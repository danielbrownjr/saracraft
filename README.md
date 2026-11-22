# SaraCraft

A private Minecraft Java AI companion project for cooperative survival.

**Status (2026-11-22): M0.8 Mineflayer movement integration under offline verification.** The recovered movement source is selectively reconciled with the reviewed M0.7 safety gate. Mock tests establish software behavior only; deployment and controlled Minecraft acceptance require separate authorization. See [M0.8 integration](docs/m0-8-integration.md) and [source reconciliation](docs/m0-8-reconciliation.md).

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

Next gate: finish draft M0.8 review and obtain separate authorization for a bounded, attended Minecraft acceptance trial. No deployment or gameplay is authorized by the source changes.
