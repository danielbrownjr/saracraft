import { UUID_RE } from '../src/commands.js'
import { identity } from './connection.js'

// Configuration is checked before authentication directories or credentials are read.
// The source-recovery placeholders are documentation, never runtime authority.
export function runtimeOptions(args, env) {
  if (args.some(arg => arg !== '--walk') || args.length > 1) throw new Error('Unsupported launcher arguments')
  const walk = args.includes('--walk')
  if (!walk) return { walk: false, commanderUuid: null }
  const uuid = env.SARACRAFT_COMMANDER_UUID
  if (typeof uuid !== 'string' || !UUID_RE.test(uuid) || /^00000000-0000-/i.test(uuid) ||
      uuid.toLowerCase() === identity.uuid.toLowerCase()) {
    throw new Error('Movement requires an explicit non-placeholder commander UUID')
  }
  return { walk: true, commanderUuid: uuid.toLowerCase() }
}
