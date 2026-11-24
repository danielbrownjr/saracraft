import { UUID_RE } from '../src/commands.js'
import { identity } from './connection.js'

// Configuration is checked before authentication directories or credentials are read.
// The source-recovery placeholders are documentation, never runtime authority.
export function runtimeOptions(args, env) {
  if (args.length > 1 || args.some(arg => !['--walk', '--observe'].includes(arg))) {
    throw new Error('Unsupported launcher arguments')
  }
  const walk = args.includes('--walk')
  const observe = args.includes('--observe')
  if (!walk) return { walk: false, observe, commanderUuid: null }
  const uuid = env.SARACRAFT_COMMANDER_UUID
  if (typeof uuid !== 'string' || !UUID_RE.test(uuid) || /^00000000-0000-/i.test(uuid) ||
      uuid.toLowerCase() === identity.uuid.toLowerCase()) {
    throw new Error('Movement requires an explicit non-placeholder commander UUID')
  }
  return { walk: true, observe: false, commanderUuid: uuid.toLowerCase() }
}
