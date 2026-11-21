# SaraCraft architecture v0.2 (M0.1 design)

Minecraft Java client -> authenticated private Paper server on Hephaestus <- authenticated Sara bot (Mineflayer / Mindcraft CE).
Separate controller validates authenticated commands, mediates bot primitives, manages STOP/timeouts and logs session events. Hosted inference via an approved API initially; Ollama adapter later.

See [compatibility matrix](compatibility-matrix.md), [controller contract](controller-contract.md), [host and security design](host-and-security-design.md), and [M0 acceptance](M0-acceptance.md).

## Isolation and authority
- Online mode plus allowlist; bot is never op.
- Chat and in-world content are untrusted. No name-based operator authorization. Authenticated UUID or trusted server-side identity adapter only.
- Fixed command allowlist. Model returns structured intents, not code. No arbitrary shell/JS, plugin installation, admin command execution, remote filesystem access or privileged credentials.
- STOP cannot depend on an LLM request finishing. Cancellation confirmed before acknowledgement.
- Protect structures and inventories; deny destructive interaction unless explicitly approved.
- Controller errors fail closed, and task completion requires verification.

## Persistence
Local world data and eventual SQLite task state must be captured consistently, with an independent NAS copy and restore test; backups must not leak credentials.

## Deployment separation
The Compose template remains inactive, requires reviewed immutable image and explicit private interface bind, with EULA false by default. M0.1 does not authorize Docker/Java/Node installation, services, LAN/firewall changes, account purchases, API provisioning, runtime tests or deployment.

## Unresolved
Exact Paper build and image digests, Mindcraft CE/Mineflayer lock, bot identity event semantics, client login behavior, provider model/budget, NAS connectivity and restore, firewall exposure and actual CPU/chunk-generation reliability remain unverified.
