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
