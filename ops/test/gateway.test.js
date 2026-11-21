import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, authorize } from '../src/policy.js';
import { OpsGateway } from '../src/gateway.js';
import { unavailableBackend } from '../src/adapter.js';
const principal = { id: 'dan', role: 'saracraft_operator', authenticated: true };
const request = (action, args = {}, requestId = 'req_12345678') => ({ action, args, requestId });
const backend = () => ({ health: async () => ({ online: true }), players: async () => [],
  backup: async () => 'done', allowlistAdd: async ({username}) => username,
  allowlistRemove: async () => 'ok', restart: async () => 'ok' });

test('allows narrowly typed commands', () => {
  assert.equal(validateRequest(request('health')).action, 'health');
  assert.equal(validateRequest(request('allowlist_add', { username: 'SaraCraft69' })).args.username, 'SaraCraft69');
});
test('denies shell, Docker and arbitrary admin actions', () => {
  for (const action of ['exec', 'docker', 'sudo', 'console', 'world_delete', 'op'])
    assert.throws(() => validateRequest(request(action)), /DENIED_ACTION/);
});
test('rejects injection in usernames and extra fields', () => {
  for (const username of ['Sara;rm -rf /', '../world', 'a b', ''])
    assert.throws(() => validateRequest(request('allowlist_add', { username })), /INVALID_USERNAME/);
  assert.throws(() => validateRequest({ ...request('health'), command: 'ls' }), /UNKNOWN_FIELD/);
  assert.throws(() => validateRequest(request('health', { cmd: 'ls' })), /UNEXPECTED_ARGS/);
});
test('identity cannot be supplied by request data', () => {
  assert.throws(() => authorize({ ...request('health'), principal }, null), /UNKNOWN_FIELD/);
  assert.throws(() => authorize(request('health'), { id: 'dan', role: 'saracraft_operator', authenticated: false }), /UNAUTHORIZED/);
});
test('sensitive requests require verified request-bound confirmation', () => {
  assert.throws(() => authorize(request('restart'), principal), /CONFIRMATION_REQUIRED/);
  assert.throws(() => authorize(request('restart'), principal, { action: 'restart', requestId: 'wrong', approvedBy: 'dan', verified: true }), /CONFIRMATION_REQUIRED/);
  assert.equal(authorize(request('restart'), principal, { action: 'restart', requestId: 'req_12345678', approvedBy: 'dan', verified: true }).action, 'restart');
});
test('authorized operation uses only named adapter method', async () => {
  const audits = [];
  const g = new OpsGateway({ backend: backend(), audit: async x => audits.push(x) });
  const result = await g.execute(request('health'), { principal });
  assert.deepEqual(result.result, { online: true });
  assert.equal(audits[0].status, 'success');
  await assert.rejects(g.execute(request('health'), { principal }), /DUPLICATE_REQUEST/);
});
test('serializes tasks to avoid conflicting changes', async () => {
  let release;
  const b = backend(); b.backup = () => new Promise(resolve => { release = resolve; });
  const g = new OpsGateway({ backend: b, audit: async () => {} });
  const pending = g.execute(request('backup'), { principal });
  await assert.rejects(g.execute(request('health', {}, 'req_87654321'), { principal }), /BUSY/);
  release('done'); await pending;
});
test('unconfigured backend fails closed', async () => {
  const g = new OpsGateway({ backend: unavailableBackend(), audit: async () => {} });
  await assert.rejects(g.execute(request('health'), { principal }), /BACKEND_NOT_CONFIGURED/);
});
