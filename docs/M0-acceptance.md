# M0: First Night acceptance contract

Status: DESIGN ONLY. None of these checks has passed on Hephaestus.

## Preconditions
- Operator approves installation, EULA acceptance, runtime execution, accounts and hosted API provisioning separately.
- Exact image digest, Paper build, bot source commit, dependency lockfile and auth configuration recorded in a release manifest.
- Minecraft Java 1.21.11 with Java 21 is a documented **candidate**, not an integrated tested pin.
- Private LAN/VPN ingress, online-mode authentication and allowlist are verified before opening access.
- Two independent licensed Java accounts available for simultaneous online-mode play.

## Required M0 observations
1. New world generation succeeds; persistence survives planned restart.
2. Dan joins the private server with a licensed Java client.
3. Sara joins concurrently using her own authenticated identity, never offline-mode.
4. Bot recognizes the authenticated commander identity, ignores lookalike display names and refuses untrusted player instructions.
5. Sara answers an in-game chat request, with observed response latency recorded.
6. Sara follows Dan over mixed normal terrain without losing control of movement.
7. Sara collects 16 logs, returns, and deposits/transfers the material as commanded.
8. **STOP** interrupts an active gather/follow operation within a measured bounded latency; failures terminate safely.
9. Destructive/admin/script-execution requests are denied. No model-generated shell/JavaScript access.
10. Server and controller recover correctly after a controlled restart; tasks do not silently repeat destructive operations.
11. Application-consistent world backup can be restored and checked in a separate disposable environment.

For each check record: UTC timestamp, environment/host, exact software versions/commit and image digests, user action, expected result, actual observation, relevant sanitized log/event IDs and pass/fail.

## Gates
- Documentation complete does not imply integration complete.
- Host tests do not establish runtime/backup acceptance.
- Deployment requires separate explicit authorization.
- Do not merge, tag, release, provision paid services or buy Minecraft accounts in M0.1.

## Stop
M0 closes only when all above are evidenced in an approved runtime. M0.1 closes with reviewed designs and open execution gates clearly identified.
