# SaraCraft connection and movement integration

This one-shot Mineflayer transport lives alongside the controller prototype. It checks the Microsoft-authenticated profile against the fixed SaraCraft69 UUID before opening a Minecraft connection. It targets only Hephaestus at 192.168.1.127:25565 using Minecraft Java 1.21.11. The verifier reports login, spawn, a loaded chunk and player presence, then disconnects. It runs with physics disabled and does not send chat, gameplay or administrative commands. The default first-login verifier permits one reconnect after a transient pre-spawn disconnect; `--observe` permits exactly one connection attempt.

The direct Mineflayer transport does not load Mindcraft CE's agent and model stack. The default first-login mode remains separate from the optional movement mode described below.

## Runtime

- Node.js 22.23.5 and npm 10.9.9. The linux/amd64 image is `docker.io/library/node@sha256:47725aca53d3295ec2d3be8f62726599b3033cc262edc2c7e429909b3ac599fc`.
- Mineflayer 4.39.0, mineflayer-pathfinder 2.4.5, prismarine-auth 3.1.1 and the locked minecraft-protocol 1.68.0.
- From this directory, run `npm ci --ignore-scripts` and `npm test` using that Node runtime. The tests use mock events, never Microsoft authentication or an online Minecraft server.

## Authentication-only provisioner (source candidate, NOT installed)

`node provision-auth.js` is a separate entrypoint. Unlike `main.js`, it
does not import Mineflayer, connect to Paper, create a Minecraft bot, or load
movement/observation code. Its only purpose is to populate an **empty** private
`/auth/cache` through the locked `prismarine-auth` Microsoft/Xbox/Minecraft
authentication APIs, verify the **pinned** SaraCraft69 Java profile and UUID,
and stop. The Minecraft *profile API* is not a Minecraft *game server*.
Use Node 22.23.5 and pinned dependencies.

The command requires an attended TTY on stdin/stdout, no arguments, a private
existing `/auth` and `/auth/cache` owned by the running UID (0700), and an
initially empty cache. An exclusive root-path-pinned `/auth/.provision.lock` prevents concurrent attended provisioning and triggers another empty-cache check after lock acquisition. A crash or hard timeout can leave this lock present, intentionally blocking retries until separately authorized, metadata-verified private recovery. It must run later under the dedicated bot identity with
`/auth` privately bound to `/var/lib/saracraft-bot/auth`; the precise
**auth-only launcher/sandbox and administrator-controlled entrypoint must be
reviewed separately before installation or execution**. It uses a Microsoft
device-code prompt written only to `/dev/tty`, suppresses library console
output and never reports tokens or challenge codes to stdout, stderr or journal.
The pinned `prismarine-auth@3.1.1` library uses a **memory-backed custom cache**
throughout Microsoft/Xbox/Minecraft authentication. Only after the Java profile
matches the fixed SaraCraft69 name and UUID does the provisioner persist the
library-compatible JSON cache entries to the private directory with exclusive
creation, mode 0600 and per-file fsync. A wrong-account, interrupted or
unsuccessful sign-in **does not persist any authentication tokens**. A failed
multi-file commit attempts rollback of files it created and reports only a
generic failure. If cleanup or a hard interruption leaves partial files,
the nonempty-cache gate and stale lock fail closed; investigate under a
separately approved private recovery procedure, never via Codex chat.
Node's uncaught-exception and unhandled-rejection handlers also emit only a
generic failure, never upstream error text.

When signing in later, use a dedicated browser profile or sign out of your
personal Microsoft account first; explicitly confirm the account belongs to
SaraCraft69. The future host launcher **must** use an absolute root-controlled
Node binary, clean `env -i`-style environment, no `npm run`, and a truly private
human-operated TTY outside Codex, tmux logging or shared terminal transcripts.
The source guard rejects root execution and suspicious Node runtime options,
but it cannot undo a preload that ran before JavaScript initialization.
The auth library is intentionally never run against real services in source tests. The process has an 8-minute
backstop. Interrupted or wrong-account attempts can leave partial or mismatched
private cache state: do not retry automatically or expose its contents.
Privileged cleanup/reset requires separate review and authorization.

**Important:** Source implementation and offline tests do not authorize
Microsoft authentication, credential migration, installation, movement,
Minecraft connections or clearing the production emergency inhibit.
The installed Stage 2 release remains at
`50a2159fe46f279cda18ec8d5529b079466ed4a9` with its inhibit active.
A new manifest and installed release require a separate promotion gate after
independent security review. The live stationary observation still requires
a separate attended go/no-go check and server-side disconnect verification.

## Device authorization and evidence

Run the verifier from a private interactive terminal on Hephaestus. It requires an approved Docker operator to start the container with an attached TTY, Docker logging disabled, and a dedicated mount at `/auth`. Use the intended Microsoft account in the browser and enter the displayed code only at the Microsoft URL shown in the terminal. Keep the terminal open until the verifier exits. There are no credential environment variables. The target, Minecraft version and identity are fixed for this milestone.

Mount the installed source read-only, set the container working directory to that mount, and run `node main.js` as the unprivileged owner of the auth directory. Both the host auth directory and its existing `cache/` child must be mode 0700. Place them outside the repository and regular backups. Credential files created under `cache/` are private to the run UID. Use one named one-shot container at a time, with no published ports or Docker socket mount. On Hephaestus use host networking so the locally originated connection follows the existing published-port path.

In manual mode, sanitized verification events are saved in `/auth/verification.jsonl` and echoed to the attached terminal. In the proposed supervised service, evidence is written only to `/var/log/saracraft-bot/verification.jsonl` (mode 0600 in a 0700 bot-owned directory); stdout and stderr are discarded by systemd and `saracraftctl logs` reads only a bounded sanitized view. No raw journal fallback is permitted. This is a source proposal, not proof of installed log isolation. Capture Paper's native `logged in with entity id` line for SaraCraft69, including its world position, and correlate its entity ID and timestamp with the client `spawn` event. Check Paper's join and disconnect messages as well. Verify the cache directory and file modes by metadata without reading token contents.

If authentication resolves to another Minecraft profile, the verifier closes without contacting Paper. An operator can start over with a new private cache directory. Keep the old cache private and remove it through the normal credential disposal process.

## Observation-only diagnostics (requires separate live authorization)

`node main.js --observe` has a 150-second normal observation window after readiness and a 175-second overall application backstop beginning before authentication. The proposed independent systemd ceiling is 180 seconds from process exec; startup imports and shutdown consume time, so no exact 5-second reserve is guaranteed. It has at most one connection attempt. A headless authentication challenge fails with `AUTH_REQUIRED` without displaying a code or accessing `/dev/tty`. The service uses a separate private evidence directory; the existing manual verifier's default remains `/auth/verification.jsonl`. Observation has a
physics-disabled session, no signed-chat certificate request, no movement adapter or
pathfinder import, and no player-chat movement command listener. Positive
control-state changes and pathfinder access are prohibited. It samples sanitized
air metadata, chunk coverage, entity readiness and hazard observations at about
1 Hz after spawn. Independent diagnostics report air packet age and local entity observations
even when the navigation safety snapshot is stale; none authorize movement.
The control guard installs after Mineflayer's plugin injection,
before any spawn observations. Because physics is off, the physics water flag is
unavailable by design; block-volume immersion is reported separately and the
combined navigation verdict remains UNKNOWN_STATE. Do not interpret that
diagnostic verdict as a movement readiness result. No observational result is permission to move. An attended
live trial requires its own explicit authorization; offline tests do not prove
physical stationarity or server behavior.

## M0.8 movement mode

`node main.js --walk` selects the recovered movement integration. It requires an explicitly supplied `SARACRAFT_COMMANDER_UUID`; there is no commander default. Missing, malformed, recovery-placeholder or bot-self UUIDs fail before authentication directories are accessed. The approved server and bot identity pins above are preserved; the sanitized recovery archive's example identity and endpoint are not imported as runtime configuration.

Movement mode requests signed-chat certificates, enables physics, and attaches the movement adapter before spawn so it can observe raw air metadata. Only authenticated commander player-chat packets enter command admission. The movement adapter integrates the per-task M0.7 safety monitor, bounded commands and cancellation. The session lasts at most eight minutes after spawn, chunk and player presence are ready. Shutdown, connection failure and the session deadline invoke the adapter's synchronous halt before requesting transport closure. An unexpected disconnect also cancels the movement operation. No post-spawn reconnect occurs.

`verifyConnection`'s optional `onClosing(bot)` callback must synchronously cancel and clear ordinary movement; it is not an asynchronous settlement hook. Its acknowledgement does not establish observed in-world cessation. Failed shutdown and close-deadline expiration report failure.

This source integration is verified with offline mocks only. Running either launcher mode authenticates and contacts Minecraft and requires separate authorization. M0.8 implementation work does not authorize installation, login, connection or gameplay. In particular, underwater escape, actual STOP latency and explosion avoidance are not proven by these tests.
