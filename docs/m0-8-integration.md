# M0.8 Mineflayer navigation integration

M0.8 selectively integrates the recovered movement adapter with the reviewed M0.7 navigation safety monitor. It is a source integration verified offline, not a deployed or accepted gameplay system. The [reconciliation matrix](m0-8-reconciliation.md) records every recovered file and checksum. Draft M0.8 must target `feat/m0-7-navigation-safety` while PR #5 remains unmerged.

## Actuation and observations

Each movement task owns a new `NavigationSafetyMonitor`. Checks run before a goal, at most 100 ms apart while active, on physics ticks and relevant world/entity events. Immediately before ordinary goals and control changes, a synchronous guard evaluates current telemetry and verifies the monitor latch and task AbortSignal. No awaited operation separates this check from the underlying Mineflayer call. This also guards pathfinder's own calls to `setControlState`, rather than checking only the initial goal.

Pinned pathfinder 2.4.5 emits its actual mutable `path` array in `path_update` and shifts that same array while following it. The adapter uses its current first step, with bounded preplanning before goal admission. Partial, missing, mining or building paths are rejected. Free motion, shortcuts, sprinting, digging, scaffolding and stuck-jump recovery are disabled. Follow targets a two-block goal within a 32-block start/commander boundary and a 60-second controller deadline. Come-here snapshots the target location, with a 30-second deadline and the same boundary.

Telemetry resolves the registry's raw `air_supply` metadata key and requires a witnessed packet for the bot's own entity. It never multiplies rounded `oxygenLevel` or invents a default air supply. Raw-air observation time is retained; later local reads cannot make an old packet fresh. Immersion and the swept volume toward the actual proposed step include waterlogged blocks and loaded chunk/block checks. Entity enumeration requires the authoritative local entity map, the bot's self entry, valid observed entities and loaded nearby columns. The nearest observed creeper uses three-dimensional distance; no fake distance sentinel represents an unknown entity set.

These observations describe the client's received world state, not an omniscient server snapshot. Server tracking distance, packet latency and ordering remain acceptance concerns. Every unavailable, stale, incomplete or ambiguous observation fails closed. Dry-ground servers may omit default air metadata or not refresh unchanged air within the one-second freshness window. In that case navigation is deliberately unavailable or cancels; this milestone does not claim sustained dry-ground follow works on the live server.

## Halt and terminal behavior

A safety trip synchronously blocks ordinary actuation and clears the goal and control states, then propagates cancellation into the controller. Monitor results retain their terminal reason and bounded halt outcome. A scoped halt path permits only control deassertions through Mineflayer's own `clearControlStates()` implementation; it cannot authorize new movement. Guards remain installed after disposal to block queued stale callbacks.

Controller deadlines request halt and abort execution. Halt and task settlement have independent concurrent bounds, defaulting to one and five seconds. First cancellation reason wins; late completions cannot rewrite terminal state. Hung operations or unsuccessful halts quarantine the controller so replacement cannot authorize a new task. STOP while idle still requests transport halt. Repeated concurrent STOP shares cancellation. Replacement waits for bounded settlement and uses a command generation to discard superseded requests.

`haltState: acknowledged` means a halt function returned, and `stopped` means transport acknowledgement plus task settlement. Neither proves in-game cessation. Reports explicitly carry `movementStopped: false`; chat acknowledges the halt without claiming observed stopped motion. Position/velocity sampling and server correlation are still required for physical acceptance.

## Water and creepers

`WATER_UNSAFE` rejects a route entering water. `WATER_EXIT_REQUIRED` identifies existing immersion and cancels ordinary navigation, reporting that a verified escape is unavailable. No emergency swimming or jump loop is implemented. Without trustworthy dry-block/air-route evidence, a safe bounded escape cannot be established here. Ordinary halt therefore cannot accidentally cancel an escape action, because no escape is started. Being halted underwater is not safe recovery and requires operator intervention under future authorization.

The reviewed six-block creeper threshold is unchanged. A nearby observed creeper stops ordinary navigation. Stopping does not prevent an explosion. At 100 ms cadence, asynchronous read/halt bounds, packet latency and hostile closing speed still consume the available margin; no live margin or evasive behavior is verified. Combat and evasion planning remain outside this milestone.

## Launcher and dependencies

The existing bot identity and target pins are preserved. Optional movement mode requires an explicit non-placeholder `SARACRAFT_COMMANDER_UUID`, validated before any authentication path access. Recovery documentation identities and endpoint are never runtime defaults. Protocol-verified signed player chat, cipher, roster UUID and monotonically increasing packet index gate command admission. System/name-only chat cannot authorize commands.

The historical signed-chat certificate request and bounded eight-minute movement session are selectively retained. Early telemetry attachment precedes spawn. Session closure requests synchronous movement shutdown before quit. No launcher, authenticated login or server connection is part of offline verification.

The only added dependency is exact `mineflayer-pathfinder@2.4.5`; all prior lock records remain unchanged. Verification uses Node 22.23.5/npm 10.9.9. CI installs the connection lock before recursive test discovery, because movement tests now import the pinned adapter library. Existing supported checkout/setup-node actions remain unchanged. Dependency deprecations and audit concerns are recorded rather than suppressed with unrelated upgrades.

## Proposed attended acceptance, requiring separate authorization

1. Review the draft changes and obtain explicit approval for the exact candidate, isolated installation, authentication, Minecraft connection and bounded attended trial. Verify the operator, commander identity, private server configuration and recovery route without reading credential contents. No merge or deployment is implied by this proposal.
2. Begin with a stationary, dry, enclosed area under direct operator observation. Verify whether real self air packets, entity tracking, loaded chunks and path updates satisfy fail-closed telemetry. If they do not, stop and collect only sanitized diagnostics; do not inject safe defaults or bypass the guard.
3. If telemetry is adequate, permit one short dry-ground come-here operation, then a short follow, explicit STOP and one replacement. Correlate task events with observed position/velocity and server timestamps. Set a predeclared observation window and cessation tolerance before testing; halt acknowledgement alone does not pass.
4. Verify unknown telemetry and disconnect cancellation without approaching hazards. Do not intentionally immerse the bot or approach a live creeper while no safe recovery/evasion is accepted. Hazard behavior remains an offline rejection test until a separately reviewed recovery plan and operator intervention are authorized.
5. End the attended session within its bound, verify disconnect, preserve sanitized evidence and leave the candidate draft/unmerged. Unexpected motion, missing observations, failed halt or unmet telemetry assumptions ends the trial immediately.

The smallest next step is review of the exact draft and authorization for stationary telemetry acceptance. Gameplay must wait if telemetry cannot establish the required observations.
