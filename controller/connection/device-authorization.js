// Device authorization is exclusively an attended interactive procedure.
import { openSync, writeSync, closeSync } from 'node:fs'

export function privateDeviceCode({ verification_uri: uri, user_code: code },
  { report, name, interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) }) {
  const url = new URL(uri)
  if (url.protocol !== 'https:' || !['www.microsoft.com', 'microsoft.com', 'login.live.com'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || !/^[A-Z0-9-]{4,16}$/i.test(code)) {
    throw new Error('Invalid device-code response')
  }
  report('authorization_required')
  if (!interactive) throw new Error('AUTH_REQUIRED')
  const tty = openSync('/dev/tty', 'w')
  try {
    writeSync(tty, `\nOpen ${url.href} and enter ${code} using the Microsoft account for ${name}.\n\n`)
  } finally {
    closeSync(tty)
  }
}
