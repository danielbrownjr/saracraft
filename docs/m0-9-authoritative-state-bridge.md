# M0.9 — Authoritative self-state bridge (proposed ADR)

Status: design proposal; not implemented, approved for deployment, or live accepted.

## Evidence and scope

The installed M0.8 candidate is 3cd0b1ede6195f9b4fcd3745d81d6ab1650f33e8 (tree 692a56053dd2fa7c414451e805db963fe95d486b). [Raw-air characterization](https://docs.google.com/document/d/18dKcY_YxcgewmBvuQfFfykUGvgCh1PHO/edit) and [fixture evidence](https://drive.google.com/file/d/1GX0M0IeZDK7xnD1VqbfGqsOHlzaU2t_q/view) establish that Paper 1.21.11 build 132 / protocol 774, Mineflayer 4.39.0, minecraft-protocol 1.68.0 and minecraft-data 3.119.0 omit default air at dry spawn/reconnect and do not periodically resend stable air. Submersion changes arrive about every 50 ms; recovery ends at 300; respawn supplies one full refresh. Keepalive is not self-state coverage.

The existing controller/connection/telemetry.js requires a witnessed self-air packet no older than 1 s and invalidates on respawn/end. It separately checks physics and block immersion, sampled next-step volume and nearby entity coverage. Do not relax the installed gate. Passive trial behavior passed technically but formal acceptance remains partial due to missing collector snapshots; see [acceptance](https://docs.google.com/document/d/1sls_1-QBNUVUuHkZte8RBG8Vo44bZGwl/edit). Movement remains blocked.

## Decision

Propose a small Paper plugin, SaraCraft Bridge, in this repository, publishing bounded complete self-state snapshots over a custom Minecraft play-state plugin-message channel. Prefer periodic full snapshots over delta reconstruction: this is a tiny payload, completeness is explicit, and recovery is easier to audit. Reuse the authenticated game connection rather than expose a new network listener. No server commands, inventory mutations, teleport, privilege grant, arbitrary queries or other-player data.

Alternatives:
- Vanilla metadata plus cached defaults: rejected; initial provenance and liveness absent.
- RCON/console polling: rejected; unnecessarily privileged, separate identity and timing, exposes administrative interface.
- Separate read-only HTTP/socket service: possible but adds credentials, listener, session binding and replay surface; reserve for demonstrated plugin messaging incompatibility.
- Custom channel: preferred pending actual Paper registration, initial delivery, client custom_payload framing and lifecycle tests. Verify exact APIs and packet ordering in disposable fixture before freezing design.

## Protocol proposal v1

Channel candidate: saracraft:state. Separate directions with strict message kinds. Binary, fixed width, network byte order; exact lengths, no arbitrary strings, no extension parsing in v1. Proposed maximum payload 128 bytes. All multibyte values unsigned except air/entity ID if required by verified server contract. No compression or dynamic allocations from declared lengths.

Client BIND request: version u8, kind u8, fresh 128-bit challenge. Only allowed client message; repeated BIND rate limited; no player identifiers or requested actions. Server obtains authenticated sender from the channel callback and checks configured bot UUID and online-mode identity. Reject unsupported versions, malformed frames and unauthorized senders without reflecting input.

Server SNAPSHOT: version u8, kind u8, challenge echo 16 bytes, server-generated generation token 16 bytes, sequence u64, server tick u64, entity ID i32, dimension identifier represented by generation (no arbitrary text), remaining air i32, maximum air i32, flags u8 (eye fluid/water, body immersion, alive, valid). Explicitly specify exact fluid semantics and unknown encoding before implementation. Candidate layout 63 bytes; reserved bits must be zero. Server tick is diagnostic, not a synchronized wall clock. Sequence starts at zero for full baseline and increments by one for each complete snapshot. Reject overflow rather than wrap. Generation is scoped to server-observed player session and dimension/entity lifecycle; challenge scopes client binding. A new generation requires a fresh binding and full baseline, never silent continuation.

Server snapshots are sampled consistently on the main server thread. Read-only public Paper API preferred; if authoritative eye-fluid data requires internals, document exact pinned mapping, compatibility and failure behavior before implementation. Air bounds must be justified by supported Paper API and game configuration; reject unknown/unsupported values rather than clamp to safe values. Unknown flag combinations invalidate. No claim that a player being dry establishes full air.

## Timing and trust

Candidate cadence every 4 ticks (200 ms nominal at 20 TPS), provisional expiry 1 s on client monotonic clock, preserving current maximum age until measured evidence justifies a change. These are fixture starting parameters, not accepted motion limits. Measure actual interarrival, tick lag, client event-loop stalls, actuation halt and physical stopping envelope. Establish a reviewed bound before live movement; if no defensible bound, stay inhibited. Server tick progression, sequence and receipt freshness must all be consistent; a queued burst or keepalive must not refresh stale state indefinitely. Evaluate bounded round-trip challenge/response freshness or equivalent verified transport-age contract before enabling actuation, because receipt time alone cannot prove server sample age.

Trust: authenticated online-mode Paper connection and explicitly configured bot identity; verify the pinned client/server transport and channel delivery path. Trust the server/plugin and approved release, not other clients or chat. Challenge/epoch prevent accidental cross-session/replay confusion, not a malicious trusted server. No extra secret or credential handling is proposed. Restrict state to the bound player; no broadcast. Rate-limit bind, bounded per-player state, clean on quit/disable, no blocking I/O on tick thread. Reject malformed messages without logging payloads or identity/coordinates. Unsupported plugin/server or missing channel leaves state unknown. Offline-mode identity permitted only in isolated synthetic fixtures.

## Receiver and navigation state machine

UNBOUND -> WAIT_BASELINE after fresh bind; WAIT_BASELINE -> VALID only on matching complete sequence-zero snapshot and verified lifecycle/entity/dimension context. VALID requires consecutive sequence, current generation, tick progress, freshness and complete validated fields. Duplicate, gap, reorder, malformed frame, stale tick, contradictory state or unknown context -> INVALID; immediately revoke authorization, deassert controls, clear goal, cancel task, and require explicit new command after rebind and baseline. No automatic resumption. Death, respawn, disconnect, dimension/position reset, client replacement and plugin disable invalidate and discard prior context. A new snapshot does not clear a latched task failure. Avoid rebind loops; bounded retries only while non-actuating. Receiver attaches before relevant login events; old callbacks cannot revive a new epoch.

Independent gates remain mandatory: known dry eyes/body, current local physics and loaded block/chunk geometry, conservative swept route plus measured stopping envelope, water/waterlogged/bubble column exclusion, known entity coverage and existing creeper rule. Any positive hazard or discrepancy stops; unknown is not dry. Low air threshold remains existing predicate until explicitly reviewed. Revalidate synchronously at every positive control or goal and on relevant events and monitor timer. Preserve existing STOP, cancellation, quarantine, signed commander and emergency inhibit invariants. Raw vanilla air remains diagnostic; contradictory witnessed values require investigation and invalidation, not unsafe override. Do not substitute rounded oxygen display or assumed 300.

## Verification matrix and staged implementation

| Stage | Work | Acceptance |
|---|---|---|
| A | Protocol spec and Paper API spike | Exact build/API, channel registration/order, eye-fluid semantics, full frame layout and bounds; no production changes |
| B | Minimal plugin | Synthetic authenticated sender binding, other-player rejection, invalid frame/rate limits, tick-thread snapshot, lifecycle cleanup |
| C | Client receiver | Deterministic fake-clock tests for baseline, duplicate/gap/reorder, stale/queued burst, malformed/unknown fields, epoch reset, disconnect and explicit rebind |
| D | Navigation integration | Preserve existing raw gate until reviewed replacement; prove unsafe/unknown state cannot issue controls; regression for STOP, cancellation, task replacement, hazards and no automatic resume |
| E | Disposable Paper | Dry spawn/idle/walk, immersion/recovery, respawn, dimension/reset, delayed chunk data, plugin absence, fault injection, tick and event-loop lag; measure halt/stopping envelope |
| F | Independent review | Architecture + implementation evidence, exact-head CI, bounded review cycle |
| G | Production | Separately authorized matching plugin/runtime promotion, rollback, inhibited preflight and attended movement characterization only after formal passive acceptance |

## Parallel collector readiness

The recovered standalone collector passed seven deterministic tests per archived characterization. Its source/supervisor integration has not been located in this repository. Do not recreate the existing host code from a report and call it integrated. Import exact sanitized source and tests with provenance or work in the established host development workspace under authorization. Rehearse complete supervisor wiring with fake operations/clock: prelaunch, scheduled 30/60/90/120/150-second and final captures, 100-record rollover and overlap, exact-line deduplication, trial attribution, premature exit and missing/late slots, real versus ambiguous telemetry gaps, stop and final capture. Require durable snapshots, not merely polling measurements. Then seek separate authorization for one passive trial; no reconstruction of historical missing snapshots.

## Non-goals and stop

This ADR alone changes no navigation policy, runtime, plugin, host, credentials, server configuration or inhibit. No movement readiness claim. Implementation requires reviewed protocol details, verified fixtures and separate production authorization. Keep existing source and operational gates intact.
