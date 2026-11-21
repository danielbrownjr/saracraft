# M0.5 restricted server operations design

## Objective
Command Sara can request bounded Minecraft administration without obtaining sudo, membership in the Docker group, unrestricted RCON, or access to other NAS/Hephaestus services.

## Boundaries
1. User/interface or LLM produces typed intent. Intent is untrusted.
2. An **independently authenticated** transport attaches a verified operator identity.
3. An unprivileged policy gateway checks action schema and limits.
4. A **separate, root-owned, narrow helper** implements precisely identified operations against a fixed SaraCraft target. It cannot accept shell strings, arbitrary file paths, service names, or generic Docker API calls.
5. A persistent audit journal records the decision and observed result. Default-deny on any validation/transport failure.

## Recommended initial verbs
`health`, `players`, `backup`, `allowlist_add`; `allowlist_remove` and `restart` require fresh direct human confirmation. Restore/world deletion/version upgrades remain out of scope.

## Hephaestus integration gate
Inspect the deployed systemd unit, actual Compose project name and image runtime, Docker user namespace, host bind mounts, console transport and service-account privileges first. Select one tight mechanism: a root-owned command broker with a static allowlist and minimal validated argument input, preferably reachable only through a permissioned local Unix socket. No direct docker.sock mount for the agent, no open TCP control listener, no blanket sudoers rule.

Use fixed service/container identifiers confirmed from the actual host, verify world-save and backup consistency, ensure source/target paths cannot be redirected with symlinks, and do not use an arbitrary `docker exec` wrapper. Restrict helper binary/script ownership and writable directories; consider a hardening sandbox and command timeouts. Keep authorization and confirmation outside LLM-supplied JSON. Verify deny cases, logging, timeouts, idempotency across restart, backup recovery, SSH/firewall isolation and running-world preservation.

## Non-goals
This feature never gives Minecraft Sara infrastructure authority. `sara-access` remains reserved for separately authorized engineering maintenance. Do not merge or deploy until integration, isolation and acceptance gates pass.
