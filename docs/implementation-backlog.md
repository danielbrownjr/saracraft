# M0 implementation backlog

1. **Compatibility spike:** verify Mineflayer, Mindcraft CE, Minecraft Java and Paper against pinned source revisions; record an exact matrix.
2. **Auth spike:** prove online-mode joining with two licensed accounts in isolated test conditions; never store tokens in Git.
3. **Server hardening:** allowlist, operator restrictions, non-public ingress, world backup/restore and resource limits.
4. **Bot adapter:** join/leave, authenticated player recognition, chat events, navigation and gather/deposit primitives.
5. **Controller:** allowlisted commands, execution budget, cancellation, task state events and observable failures.
6. **Model adapter:** hosted API provider, configurable provider/model, timeouts, retries and bounded token/cost ceiling; local Ollama later.
7. **Persistence:** minimal SQLite session/task state with migrations and restart recovery.
8. **Tests:** controller unit tests, simulated chat injection, STOP tests, isolated server integration tests.
9. **Acceptance:** record observations for every item in M0-acceptance.md.

Each stage uses feature branches and exact-head tests. Do not merge, deploy, start live services, buy accounts, or provision a paid provider without explicit approval.
