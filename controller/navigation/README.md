# M0.7 navigation safety gate

M0.8 implements this contract in the adjacent [Mineflayer adapter](../connection/movement.js); see [integration limits](../../docs/m0-8-integration.md). The reviewed monitor and its tests are unchanged. The M0.7 contract below remains applicable.

This is a **source-only, fail-closed safety primitive**, not a deployed Mineflayer navigation system. Tests use mocks, not a live Minecraft connection. It does not prove in-world STOP, escape, or creeper avoidance.

An authenticated Mineflayer movement adapter must:
- Call `check({ signal })` before each movement goal and at a bounded cadence while moving. Keep STOP abort independent from disconnect and deadlines.
- **Actuation boundary (R2):** immediately before each movement goal or control-state change, synchronously verify `monitor.tripped === null` and `!signal.aborted`. A `{ safe: true }` result is only a point-in-time observation and may have preceded a concurrent trip. Do not `await` between this final check and issuing the movement command; continue bounded monitoring after actuation. This reduces but cannot eliminate the underlying async/time-of-check race.
- Supply a fresh, complete snapshot: `observedAt` (millisecond timestamp; no future dates; default age <= 1000 ms), `air` (raw 0–300 ticks, not the rounded 0–20 `bot.oxygenLevel`), `inWater`, `nextStepInWater` (the real planned step), `entitiesObserved: true` only after reliable entity enumeration, and `creeperDistance` (3D Euclidean distance between bot and creeper entity positions, in blocks, or `null` when enumeration completed and no creeper was found).
- Treat missing chunks, stale telemetry, incomplete entity enumeration and unavailable planned-route checks as unknown. Never substitute a large fake distance sentinel (such as 1e6) or invent safe values. The 6-block creeper threshold must be checked against sampling cadence, possible closing speed and margin during integration.
- Provide a bounded `readState({ signal })` implementation where possible. The monitor independently races read completion against abort and `readTimeoutMs` (default 400 ms), rejecting late results.
- Provide a `halt` that clears movement goals and control states. All concurrent unsafe checks share a single halt attempt. Its result is `haltState: 'pending' | 'acknowledged' | 'failed' | 'timed_out'` (default halt deadline 1000 ms). **Acknowledged means the halt promise resolved, not that in-world movement stopped.** Failed or timed-out halts require escalation and separate observation of actual cessation.
- Distinguish `WATER_UNSAFE` (pre-entry, reject route) from `WATER_EXIT_REQUIRED` with `action: 'surface'` (already submerged). **Plain halt is not a safe underwater recovery**; the future adapter must provide a minimal air/dry-block escape before claiming that scenario is safe. This module does not implement or validate an escape; the monitor's halt command only suspends regular navigation. Likewise, halting near a creeper is not a proven evasive maneuver.

The monitor is a one-task latch: first unsafe reason wins and subsequent checks receive the same terminal result. After a trip it must not be reused for another movement task. Default telemetry ages and deadlines are configurable and must be validated against the future adapter's actual cadence and latency.

This stage excludes Mineflayer integration, automatic route replanning, swimming, live hostile-mob avoidance, verified STOP latency, and autonomous gameplay. Real-world game acceptance requires separate authorization.

Run `node --test safety.test.js` using Node 22+ to exercise the deterministic tests.
