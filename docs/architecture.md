# SaraCraft architecture v0.1 (design)

## Topology
Java client -> authenticated private Paper server <- authenticated Sara bot (Mineflayer / Mindcraft CE).
A separate controller is planned for task authorization, timeout/STOP, state and event logging. Its interface must be validated against the selected pinned bot runtime before implementation.
Inference is a configurable hosted API at first; Ollama is a later adapter, not a deployment prerequisite.

## Trust boundaries
- Minecraft server is private. No public port forwarding, RCON or administrative bot privileges.
- Online-mode authentication stays enabled; test accounts and credentials live outside Git.
- In-game player chat is untrusted input, not a source of operator authority.
- Only a designated user identity may command Sara; identity must come from authenticated server identity, not display-name text alone.
- Explicit allowlisted actions and bounded time, distance, resource and build limits.
- No LLM-supplied JavaScript execution, shell access, filesystem traversal or unsandboxed plugin use.
- STOP is checked before every long-running action and during navigation.
- Avoid destructive actions around protected zones, player bases or non-owned chests.
- Secret material must never be sent to in-game chat, logs or the model prompt.

## Deployment boundary
Compose is an inert, server-only template. The bot/controller are intentionally NOT represented as deployable containers until upstream versions and auth are checked. Starting the server, binding LAN interfaces, creating licenses, provisioning tokens, installing services, or enabling scheduled processes needs separate approval.

## Persistent state
World files live in a backed-up private volume after deployment authorization. SQLite is a planned task/session memory database with schema migrations and opt-in bounded retention. It must not retain API secrets or unnecessary personal conversation history.

## Open validation items
- Upstream Mindcraft CE license, maintenance, compatibility, authentication and configuration schema.
- Paper/Java image tag and container security on the actual NAS architecture.
- Hosted provider API costs, rate limits and credential strategy.
- Exact identity binding and controller integration seam.
- Logs, backup restore test, failure/restart semantics.
