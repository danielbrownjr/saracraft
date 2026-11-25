# SaraCraft — zero-to-local MVP

Status: proposed baseline for owner review, 2026-11-25. Supersedes earlier milestone ordering and gameplay-first proposal #19 once merged. Historical evidence and code remain intact. No deployment or merge authority granted here.

## Product contract

A private Minecraft Java survival companion with local Ollama inference that reads bounded game observations, interprets authenticated player requests, chooses typed gameplay actions, executes through a deterministic controller, and observes results. No hosted inference or cloud fallback. MVP is attended cooperative play, not unattended survival or a general-purpose agent. Microsoft game authentication and ordinary Minecraft networking are distinct from inference; local inference does not imply air-gapped Minecraft.

Use one private existing Paper world and Mineflayer, existing Node stack, and one Ollama model on existing authorized local hardware (same host or private LAN; no public inference endpoint). Select model by a small benchmark, not preference or speculative hardware purchasing. Reuse working implementation; no rewrite, reset, branch deletion, or artificial repetition of evidence. No mandatory Mindcraft integration. Model output is intent only, never executable code or authority.

## Ordered roadmap

All items initially unaccepted for this clean-sheet planning baseline. Reconcile existing evidence first; mark each accepted only against its exit criteria. No requirement to rerun an adequate exact-scope historical demonstration merely because the plan is new. Dependencies: #25 → #26 → #27 → #28; #25 → #29 in parallel; #28 and #29 → #30 → #31. Work on earliest unaccepted milestone in each branch; the local inference branch is the sole standing parallel exception. Direct blocker investigation remains in scope. The roadmap table governs if an issue body differs.

| ID | Issue | Required deliverable | Exit evidence |
|---|---|---|---|
| MVP-00 | [#25](https://github.com/danielbrownjr/saracraft/issues/25) | Reproducible private dev/server baseline | pinned versions, private online-mode allowlist, distinct licensed non-op bot, setup/run/stop and existing bot/runtime recovery |
| MVP-01 | [#26](https://github.com/danielbrownjr/saracraft/issues/26) | Authenticated connection and text exchange | attended join/spawn, commander message and existing !sara acknowledgement, disconnect; unauthorized sender rejected by offline regression |
| MVP-02 | [#27](https://github.com/danielbrownjr/saracraft/issues/27) | Deterministic dry-land follow, come-here, STOP | follow at least 5 blocks, visible STOP cessation, come-here, follow again; spoof/replay/cancel regression |
| MVP-03 | [#28](https://github.com/danielbrownjr/saracraft/issues/28) | Minimal structured observations, look, collect | correct observed inventory/nearby state, look at commander, collect one dropped item with verified inventory delta |
| MVP-04 | [#29](https://github.com/danielbrownjr/saracraft/issues/29) | One local Ollama model, bounded typed intents | ten warm representative prompts; advisory median <=10s, hard request deadline 30s; valid intents, malformed/unknown output rejection, timeout cancellation; measured latency |
| MVP-05 | [#30](https://github.com/danielbrownjr/saracraft/issues/30) | Model-to-controller action/observation loop | two distinct action types selected from paraphrased requests; one two-step goal driven by observed results; injection/invalid intent regression including slash-prefixed reply; direct STOP bypasses and cancels inference |
| MVP-06 | [#31](https://github.com/danielbrownjr/saracraft/issues/31) | Local playable MVP | single attended 20-minute session, natural-language follow/come/look/collect, one two-action goal, direct STOP during movement or inference, safe disconnect; >=8/10 agreed requests completed or correctly declined; all named capabilities must succeed; no cloud inference or unauthorized action |

Known live blocker from MVP-01 onward: signed-chat future-timestamp rejection; resolve via #24 (independently approved, unmerged at planning snapshot) or an equivalent owner-approved correction. Live milestones use existing `--walk-supervised`. One attended session can satisfy MVP-01 and MVP-02; evidence can be shared across later milestones where criteria are met.

MVP-04 median latency is advisory, not a measured hardware claim; owner may accept a measured model/latency tradeoff on #29 without changing the roadmap. The 30s deadline, schema validation and cancellation remain mandatory. No new hardware or infrastructure. MVP-06 requires owner-approved changes to both in-code walking session/process deadlines (currently 8/17 minutes) and unit `RuntimeMaxSec` (currently 180 seconds); use current limits until approved. Choose safe existing world conditions; if death interrupts the demonstration, obtain owner approval for a relaunch within MVP-06 rather than add respawn infrastructure.

## Minimum action and observation interface

Allowlist: chat reply, follow commander, come to commander, stop, look toward commander, collect a nearby dropped item. No arbitrary coordinates from the model for MVP; controller resolves authenticated commander and nearby item against current observations. Bound travel, action duration, item count, request size and inference time using existing controller limits where applicable. One active action at a time; at most three actions per operator-requested goal; no continuous self-directed loop. Direct authenticated STOP and independent host emergency stop do not depend on inference. STOP cancels in-flight inference and remaining goal steps; discard late model output. Chat replies are bounded single-line plain text; reject or neutralize a leading slash so model text never becomes a server command. Cancel pending work on disconnect/death; new explicit request required after restart. Validate intent schema and authority outside model. Treat chat and observed world text as untrusted data. Report completion only from observed effects, not model claims. Model receives only necessary game state, never host credentials.

## Scope freeze

1. Every PR names exactly one primary MVP issue, concrete exit criterion advanced, files/subsystems in scope, verification and explicit non-goals. Small supporting changes allowed only if needed to satisfy that issue. Planning PRs may identify the roadmap itself instead.
2. New discovery is a blocker only if reproducible evidence shows it prevents an explicit exit criterion or violates a security/data-integrity invariant. Fix smallest demonstrated cause within current issue. If material expansion is required, obtain owner decision with tradeoff and revised roadmap before implementation. Do not add hidden milestones.
3. Optional improvement gets a post-MVP label or a line in the deferred register; never becomes an implied dependency. Do not create dozens of speculative issues. At most one active capability issue per approved branch; MVP-04 may proceed alongside MVP-01–03. No dates or estimates masquerading as commitments.
4. Use proportional verification: focused tests and normal required CI, independent review for substantive changes under General Standing Orders, one practical live demonstration where specified. No new acceptance supervisor, dedicated stationary trial, arbitrary-duration soak or repeated independent review for nonblocking polish. Existing credential/privilege/identity/stop/recovery boundaries remain mandatory; owner authorizes merge, deployment, host changes and live launch.
5. Close an issue only with links to accepted evidence and exact revision/configuration where relevant. Offline tests do not substitute for required live behavior. Preserve historical failed outcomes. Stop once milestone acceptance is established; do not polish indefinitely.
6. Changes to scope, acceptance criteria or dependency order require explicit owner approval and an owner-approved roadmap diff. No unilateral expansion by agent, reviewer or model. Once MVP-06 passes, stop and report; post-MVP work requires a new decision.

## Deferred register (not prerequisites)

- #3 generalized privileged server-operations gateway: excluded.
- #16 authoritative raw-air bridge, underwater navigation, exhaustive hazard prevention: deferred.
- #19 earlier gameplay-first roadmap: superseded by this proposal on merge; preserve draft history.
- Hosted inference, provider abstraction beyond one local endpoint, cloud fallback, multi-model routing, custom training, RAG, persistent companion memory, vision, voice, personality polish, dashboards, generalized skill framework, autonomous combat/mining/crafting/building, chest organization, multiplayer expansion, continuous autonomous survival, server plugins, additional monitoring or qualification infrastructure, new world backup mechanisms and tested world restore drills: post-MVP. Document existing world backups if present; retain existing bot/runtime recovery. Existing code need not be removed.
- #4 local proposal code: reuse candidate for MVP-04/05 only; selectively reuse bounded provider transport (`ai/src/provider.js`) and relevant test patterns, not hosted/server-ops paths or the old action vocabulary (including block-breaking gather). No blanket merge.

## Tracking

GitHub issues #25–31 are the canonical execution checklist; this document is the scope/dependency contract. Labels: `mvp`, `phase:foundation`, `phase:connection`, `phase:movement`, `phase:gameplay`, `phase:inference`, `phase:agent`, `phase:acceptance`, `type:task`, `priority:required`, `post-mvp`, `deferred`, `reuse-candidate`, `superseded-roadmap`. Use [MVP issue view](https://github.com/danielbrownjr/saracraft/issues?q=is%3Aissue+label%3Amvp) and [deferred view](https://github.com/danielbrownjr/saracraft/issues?q=label%3Apost-mvp). Native GitHub Milestones/Projects creation was not available in the connected API; do not make board setup a gameplay dependency. If native setup is later authorized and supported, create seven milestones corresponding exactly to these IDs and assign the existing issues; no duplicate issues or extra milestones. Do not use release Git tags until actual release authorization.
