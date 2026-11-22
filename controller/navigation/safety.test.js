import test from 'node:test';
import assert from 'node:assert/strict';
import { assessNavigation, NavigationSafetyMonitor } from './safety.js';

const NOW = 100_000;
const dry = () => ({ air: 300, inWater: false, nextStepInWater: false,
  creeperDistance: null, entitiesObserved: true, observedAt: NOW });
const assess = snapshot => assessNavigation(snapshot, { now: NOW });
const monitor = overrides => new NavigationSafetyMonitor({ now: () => NOW, ...overrides });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('fresh safe dry terrain and observed no-creeper state are allowed', () => {
  assert.deepEqual(assess(dry()), { safe: true });
});
test('pre-entry water is rejected; submerged state requests escape, not a safe halt', () => {
  assert.equal(assess({ ...dry(), nextStepInWater: true }).reason, 'WATER_UNSAFE');
  assert.deepEqual(assess({ ...dry(), inWater: true }),
    { safe: false, reason: 'WATER_EXIT_REQUIRED', action: 'surface' });
});
test('air depletion is rejected at 99 but accepted at 100', () => {
  assert.equal(assess({ ...dry(), air: 99 }).reason, 'LOW_AIR');
  assert.equal(assess({ ...dry(), air: 100 }).safe, true);
});
test('creeper distance uses inclusive six-block threshold', () => {
  assert.equal(assess({ ...dry(), creeperDistance: 6 }).reason, 'CREEPER_NEARBY');
  assert.equal(assess({ ...dry(), creeperDistance: 6.1 }).safe, true);
});
test('invalid, unknown and stale telemetry all fail closed', () => {
  for (const value of [null, {}, { ...dry(), air: -1 }, { ...dry(), air: 301 },
    { ...dry(), air: 150.5 }, { ...dry(), air: '200' }, { ...dry(), creeperDistance: Infinity },
    { ...dry(), creeperDistance: NaN }, { ...dry(), entitiesObserved: false },
    { ...dry(), observedAt: NOW - 1001 }, { ...dry(), observedAt: NOW + 1 },
    { ...dry(), nextStepInWater: undefined }]) {
    assert.equal(assess(value).reason, 'UNKNOWN_STATE');
  }
});
test('monitor samples and latches a single halt acknowledgement', async () => {
  let reads = 0; let halts = 0;
  const m = monitor({ readState: () => (++reads === 1 ? dry() : { ...dry(), nextStepInWater: true }),
    halt: async () => { halts++; } });
  assert.deepEqual(await m.check(), { safe: true });
  assert.deepEqual(await m.check(), { safe: false, reason: 'WATER_UNSAFE', haltState: 'acknowledged' });
  assert.equal((await m.check()).reason, 'WATER_UNSAFE');
  assert.equal(reads, 2); assert.equal(halts, 1);
});
test('failed read and failed halt are reported', async () => {
  const m = monitor({ readState: () => { throw Error('sensitive'); }, halt: () => { throw Error('down'); } });
  assert.deepEqual(await m.check(), { safe: false, reason: 'STATE_UNAVAILABLE', haltState: 'failed' });
});
test('pre-aborted signal skips reads and halts once', async () => {
  const controller = new AbortController(); controller.abort();
  let reads = 0; let halts = 0;
  const m = monitor({ readState: () => { reads++; return dry(); }, halt: () => { halts++; } });
  assert.deepEqual(await m.check({ signal: controller.signal }),
    { safe: false, reason: 'CANCELLED', haltState: 'acknowledged' });
  assert.equal(reads, 0); assert.equal(halts, 1);
});
test('N1: a late safe read cannot override an earlier unsafe concurrent trip', async () => {
  const a = deferred(); const b = deferred(); let count = 0; let halts = 0;
  const m = monitor({ readState: () => (++count === 1 ? a.promise : b.promise),
    halt: () => { halts++; } });
  const first = m.check(); const second = m.check();
  await Promise.resolve(); await Promise.resolve();
  a.resolve({ ...dry(), nextStepInWater: true });
  assert.equal((await first).reason, 'WATER_UNSAFE');
  b.resolve(dry());
  assert.equal((await second).reason, 'WATER_UNSAFE');
  assert.equal(halts, 1);
});
test('N2: abort interrupts a never-resolving telemetry read', async () => {
  const controller = new AbortController(); let halts = 0;
  const m = monitor({ readState: () => new Promise(() => {}), halt: () => { halts++; }, readTimeoutMs: 100 });
  const pending = m.check({ signal: controller.signal }); controller.abort();
  assert.deepEqual(await pending, { safe: false, reason: 'CANCELLED', haltState: 'acknowledged' });
  assert.equal(halts, 1);
});
test('N2: a hung read trips a bounded STATE_UNAVAILABLE', async () => {
  const m = monitor({ readState: () => new Promise(() => {}), halt: () => {}, readTimeoutMs: 8 });
  assert.equal((await m.check()).reason, 'STATE_UNAVAILABLE');
});
test('N3: simultaneous hazards share one first-reason halt and failure result', async () => {
  const a = deferred(); const b = deferred(); const h = deferred(); let count = 0; let halts = 0;
  const m = monitor({ readState: () => (++count === 1 ? a.promise : b.promise),
    halt: () => { halts++; return h.promise; } });
  const first = m.check(); const second = m.check();
  await Promise.resolve(); await Promise.resolve();
  a.resolve({ ...dry(), creeperDistance: 2 });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  b.resolve({ ...dry(), nextStepInWater: true });
  h.reject(new Error('halt failed'));
  assert.deepEqual(await first, { safe: false, reason: 'CREEPER_NEARBY', haltState: 'failed' });
  assert.deepEqual(await second, { safe: false, reason: 'CREEPER_NEARBY', haltState: 'failed' });
  assert.equal(halts, 1);
});
test('N4: halt pending, timeout and acknowledgement are distinct', async () => {
  const m = monitor({ readState: dry, halt: () => new Promise(() => {}), haltTimeoutMs: 8 });
  const pending = m.check({ signal: AbortSignal.abort() });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(m.tripped?.haltState, 'pending');
  assert.deepEqual(await pending, { safe: false, reason: 'CANCELLED', haltState: 'timed_out' });
});
