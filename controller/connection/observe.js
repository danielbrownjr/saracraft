import { Vec3 } from 'vec3'
import { assessNavigation } from '../navigation/safety.js'
import { createTelemetry } from './telemetry.js'

// No pathfinder import, movement adapter, commander, or gameplay command handler.
export function enableObservation(bot, report, { now = Date.now, intervalMs = 1000 } = {}) {
  if (typeof report !== 'function' || typeof now !== 'function' ||
      !Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > 1000) {
    throw new TypeError('Invalid observation configuration')
  }
  const originalControl = bot.setControlState?.bind(bot)
  if (typeof originalControl !== 'function') throw new Error('Control guard unavailable')
  bot.setControlState = (control, value) => {
    if (value !== false) throw new Error('Observation mode prohibits actuation')
    return originalControl(control, false)
  }
  // This mode loads no pathfinder. Reject even accidental goal access.
  Object.defineProperty(bot, 'pathfinder', {
    configurable: false,
    get() { throw new Error('Observation mode prohibits pathfinder access') },
    set() { throw new Error('Observation mode prohibits pathfinder installation') }
  })
  const telemetry = createTelemetry(bot, { now })
  let disposed = false
  let timer

  function sample() {
    if (disposed) return
    let details = {
      rawAirReceived: false, airPacketCount: telemetry.airPacketCount,
      airPacketAgeMs: null, chunkColumnsLoaded: 0, entityCount: null,
      entitiesObserved: false, inWater: null, creeperDistanceBlocks: null,
      verdict: 'UNKNOWN_STATE'
    }
    try {
      const position = bot.entity?.position
      const timestamp = now()
      if (position && ['x', 'y', 'z'].every(k => Number.isFinite(position[k]))) {
        let loaded = 0
        for (const x of [-8, 0, 8]) for (const z of [-8, 0, 8]) {
          if (bot.world?.getColumnAt?.(new Vec3(position.x + x, position.y, position.z + z))) loaded++
        }
        const state = telemetry.readState(position)
        let verdict
        try { verdict = assessNavigation(state, { now: timestamp }) }
        catch { verdict = { safe: false, reason: 'STATE_UNAVAILABLE' } }
        details = {
          rawAirReceived: Number.isInteger(state?.air) && telemetry.airPacketCount > 0,
          airPacketCount: telemetry.airPacketCount,
          airPacketAgeMs: Number.isFinite(state?.airObservedAt)
            ? Math.max(0, Math.round(timestamp - state.airObservedAt)) : null,
          chunkColumnsLoaded: loaded,
          entityCount: state?.entitiesObserved ? Object.keys(bot.entities).length : null,
          entitiesObserved: state?.entitiesObserved === true,
          inWater: typeof state?.inWater === 'boolean' ? state.inWater : null,
          creeperDistanceBlocks: Number.isFinite(state?.creeperDistance)
            ? Math.round(state.creeperDistance) : null,
          verdict: verdict.safe ? 'SAFE' : verdict.reason
        }
      }
    } catch { details.verdict = 'STATE_UNAVAILABLE' }
    report('telemetry_sample', details)
  }
  function onSpawn() {
    if (disposed || timer) return
    sample()
    timer = setInterval(sample, intervalMs)
    timer.unref?.()
  }
  function dispose() {
    if (disposed) return
    disposed = true
    clearInterval(timer)
    bot.removeListener('spawn', onSpawn)
    bot.removeListener('end', dispose)
    telemetry.dispose()
  }
  bot.on('spawn', onSpawn)
  bot.on('end', dispose)
  return { dispose, sample }
}
