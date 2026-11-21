# SaraCraft M0.6: AI intent proposal layer

**Prototype, not deployed. No paid API provisioned. No model has access to Docker, systemd, RCON, the server or the world.**

This dependency-free Node 22 module accepts bounded user text and calls an OpenAI-compatible chat-completions endpoint (TLS for hosted, HTTP only for local loopback Ollama). Provider/model/API credentials are supplied by a future trusted runtime, never model output. `ChatProvider` sets JSON mode, low temperature, response and timeout limits, refuses HTTP redirects (`redirect: 'error'`), and streams the response body with a 16 KiB cap so oversized responses are rejected without being buffered. Compatibility with the chosen provider/model must be checked before enabling live inference.

`IntentPlanner` returns only a **typed proposal**, never executes it. Game verbs: follow, stop, return, gather. Operations verbs: health, players, backup, allowlist_add/remove, restart. Unsupported actions and malformed output fail closed.

**Critical integration boundary:** a separate authenticated transport must verify the requester. For ops, the existing `ops/src/policy.js` and `OpsGateway` independently authorize proposals with real operator identity/confirmation from a trusted channel; the LLM must never synthesize those. For gameplay, the existing controller must bind messages to the authenticated player UUID and enforce its own limits. The privileged Hephaestus broker and host access remain a separate review/deployment gate.

There is **no hourly/daily inference budget or request-rate limit yet**; one is required before any paid provider is enabled (see the M0.7 security review and integration plan).

This is **not conversational autonomy** or persistent offline operation. Those require session/memory design, metering and rate limits, and actual integrated tests. The hosted provider will incur costs if enabled in the future.

Run `npm run check && npm test` in `ai/`.

Do not log provider credentials, send authentication tokens or private chat histories to models, or treat instructions embedded in Minecraft signs/chat as trusted.
