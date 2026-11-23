import test from 'node:test'
import assert from 'node:assert/strict'
import { identity } from './connection.js'
import { readFileSync, mkdtempSync, readdirSync, mkdirSync, chmodSync, statSync, rmSync, openSync, closeSync, constants } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTH_CACHE, AUTH_LOCK, verifyPrivateCache, provisionAuthentication, acquireProvisionLock, releaseProvisionLock } from './auth-provisioner.js'
import { createStagedCache, persistVerifiedCache } from './staged-auth-cache.js'

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
      assert.equal(typeof cache, 'function')
      assert.equal(options.flow, 'live')
      assert.equal(options.deviceType, 'Nintendo')
      assert.equal(options.authTitle, 'synthetic-title')
      this.callback = callback
      this.live = cache({ cacheName: 'live', username: name })
    }
    async getMinecraftJavaToken(opts) {
      requested = opts
      await this.live.setCachedPartial({ token: { refresh_token: 'SYNTHETIC-REFRESH' } })
      this.callback({ verification_uri: 'https://www.microsoft.com', user_code: 'FAKE-0001' })
      return good
    }
  }
  let stagedFiles
  const result = await provisionAuthentication({
    Authflow: FakeAuthflow,
    Titles: { MinecraftNintendoSwitch: 'synthetic-title' },
    deviceCode: (_challenge, context) => {
      assert.equal(context.interactive, true)
      assert.equal(context.name, identity.name)
      context.report('authorization_required', { secret: 'must not leak' })
    },
    report: event => events.push(event),
    persist(files, { directory }) {
      assert.equal(directory, '/auth/cache')
      stagedFiles = files
    }
  })
  assert.equal(result, true)
  assert.deepEqual(requested, { fetchProfile: true, fetchCertificates: false })
  assert.equal(stagedFiles.length, 1)
  assert.match(stagedFiles[0].filename, /^[a-f0-9]{6}_live-cache\.json$/)
  assert.match(stagedFiles[0].content, /SYNTHETIC-REFRESH/)
  assert.deepEqual(events, ['authorization_required', 'identity_verified'])
  assert.doesNotMatch(JSON.stringify(events), /FAKE|secret|SYNTHETIC/)
})

test('provisioner refuses the wrong Microsoft/Minecraft account without returning credentials', async () => {
  class WrongProfile {
    constructor(name, factory) {
      this.live = factory({ cacheName: 'live', username: name })
      this.minecraft = factory({ cacheName: 'mca', username: name })
    }
    async getMinecraftJavaToken() {
      await this.live.setCachedPartial({ token: { refresh_token: 'WRONG-MICROSOFT-TOKEN' } })
      await this.minecraft.setCachedPartial({ mca: { access_token: 'WRONG-MINECRAFT-TOKEN' } })
      return { token: 'SYNTHETIC-NEVER-REAL', profile: { name: 'wrong', id: identity.uuid } }
    }
  }
  const events = []
  const root = mkdtempSync(join(tmpdir(), 'saracraft-wrong-account-'))
  let committed = false
  try {
    await assert.rejects(provisionAuthentication({
      Authflow: WrongProfile,
      Titles: { MinecraftNintendoSwitch: 'synthetic-title' },
      report: event => events.push(event),
      persist(files) {
        committed = true
        persistVerifiedCache(files, { directory: root })
      }
    }), /Authentication profile mismatch/)
    assert.equal(committed, false)
    assert.deepEqual(readdirSync(root), [], 'wrong-account tokens must never reach disk')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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

test('staged cache stays in memory through mid-flow errors and profile mismatch', async () => {
  const staged = createStagedCache(identity.name)
  const live = staged.factory({ cacheName: 'live', username: identity.name })
  // Explicitly exercise unawaited writes in prismarine-auth's LiveTokenManager.
  void live.setCachedPartial({ token: { refresh_token: 'PRIVATE-MEMORY-ONLY' } })
  assert.deepEqual(await live.getCached(), { token: { refresh_token: 'PRIVATE-MEMORY-ONLY' } })
  assert.throws(() => staged.factory({ cacheName: 'live', username: identity.name }), /Unexpected/)
  assert.throws(() => staged.factory({ cacheName: 'mca', username: 'wrong-account' }), /Unexpected/)
  const files = staged.seal()
  assert.equal(files.length, 1)
  assert.match(files[0].content, /PRIVATE-MEMORY-ONLY/)
  assert.throws(() => staged.seal(), /finalized/)
  assert.throws(() => live.setCachedPartial({ x: 'late' }), /finalized/)
})

test('verified cache commit uses exclusive private files and is read-back compatible with FileCache', async () => {
  const root = mkdtempSync(join(tmpdir(), 'saracraft-offline-'))
  try {
    const staged = createStagedCache(identity.name)
    const live = staged.factory({ cacheName: 'live', username: identity.name })
    await live.setCachedPartial({ token: { access_token: 'SYNTHETIC-ACCESS', refresh_token: 'SYNTHETIC-REFRESH' } })
    const items = staged.seal()
    assert.equal(persistVerifiedCache(items, { directory: root }), 1)
    assert.deepEqual(readdirSync(root), [items[0].filename])
    const path = join(root, items[0].filename)
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).token, {
      access_token: 'SYNTHETIC-ACCESS', refresh_token: 'SYNTHETIC-REFRESH'
    })
    assert.throws(() => persistVerifiedCache(items, { directory: root }), /commit failed/)
    assert.equal(readFileSync(path, 'utf8'), items[0].content)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('failed multi-file commit removes only newly created files', () => {
  const root = mkdtempSync(join(tmpdir(), 'saracraft-offline-'))
  try {
    const staged = createStagedCache(identity.name)
    staged.factory({ cacheName: 'live', username: identity.name }).setCached({ token: { refresh_token: 'TEST-ONLY' } })
    staged.factory({ cacheName: 'mca', username: identity.name }).setCached({ mca: { access_token: 'TEST-ONLY' } })
    const files = staged.seal()
    let opened = 0
    assert.throws(() => persistVerifiedCache(files, {
      directory: root,
      open(path, flags, mode) {
        if (++opened === 2) throw new Error('synthetic disk failure')
        return openSync(path, flags, mode)
      }
    }), /commit failed/)
    assert.deepEqual(readdirSync(root), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('failed authentication never reaches persistence', async () => {
  class PartialAuth {
    constructor(name, factory) { this.live = factory({ cacheName: 'live', username: name }) }
    async getMinecraftJavaToken() {
      this.live.setCachedPartial({ token: { refresh_token: 'SHOULD-NOT-SAVE' } })
      throw new Error('synthetic network abort')
    }
  }
  let commits = 0
  await assert.rejects(provisionAuthentication({
    Authflow: PartialAuth,
    Titles: { MinecraftNintendoSwitch: 'synthetic-title' },
    persist() { commits++ }
  }), /synthetic network abort/)
  assert.equal(commits, 0)
})

test('fatal Node rejection and exception never print upstream secrets', () => {
  const cli = fileURLToPath(new URL('./provision-auth.js', import.meta.url))
  for (const kind of ['exception', 'rejection']) {
    const code = `await import(${JSON.stringify(cli)}); if (${JSON.stringify(kind)} === 'exception') setImmediate(() => { throw Error('SYNTHETIC-TOKEN-SECRET') }); else Promise.reject(Error('SYNTHETIC-TOKEN-SECRET'));`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8', timeout: 4000, env: { PATH: process.env.PATH }
    })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.doesNotMatch(result.stderr, /SYNTHETIC-TOKEN-SECRET|at .*provision-auth|Error:/)
    assert.match(result.stderr, /SaraCraft authentication-only provisioning failed/)
  }
})

test('real prismarine-auth only invokes authentication endpoints with synthetic offline cache', { timeout: 15_000 }, async () => {
  const { default: library } = await import('prismarine-auth')
  const oldFetch = globalThis.fetch
  const attempted = []
  const events = []
  // Use the real library with production's memory-backed callback.
  // Any disk-backed regression must trip the test's persistence canary.
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
      Authflow: library.Authflow, Titles: library.Titles,
      deviceCode: (_, context) => { context.report('authorization_required'); throw new Error('AUTH_REQUIRED') },
      report: event => events.push(event),
      persist() { throw new Error('Unexpected disk commit during failed authentication') }
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
