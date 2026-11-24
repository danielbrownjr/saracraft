# Gameplay-first development direction

Decision: 2026-11-24. Prioritize playable cooperative survival over comprehensive prevention of ordinary in-game hazards. Retain host, account, server and authorization boundaries. This supersedes the requirement for an authoritative air bridge before initial supervised dry-land movement, not the existing deployed safety policy or authorization to deploy.

## First playable milestone

Reuse existing signed commander commands follow, comeHere and stop, existing controller cancellation and bounded Mineflayer pathfinder. Do not introduce an LLM dependency for basic commands. Build a distinct explicitly selected supervised dry-land policy; keep the strict raw-air policy available and unchanged by default. Use fresh local geometry, physics and entity observations independently of raw-air delivery. Missing air is an explicitly accepted in-game risk only in this profile; never synthesize air=300 or refresh cached air as if received. Known low air, known immersion, waterlogged/bubble hazards, unloaded route, missing commander, cancellation and invalid lifecycle still stop. Treat ordinary damage, death and imperfect pathfinding as gameplay defects rather than host-security incidents. No automatic resumption after disconnect or death. Initial scope walking/following on prepared dry terrain with operator oversight, no block edits, combat, chest access or autonomous goals.

## Implementation and verification

1. Separate local geometry sampling from air freshness. Share one selected policy between synchronous control/goal checks and async monitor. Existing strict-policy tests must remain green; add focused tests for dry motion without raw air, known hazard, stale local state, STOP and identity spoofing. Do not change observe mode.
2. Inspect existing --walk authentication/signing and runtime contract. Provide a narrowly scoped, reviewed operator launch path with the same non-op identity, private auth, root-controlled release, emergency inhibit, singleton and independent stop. Current installed service/helper only allow observation; do not bypass them, run an ad hoc second bot or grant broader sudo. Prefer same unit and fixed mode selection if feasible; separately authorize any host changes. Keep evidence sanitized. Do not expose coordinates, raw chat or credentials through privileged logs.
3. Exact-head CI and risk-proportionate independent review of authorization and control boundaries. Then separately authorized attended gameplay smoke test: follow a short distance, come here, STOP while moving; observe actual cessation, signed commander enforcement, clean disconnect and restored inhibit. No formal 150-second stationary retest solely for the bookkeeping fix. No extra review cycles for nonblocking game-behavior polish.
4. Incrementally add look/jump and basic interaction, then explicitly authorized chest organization with inventory conservation and allowlisted containers. No generalized shell, server console, arbitrary code execution or autonomous destructive world edits.

## Parallel work

PR #18 terminal classification remains a separate narrow review and merge decision; preserve original historical outcome and independently re-evaluated evidence. PR #16 authoritative bridge remains optional future underwater/advanced navigation work, not a prerequisite for supervised dry-land movement. Do not merge either merely because this direction changed.

No host deployment, credential changes, live connection or movement is authorized by this document or its source merge.
