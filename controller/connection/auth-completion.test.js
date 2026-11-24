import test from 'node:test'
import assert from 'node:assert/strict'
import { constants, readFileSync } from 'node:fs'
import { recordCompletion } from './auth-completion.js'

test('completion receipt is exclusive, private, zero-content and fsynced before parent', () => {
  const events = []
  recordCompletion({
    open(path, flags, mode) {
      events.push(['open', path, mode])
      if (path === '/auth/.provision-complete') {
        assert.equal(mode, 0o600)
        for (const flag of [constants.O_WRONLY, constants.O_CREAT, constants.O_EXCL, constants.O_NOFOLLOW]) {
          assert.equal(flags & flag, flag)
        }
        return 11
      }
      assert.equal(path, '/auth')
      assert.equal(flags & constants.O_DIRECTORY, constants.O_DIRECTORY)
      assert.equal(flags & constants.O_NOFOLLOW, constants.O_NOFOLLOW)
      return 12
    },
    fsync(fd) { events.push(['fsync', fd]) },
    close(fd) { events.push(['close', fd]) }
  })
  assert.deepEqual(events, [
    ['open', '/auth/.provision-complete', 0o600],
    ['fsync', 11], ['close', 11],
    ['open', '/auth', undefined],
    ['fsync', 12], ['close', 12]
  ])
})

test('completion receipt cannot be replaced and errors release descriptors', () => {
  const events = []
  assert.throws(() => recordCompletion({
    open(path) {
      assert.equal(path, '/auth/.provision-complete')
      throw Object.assign(new Error('exclusive receipt already present'), { code: 'EEXIST' })
    },
    fsync() { throw new Error('unexpected sync') },
    close() { throw new Error('unexpected close') }
  }), /already present/)

  assert.throws(() => recordCompletion({
    open(path) {
      if (path === '/auth/.provision-complete') return 21
      return 22
    },
    fsync(fd) {
      events.push(['fsync', fd])
      if (fd === 22) throw new Error('synthetic directory sync failure')
    },
    close(fd) { events.push(['close', fd]) }
  }), /synthetic directory sync failure/)
  assert.deepEqual(events, [
    ['fsync', 21], ['close', 21], ['fsync', 22], ['close', 22]
  ])
})

// Source-order regression for the attended entrypoint. This is deliberately
// structural: end-to-end private-TTY/credential tests remain separately gated.
test('CLI awaits provisioning before creating the completion receipt', () => {
  const source = readFileSync(new URL('./provision-auth.js', import.meta.url), 'utf8')
  assert.match(source, /try\s*\{\s*await main\(\)\s*recordCompletion\(\)\s*\}\s*catch\s*\{/)
})
