# SaraCraft M0.5 restricted operations gateway

**Prototype only. Not deployed or connected to Docker, systemd, RCON or Minecraft.**

This provides a deterministic, dependency-free policy layer and explicit backend interface. It is not a privileged helper or an authenticated network service. Run `npm test` and `npm run check` with Node 22 or newer.

| Intent | Arguments | Policy |
|---|---|---|
| health, players, backup | none | Authenticated operator |
| allowlist_add | username (3–16 ASCII letters, numbers, underscores) | Authenticated operator |
| allowlist_remove | username | Fresh verified confirmation required |
| restart | none | Fresh verified confirmation required |

All other action names, extra arguments, command strings and player-supplied authority are rejected. The caller must supply a verified principal from a separate trusted channel. A model-generated `principal.authenticated=true` is **not** adequate authentication; it must never be accepted as a real principal by the eventual transport.

**Before host deployment:** implement authenticated local transport (e.g. Unix peer credentials), a tiny root-owned fixed-operation broker with no Docker socket exposed to the agent, persistent idempotency/audit records with safe failure handling, operations-specific hard timeouts, bounded backups and a privileged helper review. The current in-memory replay prevention does not survive restarts. Confirmation evidence must be cryptographically/channel-bound rather than a caller-provided JSON object. Test against adversarial requests and verify actual host limitations before granting any authority.

No general shell, arbitrary console/RCON command, Linux service name input, Docker daemon access, public listener, or privilege escalation through the agent.
