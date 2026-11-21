# SaraCraft

Private Minecraft Java AI companion project for cooperative survival.

**Current state:** M0 design scaffold, no bot runtime, no deployment or integration test.

## Decisions
- New survival world, Normal difficulty, Paper server.
- Minecraft 1.21.11 is **provisional**, pending exact upstream compatibility checks.
- Hosted LLM API first, optional Ollama backend later.
- Mineflayer/Mindcraft CE evaluated and pinned before bot implementation.
- Private LAN/WireGuard, online-mode authentication, separate licensed account for Sara.
- No arbitrary model-generated code execution or untrusted chat-to-admin path.

## Layout
- `compose.yaml`: disabled-by-default server template; DO NOT deploy until approved.
- `docs/architecture.md`: architecture and security boundaries.
- `docs/M0-acceptance.md`: measurable first playable checks.
- `docs/implementation-backlog.md`: ordered implementation work.
- `bot/profiles/sara.profile.example.json`: non-executable persona concept, NOT a verified upstream schema.
- `scripts/claude-setup.sh`: inspection-only cloud environment prerequisite script.

No live service is installed, configured or running. No API keys belong in this repository.
