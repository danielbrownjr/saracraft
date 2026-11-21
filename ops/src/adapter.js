// Intentionally disconnected from Docker, sudo, systemd, RCON and the live world.
// A separately reviewed, fixed-operation Heph helper will implement these methods.
export function unavailableBackend() {
  const blocked = async () => { throw Error('BACKEND_NOT_CONFIGURED'); };
  return Object.freeze({
    health: blocked, players: blocked, backup: blocked,
    allowlistAdd: blocked, allowlistRemove: blocked, restart: blocked
  });
}
