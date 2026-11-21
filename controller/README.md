# SaraCraft M0.2 controller prototype

A deliberately **dependency-free, non-networked** JavaScript controller. Requires Node.js 22+ to execute.

Run `npm test` and `npm run check` inside `controller/`. Tests use mock adapters and do not connect to Minecraft.

The only supported commands are `!sara follow`, `!sara return`, `!sara gather <oak_log|spruce_log|birch_log> <1..32>`, and `!sara stop`.

**Important trust boundary:** An adapter must establish sender UUID through authenticated server identity and set `identityVerified` only after real verification. The plain Mineflayer `chat` event emits a username and is not acceptable as proof of authorization. `normalizeTrustedChat` is a data shape helper and cannot verify identity by itself. Do not connect untrusted raw player text directly to `SaraController.handle`.

**STOP semantics:** AbortSignal, transport-specific `halt()`, and a bounded wait for task shutdown. A failed halt or uncooperative adapter returns `stopped: false`; it cannot guarantee physical in-world cessation until integration checks pass.

The adapter methods `follow`, `gather`, `returnHome`, and `halt` are currently injected mocks, **not a working Mineflayer binding**. Only return `{ verified: true }` on observed world/inventory effects. No hosted-model API client, secrets, persistent store or network server is included yet.

Future integration gates: a pinned Mineflayer version/lockfile, Microsoft login, server-authenticated UUID resolution, genuine pathfinding/collection, idempotent restart handling, persistence and real stop latency measurements.
