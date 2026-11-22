import { appendFileSync, closeSync, lstatSync, openSync, writeSync } from 'node:fs'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import mineflayer from 'mineflayer'
import prismarineAuth from 'prismarine-auth'
import { enableMovement } from './movement.js'
import { runtimeOptions } from './runtime-config.js'
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
const evidence = '/auth/verification.jsonl'

function report(event, details = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), run, event, ...details }) + '\n'
  appendFileSync(evidence, line, { mode: 0o600, flag: constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW })
  process.stdout.write(line)
}

function privateDeviceCode({ verification_uri: uri, user_code: code }) {
  const url = new URL(uri)
  if (url.protocol !== 'https:' || !['www.microsoft.com', 'microsoft.com', 'login.live.com'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || !/^[A-Z0-9-]{4,16}$/i.test(code)) {
    throw new Error('Invalid device-code response')
  }
  report('authorization_required')
  const tty = openSync('/dev/tty', 'w')
  try {
    writeSync(tty, `\nOpen ${url.href} and enter ${code} using the Microsoft account for ${identity.name}.\n\n`)
  } finally {
    closeSync(tty)
  }
}

async function main({ walk, commanderUuid }) {
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
    }, privateDeviceCode)
    credentials = await auth.getMinecraftJavaToken({ fetchProfile: true, fetchCertificates: walk })
    verifiedProfile(credentials)
    if (walk && !credentials.certificates?.profileKeys) {
      report('failed', { category: 'chat_certificate_unavailable' })
      return false
    }
  } catch (error) {
    report('failed', { category: classify('auth', error) })
    return false
  }
  if (abort.signal.aborted) return false
  report('identity_verified', identity)
  connecting = true
  let movementHalt
  return verifyConnection({
    config: target, report, signal: abort.signal,
    stay: walk,
    onClosing: () => movementHalt?.dispose(),
    createBot: () => {
      const bot = mineflayer.createBot({
      ...target,
      username: identity.name,
      physicsEnabled: walk,
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
      if (walk) {
        try { movementHalt = enableMovement(bot, commanderUuid, report, { signal: abort.signal }) }
        catch { queueMicrotask(() => bot.emit('error', new Error('Movement initialization failed'))) }
      }
      return bot
    }
  })
}

try {
  const options = runtimeOptions(process.argv.slice(2), process.env)
  const authDeadline = setTimeout(() => {
    report('failed', { category: 'authentication_timeout' })
    process.exit(1)
  }, (options.walk ? 17 : 8) * 60_000)
  authDeadline.unref()
  process.exitCode = (await main(options)) ? 0 : 1
  clearTimeout(authDeadline)
} catch {
  process.stdout.write('SaraCraft verification failed during setup.\n')
  process.exitCode = 1
}
