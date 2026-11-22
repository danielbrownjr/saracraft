import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'
import { assessNavigation } from '../navigation/safety.js'
import { createTelemetry, isWater } from './telemetry.js'

function fixture() {
  let time = 10000
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot.registry = { entitiesByName: { player: { metadataKeys: ['flags', 'air_supply'] } } }
  bot.entity = { id: 1, name: 'player', position: new Vec3(0.5, 64, 0.5), width: 0.6, height: 1.8, isInWater: false }
  bot.entities = { 1: bot.entity }
  const blocks = new Map()
  bot.world = { getColumnAt: () => ({}) }
  bot.blockAt = p => blocks.get(p.toString()) ?? { name: 'air', getProperties: () => ({}) }
  const telemetry = createTelemetry(bot, { now: () => time })
  const air = (value = 300) => bot._client.emit('entity_metadata', { entityId: 1, metadata: [{ key: 1, value }] })
  const step = new Vec3(1.5, 64, 0.5)
  const read = () => telemetry.readState(step)
  const assess = () => assessNavigation(read(), { now: time })
  return { bot, blocks, telemetry, air, step, read, assess, advance: ms => { time += ms } }
}

test('raw packet air is mandatory; rounded oxygen and preexisting metadata are not substituted', () => {
  const f = fixture()
  f.bot.oxygenLevel = 20
  f.bot.entity.metadata = { 1: 300 }
  assert.equal(f.assess().reason, 'UNKNOWN_STATE')
  f.air(299)
  assert.equal(f.read().air, 299)
  assert.deepEqual(f.assess(), { safe: true })
})

test('raw air observation expires and does not become fresh through local reads', () => {
  const f = fixture()
  f.air()
  f.advance(1000)
  assert.equal(f.assess().safe, true)
  f.advance(1)
  assert.equal(f.assess().reason, 'UNKNOWN_STATE')
  assert.equal(f.read().observedAt, 10000)
  f.air()
  assert.equal(f.assess().safe, true)
})

test('missing block or chunk data is unknown rather than safe', () => {
  const f = fixture()
  f.air()
  f.bot.blockAt = () => null
  assert.equal(f.assess().reason, 'UNKNOWN_STATE')
  const g = fixture()
  g.air()
  g.bot.world.getColumnAt = () => null
  assert.equal(g.assess().reason, 'UNKNOWN_STATE')
})

test('swept player volume catches intermediate waterlogged cells and floor water', () => {
  const f = fixture()
  f.air()
  f.blocks.set(new Vec3(1, 65, 0).toString(), { name: 'oak_stairs', getProperties: () => ({ waterlogged: true }) })
  assert.equal(f.assess().reason, 'WATER_UNSAFE')
  const g = fixture()
  g.air()
  g.blocks.set(new Vec3(1, 63, 0).toString(), { name: 'water', getProperties: () => ({}) })
  assert.equal(g.assess().reason, 'WATER_UNSAFE')
})

test('current immersion remains distinct from proposed water entry', () => {
  const f = fixture()
  f.air()
  f.bot.entity.isInWater = true
  assert.equal(f.assess().reason, 'WATER_EXIT_REQUIRED')
  f.bot.entity.isInWater = undefined
  assert.equal(f.assess().reason, 'UNKNOWN_STATE')
})

test('complete valid local enumeration finds nearest creeper using three-dimensional distance', () => {
  const f = fixture()
  f.air()
  f.bot.entities[2] = { name: 'creeper', position: f.bot.entity.position.offset(3, 4, 0) }
  assert.equal(f.read().creeperDistance, 5)
  assert.equal(f.assess().reason, 'CREEPER_NEARBY')
  f.bot.entities[2].position = f.bot.entity.position.offset(0, 7, 0)
  assert.equal(f.assess().safe, true)
  delete f.bot.entities[2]
  assert.equal(f.read().creeperDistance, null)
})

test('unknown entity classification, positions, or collection is incomplete', () => {
  for (const incomplete of [{ name: undefined, position: new Vec3(0, 64, 0) },
    { name: 'creeper', position: { x: NaN, y: 64, z: 0 } }]) {
    const f = fixture()
    f.air()
    f.bot.entities[2] = incomplete
    assert.equal(f.read().entitiesObserved, false)
    assert.equal(f.assess().reason, 'UNKNOWN_STATE')
  }
  const f = fixture()
  f.air()
  f.bot.entities = undefined
  assert.equal(f.assess().reason, 'UNKNOWN_STATE')
})

test('unknown, distant or absent proposed step cannot authorize navigation', () => {
  const f = fixture()
  f.air()
  for (const step of [undefined, {}, new Vec3(10, 64, 0)]) {
    assert.equal(assessNavigation(f.telemetry.readState(step), { now: 10000 }).reason, 'UNKNOWN_STATE')
  }
})

test('other entity packets cannot refresh raw air; respawn and disconnect invalidate it', () => {
  const f = fixture()
  f.bot._client.emit('entity_metadata', { entityId: 2, metadata: [{ key: 1, value: 300 }] })
  assert.equal(f.assess().reason, 'UNKNOWN_STATE')
  f.air()
  f.bot.emit('respawn')
  assert.equal(f.assess().reason, 'UNKNOWN_STATE')
  f.air()
  assert.equal(f.assess().safe, true)
  f.bot.emit('end')
  f.air()
  assert.equal(f.assess().reason, 'UNKNOWN_STATE')
  f.telemetry.dispose()
  assert.equal(f.bot._client.listenerCount('entity_metadata'), 0)
})

test('missing registry metadata mapping fails closed and water helper identifies both forms', () => {
  const f = fixture()
  f.telemetry.dispose()
  f.bot.registry = {}
  const t = createTelemetry(f.bot)
  f.air()
  assert.equal(t.readState(f.step).air, undefined)
  assert.equal(isWater({ name: 'water' }), true)
  assert.equal(isWater({ name: 'stairs', getProperties: () => ({ waterlogged: true }) }), true)
  assert.equal(isWater(null), false)
  t.dispose()
})


test('pre-login attachment resolves registry dynamically when raw metadata arrives', () => {
  const f = fixture()
  f.telemetry.dispose()
  const registry = f.bot.registry
  f.bot.registry = undefined
  const t = createTelemetry(f.bot, { now: () => 10000 })
  f.air()
  assert.equal(t.readState(f.step).air, undefined)
  f.bot.registry = registry
  f.air(299)
  assert.equal(t.readState(f.step).air, 299)
  assert.equal(assessNavigation(t.readState(f.step), { now: 10000 }).safe, true)
  t.dispose()
})

test('empty or missing-self entity maps cannot certify complete enumeration', () => {
  const f = fixture()
  f.air()
  f.bot.entities = {}
  assert.equal(f.read().entitiesObserved, false)
  assert.equal(f.assess().reason, 'UNKNOWN_STATE')
  f.bot.entities[1] = { ...f.bot.entity }
  assert.equal(f.assess().reason, 'UNKNOWN_STATE')
  f.bot.entities[1] = f.bot.entity
  assert.equal(f.assess().safe, true)
})
