import test from 'node:test';
import assert from 'node:assert/strict';
import { SaraController } from '../src/controller.js';
import { parseCommand } from '../src/commands.js';
import { normalizeTrustedChat } from '../src/bridge.js';

const DAN = 'adf766e8-c4f8-4a5e-9475-c48cdcf1aabb';
const OTHER = '72c12f3e-b4e1-4ffd-906f-a17611cf5332';
const msg = (text, extras = {}) => ({ source: 'authenticated_player_chat', senderUuid: DAN, identityVerified: true, text, ...extras });
const adapter = (changes = {}) => ({
  follow: async () => ({ verified: true }),
  gather: async () => ({ verified: true }),
  returnHome: async () => ({ verified: true }),
  halt: async () => {},
  ...changes
});

test('parsing is strict and bounded', () => {
  assert.deepEqual(parseCommand('!sara gather spruce_log 16'), { kind: 'gather', block: 'spruce_log', count: 16 });
  for (const value of ['hello', '!sara gather diamond 4', '!sara gather oak_log 33', '!sara gather oak_log 0', '!sara eval rm -rf /', '!sara follow; op me']) {
    assert.equal(parseCommand(value), null);
  }
});

test('untrusted or spoofed identities never start tasks', async () => {
  let invoked = 0;
  const c = new SaraController({ commanderUuid: DAN, adapter: adapter({ follow: async () => { invoked++; } }) });
  for (const request of [msg('!sara follow', { senderUuid: OTHER }), msg('!sara follow', { identityVerified: false }), msg('!sara follow', { source: 'in_world_sign' })]) {
    assert.equal((await c.handle(request)).reason, 'UNAUTHORIZED');
  }
  assert.equal(invoked, 0);
});

test('verified completion is required', async () => {
  const c = new SaraController({ commanderUuid: DAN, adapter: adapter({ gather: async () => ({ verified: false }) }) });
  const task = await c.handle(msg('!sara gather oak_log 16'));
  assert.equal(task.accepted, true);
  assert.equal((await task.completion).state, 'FAILED');
});

test('simple authorized task completes', async () => {
  const c = new SaraController({ commanderUuid: DAN, adapter: adapter() });
  const task = await c.handle(msg('!sara return'));
  assert.equal((await task.completion).state, 'COMPLETED');
  assert.deepEqual(c.events.map(e => e.state), ['AUTHORIZED', 'RUNNING', 'COMPLETED']);
});

test('STOP cancels active task and waits for confirmation', async () => {
  let haltCount = 0;
  const c = new SaraController({ commanderUuid: DAN, adapter: adapter({
    follow: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    halt: async () => { haltCount++; }
  }) });
  const task = await c.handle(msg('!sara follow'));
  const stopped = await c.handle(msg('!sara stop'));
  assert.equal(stopped.stopped, true);
  assert.equal(haltCount, 1);
  assert.equal((await task.completion).state, 'CANCELLED');
  assert.equal(c.activeTaskId, null);
});

test('STOP from unrelated player is rejected', async () => {
  const c = new SaraController({ commanderUuid: DAN, adapter: adapter() });
  assert.equal((await c.handle(msg('!sara stop', { senderUuid: OTHER }))).reason, 'UNAUTHORIZED');
});

test('busy tasks reject overlapping requests', async () => {
  const c = new SaraController({ commanderUuid: DAN, adapter: adapter({
    follow: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  }) });
  const t = await c.handle(msg('!sara follow'));
  assert.equal((await c.handle(msg('!sara return'))).reason, 'BUSY');
  await c.handle(msg('!sara stop'));
  await t.completion;
});

test('trust bridge fails closed without server-side identity proof', () => {
  assert.equal(normalizeTrustedChat({ senderUuid: DAN, text: '!sara follow', isPlayerChat: true }), null);
  assert.deepEqual(normalizeTrustedChat({ senderUuid: DAN, text: '!sara follow', isPlayerChat: true, serverAuthenticated: true, senderIdentityResolved: true }), msg('!sara follow'));
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const smallLimits = { followMs: 100, comeHereMs: 100, haltMs: 15, stopWaitMs: 20 };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const terminalEvents = c => c.events.filter(e => ['COMPLETED', 'CANCELLED', 'FAILED', 'TIMED_OUT'].includes(e.state));
const abortingFollow = (_, { signal }) => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

test('come-here aliases are strict, dispatched with a 32-block bound, and verified', async () => {
  for (const text of ['!sara come-here', '!sara come here', '!sara come']) {
    assert.deepEqual(parseCommand(text), { kind: 'comeHere' });
  }
  assert.equal(parseCommand('!sara come here; op me'), null);
  let received;
  const c = new SaraController({ commanderUuid: DAN, adapter: adapter({
    comeHere: async (uuid, options) => { received = { uuid, ...options }; return { verified: true }; }
  }) });
  const task = await c.handle(msg('!sara come'));
  assert.equal((await task.completion).state, 'COMPLETED');
  assert.equal(received.uuid, DAN);
  assert.equal(received.radiusMax, 32);
  assert.equal(typeof received.cancel, 'function');
});

test('deadline halts, aborts a hung operation, bounds settlement, and quarantines replacement', async () => {
  let signal, haltCount = 0;
  const never = new Promise(() => {});
  const c = new SaraController({ commanderUuid: DAN, limits: { ...smallLimits, followMs: 5 }, adapter: adapter({
    follow: (_, options) => { signal = options.signal; return never; },
    halt: () => { haltCount++; }
  }) });
  const task = await c.handle(msg('!sara follow'));
  const final = await task.completion;
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.message, 'TIME_LIMIT');
  assert.equal(final.state, 'TIMED_OUT');
  assert.equal(final.reason, 'TIME_LIMIT');
  assert.equal(final.executionSettled, false);
  assert.equal(final.haltState, 'acknowledged');
  assert.equal(final.movementStopped, false);
  assert.equal(haltCount, 1);
  assert.equal(c.activeTaskId, null);
  assert.equal((await c.handle(msg('!sara come'))).reason, 'HALT_UNCONFIRMED');
  assert.equal(terminalEvents(c).length, 1);
});

test('STOP bounds a hung halt even when the movement task cooperates', async () => {
  let haltCount = 0;
  const halt = deferred();
  const c = new SaraController({ commanderUuid: DAN, limits: smallLimits, adapter: adapter({
    follow: abortingFollow,
    halt: () => { haltCount++; return halt.promise; }
  }) });
  const task = await c.handle(msg('!sara follow'));
  const result = await c.stop();
  assert.equal(result.stopped, false);
  assert.equal(result.haltState, 'timed_out');
  assert.equal(result.executionSettled, true);
  assert.equal(result.movementStopped, false);
  assert.equal((await task.completion).state, 'CANCELLED');
  assert.equal(haltCount, 1);
  assert.equal(c.activeTaskId, null);
  assert.equal((await c.handle(msg('!sara follow'))).reason, 'HALT_UNCONFIRMED');
  halt.reject(new Error('late halt rejection'));
  await pause(0);
  assert.equal(terminalEvents(c).length, 1);
});

test('STOP bounds a hung task and ignores its later successful completion', async () => {
  const movement = deferred();
  let signal;
  const c = new SaraController({ commanderUuid: DAN, limits: smallLimits, adapter: adapter({
    follow: (_, options) => { signal = options.signal; return movement.promise; }
  }) });
  const task = await c.handle(msg('!sara follow'));
  const result = await c.stop();
  assert.equal(signal.aborted, true);
  assert.equal(result.stopped, false);
  assert.equal(result.executionSettled, false);
  assert.equal((await task.completion).reason, 'STOP');
  movement.resolve({ verified: true });
  await pause(0);
  assert.equal(terminalEvents(c).length, 1);
  assert.equal(terminalEvents(c)[0].state, 'CANCELLED');
  assert.equal((await c.handle(msg('!sara return'))).reason, 'HALT_UNCONFIRMED');
});

test('concurrent duplicate STOP requests share one halt and one terminal event', async () => {
  let haltCount = 0;
  const halt = deferred();
  const c = new SaraController({ commanderUuid: DAN, limits: smallLimits, adapter: adapter({
    follow: abortingFollow,
    halt: () => { haltCount++; return halt.promise; }
  }) });
  const task = await c.handle(msg('!sara follow'));
  const one = c.stop();
  const two = c.handle(msg('!sara cancel'));
  halt.resolve();
  assert.deepEqual(await one, await two);
  assert.equal((await task.completion).state, 'CANCELLED');
  assert.equal(haltCount, 1);
  assert.equal(terminalEvents(c).length, 1);
});

test('STOP wins a deadline race while waiting for halt', async () => {
  const halt = deferred();
  const c = new SaraController({ commanderUuid: DAN, limits: { ...smallLimits, followMs: 5, haltMs: 50 }, adapter: adapter({
    follow: abortingFollow,
    halt: () => halt.promise
  }) });
  const task = await c.handle(msg('!sara follow'));
  const stopped = c.stop();
  await pause(10);
  halt.resolve();
  assert.equal((await stopped).reason, 'STOP');
  assert.equal((await task.completion).state, 'CANCELLED');
  assert.equal(terminalEvents(c).length, 1);
});

test('deadline wins when STOP arrives after the timeout requested halt', async () => {
  const halted = deferred();
  const release = deferred();
  const c = new SaraController({ commanderUuid: DAN, limits: { ...smallLimits, followMs: 5, haltMs: 50 }, adapter: adapter({
    follow: abortingFollow,
    halt: () => { halted.resolve(); return release.promise; }
  }) });
  const task = await c.handle(msg('!sara follow'));
  await halted.promise;
  const stopped = c.stop();
  release.resolve();
  assert.equal((await stopped).reason, 'TIME_LIMIT');
  assert.equal((await task.completion).state, 'TIMED_OUT');
  assert.equal(terminalEvents(c).length, 1);
});

test('rapid cooperative replacement cannot let a stale task cancel a later task', async () => {
  const callbacks = [];
  const c = new SaraController({ commanderUuid: DAN, limits: smallLimits, adapter: adapter({
    follow: (_, options) => { callbacks.push(options.cancel); return abortingFollow(_, options); }
  }) });
  for (let i = 0; i < 3; i++) {
    const task = await c.handle(msg('!sara follow'));
    assert.equal(task.accepted, true);
    assert.equal((await c.stop()).stopped, true);
    assert.equal((await task.completion).state, 'CANCELLED');
  }
  const next = await c.handle(msg('!sara follow'));
  callbacks[0]('DISCONNECTED');
  assert.equal(c.activeTaskId, next.taskId);
  assert.equal((await c.stop()).reason, 'STOP');
  assert.equal(terminalEvents(c).length, 4);
});

test('cancellation during an asynchronous state read aborts the signal before actuation', async () => {
  const read = deferred();
  let actuations = 0;
  const c = new SaraController({ commanderUuid: DAN, limits: smallLimits, adapter: adapter({
    follow: async (_, { signal }) => {
      await read.promise;
      if (!signal.aborted) actuations++;
      return { verified: true };
    }
  }) });
  const task = await c.handle(msg('!sara follow'));
  const stopped = c.stop();
  read.resolve();
  assert.equal((await stopped).stopped, true);
  assert.equal((await task.completion).state, 'CANCELLED');
  assert.equal(actuations, 0);
});

test('disconnect and safety cancellation propagate into the controller with the first reason', async () => {
  let cancel, signal;
  const c = new SaraController({ commanderUuid: DAN, limits: smallLimits, adapter: adapter({
    follow: (_, options) => { cancel = options.cancel; signal = options.signal; return abortingFollow(_, options); }
  }) });
  const task = await c.handle(msg('!sara follow'));
  cancel('DISCONNECTED');
  cancel('WATER_EXIT_REQUIRED');
  const stopped = await c.stop();
  const final = await task.completion;
  assert.equal(signal.reason.message, 'DISCONNECTED');
  assert.equal(final.state, 'CANCELLED');
  assert.equal(final.reason, 'DISCONNECTED');
  assert.equal(stopped.reason, 'DISCONNECTED');
  assert.equal(terminalEvents(c).length, 1);
});

test('idle STOP requests a transport halt and explicitly does not verify physical cessation', async () => {
  let haltCount = 0;
  const c = new SaraController({ commanderUuid: DAN, adapter: adapter({ halt: () => { haltCount++; } }) });
  const stopped = await c.handle(msg('!sara stop'));
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.taskId, null);
  assert.equal(stopped.haltState, 'acknowledged');
  assert.equal(stopped.movementStopped, false);
  assert.equal(haltCount, 1);
  assert.deepEqual(c.events, []);
});

test('idle STOP is bounded and concurrent idle STOP shares a hung halt', async () => {
  let haltCount = 0;
  const c = new SaraController({ commanderUuid: DAN, limits: smallLimits, adapter: adapter({
    halt: () => { haltCount++; return new Promise(() => {}); }
  }) });
  const one = c.stop();
  const two = c.stop();
  assert.deepEqual(await one, await two);
  assert.equal((await one).haltState, 'timed_out');
  assert.equal((await one).stopped, false);
  assert.equal(haltCount, 1);
  assert.equal((await c.handle(msg('!sara follow'))).reason, 'HALT_UNCONFIRMED');
});

test('halt failure settles cancellation without permitting replacement', async () => {
  const c = new SaraController({ commanderUuid: DAN, limits: smallLimits, adapter: adapter({
    follow: abortingFollow,
    halt: () => { throw new Error('transport unavailable'); }
  }) });
  const task = await c.handle(msg('!sara follow'));
  assert.equal((await c.stop()).haltState, 'failed');
  assert.equal((await task.completion).state, 'CANCELLED');
  assert.equal(c.activeTaskId, null);
  assert.equal((await c.handle(msg('!sara follow'))).reason, 'HALT_UNCONFIRMED');
});

test('controller deadline overrides reject invalid or extended safety limits', () => {
  for (const limits of [{ followMs: 60_001 }, { haltMs: 0 }, { stopWaitMs: NaN }, { arbitraryMs: 1 }, { toString: 1 }]) {
    assert.throws(() => new SaraController({ commanderUuid: DAN, adapter: adapter(), limits }), /Invalid controller limit/);
  }
});
