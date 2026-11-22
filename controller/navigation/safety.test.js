import test from 'node:test';
import assert from 'node:assert/strict';
import { assessNavigation, NavigationSafetyMonitor } from './safety.js';

const dry = () => ({
  air: 300, inWater: false, nextStepInWater: false, creeperDistance: 30
});

test('safe dry terrain is allowed', () => {
  assert.deepEqual(assessNavigation(dry()), { safe: true });
});

test('water is rejected before entry and after accidental entry', () => {
  assert.equal(assessNavigation({ ...dry(), nextStepInWater: true }).reason, 'WATER_UNSAFE');
  assert.equal(assessNavigation({ ...dry(), inWater: true }).reason, 'WATER_UNSAFE');
});

test('air depletion is rejected even outside water', () => {
  assert.equal(assessNavigation({ ...dry(), air: 99 }).reason, 'LOW_AIR');
  assert.equal(assessNavigation({ ...dry(), air: 100 }).safe, true);
});

test('nearby creepers stop movement but distant ones do not', () => {
  assert.equal(assessNavigation({ ...dry(), creeperDistance: 6 }).reason, 'CREEPER_NEARBY');
  assert.equal(assessNavigation({ ...dry(), creeperDistance: 6.1 }).safe, true);
});

test('missing or invalid safety telemetry fails closed', () => {
  for (const snapshot of [null, {}, { ...dry(), air: undefined }, { ...dry(), air: -1 },
    { ...dry(), creeperDistance: Infinity }, { ...dry(), nextStepInWater: undefined }]) {
    assert.equal(assessNavigation(snapshot).reason, 'UNKNOWN_STATE');
  }
});

test('monitor halts exactly once when a route becomes unsafe', async () => {
  let reads = 0;
  let halts = 0;
  const monitor = new NavigationSafetyMonitor({
    readState: () => (++reads === 1 ? dry() : { ...dry(), nextStepInWater: true }),
    halt: async () => { halts++; }
  });
  assert.deepEqual(await monitor.check(), { safe: true });
  assert.deepEqual(await monitor.check(), { safe: false, reason: 'WATER_UNSAFE', haltConfirmed: true });
  assert.equal((await monitor.check()).reason, 'WATER_UNSAFE');
  assert.equal(reads, 2);
  assert.equal(halts, 1);
});

test('unavailable telemetry and failed halt are reported, not passed', async () => {
  const monitor = new NavigationSafetyMonitor({
    readState: () => { throw new Error('sensitive diagnostic'); },
    halt: async () => { throw new Error('transport down'); }
  });
  assert.deepEqual(await monitor.check(), {
    safe: false, reason: 'STATE_UNAVAILABLE', haltConfirmed: false
  });
});

test('abort suppresses sampling and requests halt', async () => {
  const abort = new AbortController();
  abort.abort();
  let reads = 0;
  let halts = 0;
  const monitor = new NavigationSafetyMonitor({
    readState: () => { reads++; return dry(); },
    halt: async () => { halts++; }
  });
  assert.deepEqual(await monitor.check({ signal: abort.signal }),
    { safe: false, reason: 'CANCELLED', haltConfirmed: true });
  assert.equal(reads, 0);
  assert.equal(halts, 1);
});
