# SaraCraft M0.5 restricted operations gateway

**Prototype only. Not deployed or connected to Docker, systemd, RCON or Minecraft.**

This provides a deterministic, dependency-free policy layer and explicit backend interface. It is not a privileged helper or an authenticated network service. Run `npm test` and `npm run check` with Node 22 or newer.

| Intent | Arguments | Policy |
|---|---|---|
| health, players, backup | none | Authenticated operator |
| allowlist_add | username (3–16 ASCII letters, numbers, underscores) | Authenticated operator |
| allowlist_remove | username | Fresh verified confirmation required |
| restart | none | Fresh verified confirmation required |

All other action names, extra arguments, non-string usernames, command strings and player-supplied authority are rejected.

## Trust model (M0.7)

`OpsGateway` is constructed with a `TrustRoot` (`src/trust.js`). Only objects minted by that root via `issuePrincipal()` / `issueConfirmation()` are accepted; field values such as `authenticated: true` or `verified: true` carry no authority, so deserialized or model-generated JSON can never authorize an operation. Confirmations are bound to request ID, action and approving principal and expire (default 120 s, maximum 300 s). The `TrustRoot` must be held only by the authenticated transport, never by the AI planner or Minecraft adapter. This is an in-process capability boundary, not process isolation.

Every started operation is recorded write-ahead (`started`); if the audit sink fails, the backend is not invoked (`AUDIT_UNAVAILABLE`). Outcomes are `success`, `failed` or `timed_out`; an outcome-audit failure is reported as `AUDIT_INCOMPLETE` with the real outcome. Rejections (`rejected`, `rejected_duplicate`, `rejected_busy`) are audited. Backend methods receive `(args, { signal })` and each action has a gateway deadline (`DEADLINE_MS`). After a timeout the gateway lock is held until the backend actually settles, because the gateway cannot prove that a privileged operation stopped.

**Before host deployment:** implement authenticated local transport (e.g. Unix `SO_PEERCRED`) that owns the `TrustRoot`, a tiny root-owned fixed-operation broker with no Docker socket exposed to the agent, persistent (fsynced) idempotency/audit records, helper-side hard kill timeouts, bounded backups and a privileged helper review. The current in-memory replay prevention and audit callback do not survive restarts. Test against adversarial requests and verify actual host limitations before granting any authority.

No general shell, arbitrary console/RCON command, Linux service name input, Docker daemon access, public listener, or privilege escalation through the agent.
