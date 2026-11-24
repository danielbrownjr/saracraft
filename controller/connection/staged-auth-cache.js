// Transactional cache for prismarine-auth 3.1.1.
// During account authentication nothing is written to the filesystem.
// A verified Java profile is required before the commit operation can be
// called. This module must not be reused for untrusted or existing caches.
import { createHash } from 'node:crypto'
import { openSync, writeSync, fsyncSync, closeSync, unlinkSync, fstatSync, constants } from 'node:fs'
import { join } from 'node:path'

const ALLOWED = new Set(['msal', 'live', 'sisu', 'xbl', 'bed', 'mca', 'mcs', 'pfb'])
const WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW

export function createStagedCache(expectedUsername) {
  const entries = new Map()
  let sealed = false
  function factory({ cacheName, username }) {
    if (sealed || username !== expectedUsername || !ALLOWED.has(cacheName) || entries.has(cacheName)) {
      throw new Error('Unexpected authentication cache request')
    }
    const record = { cacheName, value: {} }
    entries.set(cacheName, record)
    // Methods use synchronous in-memory mutation even when the caller does
    // not await them (LiveTokenManager does this in prismarine-auth 3.1.1).
    return {
      getCached() { return Promise.resolve(record.value) },
      setCached(value) {
        if (sealed) throw new Error('Authentication cache already finalized')
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Invalid authentication cache update')
        }
        record.value = { ...value }
        return Promise.resolve()
      },
      setCachedPartial(value) {
        if (sealed) throw new Error('Authentication cache already finalized')
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Invalid authentication cache update')
        }
        record.value = { ...record.value, ...value }
        return Promise.resolve()
      },
      reset() {
        if (sealed) throw new Error('Authentication cache already finalized')
        record.value = {}
        return Promise.resolve(record.value)
      }
    }
  }
  function seal() {
    if (sealed) throw new Error('Authentication cache already finalized')
    sealed = true
    const hash = createHash('sha1').update(expectedUsername, 'binary').digest('hex').slice(0, 6)
    // prismarine-auth FileCache names: `<sha1-prefix>_<id>-cache.json`.
    return [...entries.values()].filter(({ value }) => Object.keys(value).length > 0)
      .map(({ cacheName, value }) => ({
        filename: `${hash}_${cacheName}-cache.json`,
        content: JSON.stringify(value)
      }))
  }
  return { factory, seal }
}

// Persist only after the authenticated Minecraft Java identity is verified.
// This is a best-effort multi-file transaction: if any write fails, remove
// exactly the files created by this call. Never touch arbitrary cache names.
// Caller must hold the exclusive /auth/.provision.lock and have verified an
// initially empty, private cache directory.
export function persistVerifiedCache(files, {
  directory,
  open = openSync,
  write = writeSync,
  fsync = fsyncSync,
  close = closeSync,
  unlink = unlinkSync,
  fstat = fstatSync
}) {
  if (!Array.isArray(files) || files.length === 0 ||
      files.some(item => typeof item.filename !== 'string' ||
        !/^[a-f0-9]{6}_(?:msal|live|sisu|xbl|bed|mca|mcs|pfb)-cache\.json$/.test(item.filename) ||
        typeof item.content !== 'string') ||
      new Set(files.map(item => item.filename)).size !== files.length) {
    throw new Error('Invalid staged authentication cache')
  }
  const created = []
  try {
    for (const file of files) {
      const path = join(directory, file.filename)
      const fd = open(path, WRITE_FLAGS, 0o600)
      created.push(path)
      try {
        const data = Buffer.from(file.content, 'utf8')
        let position = 0
        while (position < data.length) {
          const count = write(fd, data, position, data.length - position)
          if (!Number.isInteger(count) || count <= 0) throw new Error('Authentication cache write failed')
          position += count
        }
        fsync(fd)
        const info = fstat(fd)
        if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() ||
            (info.mode & 0o7777) !== 0o600) {
          throw new Error('Unsafe authentication cache file')
        }
      } finally {
        close(fd)
      }
    }
    return files.length
  } catch {
    for (const path of created.reverse()) {
      try { unlink(path) } catch { /* fail closed; never retry automatically */ }
    }
    throw new Error('Private authentication cache commit failed')
  }
}
