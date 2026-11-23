# SaraCraft Stage 2 installation candidate (NOT approved or installed)

**Base:** draft PR #7 `6844ac8bc2d1c8f09cab5957873c64f20fbbc1b6`, independently accepted on previous scope.
**Host evidence:** Hephaestus preflight of November 23, 2026, including authorized ownership-only metadata checks.
**Status:** source candidate only. No accounts, files, services, permissions, processes, tokens or Minecraft connections have been changed by this task.

## Trust model decision required

Recommended: `daniel` remains the human host administrator for recovery and owns routine development. `saracraft-bot` is the future unprivileged runtime. The approved bot release is root-controlled and immutable to routine development. `saracraftctl` is the single fixed-verb control route for routine operation, with no general sudo lease.

**Important limit:** `daniel` currently belongs to `sudo`, `adm`, and `lxd`. This is **operational separation**, not a hardened claim that the host administrator cannot access a protected bot. Do not revoke these groups without a separate recovery and trust-model authorization.

## Current verified host facts

- Host: systemd 259.9; Python 3.14.4 with isolated `-I`; developer-private Node 22.23.4; `/usr/bin/node` absent.
- Required Node: 22.23.5, not installed to the expected root-controlled path.
- `saracraft-bot` account and all proposed release/control directories are absent.
- Legacy auth cache has owner `sara`, mode 0700 beneath `/home/sara/.local/state/saracraft-auth/cache`; ordinary `daniel` traversal is denied.
- `daniel` can read raw persistent journal/syslog via `adm`; no raw-log confidentiality guarantee.
- Existing server world/config belong to separate owners; do not modify them.
- Temporary preflight sudoers rule was removed and syntax checked by Dan; do not reinstall it.
- Existing legacy bot launch inventory, service-only runtime behavior and actual server state are not yet verified.

## Candidate artifacts

- `ops/systemd/saracraft-bot.hephaestus.candidate.service` is a **noninstallable review reference** using the future absolute Node 22.23.5 path. Its systemd controls, bind mounts, path availability, and logs are **untested on Hephaestus**.
- `ops/release_manifest.py` can construct and verify a deterministic SHA-256 inventory of regular files in an offline assembled release; symlinks and special files fail closed. The manifest must be created, signed off and stored separately by a trusted administrator, never by the developer during release promotion. The manifest is not a cryptographic signature and does not attest to Node or systemd units outside the release root.
- `APPROVED-RELEASE` is a *presence-only administrative gate*. It does not validate the SHA it contains. The future promotion procedure must compare a separately trusted manifest and record the exact release Git SHA, Node binary SHA, dependency lock and installer hashes before placing the gate file.
- `ops/saracraftctl-priv` now provides allowlisted systemd `Result`, `ConditionResult` and `ExecMainStatus` alongside ActiveState (F5). It still does not confirm Minecraft connected, a cgroup empty, or a server disconnect.

## Remaining installation decisions and blockers

1. **Logging (HIGH).** Do not install the current unit with raw stdout/stderr forwarded to accessible journald/syslog while claiming bot secrets are isolated from developer Codex. Choose and separately review a private fixed-path `StandardOutput=append:...`/discarded stderr design, root-opened sanitized event log, and retention/rotation policy, or deliberately accept that `daniel` is a trusted journal reader. The present root helper uses `journalctl` and must be changed if output moves to private files. Test with synthetic secret canaries before live authentication.
2. **Legacy launch inventory (HIGH).** Discover all services, containers, tmux tasks, cron, timers, credentials mounts and Sara-owned launch routes through an explicitly authorized bounded metadata inspection. Retire only approved mechanisms after new service is accepted, ensuring one bot connection.
3. **Runtime and identity (HIGH).** A trusted builder must obtain pinned Linux x64 Node 22.23.5 and locked `npm ci --ignore-scripts` dependencies, verify supplier artifacts/checksums and produce immutable artifacts. No unverified download or active developer checkout as source of credential-bearing execution.
4. **F6 headless Authflow integration.** The previous offline review observed four device-code requests through `prismarine-auth@3.1.1` with stubbed fetch. Add a locked-library integration regression before credential migration or service acceptance; do not call Microsoft endpoints during testing.
5. **F7 systemd hardening and availability.** Evaluate proc isolation, namespaces, IPC, kernel restrictions, AF_NETLINK/resolver requirements and missing-path behavior on credential-free disposable processes. Do not copy every hardening directive blindly onto the production service.
6. **F8 release integrity.** The candidate hash tool is only an offline promotion aid until trusted manifest signing/storage, immutable ownership and Node/units hashes are verified. `ExecStartPre` enforcement is not claimed.
7. **Stop timing and status.** `systemctl stop --no-block` accepts a stop job; it does **not** prove the bot terminated. Assert empty service cgroup separately. The application 175-second backstop begins after imports and the systemd 180-second limit permits additional stop timeout. No guaranteed five-second reserve.
8. **Human administrator decision.** Keep `daniel` trusted with `sudo`/`adm`, or separately authorize hard isolation, recovery account and membership changes. This source task makes no policy change.

## Proposed Stage 2 sequence (separate explicit authorization required)

1. Approve trust/logging model. Snapshot only affected metadata/configuration. Capture exact ownership, presence and pre-change hashes.
2. Offline, build root-installable release and root-controlled Node 22.23.5. `npm ci --ignore-scripts` only from reviewed lockfile. Generate a manifest **outside the release tree**, verify file hashes, exact Git SHA, independent Node binary hash, and reject unexpected symlinks.
3. Under administrative supervision create the dedicated non-login `saracraft-bot` account, private auth/cache and logging directories, root-owned control and immutable release paths. Keep the inhibit installed **before** any start permission is exposed.
4. Verify unit effective sandbox and sudoers exact command allowlist. Review `/run/docker.sock` and optional exclusion paths. Disable automatic start and set `Restart=no`.
5. With a dummy executable, no auth and `PrivateNetwork=yes`, verify start/status/stop/estop (queued, active and hung), duplicate suppression, cgroup empty, partial estop failures, terminal detach and no boot auto-start. Reboot testing requires a separately authorized maintenance window.
6. Verify synthetic canaries stay out of developer-readable raw logs and sanitized output. Confirm existing groups and sudo/polkit cannot bypass the chosen trust model unintentionally.
7. Only after successful dummy acceptance and a separate credential authorization: migrate the existing legacy cache privately or use an auth-only utility that cannot contact Minecraft. Do not run `main.js` as an auth-only step.
8. Only after another separate attended trial authorization: controlled observation with server-side disconnect evidence. No movement, merge or deployment implied here.

## Rollback proposal

Before host writes record previous files, permissions, sudoers, service status and source SHA privately. For an installation failure, inhibit and stop only the new bot unit; verify its cgroup is empty, revoke its restricted sudoers grant and restore only modified installation-owned configuration. Keep credentials private, preserve server/world data, avoid automatic legacy restart and do not alter unrelated units. Never declare rollback verified without exercising it.

**Next gate:** Dan approves the trust model, logging policy and a named Stage 2 host change set; until then **installation is BLOCKED**.
