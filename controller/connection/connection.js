import { setTimeout as delay } from 'node:timers/promises'

export const identity = Object.freeze({
  name: 'SaraCraft69',
  uuid: '19cd07d7-8a93-4476-9d2e-7bf7948312e4'
})
export const target = Object.freeze({ host: '192.168.1.127', port: 25565, version: '1.21.11' })

export function checkTarget(config) {
  if (Object.keys(target).some(key => config[key] !== target[key])) {
    throw new Error('Unsupported Minecraft target')
  }
}

export function verifiedProfile(result) {
  const profile = result?.profile
  if (typeof result?.token !== 'string' || !result.token || profile?.name !== identity.name ||
      typeof profile.id !== 'string' || profile.id.replaceAll('-', '').toLowerCase() !== identity.uuid.replaceAll('-', '')) {
    throw new Error('Authentication profile mismatch')
  }
  return profile
}

export function classify(source, error) {
  if (source === 'auth') return 'authentication'
  if (source === 'end') return 'disconnection'
  const detail = typeof error === 'string' ? error : (error?.message ?? JSON.stringify(error) ?? '')
  if (/white.?list|allow.?list/i.test(detail)) return 'allowlist'
  if (/outdated|incompatible|unsupported.*version|wrong.*version/i.test(detail)) return 'version_mismatch'
  if (/unverified username|invalid session|failed to verify username|authentication/i.test(detail)) return 'authentication'
  if (/ECONN|EHOST|ENET|ENOTFOUND|ETIMEDOUT|socket|timed? ?out/i.test(detail + (error?.code ?? ''))) return 'network'
  return source === 'kicked' ? 'disconnection' : 'network'
}

// The caller owns the shutdown signal. Only transport failures before spawn are retried.
export async function verifyConnection({ createBot, config, report, signal, timeoutMs = 30_000,
  heartbeatMs = 5_000, closeMs = 5_000, retryDelayMs = 2_000, stay = false, sessionMs = 480_000,
  onClosing = () => {} }) {
  checkTarget(config)
  if (typeof stay !== 'boolean' || !Number.isFinite(sessionMs) || sessionMs <= 0 || sessionMs > 480_000) {
    throw new Error('Invalid bounded movement session')
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (signal?.aborted) return false
    report('connecting', { attempt })
    const outcome = await observe(createBot, report, signal, timeoutMs, heartbeatMs, closeMs, stay, sessionMs, onClosing)
    if (outcome.ok) return true
    if (attempt === 2 || outcome.spawned || signal?.aborted ||
        !['network', 'disconnection'].includes(outcome.category) || !outcome.closed) return false
    report('reconnecting', { attempt: attempt + 1 })
    await delay(retryDelayMs, undefined, { signal }).catch(error => {
      if (error.name !== 'AbortError') throw error
    })
  }
  return false
}

function observe(createBot, report, signal, timeoutMs, heartbeatMs, closeMs, stay, sessionMs, onClosing) {
  return new Promise(resolve => {
    let bot
    try {
      bot = createBot()
    } catch (error) {
      const category = classify('error', error)
      report('failed', { category })
      resolve({ category, closed: true, spawned: false })
      return
    }
    let spawned = false
    let world = false
    let presence = false
    let outcome
    let closeTimer
    let settled = false
    let sessionTimer
    let ready = false
    const timeout = setTimeout(() => finish('network'), timeoutMs)
    const heartbeat = setInterval(() => report('heartbeat', { spawned, world, presence }), heartbeatMs)

    function closeMovement() {
      try {
        const result = onClosing(bot)
        if (result && typeof result.then === 'function') {
          // A deferred halt cannot satisfy this synchronous actuation boundary.
          // Observe rejection without waiting for an uncooperative callback.
          Promise.resolve(result).catch(() => {})
          throw new Error('Closing callback must be synchronous')
        }
        return true
      } catch {
        report('failed', { category: 'movement_halt' })
        return false
      }
    }

    function settle(closed) {
      if (settled) return
      settled = true
      clearTimeout(closeTimer)
      clearTimeout(sessionTimer)
      clearTimeout(timeout)
      clearInterval(heartbeat)
      signal?.removeEventListener('abort', abort)
      if (closed) report('disconnected')
      else report('failed', { category: 'disconnection' })
      resolve({ ...outcome, spawned, closed, ok: closed && outcome?.ok === true })
    }
    function finish(category) {
      if (outcome) return
      outcome = category ? { category } : { ok: true }
      if (category) report('failed', { category })
      clearTimeout(timeout)
      clearTimeout(sessionTimer)
      clearInterval(heartbeat)
      closeTimer = setTimeout(() => {
        try { bot._client?.socket?.destroy() } catch { /* still fail settlement closed */ }
        settle(false)
      }, closeMs)
      if (!closeMovement() && outcome.ok) outcome = { category: 'movement_halt' }
      try { bot.quit('SaraCraft session complete') } catch { /* close deadline still bounds settlement */ }
    }
    function abort() { finish('shutdown') }
    function complete() {
      if (!spawned || !world || !presence || ready) return
      ready = true
      if (!stay) finish()
      else {
        clearTimeout(timeout)
        report('movement_ready', { durationSeconds: sessionMs / 1000 })
        sessionTimer = setTimeout(() => finish(), sessionMs)
      }
    }
    bot.on('login', () => { if (!outcome) report('login') })
    bot.once('spawn', () => {
      if (outcome) return
      spawned = true
      report('spawn', { ...identity, entityId: bot.entity?.id })
      complete()
    })
    bot.once('chunkColumnLoad', () => {
      if (outcome) return
      world = true
      report('world_received')
      complete()
    })
    function player(player) {
      if (outcome || presence || !player?.uuid) return
      presence = true
      report('player_presence', { self: player.uuid.replaceAll('-', '').toLowerCase() === identity.uuid.replaceAll('-', '') })
      complete()
    }
    bot.on('playerJoined', player)
    bot.on('playerUpdated', player)
    bot.on('error', error => finish(classify('error', error)))
    bot.on('kicked', reason => finish(classify('kicked', reason)))
    bot.once('end', () => {
      if (!outcome) {
        outcome = { category: 'disconnection' }
        closeMovement()
        report('failed', outcome)
      }
      settle(true)
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
