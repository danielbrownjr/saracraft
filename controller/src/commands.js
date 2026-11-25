// Deterministic player commands. Natural language and model output are not authority.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COMMANDS = Object.freeze(new Set(['stop', 'follow', 'comeHere', 'gather', 'return', 'status', 'look', 'collect']));
const ALLOWED_LOGS = new Set(['oak_log', 'spruce_log', 'birch_log']);

export function parseCommand(raw) {
  if (typeof raw !== 'string' || raw.length > 160) return null;
  const input = raw.trim().toLowerCase();
  if (input === '!sara stop' || input === '!sara cancel') return { kind: 'stop' };
  if (input === '!sara follow') return { kind: 'follow' };
  if (input === '!sara come-here' || input === '!sara come here' || input === '!sara come') return { kind: 'comeHere' };
  if (input === '!sara status') return { kind: 'status' };
  if (input === '!sara look') return { kind: 'look' };
  if (input === '!sara collect') return { kind: 'collect' };
  if (input === '!sara return') return { kind: 'return' };
  const match = /^!sara gather (oak_log|spruce_log|birch_log) ([1-9][0-9]?)$/.exec(input);
  if (match && ALLOWED_LOGS.has(match[1]) && Number(match[2]) <= 32) {
    return { kind: 'gather', block: match[1], count: Number(match[2]) };
  }
  return null;
}

export function validateEnvelope(input, commanderUuid) {
  if (!input || input.source !== 'authenticated_player_chat') return false;
  if (!UUID_RE.test(commanderUuid) || !UUID_RE.test(input.senderUuid)) return false;
  return input.senderUuid.toLowerCase() === commanderUuid.toLowerCase() && input.identityVerified === true;
}
