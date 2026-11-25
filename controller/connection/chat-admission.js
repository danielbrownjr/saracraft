import { verify } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { concat } = require('minecraft-protocol/src/transforms/binaryStream')
// Paper/vanilla 1.21.11 MessageSignature.Packed encodes cache index + 1.
// The pinned protocol reader exposes that wire value, while its verifier looks
// up array indices in a different cache. Supply decoded signatures to the
// existing verifier; its signature, session and freshness checks still decide.
const signatureBytes = 256
const cacheSize = 128
// The attended diagnostic measured a lead of 182–186 ms for a signed command.
const supervisedFutureLimitMs = 250
const logDeltaLimit = 1_000_000n

function boundedDelta(timestamp, wall) {
  if (timestamp <= 0n) return null
  const delta = timestamp - wall
  return Number(delta > logDeltaLimit ? logDeltaLimit : delta < -logDeltaLimit ? -logDeltaLimit : delta)
}

function signatureProof(packet, session, timestamp, resolved) {
  if (!resolved || !session?.sessionUuid || !session.publicKey || timestamp <= 0n ||
      !isSignature(packet.signature) || !Number.isInteger(packet.index) || packet.index < 0) return false
  const salt = packet.salt?.valueOf()
  if (typeof salt !== 'bigint') return false
  try {
    const previous = packet.previousMessages.map(item => item.signature)
    const length = Buffer.byteLength(packet.plainMessage, 'utf8')
    const signed = concat('i32', 1, 'UUID', packet.senderUuid, 'UUID', session.sessionUuid,
      'i32', packet.index, 'i64', salt, 'i64', timestamp / 1000n, 'i32', length,
      'pstring', packet.plainMessage, 'i32', previous.length, 'buffer', Buffer.concat(previous))
    return verify('RSA-SHA256', signed, session.publicKey, packet.signature)
  } catch {
    return false
  }
}
const isSignature = value => Buffer.isBuffer(value) && value.length === signatureBytes

export const isCommandCandidate = text => typeof text === 'string' && /^\s*!sara(?:\s|$)/i.test(text)

export function observeChatWire(client) {
  const cache = Array(cacheSize).fill(null)
  let synchronized = true
  let observed

  function unpack(packet) {
    if (!synchronized || !Array.isArray(packet.previousMessages) ||
        packet.previousMessages.length > 20 ||
        (packet.signature != null && !isSignature(packet.signature))) return false
    const previous = packet.previousMessages.map(entry => {
      if (entry.id === 0) return isSignature(entry.signature) ? entry.signature : null
      if (!Number.isInteger(entry.id) || entry.id < 1 || entry.id > cacheSize) return null
      return cache[entry.id - 1]
    })
    if (previous.includes(null)) return false

    // Mirror MessageSignatureCache.push: last-seen entries then current,
    // assigned newest-first, carrying forward displaced nonduplicate entries.
    const pending = [...previous]
    if (packet.signature != null) pending.push(packet.signature)
    const included = new Set(pending.map(value => value.toString('hex')))
    for (let i = 0; pending.length && i < cacheSize; i++) {
      const displaced = cache[i]
      cache[i] = pending.pop()
      if (displaced && !included.has(displaced.toString('hex'))) pending.unshift(displaced)
    }
    packet.previousMessages = previous.map(signature => ({ id: 0, signature }))
    return true
  }

  function receive(packet) {
    observed = undefined
    const packedReferences = Array.isArray(packet.previousMessages) &&
      packet.previousMessages.some(entry => entry.id > 0)
    synchronized = unpack(packet)
    if (!isCommandCandidate(packet.plainMessage)) return
    // ProtoDef decodes i64 as a SignedBigInt wrapper with bigint valueOf().
    const decoded = packet.timestamp?.valueOf()
    const timestamp = typeof decoded === 'bigint' ? decoded : 0n
    const session = client._players?.[packet.senderUuid]
    const signatureValidWithoutTime = signatureProof(packet, session, timestamp, synchronized)
    const chainAllowsIndex = Boolean(session?.hasChainIntegrity === true &&
      (!session.lastSignature || (isSignature(packet.signature) && session.lastSignature.equals(packet.signature))
        || packet.index > session.sessionIndex))
    // Sample immediately before the pinned handler. take() samples immediately
    // after, bracketing its private Date.now() without altering any clock.
    const before = BigInt(Date.now())
    const age = before - timestamp
    observed = {
      sender: packet.senderUuid, index: packet.globalIndex, timestamp,
      session, messageIndex: packet.index, signature: packet.signature,
      advancesSession: Boolean(session?.hasChainIntegrity === true &&
        (!session.lastSignature || packet.index > session.sessionIndex)),
      flags: {
        wireObserved: true,
        signaturePresent: Boolean(packet.signature),
        unsignedDecoration: Boolean(packet.unsignedChatContent),
        chatSessionKnown: Boolean(session?.sessionUuid),
        chatChainIntact: session?.hasChainIntegrity === true,
        timestampAhead: timestamp > 0n && age < 0n,
        timestampExpired: timestamp > 0n && age > 420_000n,
        timestampPresent: timestamp > 0n,
        packedReferences,
        packedSignaturesResolved: synchronized,
        signatureValidWithoutTime,
        chainAllowsIndex,
        signedDeltaBeforeMs: boundedDelta(timestamp, before)
      }
    }
  }

  // The decoded player_chat handler emits playerChat synchronously.
  client.prependListener('player_chat', receive)
  return {
    take(packet) {
      const current = observed
      observed = undefined
      if (!current || current.sender !== packet?.sender || current.index !== packet?.globalIndex) return {}
      const signedDeltaAfterMs = boundedDelta(current.timestamp, BigInt(Date.now()))
      const { signedDeltaBeforeMs, signatureValidWithoutTime, unsignedDecoration } = current.flags
      const session = client._players?.[current.sender]
      // The pinned handler verifies the chain before applying its timestamp window.
      // Require that handler to have accepted this exact signature into the same session.
      const allowSupervisedClockSkew = packet.verified === false && signatureValidWithoutTime &&
        !unsignedDecoration && signedDeltaBeforeMs > 0 && signedDeltaBeforeMs <= supervisedFutureLimitMs &&
        signedDeltaAfterMs >= 0 && signedDeltaAfterMs <= signedDeltaBeforeMs &&
        current.advancesSession && session === current.session && session.hasChainIntegrity === true &&
        session.sessionIndex === current.messageIndex && session.lastSignature?.equals(current.signature) === true
      return { ...current.flags, signedDeltaAfterMs, allowSupervisedClockSkew }
    },
    dispose() {
      client.removeListener('player_chat', receive)
      observed = undefined
      cache.fill(null)
    }
  }
}
