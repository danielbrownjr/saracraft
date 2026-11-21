import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, authorize } from '../src/policy.js';
import { OpsGateway, DEADLINE_MS } from '../src/gateway.js';
import { unavailableBackend } from '../src/adapter.js';
import { TrustRoot } from '../src/trust.js';
const trust = new TrustRoot();
const principal = trust.issuePrincipal({ id: 'dan', role: 'saracraft_operator' });
const request = (action, args = {}, requestId = 'req_12345678') => ({ action, args, requestId });
const backend = () => ({ health: async () => ({ online: true }), players: async () => [],
  backup: async () => 'done', allowlistAdd: async ({username}) => username,
  allowlistRemove: async () => 'ok', restart: async () => 'ok' });
const gateway = (b = backend(), audit = async () => {}) => new OpsGateway({ backend: b, audit, trust });

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
test('regression: username must be a string under the username key (no RegExp coercion)', () => {
  // Previously each of these passed because RegExp.test coerced undefined/null/number/array to a valid-looking string.
  for (const args of [{ evil: 'x' }, { username: null }, { username: 12345 }, { username: ['SaraCraft69'] }, { username: undefined }])
    assert.throws(() => validateRequest(request('allowlist_add', args)), /INVALID_USERNAME/);
});
test('identity cannot be supplied by request data', () => {
  assert.throws(() => authorize({ ...request('health'), principal }, null, undefined, trust), /UNKNOWN_FIELD/);
});
test('regression: structurally valid but unminted principal is rejected', () => {
  // Previously any object with authenticated:true and the operator role was accepted.
  for (const forged of [JSON.parse('{"id":"dan","role":"saracraft_operator","authenticated":true}'), { ...principal }, Object.freeze({ id: 'dan', role: 'saracraft_operator' })])
    assert.throws(() => authorize(request('health'), forged, undefined, trust), /UNAUTHORIZED/);
  const other = new TrustRoot().issuePrincipal({ id: 'dan', role: 'saracraft_operator' });
  assert.throws(() => authorize(request('health'), other, undefined, trust), /UNAUTHORIZED/);
  assert.throws(() => authorize(request('health'), principal), /TRUST_ROOT_REQUIRED/);
  assert.throws(() => new OpsGateway({ backend: backend(), audit: async () => {}, trust: { isPrincipal: () => true, isConfirmation: () => true, now: Date.now } }), /TRUST_ROOT_REQUIRED/);
});
test('sensitive requests require minted, request-bound, unexpired confirmation', () => {
  let now = 1_000_000;
  const t = new TrustRoot({ now: () => now });
  const p = t.issuePrincipal({ id: 'dan', role: 'saracraft_operator' });
  assert.throws(() => authorize(request('restart'), p, undefined, t), /CONFIRMATION_REQUIRED/);
  assert.throws(() => authorize(request('restart'), p, t.issueConfirmation({ action: 'restart', requestId: 'wrong', approvedBy: p }), t), /CONFIRMATION_REQUIRED/);
  // Regression: a caller-built object with verified:true no longer counts as confirmation.
  assert.throws(() => authorize(request('restart'), p, { action: 'restart', requestId: 'req_12345678', approvedBy: 'dan', verified: true, expiresAt: now + 60_000 }, t), /CONFIRMATION_REQUIRED/);
  const c = t.issueConfirmation({ action: 'restart', requestId: 'req_12345678', approvedBy: p, ttlMs: 60_000 });
  assert.equal(authorize(request('restart'), p, c, t).action, 'restart');
  now += 60_000; // Regression: confirmations previously had no freshness bound.
  assert.throws(() => authorize(request('restart'), p, c, t), /CONFIRMATION_REQUIRED/);
});
test('authorized operation uses only named adapter method and audits write-ahead', async () => {
  const audits = [];
  const g = gateway(backend(), async x => audits.push(x));
  const result = await g.execute(request('health'), { principal });
  assert.deepEqual(result.result, { online: true });
  assert.deepEqual(audits.map(a => a.status), ['started', 'success']);
  await assert.rejects(g.execute(request('health'), { principal }), /DUPLICATE_REQUEST/);
  assert.equal(audits.at(-1).status, 'rejected_duplicate');
});
test('regression: operation never starts when the audit journal is unavailable', async () => {
  let ran = 0;
  const b = backend(); b.health = async () => { ran++; return 1; };
  const g = gateway(b, async () => { throw Error('DISK_FULL'); });
  await assert.rejects(g.execute(request('health'), { principal }), /AUDIT_UNAVAILABLE/);
  assert.equal(ran, 0);
});
test('audit failure after execution is reported, not masked as an operation failure', async () => {
  let n = 0;
  const g = gateway(backend(), async () => { if (++n === 2) throw Error('DISK_FULL'); });
  await assert.rejects(g.execute(request('health'), { principal }), e => e.message === 'AUDIT_INCOMPLETE' && e.outcome === 'success');
});
test('serializes tasks to avoid conflicting changes', async () => {
  let release;
  const b = backend(); b.backup = () => new Promise(resolve => { release = resolve; });
  const g = gateway(b);
  const pending = g.execute(request('backup'), { principal });
  await new Promise(setImmediate);
  await assert.rejects(g.execute(request('health', {}, 'req_87654321'), { principal }), /BUSY/);
  release('done'); await pending;
  assert.equal((await g.execute(request('health', {}, 'req_87654321'), { principal })).ok, true);
});
test('regression: hung backend times out, is signalled, and keeps the lock until it settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal, release;
  const audits = [];
  const b = backend(); b.health = (_args, opts) => { signal = opts.signal; return new Promise(r => { release = r; }); };
  const g = gateway(b, async x => audits.push(x.status));
  const pending = g.execute(request('health'), { principal });
  await new Promise(setImmediate);
  t.mock.timers.tick(DEADLINE_MS.health);
  await assert.rejects(pending, /OPERATION_TIMED_OUT/);
  assert.equal(signal.aborted, true);
  assert.deepEqual(audits, ['started', 'timed_out']);
  // The backend has not confirmed it stopped, so a second operation must not overlap it.
  await assert.rejects(g.execute(request('players', {}, 'req_87654321'), { principal }), /BUSY/);
  release('late'); await new Promise(setImmediate);
  assert.equal((await g.execute(request('players', {}, 'req_87654321'), { principal })).ok, true);
});
test('unconfigured backend fails closed', async () => {
  await assert.rejects(gateway(unavailableBackend()).execute(request('health'), { principal }), /BACKEND_NOT_CONFIGURED/);
});
