# SaraCraft

A private Minecraft Java AI companion project for cooperative survival.

**Status (2026-11-21): M0.2 controller prototype and M0.3 host-preparation plan.** The dependency-free controller passes local mock-based unit tests; no Minecraft bot integration, server deployment, host installation or paid API has been performed through this session.

## Design choices

- New Java survival world, Normal difficulty; candidate protocol 1.21.11 and Java 21.
- Paper on Hephaestus N100, Mineflayer/Mindcraft CE bot and controller there; hosted API initially, local Ollama later.
- Private LAN/WireGuard ingress; online mode, enforced allowlist, distinct licensed accounts, bot not op.
- Model proposes bounded intent; controller independently authorizes it and provides out-of-band STOP.
- World stored on Heph local NVMe, off-host NAS backup with tested restore before acceptance.
- No model-generated code execution, admin access, or trusting in-game names for identity.

## Design documents

- [M0 acceptance](docs/M0-acceptance.md)
- [Compatibility matrix](docs/compatibility-matrix.md)
- [Host and security design](docs/host-and-security-design.md)
- [Controller contract](docs/controller-contract.md)
- [Architecture](docs/architecture.md)
- [Implementation backlog](docs/implementation-backlog.md)

`compose.yaml` is a **nondeployable-by-default design template**. Deployment requires explicit approval, EULA acceptance, verified private bind IP, authenticated allowlist, immutable image digest, and a reviewed build. The illustrative bot profile is not a validated Mindcraft CE schema. No credentials belong in Git.

Next gates: establish pinned Mindcraft/Mineflayer/Paper artifacts and implement a real authenticated Minecraft adapter; run the read-only Heph preflight then perform separately verified authorized host preparation. See [controller prototype](controller/README.md) and [host preparation runbook](docs/heph-host-preparation.md).
