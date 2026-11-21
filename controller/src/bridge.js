// Only trusted server/authentication adapters may set identityVerified=true.
// This deliberately does NOT connect to Mineflayer's name-only "chat" event.
export function normalizeTrustedChat({ senderUuid, text, isPlayerChat, serverAuthenticated, senderIdentityResolved }) {
  if (isPlayerChat !== true || serverAuthenticated !== true || senderIdentityResolved !== true) return null;
  return { source: 'authenticated_player_chat', senderUuid, text, identityVerified: true };
}
