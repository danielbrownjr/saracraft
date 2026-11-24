// Private completion receipt: zero bytes, no credential or profile data.
// Called only after verified cache commit, operator notice and lock release.
// Exported for deterministic offline tests; the CLI supplies no overrides.
import { openSync, fsyncSync, closeSync, constants } from 'node:fs'

export function recordCompletion({
  open = openSync,
  fsync = fsyncSync,
  close = closeSync
} = {}) {
  const fd = open('/auth/.provision-complete',
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600)
  try { fsync(fd) } finally { close(fd) }
  const parent = open('/auth', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { fsync(parent) } finally { close(parent) }
}
