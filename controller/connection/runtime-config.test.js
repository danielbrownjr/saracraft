import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeOptions } from './runtime-config.js'
import { identity } from './connection.js'

test('first-login verifier has no movement commander default', () => {
  assert.deepEqual(runtimeOptions([], {}), { walk: false, commanderUuid: null })
})

test('walk mode requires an explicit commander and rejects recovered placeholders', () => {
  for (const value of [undefined, '', 'not-a-uuid', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002', identity.uuid]) {
    assert.throws(() => runtimeOptions(['--walk'], { SARACRAFT_COMMANDER_UUID: value }), /explicit non-placeholder/)
  }
  const uuid = 'A1234567-1234-4234-8234-123456789ABC'
  assert.deepEqual(runtimeOptions(['--walk'], { SARACRAFT_COMMANDER_UUID: uuid }),
    { walk: true, commanderUuid: uuid.toLowerCase() })
})

test('unknown or duplicate mode arguments fail closed', () => {
  for (const args of [['--unknown'], ['--walk', '--walk'], ['--walk', '--unknown']]) {
    assert.throws(() => runtimeOptions(args, {}), /Unsupported launcher arguments/)
  }
})
