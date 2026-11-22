# M0.7 navigation safety gate

This is a **source-only, fail-closed safety primitive**, not a deployed Mineflayer navigation system. It is not evidence that SaraCraft can swim, pathfind, escape creepers, or halt in-world.

A future authenticated Mineflayer movement adapter must:
- Call `check({ signal })` before issuing a movement goal and at bounded intervals while it moves.
- Provide **fresh** game-derived telemetry: `air` (0–300), `inWater`, `nextStepInWater` (actual next route step, not only the current block), and `creeperDistance` (nearest hostile creeper in blocks; use a finite range sentinel such as 1e6 if none are observed).
- Fail closed if telemetry, chunk observations or route safety cannot be established. Never invent safe readings to pass the gate.
- Implement `halt` by cancelling the active pathfinder goal and relevant Mineflayer movement controls. A resolved halt call is **not** proof that the in-game entity actually stopped.
- Stop the movement task and report `reason` and `haltConfirmed` when the gate trips. A failed halt needs escalation, not a quiet retry.
- Tie STOP's AbortSignal to the monitor, independently from timeout and disconnect handling.

The initial policy conservatively blocks water and nearby creepers. It does not implement swimming, rescue, full hostile-mob safety, staleness detection, automatic route replanning, or task persistence. Tests are deterministic mocked snapshots only. Actual game-world acceptance is a separate, authorized milestone.

Run `node --test safety.test.js` with Node 22+ to exercise the gate without connecting to Minecraft.
