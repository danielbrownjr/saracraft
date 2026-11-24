import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'
import { commandEnvelope, commandReply, enableMovement, isWater } from './movement.js'
const uuid = '00000000-0000-4000-8000-000000000001'
const envelope = text => ({ source: 'authenticated_player_chat', senderUuid: uuid, identityVerified: true, text })
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const dry = () => ({ air: 300, inWater: false, nextStepInWater: false, entitiesObserved: true,
  creeperDistance: null, observedAt: Date.now() })
function fixture({ readState = dry, report, limits = {}, preplan } = {}) {
  const bot = new EventEmitter()
  bot._client = new EventEmitter(); bot._client.cipher = {}
  bot.entity = { id: 1, position: new Vec3(0.5, 1, 0.5), velocity: new Vec3(0, 0, 0), onGround: true, isInWater: false }
  bot.players = { commander: { uuid, entity: { position: new Vec3(5.5, 1, 0.5) } } }
  const acts = []; const reports = []
  bot.controlState = { forward: false, jump: false, sprint: false }
  bot.setControlState = (key, value) => { bot.controlState[key] = value; acts.push([key, value]) }
  // Match Mineflayer physics.js: clearControlStates calls the CURRENT wrapper.
  bot.clearControlStates = () => { for (const key of Object.keys(bot.controlState)) bot.setControlState(key, false) }
  bot.chat = text => acts.push(['chat', text])
  bot.registry = { blocksByName: { water: { id: 1 } } }
  let route
  bot.pathfinder = {
    setMovements() {},
    setGoal(goal, dynamic) { this.goal = goal; this.dynamic = dynamic; bot.emit('goal_updated', goal); bot.emit('path_reset', 'goal_updated'); bot.clearControlStates(); acts.push(['goal', goal]) },
    getPathFromTo: function* () { yield { result: preplan ?? { status: 'success', path: [{ x: 1.5, y: 1, z: 0.5, toBreak: [], toPlace: [] }] } } }
  }
  bot.loadPlugin = () => {
    bot.on('physicsTick', () => {
      if (!bot.pathfinder.goal) return
      route ??= [{ x: 1.5, y: 1, z: 0.5, toBreak: [], toPlace: [] }, { x: 2.5, y: 1, z: 0.5, toBreak: [], toPlace: [] }]
      bot.emit('path_update', { status: 'success', path: route })
      bot.setControlState('forward', true)
    })
  }
  const movements = { blocksToAvoid: new Set(), exclusionAreasStep: [] }
  const shutdown = new AbortController()
  const halt = enableMovement(bot, uuid, report ?? ((event, detail) => reports.push({ event, ...detail })), {
    telemetry: { readState, dispose() {} }, movements, signal: shutdown.signal,
    controllerOptions: { limits: { haltMs: 20, stopWaitMs: 20, ...limits } }, readTimeoutMs: 10, haltTimeoutMs: 10
  })
  return { bot, acts, reports, halt, controller: halt.controller, shutdown,
    packet(text, globalIndex = 0, extra = {}) { bot._client.emit('playerChat', { sender: uuid, plainMessage: text, globalIndex, verified: true, ...extra }) },
    async close() { shutdown.abort(); await flush(); halt.dispose() },
    get route() { return route } }
}

test('recovered command admission requires authenticated commander and movement command', () => {
  const packet = { sender: uuid, authenticated: true, plainMessage: '!sara come-here' }
  assert.equal(commandEnvelope(packet, uuid)?.senderUuid, uuid)
  for (const extra of [{ authenticated: false }, { sender: '23d762da-e683-4b0c-82a1-d77c201ec6a8' }, { plainMessage: '!sara gather oak_log 2' }]) assert.equal(commandEnvelope({ ...packet, ...extra }, uuid), null)
})
test('water recognizes waterlogged blocks; STOP acknowledgement never claims cessation', () => {
  assert.ok(isWater({ name: 'water' }))
  assert.ok(isWater({ name: 'oak_stairs', getProperties: () => ({ waterlogged: true }) }))
  assert.equal(isWater(null), false)
  assert.equal(commandReply('follow', { accepted: true }), 'Following!')
  assert.equal(commandReply('comeHere', { accepted: true }), 'Coming!')
  assert.equal(commandReply('stop', { stopped: true }), null)
  assert.match(commandReply('stop', { haltState: 'acknowledged' }), /unverified/)
})
test('safe dry goal and pathfinder controls pass R2, STOP clears active states', async () => {
  const f = fixture(); const task = await f.controller.handle(envelope('!sara follow')); await flush()
  assert.ok(f.bot.pathfinder.goal)
  f.bot.emit('physicsTick'); await flush()
  assert.equal(f.bot.controlState.forward, true)
  const stopped = await f.controller.stop()
  assert.equal(stopped.haltState, 'acknowledged'); assert.equal(stopped.movementStopped, false)
  assert.equal(f.bot.controlState.forward, false); assert.equal(f.bot.pathfinder.goal, null)
  assert.equal((await task.completion).state, 'CANCELLED'); await f.close()
})
test('come-here snapshots destination while follow remains active near commander', async () => {
  const f = fixture(); const task = await f.controller.handle(envelope('!sara come')); await flush()
  const goal = f.bot.pathfinder.goal
  f.bot.players.commander.entity.position = new Vec3(9, 1, 0.5)
  assert.equal(goal.x, 5)
  f.bot.entity.position = new Vec3(5, 1, 0.5); f.bot.emit('goal_reached'); await flush()
  assert.equal((await task.completion).state, 'COMPLETED')
  const follow = await f.controller.handle(envelope('!sara follow')); await flush()
  f.bot.emit('goal_reached'); await flush(); assert.equal(f.controller.activeTaskId, follow.taskId)
  await f.close()
})
for (const [reason, override] of [
  ['UNKNOWN_STATE', { nextStepInWater: undefined }], ['UNKNOWN_STATE', { entitiesObserved: false }],
  ['UNKNOWN_STATE', { observedAt: 0 }], ['WATER_UNSAFE', { nextStepInWater: true }],
  ['WATER_EXIT_REQUIRED', { inWater: true }], ['CREEPER_NEARBY', { creeperDistance: 6 }]
]) test(`unsafe pregoal ${reason} cancels with no ordinary actuation`, async () => {
  const f = fixture({ readState: () => ({ ...dry(), ...override }) })
  const task = await f.controller.handle(envelope('!sara follow'))
  const final = await task.completion; await flush()
  assert.equal(final.reason, reason); assert.equal(final.state, 'CANCELLED')
  assert.equal(f.acts.some(([key, value]) => key === 'goal' && value !== null), false)
  assert.equal(f.bot.controlState.jump, false)
  if (reason === 'WATER_EXIT_REQUIRED') assert.equal(f.reports.find(r => r.event === 'movement_safety').recovery, 'unavailable_no_verified_escape')
  await f.close()
})
test('state change after a safe check blocks controls synchronously and clears Mineflayer states', async () => {
  let unsafe = false
  const f = fixture({ readState: () => ({ ...dry(), nextStepInWater: unsafe }) })
  const task = await f.controller.handle(envelope('!sara follow')); await flush()
  f.bot.emit('physicsTick'); await flush(); assert.equal(f.bot.controlState.forward, true)
  unsafe = true
  f.bot.setControlState('jump', true)
  assert.equal(f.bot.controlState.forward, false); assert.equal(f.bot.controlState.jump, false)
  assert.equal((await task.completion).reason, 'WATER_UNSAFE')
  f.bot.setControlState('forward', true); assert.equal(f.bot.controlState.forward, false)
  await f.close()
})
test('actual mutable route reference advances to next pathfinder step', async () => {
  const seen = []
  const f = fixture({ readState: step => { seen.push(step?.x); return dry() } })
  await f.controller.handle(envelope('!sara follow')); await flush(); f.bot.emit('physicsTick'); await flush()
  f.route.shift(); f.bot.setControlState('jump', false)
  assert.equal(seen.at(-1), 2.5); await f.close()
})
test('hung telemetry reads terminate before any goal and STOP interrupts pending reads', async () => {
  const f = fixture({ readState: () => new Promise(() => {}) })
  const task = await f.controller.handle(envelope('!sara follow'))
  assert.equal((await task.completion).reason, 'STATE_UNAVAILABLE'); await f.close()
  let resolve
  const g = fixture({ readState: () => new Promise(yes => { resolve = yes }) })
  const pending = await g.controller.handle(envelope('!sara follow')); await flush()
  await g.controller.stop(); resolve(dry()); await flush()
  assert.equal((await pending.completion).reason, 'STOP')
  assert.equal(g.acts.some(([key, goal]) => key === 'goal' && goal), false); await g.close()
})
test('chat verified field, encryption, roster and replay index all gate actuation', async () => {
  const f = fixture()
  f.packet('!sara follow', 0, { verified: undefined }); f.packet('!sara follow', 0, { verified: false }); await flush()
  assert.equal(f.controller.activeTaskId, null)
  f.packet('!sara follow', 1); await flush(); assert.ok(f.controller.activeTaskId)
  f.packet('!sara stop', 1); await flush(); assert.ok(f.controller.activeTaskId)
  f.packet('!sara stop', 2); await flush(); assert.equal(f.controller.activeTaskId, null)
  assert.equal(f.reports.filter(r => r.event === 'movement_ignored').length, 3)
  f.bot._client.cipher = null; f.packet('!sara follow', 3); await flush(); assert.equal(f.controller.activeTaskId, null)
  f.bot._client.cipher = {}
  f.bot.players = {}; f.packet('!sara follow', 4); await flush(); assert.equal(f.controller.activeTaskId, null)
  f.bot.players = { commander: { uuid, entity: { position: new Vec3(5.5, 1, 0.5) } } }
  f.packet('!sara follow', 5, { sender: '11111111-1111-4111-8111-111111111111' })
  f.packet('!sara follow', 6, { globalIndex: undefined }); await flush()
  assert.equal(f.controller.activeTaskId, null)
  await f.close()
})
test('rapid replacements let only the latest accepted command resume', async () => {
  const f = fixture(); f.packet('!sara follow', 1); await flush()
  f.packet('!sara come', 2); f.packet('!sara follow', 3); await flush()
  const live = f.controller.events.filter(e => e.state === 'RUNNING')
  assert.deepEqual(live.map(e => e.kind), ['follow', 'follow'])
  await f.close()
})
test('disconnect and global shutdown prevent queued callbacks from restarting controls', async () => {
  for (const end of [f => f.bot.emit('end'), f => f.shutdown.abort()]) {
    const f = fixture(); const task = await f.controller.handle(envelope('!sara follow')); await flush()
    f.bot.emit('physicsTick'); end(f); await flush()
    assert.equal((await task.completion).state, 'CANCELLED')
    f.bot.setControlState('forward', true); f.packet('!sara follow', 7); await flush()
    assert.equal(f.bot.controlState.forward, false); assert.equal(f.controller.activeTaskId, null); await f.close()
  }
})
test('incomplete planning rejects goal, and reporting failures cannot strand tasks', async () => {
  const f = fixture({ preplan: { status: 'partial', path: [] }, report: () => { throw Error('disk unavailable') } })
  const task = await f.controller.handle(envelope('!sara follow'))
  assert.equal((await task.completion).state, 'CANCELLED'); await f.close()
})
test('deadline expiration cancels ordinary movement and leaves one terminal state', async () => {
  const f = fixture({ limits: { followMs: 8 } })
  const task = await f.controller.handle(envelope('!sara follow')); const final = await task.completion
  assert.equal(final.state, 'TIMED_OUT'); assert.equal(final.reason, 'TIME_LIMIT')
  assert.equal(f.bot.pathfinder.goal, null); assert.equal(f.controller.events.filter(e => e.state === 'TIMED_OUT').length, 1)
  await f.close()
})

test('reliable already-submerged state wins over unavailable ordinary planning', async () => {
  const f = fixture({ readState: () => ({ ...dry(), inWater: true, nextStepInWater: true }), preplan: { status: 'noPath', path: [] } })
  const task = await f.controller.handle(envelope('!sara follow'))
  assert.equal((await task.completion).reason, 'WATER_EXIT_REQUIRED')
  await f.close()
})


test('pre-spawn setup failures fail closed without throwing from spawn listener', async () => {
  const bot = new EventEmitter(); bot._client = new EventEmitter()
  bot.clearControlStates = () => {}
  const errors = []; bot.on('error', error => errors.push(error.message))
  const halt = enableMovement(bot, uuid, () => { throw Error('report unavailable') })
  bot.entity = { position: new Vec3(0, 0, 0) }
  bot.registry = {}
  bot.loadPlugin = () => { throw Error('unsupported registry') }
  assert.doesNotThrow(() => bot.emit('spawn'))
  await flush(); assert.deepEqual(errors, ['MOVEMENT_SETUP_FAILED'])
  assert.equal(halt.controller, undefined); halt.dispose()
})

test('disposal permanently gates admission even when halt throws', async () => {
  const f = fixture()
  const task = await f.controller.handle(envelope('!sara follow')); await flush()
  f.bot.on('goal_updated', goal => { if (goal === null) throw Error('transport failed') })
  assert.throws(() => f.halt.dispose(), /HALT_FAILED|transport failed/)
  const final = await task.completion
  assert.equal(final.state, 'CANCELLED')
  f.packet('!sara follow', 50); f.bot.setControlState('forward', true); await flush()
  assert.equal(f.bot.controlState.forward, false)
  assert.equal(f.controller.activeTaskId, null)
  f.bot.removeAllListeners('goal_updated'); await f.close()
})


test('throwing telemetry preserves STATE_UNAVAILABLE in controller and monitor reports', async () => {
  const f = fixture({ readState: () => { throw Error('disconnected getter') } })
  const task = await f.controller.handle(envelope('!sara follow'))
  assert.equal((await task.completion).reason, 'STATE_UNAVAILABLE')
  await flush()
  assert.equal(f.reports.find(r => r.event === 'movement_safety').reason, 'STATE_UNAVAILABLE')
  await f.close()
})
