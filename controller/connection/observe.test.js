import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'
import { enableObservation } from './observe.js'
import mineflayer from 'mineflayer'

function fixture() {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot.registry = { entitiesByName: { player: { metadataKeys: ['flags', 'air_supply'] } } }
  bot.entity = { id: 1, name: 'player', position: new Vec3(0.5, 64, 0.5),
    width: 0.6, height: 1.8, isInWater: false }
  bot.entities = { 1: bot.entity }
  bot.world = { getColumnAt: () => ({}) }
  bot.blockAt = () => ({ name: 'air', getProperties: () => ({}) })
  bot.setControlState = (key, value) => { bot.lastControl = [key, value] }
  bot.loadPlugin = () => { throw Error('must not load pathfinder') }
  const events = []
  let time = 10_000
  const observer = enableObservation(bot, (event, payload) => events.push({ event, payload }),
    { now: () => time, intervalMs: 1000 })
  bot.emit('inject_allowed')
  return { bot, observer, events, advance: ms => { time += ms } }
}

test('observation forbids goals and positive controls, with no player-chat listener', () => {
  const { bot, observer } = fixture()
  assert.throws(() => bot.setControlState('forward', true), /prohibits actuation/)
  assert.throws(() => bot.setControlState('jump', 1), /prohibits actuation/)
  assert.throws(() => bot.pathfinder, /prohibits pathfinder access/)
  assert.throws(() => { bot.pathfinder = { setGoal() {} } }, /prohibits pathfinder installation/)
  assert.equal(bot.listenerCount('playerChat'), 0)
  assert.equal(bot._client.listenerCount('player_chat'), 0)
  bot.setControlState('forward', false)
  assert.deepEqual(bot.lastControl, ['forward', false])
  observer.dispose()
})

test('stationary samples are sanitized and never issue movement controls', () => {
  const { bot, observer, events } = fixture()
  bot.emit('spawn')
  assert.equal(events.length, 1)
  assert.equal(events[0].payload.airPacketCount, 0)
  assert.equal(events[0].payload.verdict, 'UNKNOWN_STATE')
  bot._client.emit('entity_metadata', { entityId: 1, metadata: [{ key: 1, value: 300 }] })
  observer.sample()
  const last = events.at(-1).payload
  assert.equal(last.rawAirReceived, true)
  assert.equal(last.airPacketCount, 1)
  assert.equal(last.chunkColumnsLoaded, 9)
  assert.equal(last.entitiesObserved, true)
  assert.equal(last.blockVolumeInWater, false)
  assert.equal(last.physicsWaterFlag, 'unavailable_physics_disabled')
  assert.equal(last.inWater, null)
  assert.equal(last.verdict, 'UNKNOWN_STATE')
  for (const event of events) {
    assert.doesNotMatch(JSON.stringify(event), /position|commander|uuid|username|chat|accessToken/i)
  }
  assert.equal(bot.lastControl, undefined)
  bot.emit('end')
  observer.sample()
  assert.equal(events.length, 2)
  assert.equal(bot._client.listenerCount('entity_metadata'), 0)
  observer.dispose()
})

test('physics-enabled observation keeps navigation unknown without a disabled-physics flag', () => {
  const { bot, observer, events } = fixture()
  bot.physicsEnabled = true
  bot.emit('spawn')
  const sample = events[0].payload
  assert.equal(sample.physicsWaterFlag, undefined)
  assert.equal(sample.inWater, null)
  assert.equal(sample.blockVolumeInWater, false)
  assert.equal(sample.verdict, 'UNKNOWN_STATE')
  observer.dispose()
})

test('missing air does not hide loaded entities and nearby creeper', () => {
  const { bot, observer, events } = fixture()
  bot.entities[2] = { id: 2, name: 'creeper', position: new Vec3(3.5, 64, 0.5) }
  bot.emit('spawn')
  const sample = events[0].payload
  assert.equal(sample.rawAirReceived, false)
  assert.equal(sample.airPacketCount, 0)
  assert.equal(sample.airPacketAgeMs, null)
  assert.equal(sample.entitiesObserved, true)
  assert.equal(sample.entityCount, 2)
  assert.equal(sample.creeperDistanceBlocks, 3)
  assert.equal(sample.verdict, 'UNKNOWN_STATE')
  observer.dispose()
})

test('stale air retains packet age and independent entity observations', () => {
  const { bot, observer, events, advance } = fixture()
  bot.entities[2] = { id: 2, name: 'creeper', position: new Vec3(3.5, 64, 0.5) }
  bot._client.emit('entity_metadata', { entityId: 1, metadata: [{ key: 1, value: 300 }] })
  advance(1500)
  bot.emit('spawn')
  const sample = events[0].payload
  assert.equal(sample.rawAirReceived, true)
  assert.equal(sample.airPacketCount, 1)
  assert.equal(sample.airPacketAgeMs, 1500)
  assert.equal(sample.entitiesObserved, true)
  assert.equal(sample.entityCount, 2)
  assert.equal(sample.creeperDistanceBlocks, 3)
  assert.equal(sample.verdict, 'UNKNOWN_STATE')
  observer.dispose()
})

test('control guard installs after plugin injection, not before', () => {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  const observer = enableObservation(bot, () => {})
  assert.equal(bot.setControlState, undefined)
  bot.setControlState = () => {}
  bot.emit('inject_allowed')
  assert.throws(() => bot.setControlState('forward', true), /prohibits actuation/)
  observer.dispose()
})

test('unknown chunk coverage remains fail-closed', () => {
  const { bot, observer, events } = fixture()
  bot.world.getColumnAt = () => null
  bot.emit('spawn')
  assert.equal(events[0].payload.chunkColumnsLoaded, 0)
  assert.equal(events[0].payload.verdict, 'UNKNOWN_STATE')
  observer.dispose()
})

// Real Mineflayer 4.39.0 plugin-loader ordering without sockets or authentication.
test('real createBot defers control injection; observe guards after inject_allowed', async () => {
  const bot = mineflayer.createBot({
    username: 'offline_fixture', version: '1.21.11',
    physicsEnabled: true, disableChatSigning: true,
    auth() { /* Do not connect, authenticate, or emit session. */ }
  })
  const observer = enableObservation(bot, () => {})
  assert.equal(bot.setControlState, undefined)
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('plugin injection did not run')), 1000)
      bot.once('inject_allowed', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    assert.equal(bot.physicsEnabled, true)
    assert.equal(typeof bot.setControlState, 'function')
    assert.throws(() => bot.setControlState('forward', true), /prohibits actuation/)
    assert.throws(() => bot.pathfinder, /prohibits pathfinder access/)
    assert.equal(bot.listenerCount('playerChat'), 0)
    assert.equal(bot._client.listenerCount('player_chat'), 0)
  } finally {
    observer.dispose()
  }
})
