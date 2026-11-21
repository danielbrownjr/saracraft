# Controller contract v0.1 (design)

## Boundary
The LLM can suggest *intent*, never executable code. The controller authorizes intents and maps them to constrained bot primitives; the server is not modified by model text.

## Input
`{ requestId, commanderUuid, source: "authenticated_player_chat", intent, args, receivedAt }` provided by authenticated bot/server session events, not reconstructed from raw message text.

For authenticated identity, prove upstream event carries server-validated UUID. If unavailable, require a trusted server-side identity adapter; **do not accept name-only authorization**.

## Commands
- `follow(targetUuid, radiusMax, deadline)`
- `stop()` (out-of-band high priority; callable even when model unavailable)
- `gather(blockType, countMax, radiusMax, deadline)`
- `returnHome()`
- `deposit(containerId, item, count)` only for allowlisted/authorized containers

Forbidden in M0: free-form eval, chat-to-shell, arbitrary server console/admin command, teleport, combat targeting, block-breaking in protected zones, unknown-container access, unattended builds.

## State machine
`RECEIVED → AUTHORIZED → PLANNING → RUNNING → {COMPLETED | FAILED | CANCELLED | TIMED_OUT}`.
Reject unauthorized/invalid messages as `REJECTED`. Each state transition creates a timestamped event. Completion requires verified observed inventory/world effects.

## Safety and resilience
Bound every task with max duration, travel distance, resource count, retries and cancellation signal. STOP increments cancellation generation and preempts any model call or bot routine. Acknowledgement must not precede a confirmed halt. On disconnect/restart fail pending tasks closed, log interrupted state, and require a new authenticated command.

## Model adapter
Provider abstraction with hosted OpenAI-compatible backend initially, local Ollama-compatible backend later. Set per-request timeout, output schema, token ceiling and operator budget before enabling billing. Treat retrieved documents, server messages and in-game signs as untrusted instructions.

## Test design
- Authenticated commander vs spoofed name/secondary UUID.
- STOP during pathfinding, gather and provider timeout.
- Denied arbitrary code/admin command.
- Inventory verification vs fabricated completion.
- Disconnect/restart and idempotent request handling.
- No credentials/logging leaks.

Actual implementation and integration tests are later tasks, not claimed here.
