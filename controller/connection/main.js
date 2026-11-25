import { appendFileSync, lstatSync } from 'node:fs'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import mineflayer from 'mineflayer'
import prismarineAuth from 'prismarine-auth'
// Import movement dynamically only in --walk. --observe cannot load pathfinder.
import { runtimeOptions } from './runtime-config.js'
import { privateDeviceCode } from './device-authorization.js'
import { observationTiming } from './observation-policy.js'
import { classify, identity, target, verifiedProfile, verifyConnection } from './connection.js'

process.umask(0o077)
// Diagnostics from upstream libraries may include raw authentication responses.
for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir']) console[method] = () => {}
const run = randomUUID()
const abort = new AbortController()
let connecting = false
function shutdown() {
  if (!connecting) process.exit(130)
  abort.abort()
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
const cache = '/auth/cache'
// The only accepted service-specific override is a fixed, reviewable destination.
const evidence = process.env.SARACRAFT_EVIDENCE_PATH === '/var/log/saracraft-bot/verification.jsonl'
  ? '/var/log/saracraft-bot/verification.jsonl' : '/auth/verification.jsonl'

function report(event, details = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), run, event, ...details }) + '\n'
  appendFileSync(evidence, line, { mode: 0o600, flag: constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW })
  // The supervised service keeps its evidence exclusively in private JSONL.
  if (evidence === '/auth/verification.jsonl') process.stdout.write(line)
}

async function main({ walk, observe, commanderUuid, policy = 'strict' }) {
  for (const path of ['/auth', cache]) {
    const stat = lstatSync(path)
    if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
      throw new Error('Authentication directory must be private')
    }
  }
  const { Authflow, Titles } = prismarineAuth
  report('authenticating')
  let credentials
  try {
    // Match minecraft-protocol's built-in Microsoft device-code flow.
    const auth = new Authflow(identity.name, cache, {
      authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo', flow: 'live'
    }, challenge => privateDeviceCode(challenge, { report, name: identity.name }))
    credentials = await auth.getMinecraftJavaToken({ fetchProfile: true, fetchCertificates: walk })
    verifiedProfile(credentials)
    if (walk && !credentials.certificates?.profileKeys) {
      report('failed', { category: 'chat_certificate_unavailable' })
      return false
    }
  } catch (error) {
    report('failed', { category: error?.message === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : classify('auth', error) })
    return false
  }
  if (abort.signal.aborted) return false
  report('identity_verified', observe ? {} : identity)
  connecting = true
  const inference = walk && policy === 'supervised-dry' ? new (await import('../inference/ollama.js')).LocalOllama({model:'qwen2.5:1.5b'}) : null
  const installMovement = walk ? (await import('./movement.js')).enableMovement : null
  const installObserver = observe ? (await import('./observe.js')).enableObservation : null
  let attachment
  const trialReport = observe ? (event, details = {}) => {
    if (event === 'spawn') return report('spawn')
    if (event === 'player_presence') return report('player_presence', { self: details.self === true })
    if (event === 'movement_ready') return report('observation_ready')
    return report(event, details)
  } : report
  return verifyConnection({
    config: target, report: trialReport, signal: abort.signal,
    stay: walk || observe, sessionMs: observe ? observationTiming.sessionMs : 480_000,
    maxAttempts: observe || policy === 'supervised-dry' ? 1 : 2,
    onClosing: () => attachment?.dispose(),
    createBot: () => {
      const bot = mineflayer.createBot({
      ...target,
      username: identity.name,
      // Let the observer settle under gravity without enabling control inputs.
      physicsEnabled: walk || observe,
      disableChatSigning: !walk,
      hideErrors: true,
      auth(client, options) {
        const profile = verifiedProfile(credentials)
        const session = { accessToken: credentials.token, selectedProfile: profile, availableProfile: [profile] }
        options.haveCredentials = true
        options.accessToken = credentials.token
        if (walk) Object.assign(client, credentials.certificates)
        client.session = session
        client.username = profile.name
        queueMicrotask(() => {
          try {
            client.emit('session', session)
            options.connect(client)
          } catch (error) {
            client.emit('error', error)
          }
        })
      }
      })
      if (walk || observe) {
        try {
          attachment = walk
            ? installMovement(bot, commanderUuid, trialReport, { signal: abort.signal, policy, inference })
            : installObserver(bot, trialReport)
        } catch {
          queueMicrotask(() => bot.emit('error', new Error('Session initialization failed')))
        }
      }
      return bot
    }
  })
}

try {
  const options = runtimeOptions(process.argv.slice(2), process.env)
  // Observation's overall clock starts before authentication and bot creation.
  // Backstop: a normal 150s observe run may exit cleanly before the 175s deadline.
  // Imports run before this timer; the systemd 180s ceiling is independent.
  const deadline = setTimeout(() => {
    report('failed', { category: options.observe ? 'session_deadline' : 'authentication_timeout' })
    abort.abort()
    const forceExit = setTimeout(() => process.exit(1), options.observe ? 4_000 : 0)
    forceExit.unref()
    if (!options.observe) process.exit(1)
  }, options.observe ? observationTiming.deadlineMs : (options.walk ? 17 : 8) * 60_000)
  deadline.unref()
  try {
    process.exitCode = (await main(options)) && !abort.signal.aborted ? 0 : 1
  } finally {
    clearTimeout(deadline)
  }
} catch {
  process.stdout.write('SaraCraft verification failed during setup.\n')
  process.exitCode = 1
}
