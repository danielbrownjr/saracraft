# SaraCraft Stage 2 installation candidate (historical source design and host gates)

**Base (historical):** PR #7 `6844ac8bc2d1c8f09cab5957873c64f20fbbc1b6`, independently accepted on previous scope.
**Host evidence:** Hephaestus preflight of November 23, 2026, including authorized ownership-only metadata checks.
**Status (2026-11-24):** PR #8 is merged to `main`. Stage 2 release `50a2159` was subsequently installed and verified on Hephaestus according to the 2026-11-23 Stage 3 Hephaestus acceptance record; this document retains the earlier candidate-stage facts for historical context. Current host state has not been rechecked since the source merges. PR #11 (`407a1d8`) passed synthetic credential-free host acceptance but is not known to be promoted. The emergency inhibit remains mandatory and no live authentication or gameplay is authorized.

## Approved source-level trust and logging decisions (2026-11-23)

Dan approved retaining `daniel` as the human host administrator for recovery and owns routine development. `saracraft-bot` is the future unprivileged runtime. The approved bot release is root-controlled and immutable to routine development. `saracraftctl` is the single fixed-verb control route for routine operation, with no general sudo lease.

**Important limit:** `daniel` currently belongs to `sudo`, `adm`, and `lxd`. This is **operational separation**, not a hardened claim that the host administrator cannot access a protected bot. Do not revoke these groups without a separate recovery and trust-model authorization.

## Historical pre-installation host facts (2026-11-23; not current state)

- Host: systemd 259.9; Python 3.14.4 with isolated `-I`; developer-private Node 22.23.4; `/usr/bin/node` absent.
- Required Node: 22.23.5, not installed to the expected root-controlled path.
- `saracraft-bot` account and all proposed release/control directories are absent.
- Legacy auth cache has owner `sara`, mode 0700 beneath `/home/sara/.local/state/saracraft-auth/cache`; ordinary `daniel` traversal is denied.
- `daniel` can read raw persistent journal/syslog via `adm`; no raw-log confidentiality guarantee.
- Existing server world/config belong to separate owners; do not modify them.
- Temporary preflight sudoers rule was removed and syntax checked by Dan; do not reinstall it.
- Existing legacy bot launch inventory, service-only runtime behavior and actual server state are not yet verified.

## Candidate artifacts

- `ops/systemd/saracraft-bot.hephaestus.candidate.service` is a **noninstallable review reference** using the future absolute Node 22.23.5 path. Its systemd controls, bind mounts and actual effective sandbox are **untested on Hephaestus**. Its stdout/stderr are discarded using `StandardOutput=null` and `StandardError=null`, so the bot cannot put raw output into `adm`-readable journald or syslog via these streams. Service-manager metadata may still be journaled.
- `ops/release_manifest.py` produces a v2 SHA-256 inventory with file **and directory** metadata (type, owner UID/GID, mode, and regular-file hardlink count). The public `verify` action rejects ownership other than root:root, group/other write, setuid/setgid, linked files, unsafe ancestor directories back to `/`, symlinks/special files, and any manifest mismatch. `build` can run against an unprivileged staging directory, but such a snapshot **does not imply** a promotable release; install into the trusted root-controlled tree first, then rebuild the manifest under trusted administrative custody and run strict `verify`. The trusted manifest must be stored outside both release and developer write access. This is not a signature, atomic anti-TOCTOU protection, or a runtime integrity gate, and does not attest to Node, units, or sudoers outside the release tree.
- `APPROVED-RELEASE` is a *presence-only administrative gate*. It does not validate the SHA it contains. The future promotion procedure must compare a separately trusted manifest and record the exact release Git SHA, Node binary SHA, dependency lock and installer hashes before placing the gate file.
- `ops/saracraftctl-priv` now provides allowlisted systemd `Result`, `ConditionResult` and `ExecMainStatus` alongside ActiveState (F5). It still does not confirm Minecraft connected, a cgroup empty, or a server disconnect.

## Historical installation decisions and blockers (pre-acceptance)

1. **Logging source design completed; host acceptance BLOCKED.** Dan approved preserving administrator privileges and private runtime logs. Unit discards stdout/stderr; `main.js` writes the fixed bot-owned `/var/log/saracraft-bot/verification.jsonl` (0600) inside a 0700 bot-owned directory. The allowlisted `saracraftctl logs` helper reads only a bounded 256 KiB tail of that fixed file, rejects symlinks, wrong owner or unsafe modes, and discards unrecognized or oversized records. No journal fallback. Systemd may still journal its own lifecycle metadata. Validate installed effective behavior with a synthetic secret canary. Determine retention/rotation before deployment, rotating only when bot stopped and preserving private ownership; long-term unbounded disk growth is not acceptable.
2. **Legacy launch inventory (HIGH).** Discover all services, containers, tmux tasks, cron, timers, credentials mounts and Sara-owned launch routes through an explicitly authorized bounded metadata inspection. Retire only approved mechanisms after new service is accepted, ensuring one bot connection.
3. **Runtime and identity (HIGH).** A trusted builder must obtain pinned Linux x64 Node 22.23.5 and locked `npm ci --ignore-scripts` dependencies, verify supplier artifacts/checksums and produce immutable artifacts. No unverified download or active developer checkout as source of credential-bearing execution.
4. **F6 headless Authflow integration.** Added an offline regression invoking locked `prismarine-auth@3.1.1` with global fetch intercepted and an in-memory empty cache, verifying `AUTH_REQUIRED`, bounded device-code retries, and no code disclosure. It makes no network connection or credential read. This does not test actual Microsoft authentication.
5. **F7 systemd hardening and availability.** Evaluate proc isolation, namespaces, IPC, kernel restrictions, AF_NETLINK/resolver requirements and missing-path behavior on credential-free disposable processes. Do not copy every hardening directive blindly onto the production service.
6. **F8 release integrity.** The candidate hash tool is only an offline promotion aid until trusted manifest signing/storage, immutable ownership and Node/units hashes are verified. `ExecStartPre` enforcement is not claimed.
7. **Stop timing and status.** `systemctl stop --no-block` accepts a stop job; it does **not** prove the bot terminated. Assert empty service cgroup separately. The application 175-second backstop begins after imports and the systemd 180-second limit permits additional stop timeout. No guaranteed five-second reserve.
8. **Human administrator decision (approved):** retain `daniel` as trusted administrator, without altering `sudo`/`adm`/`lxd` memberships. The model is operational separation, **not a security boundary against Codex running as `daniel`**. If LXD's daemon/socket is reachable to the `lxd` group, `daniel` (including Codex processes) may obtain root-equivalent access without a password and reach tokens/private logs. Preserve privileges as explicitly approved; verify LXD availability during host preflight, avoid reusable sudo timestamps in Codex sessions, and never claim this policy prevents intentional administrator bypass. This source task makes no host policy change.

## Historical Stage 2 sequence (any further host operation requires separate authorization)

1. Approve trust/logging model. Snapshot only affected metadata/configuration. Capture exact ownership, presence and pre-change hashes.
2. Offline, build root-installable release and root-controlled Node 22.23.5. `npm ci --ignore-scripts` only from reviewed lockfile. Generate a v2 manifest **outside the release tree** after final root-controlled copy, run `python3 ops/release_manifest.py verify /opt/saracraft/releases/<approved-sha> /root/<trusted-manifest>.json` under explicit administrative authorization, verify exact Git SHA and independent Node binary hash, and reject unexpected symlinks, hardlinks, unsafe ancestors, modes, ownership, or changed directory entries. The manifest must be kept in separate trusted custody, not written into the bot's live release.
3. Under administrative supervision create the dedicated non-login `saracraft-bot` account, private auth/cache and logging directories, root-owned control and immutable release paths. Keep the inhibit installed **before** any start permission is exposed.
4. Verify unit effective sandbox and sudoers exact command allowlist. Review `/run/docker.sock` and optional exclusion paths. Disable automatic start and set `Restart=no`.
5. With a dummy executable, no auth and `PrivateNetwork=yes`, verify start/status/stop/estop (queued, active and hung), duplicate suppression, cgroup empty, partial estop failures, terminal detach and no boot auto-start. Reboot testing requires a separately authorized maintenance window.
6. Verify synthetic canaries stay out of developer-readable raw logs and sanitized output. Confirm existing groups and sudo/polkit cannot bypass the chosen trust model unintentionally.
7. Only after successful dummy acceptance and a separate credential authorization: migrate the existing legacy cache privately or use an auth-only utility that cannot contact Minecraft. Do not run `main.js` as an auth-only step.
8. Only after another separate attended trial authorization: controlled observation with server-side disconnect evidence. No movement, merge or deployment implied here.

## Rollback proposal

Before host writes record previous files, permissions, sudoers, service status and source SHA privately. For an installation failure, inhibit and stop only the new bot unit; verify its cgroup is empty, revoke its restricted sudoers grant and restore only modified installation-owned configuration. Keep credentials private, preserve server/world data, avoid automatic legacy restart and do not alter unrelated units. Never declare rollback verified without exercising it.

**Historical pre-installation gate (superseded by subsequent Stage 2 acceptance):** M1 strict release-tree ownership/mode audit and L1 missing-account handling are source changes pending exact-head CI and a focused independent re-review. Dan has approved the trust and private logging *source design*, not its installation. A separate independent review of the new private-file reader, unit output handling, status semantics and release verification plus installed-host dummy acceptance and a named Stage 2 authorization are still required. **Installation was BLOCKED at that point.** The current next gate is separately authorized trusted promotion of `407a1d8`; recheck host metadata before proceeding.
