// Mineflayer 4.39.0 / minecraft-data 3.119.0 observations. No network or login here.
import { Vec3 } from 'vec3'

const finitePosition = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]))
export function isWater(block) {
  return block?.name === 'water' || block?.name === 'bubble_column' || block?.getProperties?.().waterlogged === true
}

// Subscribe before movement. A cached/default oxygenLevel is deliberately never
// accepted: it is rounded to 0..20 by Mineflayer. Raw air must be witnessed in an
// entity_metadata packet and ages out independently of subsequent local reads.
export function createTelemetry(bot, { now = Date.now, maxAgeMs = 1000, policy = 'strict' } = {}) {
  if (!['strict', 'supervised-dry'].includes(policy)) throw new RangeError('invalid navigation policy')
  const supervised = policy === 'supervised-dry'
  let air
  let airPacketCount = 0
  let airObservedAt
  let ended = false
  const onMetadata = packet => {
    // enableMovement attaches before Mineflayer finishes plugin injection/login.
    const metadataKeys = bot.registry?.entitiesByName?.player?.metadataKeys
    const airKey = Array.isArray(metadataKeys) ? metadataKeys.indexOf('air_supply') : -1
    if (ended || airKey < 0 || !bot.entity || packet.entityId !== bot.entity.id || !Array.isArray(packet.metadata)) return
    const entry = packet.metadata.find(item => item.key === airKey)
    if (!entry) return
    air = entry.value
    airPacketCount++
    airObservedAt = now()
  }
  const invalidate = () => { air = undefined; airObservedAt = undefined }
  const onEnd = () => { ended = true; invalidate() }
  bot._client.on('entity_metadata', onMetadata)
  bot.on('respawn', invalidate)
  bot.on('end', onEnd)

  // Include the full player volume and the floor under every sample. Pathfinder
  // nodes are feet positions; checking just their endpoint misses intervening
  // water/waterlogged cells and chunk boundaries.
  function volume(position, width, height, includeFloor) {
    const result = []
    const epsilon = 1e-6
    for (let x = Math.floor(position.x - width / 2 + epsilon); x <= Math.floor(position.x + width / 2 - epsilon); x++) {
      for (let y = Math.floor(position.y - (includeFloor ? 0.05 : 0)); y <= Math.floor(position.y + height - epsilon); y++) {
        for (let z = Math.floor(position.z - width / 2 + epsilon); z <= Math.floor(position.z + width / 2 - epsilon); z++) {
          const p = new Vec3(x, y, z)
          if (!bot.world?.getColumnAt?.(p)) return null
          const block = bot.blockAt(p)
          if (!block || typeof block.name !== 'string' || typeof block.getProperties !== 'function') return null
          const properties = block.getProperties()
          if (!properties || typeof properties !== 'object') return null
          result.push(block.name === 'water' || (supervised && block.name === 'bubble_column') || properties.waterlogged === true)
        }
      }
    }
    return result.some(Boolean)
  }
  function nearbyChunks(position) {
    // The six-block creeper gate needs loaded world coverage beyond the bot's
    // own column. This describes the client's observation region, not entities
    // outside the server's visibility/tracking policy.
    for (const x of [-8, 0, 8]) for (const z of [-8, 0, 8]) {
      if (!bot.world?.getColumnAt?.(new Vec3(position.x + x, position.y, position.z + z))) return false
    }
    return true
  }
  function entities(position) {
    if (!nearbyChunks(position) || !bot.entities || typeof bot.entities !== 'object' || Array.isArray(bot.entities) ||
        !Number.isSafeInteger(bot.entity?.id) || bot.entities[bot.entity.id] !== bot.entity) {
      return { entitiesObserved: false, creeperDistance: undefined }
    }
    let nearest = null
    for (const entity of Object.values(bot.entities)) {
      if (!entity || !finitePosition(entity.position) || typeof entity.name !== 'string' || !entity.name) {
        return { entitiesObserved: false, creeperDistance: undefined }
      }
      if (entity.name === 'creeper') {
        const distance = Math.hypot(entity.position.x - position.x, entity.position.y - position.y, entity.position.z - position.z)
        nearest = nearest === null ? distance : Math.min(nearest, distance)
      }
    }
    return { entitiesObserved: true, creeperDistance: nearest }
  }
  function readState(nextStep) {
    const sampledAt = now()
    const position = bot.entity?.position
    const width = bot.entity?.width
    const height = bot.entity?.height
    const unknown = { air, observedAt: airObservedAt, entitiesObserved: false }
    if (ended || !finitePosition(position) || !finitePosition(nextStep) ||
        !Number.isFinite(width) || width <= 0 || width > 2 ||
        !Number.isFinite(height) || height <= 0 || height > 3 ||
        (!supervised && (!Number.isFinite(airObservedAt) || airObservedAt > sampledAt || sampledAt - airObservedAt > maxAgeMs))) return unknown
    const immersed = volume(position, width, height, false)
    // Physics may already have detected water before a block notification. Either
    // positive is sufficient; unavailable physics state cannot certify dry land.
    const inWater = immersed === null || typeof bot.entity.isInWater !== 'boolean' ? undefined : immersed || bot.entity.isInWater
    const distance = Math.hypot(nextStep.x - position.x, nextStep.y - position.y, nextStep.z - position.z)
    let nextStepInWater
    if (distance <= 4) {
      const intervals = Math.max(1, Math.ceil(distance / 0.25))
      let unavailable = false
      let water = false
      for (let i = 0; i <= intervals; i++) {
        const fraction = i / intervals
        const p = new Vec3(position.x + (nextStep.x - position.x) * fraction,
          position.y + (nextStep.y - position.y) * fraction, position.z + (nextStep.z - position.z) * fraction)
        const sampled = volume(p, width, height, true)
        if (sampled === null) unavailable = true
        else water ||= sampled
      }
      nextStepInWater = unavailable ? undefined : water
    }
    return { air, inWater, nextStepInWater, ...entities(position),
      observedAt: Math.min(sampledAt, airObservedAt), airObservedAt, sampledAt }
  }
  return {
    readState,
    // Diagnostic-only raw packet evidence. Deliberately independent of the
    // navigation freshness gate, which remains unchanged.
    observeAir() {
      const sampledAt = now()
      const ageMs = Number.isFinite(airObservedAt) && Number.isFinite(sampledAt) &&
        sampledAt >= airObservedAt ? Math.round(sampledAt - airObservedAt) : null
      return { received: !ended && Number.isFinite(airObservedAt),
        ageMs, count: airPacketCount }
    },
    // Diagnostic-only entity observation, independent of air freshness.
    observeEntities() {
      const position = bot.entity?.position
      if (ended || !finitePosition(position)) {
        return { entitiesObserved: false, creeperDistance: undefined, entityCount: null }
      }
      const observation = entities(position)
      return { ...observation,
        entityCount: observation.entitiesObserved ? Object.keys(bot.entities).length : null }
    },
    // Diagnostic-only block inspection; does not infer the physics water flag.
    observeBlockImmersion() {
      const entity = bot.entity
      const position = entity?.position
      const width = entity?.width
      const height = entity?.height
      if (ended || !finitePosition(position) ||
          !Number.isFinite(width) || width <= 0 || width > 2 ||
          !Number.isFinite(height) || height <= 0 || height > 3) return null
      return volume(position, width, height, false)
    },
    get airPacketCount() { return airPacketCount },
    dispose() {
      ended = true
      bot._client.removeListener('entity_metadata', onMetadata)
      bot.removeListener('respawn', invalidate)
      bot.removeListener('end', onEnd)
    }
  }
}
