# Hephaestus private deployment design (no deployment authorized)

Source: read-only Hephaestus reconnaissance, 2026-11-21 18:57–18:59 UTC. Figures are a single snapshot.

- Ubuntu 26.04.1, Intel N100 4c/4t, 14.90 GiB RAM (13.84 GiB available), 4 GiB swap.
- Samsung 990 PRO NVMe, about 3.4 TiB available.
- Ethernet 192.168.1.127/24, 1 Gbps; TCP 25565 unused.
- Java, Docker/Compose and Node/npm were absent from PATH at inspection time; their installation is **not authorized here**.
- UFW reportedly disabled; effective firewall, router port forwards, VPN, NAS restore capability remain unverified.

## Recommended topology
Hephaestus: Paper, one Sara bot and controller. Hosted inference initially; separate GPU host for later Ollama. World stored on local NVMe, application-consistent backups copied independently to UGREEN NAS.

## Resource budgets (planning ceilings, not verified settings)
- Paper heap 4 GiB, whole server 5–6 GiB.
- Bot up to 1 GiB, controller up to 0.5 GiB.
- OS and developer workload reserve at least 3 GiB.
- Monitor memory pressure, swap, main-tick duration, chunk generation and CPU saturation before changing allocations.
- Start with view distance 8, simulation distance 5, max players 4.

## Network and authentication
- **Do not expose on public internet.** Bind the game to explicitly approved LAN/VPN address, not 0.0.0.0 and not loopback-only for remote players.
- The prior compose.yaml loopback bind is safe but inaccessible to Dan's other LAN clients. A parametrized explicit private IPv4 bind is needed at deployment, once actual routing/firewall is verified.
- No router forwarding. No unauthenticated RCON. Online-mode=true, user allowlist, bot is not op.
- Restrict admin console, credentials and controller endpoints to local operator.
- Player identity must derive from authenticated UUID, not nickname, message prefix or untrusted text.
- Host-side firewall and Docker published-port forwarding require actual tests; Docker can bypass naive UFW assumptions.

## Controller invariants
- A designated UUID may request an allowlisted task; other player/system chat is never instructions.
- Actions use bounded time, radius, blocks/resources, retries, and explicit abort signals.
- STOP preempts active work, cancels queued movement, and sends an acknowledgement only after cancellation confirmed.
- No LLM shell/JS/code execution, privilege escalation, arbitrary plugin installation, or access to secrets.
- Protected areas/builds and inventories are opt-in; deny destructive actions by default.
- Report failed/partial actions accurately; never claim collection/delivery without observed inventory state.

## Storage and recovery
- Keep data under dedicated non-root directories (proposed `/srv/saracraft`, requires explicit approval).
- Server state and controller SQLite must not be snapshotted inconsistently. Flush/save and quiesce before backup; capture manifest and checksum; ship off-host.
- Test a **restore**, not only backup creation, in an isolated approved environment.
- Exclude auth tokens, API secrets and player personal data from backups unless secured under separate policy; store separate credential material with narrow permissions.

## Deployment approval checklist
1. Confirm versions/builds/digests and image security.
2. Verify LAN/VPN route, host firewall/Docker exposure semantics and IP durability.
3. Approve EULA, installation and resource changes explicitly.
4. Provide two licensed identities and approved provider credentials without committing them.
5. Implement and test command permissions/STOP and restoration.
6. Approve host deployment in separate task.
