# SaraCraft first-login verifier

This one-shot Mineflayer transport lives alongside the controller prototype. It checks the Microsoft-authenticated profile against the fixed SaraCraft69 UUID before opening a Minecraft connection. It targets only Hephaestus at 192.168.1.127:25565 using Minecraft Java 1.21.11. The verifier reports login, spawn, a loaded chunk and player presence, then disconnects. It runs with physics disabled and does not send chat, gameplay or administrative commands. It permits one reconnect after a transient pre-spawn disconnect.

The direct Mineflayer transport covers this milestone without loading Mindcraft CE's agent and model stack. The existing controller remains disconnected from live chat until an authenticated sender-identity adapter is ready.

## Runtime

- Node.js 22.23.5 and npm 10.9.9. The linux/amd64 image is `docker.io/library/node@sha256:47725aca53d3295ec2d3be8f62726599b3033cc262edc2c7e429909b3ac599fc`.
- Mineflayer 4.39.0, prismarine-auth 3.1.1 and the locked minecraft-protocol 1.68.0.
- From this directory, run `npm ci --ignore-scripts` and `npm test` using that Node runtime. The tests use mock events, never Microsoft authentication or an online Minecraft server.

## Device authorization and evidence

Run the verifier from a private interactive terminal on Hephaestus. It requires an approved Docker operator to start the container with an attached TTY, Docker logging disabled, and a dedicated mount at `/auth`. Use the intended Microsoft account in the browser and enter the displayed code only at the Microsoft URL shown in the terminal. Keep the terminal open until the verifier exits. There are no credential environment variables. The target, Minecraft version and identity are fixed for this milestone.

Mount the installed source read-only, set the container working directory to that mount, and run `node main.js` as the unprivileged owner of the auth directory. Both the host auth directory and its existing `cache/` child must be mode 0700. Place them outside the repository and regular backups. Credential files created under `cache/` are private to the run UID. Use one named one-shot container at a time, with no published ports or Docker socket mount. On Hephaestus use host networking so the locally originated connection follows the existing published-port path.

Only sanitized verification events are saved in `/auth/verification.jsonl`. Capture Paper's native `logged in with entity id` line for SaraCraft69, including its world position, and correlate its entity ID and timestamp with the client `spawn` event. Check Paper's join and disconnect messages as well. Verify the cache directory and file modes by metadata without reading token contents.

If authentication resolves to another Minecraft profile, the verifier closes without contacting Paper. An operator can start over with a new private cache directory. Keep the old cache private and remove it through the normal credential disposal process.
