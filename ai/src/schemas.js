// LLM outputs are untrusted proposals, never authority or executable commands.
const NAME = /^[A-Za-z0-9_]{3,16}$/;
const LOGS = new Set(['oak_log', 'spruce_log', 'birch_log']);
const OPS = new Set(['health', 'players', 'backup', 'allowlist_add', 'allowlist_remove', 'restart']);
const GAME = new Set(['follow', 'stop', 'return', 'gather']);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function validateProposal(value, scope) {
  if (!object(value) || Object.keys(value).some(k => !['action','args'].includes(k))) throw Error('INVALID_PROPOSAL');
  if (!['ops','game'].includes(scope)) throw Error('INVALID_SCOPE');
  if (!(scope === 'ops' ? OPS : GAME).has(value.action)) throw Error('DENIED_ACTION');
  const args = value.args ?? {};
  if (!object(args)) throw Error('INVALID_ARGS');
  const keys = Object.keys(args);
  if (scope === 'ops' && value.action.startsWith('allowlist_')) {
    if (keys.length !== 1 || keys[0] !== 'username' || typeof args.username !== 'string' || !NAME.test(args.username)) throw Error('INVALID_USERNAME');
    return { action: value.action, args: {username:args.username} };
  }
  if (scope === 'game' && value.action === 'gather') {
    if (keys.length !== 2 || !keys.includes('block') || !keys.includes('count') || !LOGS.has(args.block) ||
      !Number.isSafeInteger(args.count) || args.count < 1 || args.count > 32) throw Error('INVALID_GATHER');
    return { action: value.action, args: {block:args.block,count:args.count} };
  }
  if (keys.length) throw Error('UNEXPECTED_ARGS');
  return { action: value.action, args: {} };
}
