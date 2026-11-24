#!/usr/bin/env node
// Attended authentication only. NOT a Minecraft launcher or an installed unit.
// Invoking this utility later requires separate explicit host/auth authorization.
import { isatty } from 'node:tty'
import { openSync, writeSync, closeSync } from 'node:fs'
import { verifyPrivateCache, provisionAuthentication, acquireProvisionLock, releaseProvisionLock } from './auth-provisioner.js'

process.umask(0o077)
const safeError = process.stderr.write.bind(process.stderr)
const FATAL_MESSAGE = 'SaraCraft authentication-only provisioning failed.\n'
// Node's fatal error path bypasses process.stderr.write and console.*.
// Use a bounded generic handler; never emit upstream exception contents.
function fatalExit() {
  try { safeError(FATAL_MESSAGE) } finally { process.exit(1) }
}
process.on('uncaughtException', fatalExit)
process.on('unhandledRejection', fatalExit)
// Suppress any direct writes from upstream in addition to console methods.
// The only intended attended output is the reviewed /dev/tty prompt.
process.stdout.write = () => true
process.stderr.write = () => true
// Upstream auth packages sometimes console-log tokens or error bodies.
// Quiet all library console channels; only reviewed messages go to /dev/tty.
for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir']) {
  console[method] = () => {}
}
function privateNotice(message) {
  const fd = openSync('/dev/tty', 'w')
  try { writeSync(fd, message + '\n') } finally { closeSync(fd) }
}
async function main() {
  if (process.argv.length !== 2 || !isatty(0) || !isatty(1)) {
    throw new Error('Attended private terminal required')
  }
  if (process.getuid() === 0) throw new Error('Root authentication is prohibited')
  // These are supplemental guards; the future trusted launcher must clear the
  // environment *before* Node starts, as a preload runs before this check.
  if (process.execArgv.length !== 0 || process.env.NODE_OPTIONS || process.env.NODE_DEBUG ||
      process.env.DEBUG) throw new Error('Untrusted Node execution environment')
  verifyPrivateCache()
  acquireProvisionLock()
  try {
    // Check after exclusivity in case another invocation ran in the gap.
    verifyPrivateCache()
    // No main.js, Mineflayer, or minecraft-protocol imports. Authflow is
    // imported only after private-directory/TTY/lock checks.
    const deadline = setTimeout(() => process.exit(1), 8 * 60_000)
    try {
      const { default: library } = await import('prismarine-auth')
      await provisionAuthentication({
        Authflow: library.Authflow,
        Titles: library.Titles,
        report: () => {} // do not persist or echo authentication events
      })
      privateNotice('SaraCraft authentication cache provisioned for the pinned profile.')
    } finally {
      clearTimeout(deadline)
    }
  } finally {
    // On a hard timeout or kill the exclusive lock remains fail-closed.
    releaseProvisionLock()
  }
}
try {
  await main()
} catch {
  // Never stringify upstream errors, auth replies, names or token details.
  safeError(FATAL_MESSAGE)
  process.exitCode = 1
}
