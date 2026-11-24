# SaraCraft restricted runtime control, Stage 1 source design

**Status (2026-11-24):** Stage 1–3 source PRs #5–#11 merged to `main`. Source merge is not host deployment or authorization for Minecraft use. A Stage 2 release at `50a2159` was previously installed on Hephaestus (per the 2026-11-23 acceptance record), and the credential-free synthetic host gate passed for unpromoted `407a1d8`; current host state has not been rechecked. The pinned observation safety behavior and emergency inhibit remain required.

## Trust boundaries

- Developer `daniel` can edit source and request only fixed local operations.
- Root-owned immutable release at `/opt/saracraft/releases/current` includes an explicit `APPROVED-RELEASE` marker containing a separately authorized, verified SHA. The developer/bot cannot write release files, ancestors, or symlink targets. Never point this at a developer checkout.
- `saracraft-bot` is an unprivileged non-login identity separate from the `saracraft` world-storage owner and temporary `sara` admin account.
- Only the bot account reads its private Microsoft cache. Runtime control never receives credential bytes.
- Bot has no direct Minecraft server world or Docker access. Systemd service keeps its own process cgroup independent of Codex/tmux.
- Initial unit is strictly `--observe`; movement cannot be selected by `saracraftctl`.

## Fixed-verb interface (installation and live use separately gated)

```text
saracraftctl start observe
saracraftctl status
saracraftctl logs
saracraftctl stop
saracraftctl estop
```

No arbitrary flags, unit names, release paths, environment overrides, or shell fragments. The unprivileged CLI maps to five exact noninteractive sudo backend operations. An emergency stop attempts to persist an inhibit and **always** requests a systemd stop regardless of permission, filesystem, or lock failures. It reports separate machine-readable outcome labels `stop_request=ACCEPTED|FAILED` and `inhibit_file=PRESENT|NOT_CONFIRMED` and exits nonzero if either operation fails. A successful `systemctl stop --no-block` only acknowledges a queued stop request, **not** confirmed bot termination or server-side disconnect. A present inhibit file is the start-condition gate (subject to real systemd verification), not a guarantee of power-loss durability. When the inhibit cannot be written, **future starts are NOT inhibited even if the current stop request is accepted**. Do not restart until an authorized administrator repairs and verifies the inhibit; independently confirm bot termination. When the stop request fails, use separately authorized host administration to verify and terminate the running bot; merely having the inhibit does not kill an existing process. The inhibit should remain effective through reboot and subsequent start requests when installed and validated. Plain `stop` also bypasses all persistence and locks. To clear it, a separately authorized administrator first verifies the runtime is stopped, then uses the root-only `clear-inhibit` operation. It is **not** part of Daniel's sudo grant.

`status` reports only systemd ActiveState and inhibit status in this Stage 1 prototype; it does **not** establish that Minecraft is connected or report a verified release SHA. Operational readiness and game-level disconnect still require separate telemetry/server corroboration. `logs` parses only allowlisted JSON events/fields from the fixed service unit journal and discards unknown/freeform entries. It does not expose arbitrary journal entries, authentication codes, usernames, UUIDs, positions, or credentials. The journal is still privileged, so host log routing/privacy requires installation review.

## Startup limits and credentials

The proposed launcher ends a normal observation after 150 seconds of readiness, allowing clean completion. A separate 175-second overall backstop begins before authentication or client construction, with an early shutdown signal and short hard-exit fallback. Static imports precede this timer, so the interval to systemd's 180-second cap is **not** a guaranteed five-second reserve. At most **one** observation connection attempt is permitted. Service `RuntimeMaxSec=180` is an independent process-lifetime ceiling; the nominal timing gap does not guarantee an exact shutdown reserve. Neither bound is proof of immediate server-side disconnect.

A headless device-auth challenge returns `AUTH_REQUIRED` without displaying device codes or opening a terminal. Authentication must be established through a separately approved interactive operation before service use. The existing interactive verifier and optional movement mode retain their separate behaviors.

Evidence has a fixed default under `/auth/verification.jsonl` for existing manual runs. In the proposed service only, the exact `SARACRAFT_EVIDENCE_PATH=/var/log/saracraft-bot/verification.jsonl` path selects a separate private log directory. Do not make that log directory publicly writable or readable. Logging schema changes require review.

## Host preflight required before Stage 2 (no permission granted here)

1. Inspect metadata only: installed Node location/version, launcher and Docker assumptions, existing auth/cache ownership, existing legacy bot sessions, log routing, and `saracraft-minecraft.service` health. Do not read tokens.
2. Verify root ownership of the helper, service unit, immutable release and all parent directories, and the exact sudoers command matches. Fail closed on unexpected permissions.
3. Verify the dedicated bot account exists and is *not* a member of docker or other privileged groups. Confirm private auth directories, paths, bind mount, `ReadWritePaths`, `InaccessiblePaths`, resolver/network access and fixed server endpoint.
4. Do not assume `/usr/bin/node` exists or matches the locked dependency runtime; correct the reviewed unit template only after inspection.
5. Check systemd unit parsing, effective sandboxing and release manifest checksum; run controlled offline fixtures before any credential-bearing launch.
6. Ensure `ExecStart` cannot load developer-written code via symlink, writable parent, Node resolution, runtime config or dependency injection.
7. Retire legacy bot starts under separate authorization; enforce singleton across both old and new launch mechanisms.
8. Validate emergency stop during pending start, hung shutdown, terminal disconnect and host reboot without a Minecraft connection.
9. Separately authorize any migration of existing Microsoft credential cache; protect account-specific data and never place it in the repository or developer home.

## Offline Stage 1 acceptance and limits

Run `python3 -m unittest discover -s ops/tests -v` (Python standard library only), `python3 -m py_compile ops/saracraftctl ops/saracraftctl-priv`, connection Node regressions, and exact-head CI. These checks test parsers, allowlists and mocked lifecycle; they do **not** establish that systemd sandboxing, the actual host binary, stop kinetics, credentials or the world state are safe.

Do not install units, alter permissions, deploy, authenticate, merge or start Minecraft as part of Stage 1. The initial independent review identified F1-F3 and the focused independent re-review accepted F1-F4 at `0150717260f82f3d0752d0ec63d211f565e9cfd9`. Follow-up R1/R2 improve outcome reporting and document the non-latching partial-stop case. No new routine independent review is authorized by this follow-up. Host assumptions and installation acceptance remain unverified.

## Rollback plan for a future, separately authorized installation

Record exact pre-install state and private backups before touching it. Inhibit and stop the managed unit, revoke only the restricted sudoers grant, disable/uninstall only newly installed control files, and restore affected configs from verified backups. Keep authentication/cache private. Never automatically restart the legacy launcher or alter Minecraft world data. Rollback procedure is not exercised by Stage 1.
