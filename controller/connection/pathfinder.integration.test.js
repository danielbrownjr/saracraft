import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import minecraftData from 'minecraft-data'
import blockLoader from 'prismarine-block'
import physicsPackage from 'prismarine-physics'
import { Vec3 } from 'vec3'
import { enableMovement } from './movement.js'

const commander = 'adf766e8-c4f8-4a5e-9475-c48cdcf1aabb'
const flush = () => new Promise(resolve => setImmediate(resolve))

// Actual installed pathfinder, block registry and physics against a finite local
// world fixture. This never constructs a Mineflayer client or opens a socket.
function fixture({ policy = 'strict' } = {}) {
  const bot = new EventEmitter()
  bot.version = '1.21.11'
  bot.registry = minecraftData(bot.version)
  const Block = blockLoader(bot.registry)
  bot.entity = { id: 1, name: 'player', position: new Vec3(0.5, 64, 0.5), velocity: new Vec3(0, 0, 0),
    width: 0.6, height: 1.8, onGround: true, isInWater: false, isInLava: false,
    effects: {}, attributes: {}, yaw: 0, pitch: 0 }
  const target = { id: 2, name: 'player', position: new Vec3(8.5, 64, 0.5), width: 0.6, height: 1.8 }
  bot.entities = { 1: bot.entity, 2: target }
  bot.players = { commander: { uuid: commander, entity: target } }
  bot._client = new EventEmitter()
  bot._client.cipher = true
  bot.inventory = { items: () => [], slots: [] }
  bot.game = { minY: -64 }
  bot.controlState = Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map(k => [k, false]))
  const controls = []
  bot.setControlState = (key, value) => { controls.push([key, value]); bot.controlState[key] = value }
  // Match Mineflayer's real indirect implementation, rather than replacing the
  // map directly and hiding actuation-wrapper cancellation defects.
  bot.clearControlStates = () => { for (const key of Object.keys(bot.controlState)) bot.setControlState(key, false) }
  bot.look = (yaw, pitch) => {
    Object.assign(bot.entity, { yaw, pitch })
    return Promise.resolve()
  }
  bot.chat = () => {}
  let water = false
  bot.blockAt = p => {
    if (Math.abs(p.x) > 40 || Math.abs(p.z) > 40) return null
    const name = p.y < 64 ? 'stone' : (water && p.x >= 1 && p.y === 64 ? 'water' : 'air')
    const block = Block.fromStateId(bot.registry.blocksByName[name].minStateId, 0)
    block.position = p.floored()
    return block
  }
  bot.world = { getColumnAt: () => ({}) }
  bot.physics = physicsPackage.Physics(bot.registry, { getBlock: p => bot.blockAt(p) })
  bot.loadPlugin = plugin => plugin(bot)
  const reports = []
  const halt = enableMovement(bot, commander, (event, details) => reports.push({ event, ...details }), { policy, now: () => 10000, searchTimeoutMs: 10_000, searchTickTimeoutMs: 1_000 })
  const airKey = bot.registry.entitiesByName.player.metadataKeys.indexOf('air_supply')
  if (policy === 'strict') bot._client.emit('entity_metadata', { entityId: 1, metadata: [{ key: airKey, value: 300 }] })
  return { bot, halt, controls, reports, target, water: () => { water = true } }
}

test('real pathfinder controls are admitted on dry ground, then synchronously cleared on water trip', async () => {
  const f = fixture()
  try {
    const envelope = { source: 'authenticated_player_chat', senderUuid: commander,
      identityVerified: true, text: '!sara follow' }
    const task = await f.halt.controller.handle(envelope)
    await flush()
    assert.notEqual(f.bot.pathfinder.goal, null, 'safe preplan must admit the real goal')
    f.bot.emit('physicsTick')
    await flush()
    assert.equal(f.bot.controlState.forward, true, 'real pathfinder must reach guarded forward actuation')
    assert.ok(f.controls.some(([key, value]) => key === 'forward' && value))
    f.water()
    f.bot.emit('blockUpdate')
    // The next actual pathfinder control call must see the changed swept route,
    // even if an earlier async monitor result was safe.
    f.bot.setControlState('forward', true)
    const final = await task.completion
    assert.equal(final.state, 'CANCELLED')
    assert.equal(final.reason, 'WATER_UNSAFE')
    assert.equal(f.bot.pathfinder.goal, null)
    assert.ok(Object.values(f.bot.controlState).every(value => value === false))
    assert.equal(final.movementStopped, false)
    f.bot.setControlState('forward', true)
    assert.equal(f.bot.controlState.forward, false)
  } finally { f.halt(); f.halt.dispose() }
})

test('supervised dry follow, verified commander STOP, come and follow again with real pathfinder', async () => {
  const f = fixture({ policy: 'supervised-dry' })
  const packet = (word, globalIndex, extra = {}) => f.bot._client.emit('playerChat', {
    sender: commander, plainMessage: `!sara ${word}`, globalIndex, verified: true, ...extra
  })
  const advance = async (ticks) => {
    for (let i = 0; i < ticks; i++) {
      f.bot.emit('physicsTick')
      f.bot.physics.simulatePlayer(new physicsPackage.PlayerState(f.bot, f.bot.controlState),
        { getBlock: p => f.bot.blockAt(p) }).apply(f.bot)
      await flush()
    }
  }
  try {
    packet('follow', 1, { verified: false })
    await flush()
    assert.equal(f.halt.controller.activeTaskId, null)
    packet('follow', 1)
    await flush()
    assert.ok(f.bot.pathfinder.goal)
    const start = f.bot.entity.position.clone()
    await advance(15)
    assert.ok(f.bot.entity.position.distanceTo(start) > 1)
    f.target.position = new Vec3(11.5, 64, 0.5)
    await advance(10)
    assert.ok(f.bot.pathfinder.goal, 'moving commander must remain a valid dynamic goal')
    packet('stop', 2)
    await flush()
    assert.equal(f.bot.pathfinder.goal, null)
    assert.ok(Object.values(f.bot.controlState).every(value => value === false))
    await advance(12)
    const stopped = f.bot.entity.position.clone()
    await advance(5)
    assert.ok(f.bot.entity.position.distanceTo(stopped) < 0.05)
    packet('come', 3)
    await flush()
    await advance(60)
    assert.ok(f.bot.entity.position.distanceTo(f.target.position) <= 2.5)
    assert.equal(f.halt.controller.activeTaskId, null)
    f.target.position = new Vec3(16.5, 64, 0.5)
    packet('follow', 4)
    await flush()
    const followAgain = f.bot.entity.position.clone()
    await advance(15)
    assert.ok(f.bot.entity.position.distanceTo(followAgain) > 1)
    f.bot.emit('respawn')
    assert.equal(f.bot.pathfinder.goal, null)
    assert.ok(Object.values(f.bot.controlState).every(value => value === false))
    assert.deepEqual(f.reports.filter(row => row.event === 'movement_command' && row.accepted)
      .map(row => row.kind), ['follow', 'stop', 'comeHere', 'follow'])
  } finally { f.halt(); f.halt.dispose() }
})
