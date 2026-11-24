import test from 'node:test'
import assert from 'node:assert/strict'
import { observationTiming } from './observation-policy.js'

test('normal observation has a reachable success window before its backstop', () => {
  assert.ok(observationTiming.sessionMs > 0)
  assert.ok(observationTiming.sessionMs < observationTiming.deadlineMs)
  // Connection setup and shutdown have time within the total budget.
  assert.ok(observationTiming.deadlineMs - observationTiming.sessionMs >= 20_000)
  assert.ok(observationTiming.deadlineMs < 180_000)
})
