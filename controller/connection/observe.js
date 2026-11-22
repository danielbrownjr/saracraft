import { Vec3 } from 'vec3'
import { createTelemetry } from './telemetry.js'

// No pathfinder import, movement adapter, commander, or gameplay command handler.
export function enableObservation(bot, report, { now = Date.now, intervalMs = 1000 } = {}) {
  if (typeof report !== 'function' || typeof now !== 'function' ||
      !Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > 1000) {
    throw new TypeError('Invalid observation configuration')
  }
  // Mineflayer injects its physics plugin on inject_allowed *after* createBot()
  // returns. Wrapping the property earlier would either throw or be overwritten.
  // Our listener is registered after Mineflayer's loader, so it runs afterward.
  let guardInstalled = false
  let disposed = false
  function installControlGuard() {
    if (disposed) return
    const originalControl = bot.setControlState?.bind(bot)
    if (typeof originalControl !== 'function') {
      bot.emit('error', new Error('Observation control guard unavailable after injection'))
      return
    }
    bot.setControlState = (control, value) => {
      if (value !== false) throw new Error('Observation mode prohibits actuation')
      return originalControl(control, false)
    }
    guardInstalled = true
  }
  bot.once('inject_allowed', installControlGuard)
  // This mode loads no pathfinder. Reject even accidental goal access.
  Object.defineProperty(bot, 'pathfinder', {
    configurable: false,
    get() { throw new Error('Observation mode prohibits pathfinder access') },
    set() { throw new Error('Observation mode prohibits pathfinder installation') }
  })
  const telemetry = createTelemetry(bot, { now })
  let timer

  function sample() {
    if (disposed) return
    let details = {
      rawAirReceived: false, airPacketCount: telemetry.airPacketCount,
      airPacketAgeMs: null, chunkColumnsLoaded: 0, entityCount: null,
      entitiesObserved: false, inWater: null, blockVolumeInWater: null,
      physicsWaterFlag: 'unavailable_physics_disabled', creeperDistanceBlocks: null,
      verdict: 'UNKNOWN_STATE'
    }
    try {
      const position = bot.entity?.position
      const timestamp = now()
      if (guardInstalled && position && ['x', 'y', 'z'].every(k => Number.isFinite(position[k]))) {
        let loaded = 0
        for (const x of [-8, 0, 8]) for (const z of [-8, 0, 8]) {
          if (bot.world?.getColumnAt?.(new Vec3(position.x + x, position.y, position.z + z))) loaded++
        }
        // Independent diagnostics must not be hidden by the navigation
        // readState air-freshness gate. Never use these to authorize movement.
        const air = telemetry.observeAir()
        const observedEntities = telemetry.observeEntities()
        details = {
          rawAirReceived: air.received,
          airPacketCount: air.count,
          airPacketAgeMs: air.ageMs,
          chunkColumnsLoaded: loaded,
          entityCount: observedEntities.entityCount,
          entitiesObserved: observedEntities.entitiesObserved,
          // With physics disabled Mineflayer never initializes isInWater.
          // Report observed block-volume immersion separately without falsely
          // claiming the combined navigation verdict has passed.
          inWater: null,
          blockVolumeInWater: telemetry.observeBlockImmersion(),
          physicsWaterFlag: 'unavailable_physics_disabled',
          creeperDistanceBlocks: Number.isFinite(observedEntities.creeperDistance)
            ? Math.round(observedEntities.creeperDistance) : null,
          verdict: 'UNKNOWN_STATE'
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
    bot.removeListener('inject_allowed', installControlGuard)
    bot.removeListener('end', dispose)
    telemetry.dispose()
  }
  bot.on('spawn', onSpawn)
  bot.on('end', dispose)
  return { dispose, sample }
}
