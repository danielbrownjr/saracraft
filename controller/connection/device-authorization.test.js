import test from 'node:test'
import assert from 'node:assert/strict'
import { privateDeviceCode } from './device-authorization.js'

const challenge = { verification_uri: 'https://www.microsoft.com', user_code: 'ABCD-EFGH' }

test('headless device authorization fails closed without emitting code', () => {
  const events = []
  assert.throws(() => privateDeviceCode(challenge, {
    interactive: false, name: 'test', report: (event, details) => events.push({ event, details })
  }), /^Error: AUTH_REQUIRED$/)
  assert.deepEqual(events, [{ event: 'authorization_required', details: undefined }])
  assert.doesNotMatch(JSON.stringify(events), /ABCD|microsoft.com/)
})

test('malformed authorization challenge is rejected without side effects', () => {
  for (const invalid of [
    { verification_uri: 'http://www.microsoft.com', user_code: 'ABCD-EFGH' },
    { verification_uri: 'https://example.com', user_code: 'ABCD-EFGH' },
    { verification_uri: 'https://www.microsoft.com/?code=secret', user_code: 'ABCD-EFGH' },
    { verification_uri: 'https://www.microsoft.com', user_code: 'not a code' }
  ]) {
    let events = 0
    assert.throws(() => privateDeviceCode(invalid, {
      interactive: false, name: 'test', report: () => events++
    }), /Invalid device-code response/)
    assert.equal(events, 0)
  }
})
