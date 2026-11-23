import test from 'node:test'
import assert from 'node:assert/strict'
import { identity } from './connection.js'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { AUTH_CACHE, AUTH_LOCK, verifyPrivateCache, provisionAuthentication, acquireProvisionLock, releaseProvisionLock } from './auth-provisioner.js'

const good = {
  token: 'SYNTHETIC-NEVER-REAL',
  profile: { name: identity.name, id: identity.uuid.replaceAll('-', '') }
}
const safeDir = (uid = 500) => ({ isDirectory: () => true, uid, mode: 0o40700 })

test('provision lock is exclusive, fixed-path, private and never silently bypassed', () => {
  const events = []
  acquireProvisionLock({
    open(path, flags, mode) {
      assert.equal(path, AUTH_LOCK)
      assert.equal(mode, 0o600)
      assert.ok((flags & 0o200) !== 0) // O_EXCL on Linux CI
      events.push('open')
      return 13
    },
    close(fd) { assert.equal(fd, 13); events.push('close') }
  })
  releaseProvisionLock({ unlink(path) {
    assert.equal(path, AUTH_LOCK)
    events.push('unlink')
  } })
  assert.deepEqual(events, ['open', 'close', 'unlink'])
  assert.throws(() => acquireProvisionLock({
    open() { throw Object.assign(new Error('lock already exists'), { code: 'EEXIST' }) },
    close() { throw new Error('unexpected close') }
  }), /lock already exists/)
})

test('cache gate permits only the fixed, empty, private directories', () => {
  const paths = []
  verifyPrivateCache({
    uid: 500,
    lstat(path) { paths.push(path); return safeDir() },
    readdir(path) { assert.equal(path, AUTH_CACHE); return [] }
  })
  assert.deepEqual(paths, ['/auth', '/auth/cache'])
})

test('cache gate rejects relocated, preexisting, symlinked, wrong-owner or readable caches', () => {
  const cases = [
    { root: '/tmp/auth' },
    { cache: '/home/daniel/cache' },
    { readdir: () => ['some-private-file'] },
    { lstat: () => ({ ...safeDir(), isDirectory: () => false }) },
    { lstat: () => safeDir(999) },
    { lstat: () => ({ ...safeDir(), mode: 0o40750 }) },
    { lstat: () => ({ ...safeDir(), mode: 0o44700 }) }
  ]
  for (const change of cases) {
    assert.throws(() => verifyPrivateCache({
      uid: 500, lstat: () => safeDir(),
      readdir: () => [], ...change
    }), /Authentication cache|Private authentication|not empty/)
  }
})

test('provisioner matches pinned profile, asks for no certificates and returns no credential data', async () => {
  const events = []
  let requested
  class FakeAuthflow {
    constructor(name, cache, options, callback) {
      assert.equal(name, identity.name)
      assert.equal(cache, '/auth/cache')
      assert.equal(options.flow, 'live')
      assert.equal(options.deviceType, 'Nintendo')
      assert.equal(options.authTitle, 'synthetic-title')
      this.callback = callback
    }
    async getMinecraftJavaToken(opts) {
      requested = opts
      this.callback({ verification_uri: 'https://www.microsoft.com', user_code: 'FAKE-0001' })
      return good
    }
  }
  const result = await provisionAuthentication({
    Authflow: FakeAuthflow,
    Titles: { MinecraftNintendoSwitch: 'synthetic-title' },
    deviceCode: (_challenge, context) => {
      assert.equal(context.interactive, true)
      assert.equal(context.name, identity.name)
      context.report('authorization_required', { secret: 'must not leak' })
    },
    report: event => events.push(event)
  })
  assert.equal(result, true)
  assert.deepEqual(requested, { fetchProfile: true, fetchCertificates: false })
  assert.deepEqual(events, ['authorization_required', 'identity_verified'])
  assert.doesNotMatch(JSON.stringify(events), /FAKE|secret|SYNTHETIC/)
})

test('provisioner refuses the wrong Microsoft/Minecraft account without returning credentials', async () => {
  class WrongProfile {
    async getMinecraftJavaToken() {
      return { token: 'SYNTHETIC-NEVER-REAL', profile: { name: 'wrong', id: identity.uuid } }
    }
  }
  const events = []
  await assert.rejects(provisionAuthentication({
    Authflow: WrongProfile,
    Titles: { MinecraftNintendoSwitch: 'synthetic-title' },
    report: event => events.push(event)
  }), /Authentication profile mismatch/)
  assert.deepEqual(events, [])
})

test('provisioner rejects path substitution before constructing Authflow', async () => {
  let constructed = false
  class FakeAuthflow {
    constructor() { constructed = true }
  }
  await assert.rejects(provisionAuthentication({
    Authflow: FakeAuthflow,
    Titles: { MinecraftNintendoSwitch: 'synthetic-title' },
    cache: '/tmp/evil'
  }), /Invalid authentication-only configuration/)
  assert.equal(constructed, false)
})

test('provisioner rejects auth backend errors and emits no sensitive diagnostics', async () => {
  const events = []
  class FailingAuthflow {
    async getMinecraftJavaToken() { throw new Error('SECRET fake auth failure') }
  }
  await assert.rejects(provisionAuthentication({
    Authflow: FailingAuthflow,
    Titles: { MinecraftNintendoSwitch: 'synthetic-title' },
    report: event => events.push(event)
  }), /SECRET fake auth failure/)
  assert.deepEqual(events, [])
})

test('real prismarine-auth only invokes authentication endpoints with synthetic offline cache', { timeout: 15_000 }, async () => {
  const { default: library } = await import('prismarine-auth')
  const oldFetch = globalThis.fetch
  const attempted = []
  const events = []
  const cache = () => ({
    async getCached() { return {} },
    async setCachedPartial() { throw new Error('unexpected cache write') }
  })
  // Wrap real Authflow to replace its cache with a nonpersistent in-memory
  // fixture. The underlying library's device-code flow is unchanged.
  class TestAuthflow extends library.Authflow {
    constructor(name, ignored, options, callback) { super(name, cache, options, callback) }
  }
  globalThis.fetch = async (url, options) => {
    attempted.push(String(url))
    assert.equal(String(url), 'https://login.live.com/oauth20_connect.srf')
    assert.equal(options?.method, 'post')
    return Response.json({
      verification_uri: 'https://www.microsoft.com',
      user_code: 'MOCK-0001',
      device_code: 'SYNTHETIC-DEVICE-SECRET',
      expires_in: 60,
      interval: 5
    })
  }
  try {
    await assert.rejects(provisionAuthentication({
      Authflow: TestAuthflow, Titles: library.Titles,
      deviceCode: (_, context) => { context.report('authorization_required'); throw new Error('AUTH_REQUIRED') },
      report: event => events.push(event)
    }), /^Error: AUTH_REQUIRED$/)
    assert.ok(attempted.length >= 1 && attempted.length <= 4)
    assert.equal(events.length, attempted.length)
    assert.ok(events.every(event => event === 'authorization_required'))
    assert.doesNotMatch(JSON.stringify(events), /MOCK|SYNTHETIC/)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('auth-only CLI refuses non-TTY and arguments before any authentication', () => {
  const cli = fileURLToPath(new URL('./provision-auth.js', import.meta.url))
  for (const args of [[], ['--observe'], ['--walk'], ['--cache', '/tmp']]) {
    const processResult = spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8', timeout: 4000, env: { PATH: process.env.PATH }
    })
    assert.equal(processResult.status, 1)
    assert.equal(processResult.stdout, '')
    assert.equal(processResult.stderr, 'SaraCraft authentication-only provisioning failed.\n')
  }
})

test('auth-only production entrypoints cannot import Minecraft gameplay clients', () => {
  for (const file of ['auth-provisioner.js', 'provision-auth.js']) {
    const source = readFileSync(fileURLToPath(new URL('./' + file, import.meta.url)), 'utf8')
    // Only inspect executable import/require specifiers, not commentary.
    assert.doesNotMatch(source, /(?:from\s*['"]|import\s*\(['"]|require\s*\(['"])(?:[^'"]*\/)?(?:main|mineflayer|minecraft-protocol|movement|observe)(?:\.js)?['"]/)
  }
})
