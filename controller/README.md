# SaraCraft controller and M0.8 movement integration

The controller remains dependency-free and accepts deterministic authenticated command envelopes. The separate `connection/` adapter uses pinned Mineflayer/pathfinder dependencies and integrates the reviewed `navigation/` safety monitor.

Commands: `!sara follow`, `!sara come-here` (also `come here` and `come`), `!sara stop` (also `cancel`), `!sara return`, and `!sara gather <oak_log|spruce_log|birch_log> <1..32>`. The movement chat adapter admits only follow, come-here and STOP; gather/return remain unavailable there.

The trusted envelope helper is a boundary, not an authenticator. Name-only chat never establishes authority. Movement admission requires the configured commander UUID, protocol-verified chat, encrypted transport, matching player roster and a strictly increasing packet index.

Deadlines abort execution and request a transport halt. STOP bounds halt and task settlement concurrently; duplicate requests share the task cancellation. The first terminal reason wins. An uncooperative task or unsuccessful halt quarantines the controller instance, preventing replacement authorization. `stopped` describes adapter settlement plus halt acknowledgement; `movementStopped: false` explicitly records that physical cessation was not verified.

Install the locked connection dependencies before recursive discovery:

```sh
cd connection
npm ci --ignore-scripts --no-audit --no-fund
cd ..
npm run check
npm test
```

Use Node 22.23.5/npm 10.9.9. All tests use mocks or local installed libraries; never execute `connection/main.js` for offline verification. See [integration decisions and acceptance limits](../docs/m0-8-integration.md).
