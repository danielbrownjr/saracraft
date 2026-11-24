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
function fixture() {
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
  bot.look = () => Promise.resolve()
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
  const halt = enableMovement(bot, commander, (event, details) => reports.push({ event, ...details }), { now: () => 10000, searchTimeoutMs: 10_000, searchTickTimeoutMs: 1_000 })
  const airKey = bot.registry.entitiesByName.player.metadataKeys.indexOf('air_supply')
  bot._client.emit('entity_metadata', { entityId: 1, metadata: [{ key: airKey, value: 300 }] })
  return { bot, halt, controls, reports, water: () => { water = true } }
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
