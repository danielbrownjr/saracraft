// Authentication-only workflow. Do not import Mineflayer, minecraft-protocol,
// observe.js, movement.js, or main.js from this module.
import { lstatSync, readdirSync, openSync, closeSync, unlinkSync, constants } from 'node:fs'
import { identity, verifiedProfile } from './connection.js'
import { privateDeviceCode } from './device-authorization.js'

export const AUTH_ROOT = '/auth'
export const AUTH_CACHE = '/auth/cache'
export const AUTH_LOCK = '/auth/.provision.lock'

// One attended provisioner at a time. The lock is outside /auth/cache so
// empty-cache checks remain meaningful. A crash leaves a fail-closed stale
// lock requiring separately authorized private cleanup; no auto-recovery.
export function acquireProvisionLock({
  open = openSync,
  close = closeSync
} = {}) {
  const descriptor = open(AUTH_LOCK,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600)
  close(descriptor)
}

export function releaseProvisionLock({ unlink = unlinkSync } = {}) {
  unlink(AUTH_LOCK)
}


export function verifyPrivateCache({
  root = AUTH_ROOT,
  cache = AUTH_CACHE,
  uid = process.getuid(),
  lstat = lstatSync,
  readdir = readdirSync
} = {}) {
  // Exactly the private service bind root and its cache child. A caller
  // cannot relocate credentials into a checkout or other writable tree.
  if (root !== AUTH_ROOT || cache !== AUTH_CACHE || !Number.isInteger(uid)) {
    throw new Error('Authentication cache configuration rejected')
  }
  for (const path of [root, cache]) {
    const info = lstat(path)
    if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o077) !== 0 ||
        (info.mode & 0o6000) !== 0) {
      throw new Error('Private authentication directory required')
    }
  }
  // Provision only once into an empty private cache. Never enumerate names
  // into output. A previous failed attempt requires explicit private cleanup.
  if (readdir(cache).length !== 0) throw new Error('Authentication cache is not empty')
}

export async function provisionAuthentication({
  Authflow,
  Titles,
  cache = AUTH_CACHE,
  report = () => {},
  deviceCode = privateDeviceCode,
  profileCheck = verifiedProfile
}) {
  if (cache !== AUTH_CACHE || typeof Authflow !== 'function' || !Titles?.MinecraftNintendoSwitch) {
    throw new Error('Invalid authentication-only configuration')
  }
  const auth = new Authflow(identity.name, cache, {
    authTitle: Titles.MinecraftNintendoSwitch,
    deviceType: 'Nintendo',
    flow: 'live'
  }, challenge => deviceCode(challenge, {
    name: identity.name,
    interactive: true,
    report: event => {
      // Never pass challenge contents or identity into a report.
      if (event === 'authorization_required') report('authorization_required')
    }
  }))
  // Requests Microsoft/Xbox/Minecraft *authentication APIs* and a Minecraft
  // profile. It never constructs a game client or connects to the server.
  const credentials = await auth.getMinecraftJavaToken({
    fetchProfile: true, fetchCertificates: false
  })
  profileCheck(credentials) // identity + UUID pin; throw on mismatch.
  report('identity_verified')
  // Do not return credentials, profile, token, or device-code response.
  return true
}
