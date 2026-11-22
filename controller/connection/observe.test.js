import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'
import { enableObservation } from './observe.js'

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
  const observer = enableObservation(bot, (event, payload) => events.push({ event, payload }),
    { now: () => 10_000, intervalMs: 1000 })
  return { bot, observer, events }
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
  assert.equal(last.verdict, 'SAFE')
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

test('unknown chunk coverage remains fail-closed', () => {
  const { bot, observer, events } = fixture()
  bot.world.getColumnAt = () => null
  bot.emit('spawn')
  assert.equal(events[0].payload.chunkColumnsLoaded, 0)
  assert.equal(events[0].payload.verdict, 'UNKNOWN_STATE')
  observer.dispose()
})
