# M0: First Night acceptance

**Status:** Planned. No runtime or hardware integration has been performed.

## Prerequisites
- Pin a tested Minecraft Java, Paper and Mineflayer/Mindcraft CE compatibility matrix.
- New private survival world, normal difficulty, online mode and allowlist.
- Distinct licensed authenticated players for Dan and Sara.
- Authorized hosting deployment and credentials stored outside version control.
- Explicit approval before running servers, paying providers or purchasing accounts.

## Acceptance checks
1. Server starts and persists the new world through a clean restart.
2. Dan joins and can play using his Java client.
3. Sara joins with a distinct authenticated account, without bypassing auth.
4. Sara reads/responds to Dan's in-game chat within bounded latency.
5. Sara follows Dan through normal terrain and stops when told.
6. Sara gathers at least 16 logs and delivers or deposits them as directed.
7. Global STOP cancels active tasks; unauthorized commands and code execution are rejected.
8. After a controlled restart, the server world and minimal session state survive.
9. All failures are recorded accurately; no fake task-completion messages.

## Evidence
Record exact versions, image digests, source SHAs, model/provider, server configuration (excluding secrets), reproducible steps, timestamps, expected/observed results and relevant logs.

## Stop condition
M0 cannot be marked complete until all checks are observed on the approved private test environment. No deployment or purchase is authorized by this document.
