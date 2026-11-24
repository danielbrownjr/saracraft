import test from 'node:test'
import assert from 'node:assert/strict'
import { assessNavigation, NavigationSafetyMonitor } from './safety.js'

const now = 10000
const dry = { sampledAt: now, inWater: false, nextStepInWater: false,
  entitiesObserved: true, creeperDistance: null }
const options = { now, policy: 'supervised-dry' }

test('dry-land movement needs no fabricated air and strict default still denies it', () => {
  assert.equal(assessNavigation(dry, options).safe, true)
  assert.equal(assessNavigation(dry, { now }).safe, false)
  assert.equal(assessNavigation(dry, { now, policy: 'typo' }).safe, false)
})
test('supervised profile rejects water, low air, invalid or stale local state', () => {
  for (const patch of [{ inWater: true }, { nextStepInWater: true },
    { air: 99 }, { air: null }, { sampledAt: now - 1001 },
    { sampledAt: now + 1 }, { entitiesObserved: false },
    { nextStepInWater: undefined }, { creeperDistance: 5 }]) {
    assert.equal(assessNavigation({ ...dry, ...patch }, options).safe, false)
  }
})
test('async monitor shares selected policy and latches hazards', async () => {
  let state = dry
  let halts = 0
  const monitor = new NavigationSafetyMonitor({ readState: () => state,
    halt: () => { halts++ }, now: () => now, policy: 'supervised-dry' })
  assert.equal((await monitor.check()).safe, true)
  state = { ...dry, nextStepInWater: true }
  assert.equal((await monitor.check()).safe, false)
  state = dry
  assert.equal((await monitor.check()).safe, false)
  assert.equal(halts, 1)
})
