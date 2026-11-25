# SaraCraft

![SaraCraft banner featuring a pixel-art engineer in a Minecraft-inspired workshop](branding/saracraft-project-banner.png)

A private Minecraft Java AI companion for cooperative survival, designed for local Ollama inference.

## MVP roadmap

[Zero-to-local MVP roadmap](docs/mvp-roadmap.md) defines the proposed scope, ordered milestones, acceptance criteria and exclusions. [MVP issues](https://github.com/danielbrownjr/saracraft/issues?q=is%3Aissue+label%3Amvp) track execution. Prior implementations and historical evidence are retained; progress is reconciled against the new acceptance criteria rather than assumed or rebuilt.

The MVP is a locally inferred companion that understands authenticated natural-language requests, observes bounded game state, and executes a small allowlist of actions in a shared private world. No hosted inference or cloud fallback.

Current state: connection demonstrated; live command admission, model integration and gameplay acceptance remain unverified.

## Design choices

- One private Java survival world, Paper and Mineflayer; reuse the pinned Node stack.
- One local Ollama endpoint/model on existing authorized hardware.
- Private LAN/WireGuard ingress; online mode, enforced allowlist, distinct licensed accounts, bot not op.
- Model proposes bounded intent; controller independently validates and executes, with direct and out-of-band STOP.
- No model-generated code execution, admin access, or trusting in-game names for identity.

## Historical technical references

These documents preserve technical context, not additional MVP milestones. For scope and order, the MVP roadmap takes precedence after approval; security and authorization requirements remain in force.

- [M0 acceptance](docs/M0-acceptance.md)
- [Compatibility matrix](docs/compatibility-matrix.md)
- [Host and security design](docs/host-and-security-design.md)
- [Controller contract](docs/controller-contract.md)
- [Architecture](docs/architecture.md)
- [Historical implementation backlog](docs/implementation-backlog.md)

`compose.yaml` remains a nondeployable-by-default design template. No credentials belong in Git. Source merges do not authorize deployment, host changes or live gameplay.
