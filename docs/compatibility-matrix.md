# Compatibility matrix (research baseline, 2026-11-21)

| Layer | Candidate | Evidence | Remaining pin/verification |
|---|---|---|---|
| Minecraft Java protocol | 1.21.11 | Mindcraft CE and Mineflayer upstream README list support | Verify server/client and bot integration |
| Paper | 1.21.11 | Paper official 1.21.11 release/docs | Choose exact build and hash from official download service |
| JVM | Java 21 | Paper official getting-started matrix for 1.20–1.21.11 | Select immutable runtime image digest; test startup |
| Mineflayer | upstream supporting 1.21.11 | https://github.com/PrismarineJS/mineflayer | Pin exact npm version/lockfile and test movement, chat, auth |
| Mindcraft CE | upstream supporting 1.21.11 | https://github.com/mindcraft-ce/mindcraft-ce | Pin commit, inspect auth/profile/schema and ensure controller integration seam |
| Container image | itzg/minecraft-server Java 21 variant | https://github.com/itzg/docker-minecraft-server | Resolve immutable multiarch manifest digest for Heph x86_64 |
| Hosted inference | OpenAI-compatible provider TBD | Provider-specific support still unverified | Choose provider/model, budget and secure secret injection with approval |
| Local inference | Ollama later | Architectural adapter only | Validate endpoint/model/latency on actual GPU host |

## Authoritative references
- https://github.com/mindcraft-ce/mindcraft-ce
- https://github.com/PrismarineJS/mineflayer
- https://docs.papermc.io/paper/getting-started/
- https://papermc.io/news/1-21-11/
- https://docs.papermc.io/misc/downloads-service/

**Do not confuse a supported version range with a tested exact dependency combination.** No exact Paper build, image digest, Mindcraft CE SHA, Mineflayer npm lock or model configuration is established in this design-only pass. A compatibility spike must establish those before any host install.
