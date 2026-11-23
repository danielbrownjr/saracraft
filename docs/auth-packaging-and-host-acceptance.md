# SaraCraft authentication packaging and credential-free acceptance

**Status:** Candidate procedure and source-side validation only. No host acceptance or credential-bearing use is claimed.
**Stacked base:** PR #10 at `f21b35933e49e7b882cb62f0a056160681ca6375`.
**Safety:** Keep `/var/lib/saracraft-control/inhibit` present. Do not launch `provision-auth.js`, `main.js`, or any Minecraft connection during packaging or synthetic acceptance.

## O1: deterministic, symlink-free packaging

The approved security audits intentionally reject symlinks everywhere in the release and Node runtime, including `node_modules/.bin`, `bin/npm`, `bin/npx`, and `bin/corepack`. Do **not** weaken the audits.

In an isolated, throwaway trusted Linux x64 build workspace:

1. Pin the exact reviewed source commit, Linux x64 Node **22.23.5**, and `controller/connection/package-lock.json`. Obtain Node from a trusted source with independently verified publisher checksum. Record artifact hash and provenance, never an unverified downloader command.
2. Within the exact reviewed `controller/connection`, use `npm ci --ignore-scripts --no-bin-links` with its existing lockfile. Do not run `npm install`, lifecycle scripts, or re-resolve dependencies. Verify the resulting runtime entrypoint uses imports rather than `.bin` invocations. No `npm` executable is required at runtime.
3. Assemble the release from reviewed source and the locked dependencies in a **new** scratch destination, with no existing destination overwritten. Copy without hardlinks and do not follow symlinks. Reject any symlink or special file instead of silently dereferencing it. Preserve the package lock.
4. Construct a minimal Node runtime in a separate new scratch directory containing the **verified regular** `bin/node` executable, not the stock distro's `npm`/`npx`/`corepack` links or `lib/node_modules`. Confirm `bin/node --version` is exactly `v22.23.5` and that the executable works with the project's locked imports in the isolated environment. Do not assume the host's installed Node is equivalent.
5. Run the read-only structural check before promotion:
   `python3 ops/auth/check_package_layout.py /absolute/scratch/release /absolute/scratch/node-runtime`
   This check rejects special entries, hardlinks, and unsafe mode bits. It **does not** prove trusted provenance, immutable ownership or host compatibility.
6. After separately authorized root-controlled promotion, record all pre-existing metadata, create the trusted manifest **outside** the release, verify strict `ops/release_manifest.py verify` with ownership and ancestry to `/`, and run PR #10's `fixed_release()` inspection against the pinned release and runtime. The final `APPROVED-RELEASE` marker and `current` selector are administrative gates, not proof of an approved build unless independently matched to the recorded commit and manifest. Never use the development checkout as the credential-bearing release.

A **green structural preflight in a developer-owned scratch tree is not host acceptance**. Stop if any dependency needs `.bin` execution, any runtime file is unexpectedly required, checksums are unavailable, or a symlink reappears. Do not force chmod/chown on an unexpected existing host path.

## Credential-free Hephaestus acceptance: explicit host gate

Before executing any transient unit, identify the operator-controlled terminal and verify a dedicated test identity, files and paths with metadata-only inspection. Preserve existing services, legacy bot process, Minecraft world, caches and sudo rules. Inventory installed systemd version and the real service and login state. Do not use a real account, invoke the actual authentication entrypoint, enter device codes or move any private cache.

Run only synthetic fixture processes, using a distinct fixed `saracraft-auth-canary` test unit name, a bounded runtime, and dummy non-secret strings that cannot be confused with real tokens. Confirm, with recorded fixed expected/actual values:

| Acceptance gate | Evidence needed |
| --- | --- |
| PTY confidentiality | Canary displayed only on attended terminal; not in journald, syslog, sudo I/O capture, PAM TTY audit, crash storage or terminal recordings |
| Terminal compatibility | `/dev/tty` controlling terminal accessible in effective sandbox with `PrivateDevices=yes`; no unintended stdout/stderr journal stream |
| Sandbox | `systemctl show` + `systemd-analyze security` reflect intended user/group, capabilities, paths, mounts, writable auth fixture and no access to unrelated directories |
| Paths | `BindPaths` behaves as intended, missing `InaccessiblePaths` dependencies fail closed or are explicitly understood, no host authentication directories modified |
| Network | Synthetic process resolves approved DNS endpoints under `RestrictAddressFamilies` without contacting Microsoft auth or Minecraft |
| Lifecycle | Duplicate start refused; Ctrl-C, terminal hangup, `^]^]^]` detach, forced timeout and client disconnect have observed exit status and bounded cleanup |
| Cleanup | No survivor PIDs in the test cgroup and transient unit collected after **every** trial; restart remains off |
| Emergency controls | Persistent observation inhibit remains present, root-owned mode 0600, before and after; observation service never starts |
| Actual promoted artifacts | Strict manifest verifies immutable source and runtime, and the launcher metadata preflight accepts them without executing authentication |

Stop on any leaked canary, active orphan, unexplained mount, unexpected service activation, absent inhibit, or failed metadata check. Preserve the inhibit and capture **sanitized** evidence only, never raw terminal output containing credential material (even synthetic canaries should be handled minimally). No automatic cleanup of unrelated units.

**Host-access limitation:** GitHub CI and offline fixtures do not execute systemd on Hephaestus. Unless the operator has independently verified host access and specifically authorized the bounded unit tests, classify host acceptance as **BLOCKED / NOT TESTED**. Never substitute a local container or CI job for this acceptance.

## Authentication completion semantics (2026-11-23 synthetic SIGINT finding)

Hephaestus systemd 259.9 returned `systemd-run --wait --collect` status 0
even when Ctrl-C terminated the synthetic service with SIGINT (2) after
1.717 seconds. Therefore `systemd-run` success alone proves only the
client request/wait path, **not** successful authentication.

The reviewed `provision-auth.js` now creates a zero-byte,
`/auth/.provision-complete` receipt with `O_EXCL | O_NOFOLLOW`,
mode 0600, and file/parent fsync **only after** verified cache commit,
private success notification and exclusive lock release. The launcher
preflight rejects an existing receipt. After `systemd-run` returns zero,
the launcher requires the receipt to be a single-link regular file owned
by the bot, size zero and mode 0600; nonempty cache entries must have
the expected fixed filename patterns, bot owner, mode 0600 and single
links; no provision lock may remain; and the authentication unit must
report inactive with PID 0. All inspections are metadata-only; never
print or read credential bytes. Any failure leaves the inhibit active
and reports generic failure.

**Limit:** The receipt attests the bot reached the completion point, not
the service's exact exit signal. A process killed after the receipt was
committed could still leave valid receipt/cache metadata. Systemd
exit status alone cannot resolve that race with `--collect`; acceptance
must exercise this behavior using synthetic data and retain the
private recovery gate. This change does not prove Microsoft credentials
are valid and does not authorize real sign-in.

## Stage 3: readying attended authentication, not triggering it

After all credential-free host acceptance items pass, separately confirm the pinned account `SaraCraft69`, human-controlled non-recorded TTY, sudo policy without `log_input`, `log_output`, or `iolog` capture, PAM audit policy, private bot-owned empty cache, absent lock, inactive observer/auth units, and intact persistent inhibit.

**Stop before credential entry or invoking the real launcher.** A separate explicit authorization is required for actual Microsoft sign-in. Never share device codes, tokens, browser session, or cache with coding agents, terminal recordings, Google Drive or Git.
