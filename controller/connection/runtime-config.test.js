import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeOptions } from './runtime-config.js'
import { identity } from './connection.js'

test('first-login verifier has no movement commander default', () => {
  assert.deepEqual(runtimeOptions([], {}), { walk: false, observe: false, commanderUuid: null })
})

test('walk mode requires an explicit commander and rejects recovered placeholders', () => {
  for (const value of [undefined, '', 'not-a-uuid', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002', identity.uuid]) {
    assert.throws(() => runtimeOptions(['--walk'], { SARACRAFT_COMMANDER_UUID: value }), /explicit non-placeholder/)
  }
  const uuid = 'A1234567-1234-4234-8234-123456789ABC'
  assert.deepEqual(runtimeOptions(['--walk'], { SARACRAFT_COMMANDER_UUID: uuid }),
    { walk: true, observe: false, commanderUuid: uuid.toLowerCase() })
})

test('observation mode needs no commander and rejects combined modes', () => {
  assert.deepEqual(runtimeOptions(['--observe'], {}),
    { walk: false, observe: true, commanderUuid: null })
  assert.deepEqual(runtimeOptions(['--observe'], { SARACRAFT_COMMANDER_UUID: 'invalid' }),
    { walk: false, observe: true, commanderUuid: null })
  for (const args of [['--observe', '--walk'], ['--observe', '--observe']]) {
    assert.throws(() => runtimeOptions(args, {}), /Unsupported launcher arguments/)
  }
})

test('unknown or duplicate mode arguments fail closed', () => {
  for (const args of [['--unknown'], ['--walk', '--walk'], ['--walk', '--unknown']]) {
    assert.throws(() => runtimeOptions(args, {}), /Unsupported launcher arguments/)
  }
})
