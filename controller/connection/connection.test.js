import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { checkTarget, classify, identity, target, verifiedProfile, verifyConnection } from './connection.js'

test('target is pinned to the private Paper server and Minecraft version', () => {
  checkTarget(target)
  assert.throws(() => checkTarget({ ...target, version: '26.1' }))
  assert.throws(() => checkTarget({ ...target, host: '203.0.113.1' }))
  assert.throws(() => checkTarget({ ...target, port: 25566 }))
})

test('only the approved authenticated profile can connect', () => {
  const profile = { name: identity.name, id: identity.uuid.replaceAll('-', '') }
  assert.equal(verifiedProfile({ token: 'mock', profile }), profile)
  for (const result of [
    { token: 'mock', profile: { ...profile, name: 'other' } },
    { token: 'mock', profile: { ...profile, id: 'wrong' } },
    { profile }, { error: 'expired_token' }, undefined
  ]) assert.throws(() => verifiedProfile(result), /profile mismatch/)
})

test('classifies expired credentials, allowlist, incompatible versions and disconnection', () => {
  assert.equal(classify('auth', new Error('expired_token')), 'authentication')
  assert.equal(classify('kicked', { translate: 'multiplayer.disconnect.not_whitelisted' }), 'allowlist')
  assert.equal(classify('kicked', 'Outdated client'), 'version_mismatch')
  assert.equal(classify('error', { code: 'ETIMEDOUT' }), 'network')
  assert.equal(classify('end'), 'disconnection')
})

async function scenarios(sequence, options = {}) {
  let attempts = 0
  let quits = 0
  const events = []
  const result = await verifyConnection({
    config: target, closeMs: 20, heartbeatMs: 10, timeoutMs: 60, retryDelayMs: 1, ...options,
    report: (event, detail) => events.push({ event, detail }),
    createBot() {
      const action = sequence[attempts++]
      const bot = new EventEmitter()
      bot.entity = { id: 17 }
      bot.quit = () => {
        quits++
        queueMicrotask(() => bot.emit('end', 'quitting'))
      }
      setImmediate(() => action(bot))
      return bot
    }
  })
  return { result, attempts, quits, events }
}

test('requires spawn, chunk and player presence, then waits for clean end', async () => {
  const { result, attempts, quits, events } = await scenarios([bot => {
    bot.emit('login')
    bot.emit('playerJoined', { uuid: identity.uuid })
    bot.emit('spawn')
    bot.emit('chunkColumnLoad')
  }])
  assert.equal(result, true)
  assert.equal(attempts, 1)
  assert.equal(quits, 1)
  // Heartbeats may interleave with lifecycle milestones under runner load.
  // A separate test asserts heartbeat emission; only order milestones here.
  assert.deepEqual(events.map(e => e.event).filter(e => e !== 'heartbeat'),
    ['connecting', 'login', 'player_presence', 'spawn', 'world_received', 'disconnected'])
})

test('retries one network failure and classifies failures without logging raw secrets', async () => {
  const { result, attempts, quits, events } = await scenarios([
    bot => bot.emit('error', new Error('socket timeout with access_token=secret')),
    bot => bot.emit('error', new Error('socket timeout with refresh_token=secret'))
  ])
  assert.equal(result, false)
  assert.equal(attempts, 2)
  assert.equal(quits, 2)
  assert.equal(events.filter(e => e.event === 'reconnecting').length, 1)
  assert.ok(!JSON.stringify(events).includes('secret'))
})

test('observation supports exactly one connection attempt', async () => {
  const result = await scenarios([bot => bot.emit('error', new Error('socket timeout'))], { maxAttempts: 1 })
  assert.equal(result.result, false)
  assert.equal(result.attempts, 1)
  assert.equal(result.events.some(e => e.event === 'reconnecting'), false)
})

test('invalid connection attempt limits fail before constructing a bot', async () => {
  for (const maxAttempts of [0, -1, 3, 1.5, NaN]) {
    await assert.rejects(verifyConnection({ config: target, maxAttempts,
      report() {}, createBot() { assert.fail('must not create bot') } }), /Invalid bounded/)
  }
})

test('allowlist rejection and loss after spawn do not reconnect', async () => {
  const kicked = await scenarios([bot => bot.emit('kicked', 'not whitelisted')])
  assert.equal(kicked.attempts, 1)
  assert.deepEqual(kicked.events.find(e => e.event === 'failed').detail, { category: 'allowlist' })
  const lost = await scenarios([bot => {
    bot.emit('spawn')
    bot.emit('end')
  }])
  assert.equal(lost.result, false)
  assert.equal(lost.attempts, 1)
})

test('reports heartbeat and handles explicit shutdown', async () => {
  const controller = new AbortController()
  const { result, attempts, quits, events } = await scenarios([
    () => setTimeout(() => controller.abort(), 25)
  ], { signal: controller.signal })
  assert.equal(result, false)
  assert.equal(attempts, 1)
  assert.equal(quits, 1)
  assert.ok(events.some(e => e.event === 'heartbeat'))
  assert.equal(events.at(-1).event, 'disconnected')
})

function ready(bot) {
  bot.emit('spawn')
  bot.emit('chunkColumnLoad')
  bot.emit('playerJoined', { uuid: identity.uuid })
}

test('movement session stays after readiness and halts before bounded clean quit', async () => {
  const ordering = []
  const { result, quits, events } = await scenarios([bot => {
    const quit = bot.quit
    bot.quit = () => { ordering.push('quit'); quit() }
    ready(bot)
    ordering.push('ready')
  }], { stay: true, sessionMs: 10, onClosing: () => ordering.push('halt') })
  assert.equal(result, true)
  assert.equal(quits, 1)
  assert.deepEqual(ordering, ['ready', 'halt', 'quit'])
  assert.deepEqual(events.filter(e => e.event === 'movement_ready').map(e => e.detail), [{ durationSeconds: 0.01 }])
})

test('shutdown cancels a ready movement session and halts once without retry', async () => {
  const controller = new AbortController()
  let halts = 0
  const result = await scenarios([bot => {
    ready(bot)
    controller.abort()
  }], { stay: true, sessionMs: 100, signal: controller.signal, onClosing: () => halts++ })
  assert.equal(result.result, false)
  assert.equal(result.attempts, 1)
  assert.equal(halts, 1)
  assert.equal(result.events.find(e => e.event === 'failed').detail.category, 'shutdown')
})

test('disconnect during a ready movement session halts and never reconnects', async () => {
  let halts = 0
  const result = await scenarios([bot => { ready(bot); bot.emit('end') }],
    { stay: true, sessionMs: 100, onClosing: () => halts++ })
  assert.equal(result.result, false)
  assert.equal(result.attempts, 1)
  assert.equal(halts, 1)
})

test('hung transport quit is bounded and a throwing halt cannot report success', async () => {
  let destroyed = 0
  const result = await scenarios([bot => {
    bot._client = { socket: { destroy() { destroyed++; throw new Error('mock failure') } } }
    bot.quit = () => {}
    ready(bot)
  }], { stay: true, sessionMs: 5, onClosing() { throw new Error('mock halt failure') } })
  assert.equal(result.result, false)
  assert.equal(result.attempts, 1)
  assert.equal(destroyed, 1)
  assert.ok(result.events.some(e => e.event === 'failed' && e.detail.category === 'movement_halt'))
})

test('movement session rejects invalid or excessive durations before bot creation', async () => {
  for (const sessionMs of [0, -1, NaN, Infinity, 480_001]) {
    await assert.rejects(verifyConnection({ config: target, sessionMs,
      report() {}, createBot() { assert.fail('must not create bot') } }), /Invalid bounded/)
  }
})

test('asynchronous closing hooks are rejected without waiting or unhandled rejection', async () => {
  for (const onClosing of [() => new Promise(() => {}), () => Promise.reject(new Error('mock failure'))]) {
    const result = await scenarios([ready], { stay: true, sessionMs: 5, onClosing })
    assert.equal(result.result, false)
    assert.equal(result.quits, 1)
    assert.ok(result.events.some(e => e.event === 'failed' && e.detail.category === 'movement_halt'))
  }
})

test('extended session is bounded and only explicitly supervised stay permits it',async()=>{
  for(const options of [{stay:true,supervised:true,sessionMs:1500001},{stay:false,supervised:true,sessionMs:480001},{stay:true,supervised:false,sessionMs:480001}]){
    await assert.rejects(verifyConnection({config:target,...options,report(){},createBot(){assert.fail('must not create bot')}}),/Invalid bounded/)
  }
  const ac=new AbortController();ac.abort()
  assert.equal(await verifyConnection({config:target,stay:true,supervised:true,sessionMs:1500000,signal:ac.signal,report(){},createBot(){assert.fail('already aborted')}}),false)
})
