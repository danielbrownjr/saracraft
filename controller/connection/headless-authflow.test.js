// Locked prismarine-auth 3.1.1 offline integration regression.
// All network requests are replaced before the real Authflow is constructed.
// Never use real account credentials or a persistent cache.
import test from 'node:test'
import assert from 'node:assert/strict'
import prismarineAuth from 'prismarine-auth'
import { privateDeviceCode } from './device-authorization.js'

test('headless real Authflow refuses device authorization with bounded offline retries and no disclosure', { timeout: 15_000 }, async () => {
  const previousFetch = globalThis.fetch
  const events = []
  const requests = []
  const secretCode = 'QWER-1234'
  const cache = () => ({
    async getCached() { return {} },
    async setCachedPartial() { throw new Error('unexpected cache mutation') }
  })
  globalThis.fetch = async (input, init) => {
    const endpoint = String(input)
    requests.push(endpoint)
    // A real HTTP call is never permitted: this handles the only expected path.
    assert.equal(endpoint, 'https://login.live.com/oauth20_connect.srf')
    assert.equal(init?.method, 'post')
    return Response.json({
      verification_uri: 'https://www.microsoft.com',
      user_code: secretCode,
      device_code: 'PRIVATE-NETWORKLESS-DEVICE-CODE',
      expires_in: 60,
      interval: 5
    })
  }
  try {
    const { Authflow, Titles } = prismarineAuth
    const auth = new Authflow('SaraCraft69', cache, {
      authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo', flow: 'live'
    }, challenge => privateDeviceCode(challenge, {
      interactive: false, name: 'SaraCraft69', report: event => events.push(event)
    }))
    let failure
    try {
      await auth.getMinecraftJavaToken({ fetchProfile: true, fetchCertificates: false })
    } catch (error) {
      failure = error
    }
    assert.equal(failure?.message, 'AUTH_REQUIRED')
    assert.ok(requests.length >= 1 && requests.length <= 4, 'real library headless retries are bounded')
    assert.equal(events.length, requests.length)
    assert.ok(events.every(event => event === 'authorization_required'))
    assert.doesNotMatch(JSON.stringify(events), /QWER|PRIVATE|microsoft.com/)
    assert.ok(requests.every(request => request === 'https://login.live.com/oauth20_connect.srf'))
  } finally {
    globalThis.fetch = previousFetch
  }
})
