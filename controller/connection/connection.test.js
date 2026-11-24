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
    ...options, config: target, closeMs: 20, heartbeatMs: 10, timeoutMs: 60, retryDelayMs: 1,
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
