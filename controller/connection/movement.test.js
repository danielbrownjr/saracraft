import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { generateKeyPairSync, sign } from 'node:crypto'
import { createRequire } from 'node:module'
import { observeChatWire } from './chat-admission.js'
import { Vec3 } from 'vec3'
import { commandEnvelope, commandReply, enableMovement, isWater } from './movement.js'
const uuid = '00000000-0000-4000-8000-000000000001'
const envelope = text => ({ source: 'authenticated_player_chat', senderUuid: uuid, identityVerified: true, text })
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const dry = () => ({ air: 300, inWater: false, nextStepInWater: false, entitiesObserved: true,
  creeperDistance: null, sampledAt: Date.now(), observedAt: Date.now() })
function fixture({ readState = dry, report, limits = {}, preplan, policy, manualRoute = false } = {}) {
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
      if (!bot.pathfinder.goal || manualRoute) return
      route ??= [{ x: 1.5, y: 1, z: 0.5, toBreak: [], toPlace: [] }, { x: 2.5, y: 1, z: 0.5, toBreak: [], toPlace: [] }]
      bot.emit('path_update', { status: 'success', path: route })
      bot.setControlState('forward', true)
    })
  }
  const movements = { blocksToAvoid: new Set(), exclusionAreasStep: [] }
  const shutdown = new AbortController()
  const halt = enableMovement(bot, uuid, report ?? ((event, detail) => reports.push({ event, ...detail })), {
    policy, telemetry: { readState, dispose() {} }, movements, signal: shutdown.signal,
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
test('command diagnostics identify each gate without carrying packet fields', async () => {
  const f = fixture()
  try {
    f.packet('ordinary chat', 1)
    assert.equal(f.reports.length, 0)
    f.packet('!sara other', undefined, { globalIndex: undefined, verified: false, sender: 'other',
      raw: 'private', signature: 'private' })
    await flush()
    const checks = f.reports.find(x => x.event === 'movement_ignored')
    assert.deepEqual(checks, { event: 'movement_ignored', signatureVerified: false,
      encryptedTransport: true, commanderMatched: false, commanderInRoster: true, indexPresent: false,
      indexValid: false, indexFresh: false, commandParsed: false })
    f.packet('!sara follow', -1)
    await flush()
    assert.equal(f.reports.at(-1).indexPresent, true)
    assert.equal(f.reports.at(-1).indexValid, false)
    f.bot._client.cipher = null
    f.bot.players = {}
    f.packet('!sara follow', 1)
    await flush()
    assert.equal(f.reports.at(-1).encryptedTransport, false)
    assert.equal(f.reports.at(-1).commanderInRoster, false)
  } finally { await f.close() }
})

test('pinned protocol produces the signed playerChat shape, including first index zero', async () => {
  const require = createRequire(import.meta.url)
  const installChat = require('minecraft-protocol/src/client/chat')
  const { concat } = require('minecraft-protocol/src/transforms/binaryStream')
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const session = '00000000-0000-4000-8000-000000000002'
  const keyBytes = publicKey.export({ format: 'der', type: 'spki' })
  const f = fixture()
  const client = f.bot._client
  client.version = '1.21.11'
  client.write = () => {}
  installChat(client, {})
  const key = () => client.emit('player_info', { data: [{ uuid, chatSession: {
    uuid: session, publicKey: { keyBytes }
  } }] })
  function wire(plainMessage, globalIndex, index, { future = false, decorated = false } = {}) {
    const timestamp = BigInt(Date.now() + (future ? 5000 : -1000))
    const body = concat('i32', 1, 'UUID', uuid, 'UUID', session, 'i32', index, 'i64', 0n,
      'i64', timestamp / 1000n, 'i32', Buffer.byteLength(plainMessage), 'pstring', plainMessage, 'i32', 0)
    client.emit('player_chat', { senderUuid: uuid, globalIndex, index, plainMessage, timestamp, salt: 0n,
      signature: sign('RSA-SHA256', body, privateKey), previousMessages: [],
      unsignedChatContent: decorated ? { type: 'string', value: plainMessage } : undefined })
  }
  try {
    wire('!sara follow', 0, 0)
    await flush()
    assert.equal(f.reports.at(-1).chatSessionKnown, false)
    assert.equal(f.reports.at(-1).signaturePresent, true)
    key()
    wire('!sara follow', 0, 0)
    await flush()
    assert.ok(f.controller.activeTaskId)
    wire('!sara stop', 0, 1)
    await flush()
    assert.ok(f.controller.activeTaskId)
    assert.equal(f.reports.at(-1).signatureVerified, true)
    assert.equal(f.reports.at(-1).indexFresh, false)
    wire('!sara stop', 1, 2, { future: true })
    await flush()
    assert.equal(f.reports.at(-1).timestampAhead, true)
    assert.equal(f.reports.at(-1).signatureVerified, false)
    wire('!sara stop', 1, 3, { decorated: true })
    await flush()
    assert.equal(f.reports.at(-1).unsignedDecoration, true)
    assert.equal(f.reports.at(-1).signatureVerified, false)
    wire('!sara stop', 1, 4)
    await flush()
    assert.equal(f.controller.activeTaskId, null)
  } finally { await f.close() }
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

for (const policy of ['strict', 'supervised-dry']) {
  test(`Paper wire cache and signed STOP/replay gating (${policy})`, async () => {
    const require = createRequire(import.meta.url)
    const { createSerializer, createDeserializer, states } = require('minecraft-protocol')
    const installChat = require('minecraft-protocol/src/client/chat')
    const { concat } = require('minecraft-protocol/src/transforms/binaryStream')
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const session = '00000000-0000-4000-8000-000000000002'
    const keyBytes = publicKey.export({ format: 'der', type: 'spki' })
    const version = '1.21.11'
    const writer = createSerializer({ state: states.PLAY, version, isServer: true })
    const reader = createDeserializer({ state: states.PLAY, version })
    const f = fixture({ policy })
    const uncorrected = new EventEmitter()
    for (const client of [f.bot._client, uncorrected]) {
      client.version = version
      client.write = () => {}
      installChat(client, {})
      client.emit('player_info', { data: [{ uuid, chatSession: {
        uuid: session, publicKey: { keyBytes }
      } }] })
    }
    const verification = []
    uncorrected.on('playerChat', event => verification.push(event.verified === true))
    function send(plainMessage, index, refs, acknowledged, { lead = -1000, tamper = false, globalIndex = index, replayAt } = {}) {
      const timestamp = BigInt(Date.now() + lead)
      const body = concat('i32', 1, 'UUID', uuid, 'UUID', session, 'i32', index, 'i64', 0n,
        'i64', timestamp / 1000n, 'i32', Buffer.byteLength(plainMessage), 'pstring', plainMessage,
        'i32', acknowledged.length, 'buffer', Buffer.concat(acknowledged))
      const signature = sign('RSA-SHA256', body, privateKey)
      if (tamper) signature[0] ^= 0xff
      const buffer = writer.createPacketBuffer({ name: 'player_chat', params: {
        globalIndex, senderUuid: uuid, index, signature, plainMessage, timestamp, salt: 0n,
        previousMessages: refs.map(id => ({ id })), filterType: 0,
        type: { chatType: 0 }, networkName: { type: 'string', value: 'fixture' }
      } })
      for (const client of [uncorrected, f.bot._client]) {
        const { name, params } = reader.parsePacketBuffer(buffer).data
        assert.equal(typeof params.timestamp, 'object')
        assert.equal(params.timestamp.valueOf(), timestamp)
        client.emit(name, params)
      }
      if (replayAt !== undefined) {
        const { name, params } = reader.parsePacketBuffer(buffer).data
        f.bot._client.emit(name, { ...params, globalIndex: replayAt })
      }
      return signature
    }
    try {
      const first = send('ordinary fixture message', 0, [], [])
      const second = send('!sara follow', 1, [1], [first])
      await flush()
      assert.deepEqual(verification, [true, false], 'pinned verifier alone misses Paper cache slot zero')
      assert.ok(f.controller.activeTaskId)
      send('!sara stop', 2, [1, 2], [second, first])
      await flush()
      assert.equal(f.controller.activeTaskId, null)
      send('!sara follow', 3, [], [], { lead: 5000 })
      await flush()
      assert.equal(f.controller.activeTaskId, null)
      assert.equal(f.reports.at(-1).timestampPresent, true)
      assert.equal(f.reports.at(-1).timestampAhead, true)
      assert.equal(f.reports.at(-1).signatureValidWithoutTime, true)
      assert.equal(f.reports.at(-1).chainAllowsIndex, true)
      assert.ok(f.reports.at(-1).signedDeltaAfterMs >= 4000)
      assert.ok(f.reports.at(-1).signedDeltaBeforeMs >= f.reports.at(-1).signedDeltaAfterMs)
      send('!sara follow', 4, [], [], { lead: -430000 })
      await flush()
      assert.equal(f.controller.activeTaskId, null)
      assert.equal(f.reports.at(-1).timestampExpired, true)
      assert.equal(f.reports.at(-1).signatureValidWithoutTime, true)
      assert.ok(f.reports.at(-1).signedDeltaBeforeMs <= -420000)
      const bounded = send('!sara follow', 5, [], [], { lead: 180 })
      await flush()
      assert.equal(Boolean(f.controller.activeTaskId), policy === 'supervised-dry')
      assert.equal(verification.at(-1), false)
      send('!sara stop', 6, [1], [bounded], { lead: 180 })
      await flush()
      assert.equal(f.controller.activeTaskId, null)
      assert.equal(verification.at(-1), false)
      send('!sara follow', 7, [], [], { lead: 180, globalIndex: 1 })
      await flush()
      assert.equal(f.controller.activeTaskId, null)
      assert.equal(f.reports.at(-1).indexFresh, false)
      send('!sara stop', 8, [], [], { lead: 180, replayAt: 99 })
      await flush()
      assert.equal(f.reports.filter(r => r.event === 'movement_command' && r.kind === 'stop').length,
        policy === 'supervised-dry' ? 3 : 1)
      assert.equal(f.reports.findLast(r => r.event === 'movement_ignored').indexFresh, true)
      const third = send('ordinary signed message', 9, [], [])
      send('!sara follow', 10, [1], [third], { tamper: true, lead: 180 })
      await flush()
      assert.equal(f.controller.activeTaskId, null)
      assert.equal(f.reports.at(-1).packedSignaturesResolved, true)
      assert.equal(f.reports.at(-1).signatureVerified, false)
      assert.equal(f.reports.at(-1).signatureValidWithoutTime, false)
      send('!sara follow', 11, [128], [])
      await flush()
      assert.equal(f.controller.activeTaskId, null)
      assert.equal(f.reports.at(-1).packedReferences, true)
      assert.equal(f.reports.at(-1).packedSignaturesResolved, false)
    } finally { await f.close() }
  })
}

test('malformed timestamp and missing session never yield independent signature proof', () => {
  const client = new EventEmitter()
  const wire = observeChatWire(client)
  try {
    client.emit('player_chat', {
      senderUuid: uuid, globalIndex: 0, plainMessage: '!sara stop', timestamp: 'invalid', previousMessages: []
    })
    const flags = wire.take({ sender: uuid, globalIndex: 0 })
    assert.equal(flags.timestampPresent, false)
    assert.equal(flags.signedDeltaBeforeMs, null)
    assert.equal(flags.signedDeltaAfterMs, null)
    assert.equal(flags.signatureValidWithoutTime, false)
    assert.equal(flags.chainAllowsIndex, false)
  } finally { wire.dispose() }
})

for (const policy of ['strict', 'supervised-dry']) {
  test(`follow waits after route exhaustion and resumes only on verified route (${policy})`, async () => {
    const seen = []
    const f = fixture({ policy, manualRoute: true, readState: step => {
      seen.push(step)
      return step ? dry() : { ...dry(), nextStepInWater: undefined }
    } })
    try {
      const task = await f.controller.handle(envelope('!sara follow')); await flush()
      const goal = f.bot.pathfinder.goal
      assert.ok(goal)
      const route = [new Vec3(3.5, 1, 0.5)]
      f.bot.emit('path_update', {status:'success',path:route})
      f.bot.setControlState('forward', true)
      assert.equal(f.bot.controlState.forward,true)
      f.bot.entity.position = route.shift()
      f.bot.emit('physicsTick'); await flush()
      assert.equal(f.controller.activeTaskId,task.taskId)
      assert.equal(f.bot.controlState.forward,false)
      assert.equal(seen.at(-1),f.bot.entity.position)
      f.bot.setControlState('forward',true)
      assert.equal(f.bot.controlState.forward,false)
      f.bot.players.commander.entity.position = new Vec3(6.5,1,0.5)
      assert.equal(goal.hasChanged(),true)
      assert.equal(goal.hasChanged(),false)
      f.bot.emit('path_reset','goal_moved')
      f.bot.emit('physicsTick'); await flush()
      assert.equal(f.controller.activeTaskId,task.taskId)
      f.bot.setControlState('jump',true)
      assert.equal(f.bot.controlState.jump,false)
      const next = new Vec3(4.5,1,0.5)
      f.bot.emit('path_update',{status:'success',path:[next]})
      f.bot.setControlState('forward',true)
      assert.equal(f.bot.controlState.forward,true)
      assert.equal(seen.at(-1),next)
      await f.controller.stop()
      assert.equal((await task.completion).reason,'STOP')
      f.bot.emit('path_update',{status:'success',path:[next]})
      f.bot.setControlState('forward',true)
      assert.equal(f.bot.controlState.forward,false)
    } finally { await f.close() }
  })
}
test('waiting follow still trips on unsafe stationary state', async () => {
  let unsafe=false
  const f=fixture({manualRoute:true,readState:step=>({...dry(),entitiesObserved:!unsafe && !!step})})
  try {
    const task=await f.controller.handle(envelope('!sara follow'));await flush()
    unsafe=true
    f.bot.emit('physicsTick');await flush()
    assert.equal((await task.completion).reason,'UNKNOWN_STATE')
    assert.equal(f.bot.pathfinder.goal,null)
  } finally { await f.close() }
})
test('failed replanning remains fail closed', async () => {
  const f=fixture({manualRoute:true})
  try {
    const task=await f.controller.handle(envelope('!sara follow'));await flush()
    f.bot.emit('path_update',{status:'noPath',path:[]})
    assert.equal((await task.completion).reason,'UNKNOWN_STATE')
    f.bot.setControlState('forward',true)
    assert.equal(f.bot.controlState.forward,false)
  } finally { await f.close() }
})
