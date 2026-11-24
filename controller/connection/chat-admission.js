// Paper/vanilla 1.21.11 MessageSignature.Packed encodes cache index + 1.
// The pinned protocol reader exposes that wire value, while its verifier looks
// up array indices in a different cache. Supply decoded signatures to the
// existing verifier; its signature, session and freshness checks still decide.
const signatureBytes = 256
const cacheSize = 128
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
    const age = BigInt(Date.now()) - timestamp
    const session = client._players?.[packet.senderUuid]
    observed = {
      sender: packet.senderUuid, index: packet.globalIndex,
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
        packedSignaturesResolved: synchronized
      }
    }
  }

  // The decoded player_chat handler emits playerChat synchronously.
  client.prependListener('player_chat', receive)
  return {
    take(packet) {
      const current = observed
      observed = undefined
      return current && current.sender === packet?.sender && current.index === packet?.globalIndex
        ? current.flags : {}
    },
    dispose() {
      client.removeListener('player_chat', receive)
      observed = undefined
      cache.fill(null)
    }
  }
}
