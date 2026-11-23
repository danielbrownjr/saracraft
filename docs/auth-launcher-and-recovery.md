# SaraCraft authentication-only launcher and private recovery (SOURCE CANDIDATE)

**Status:** Source only, not installed or executed on Hephaestus. The accepted
PR #9 provisioner is stacked on PR #8. This document and
`ops/auth/saracraft-auth-launch` are candidates for a separate security review.
No host changes, identity provisioning, Microsoft sign-in, Minecraft connection,
release promotion or emergency-inhibit clearance are authorized by this PR.

## Intended trust model

This is a human-attended operational gate, not a technical boundary against a
root-capable developer. The `daniel` user retains `sudo`, `adm` and `lxd`.
When the LXD daemon is reachable, the same user (and software that user runs)
may reach root, including all credentials. Neither a Python check nor sudo
itself can prove a PTY is not recorded by Codex or an operator's tooling.

**Required independently verified precondition:** A dedicated human-controlled
terminal, without Codex, tmux capture, `script`, terminal recording or session
logging. The operator must enter the normal, interactive sudo authentication
themselves. Do not create a `NOPASSWD` grant for the launcher and do not reuse a
Codex-visible terminal or a cached sudo timestamp. A clean host environment is
required *before* the Node process begins.

## Source contract and invocation plan (NOT an instruction to run now)

Candidate root-owned path: `/usr/local/libexec/saracraft-auth-launch`, mode
0755, never writable by `daniel` or `saracraft-bot`. It is intended to be
invoked manually only after an independently authorized and documented root
installation/promotion, from a dedicated unattended-by-Codex TTY using a
password-requiring sudo prompt. It accepts **no arguments**.

The launcher validates root execution under the named human operator, both
terminal file descriptors, the root-owned 0600 persistent emergency inhibit,
empty 0700 bot-owned auth/cache directories and absent provision lock,
inactive observation service, absent active auth transient unit, and a
root-controlled, 40-hex-SHA-named release selected by `current` with the
`APPROVED-RELEASE` marker. It does **not** clear inhibit.

The fixed `systemd-run --system --pty --wait --collect` invocation runs a
separate, one-shot `saracraft-auth-once.service` with `User/Group=saracraft-bot`,
private `/auth` bound to the bot's auth directory, strict filesystem and
capability restrictions, a 540s service limit, and a fixed absolute Node 22.23.5
binary and the approved `provision-auth.js` entrypoint. Environment is cleared
at the second execution boundary with `/usr/bin/env -i`; inherited environment
for `systemd-run` itself is also restricted. No `npm run`, raw stdout/stderr
journal target, or gameplay launcher path is used. The PTY is inherently
operator-visible and may be captured by the surrounding terminal: host
acceptance must verify `systemd-run --pty` routing with a synthetic canary.

The launcher exit state is **not** proof of secret isolation, successful
Microsoft authentication, or that a service cgroup emptied. Before any real
sign-in a credential-free test must validate the effective transient unit,
mount mapping, token-free PTY-only output, parent/child termination,
signal/timeout behavior, network DNS to approved authentication endpoints,
empty service cgroup, and the absence of raw canaries from journal/syslog,
crash stores and operator logs. Do not claim that source tests do this.

### Installed release and promotion gate

PR #9 and this launcher are *not* in the accepted Stage 2 release. A later
administrator-controlled promotion must assemble from the exact reviewed Git
commit with final ownership, hash into an out-of-tree trusted manifest from
root-owned staging, copy without hardlinks, strictly verify the promoted tree,
independently validate Node, policy and the launcher, and confirm that `current`
points to the exact approved SHA. Rebuild the manifest before copying, not
from an untrusted installed tree. No PR merge or deployment is implied.

## Private recovery, no secrets in logs

**Never restart automatically.** Fatal interruption can leave
`/auth/.provision.lock` or a partial set of **verified-account-only** cache
files. Wrong-account and pre-verification failure must leave no cache files.
The next invocation stops on either condition.

Only a separately authorized human administrator, in a non-recorded private
session, may perform recovery. In particular:

1. **Stop and preserve inhibit.** Verify `saracraft-bot.service` is inactive,
   `MainPID=0`, cgroup empty, and auth transient unit inactive/empty. If any
   process is active, stop and investigate; do not remove the lock.
2. **Metadata-only inspection.** Verify fixed directories via fd-relative,
   no-follow checks. Confirm auth root/cache owner `saracraft-bot`, mode 0700;
   verify lock is a bot-owned, one-link, mode-0600 regular file. Enumerate only
   names/types/modes/owners of cache entries, not contents. Never display,
   download, back up to a developer path, or upload tokens to Drive.
3. **Decide disposition.** If cache files are present, treat them as protected
   credentials. Revoke the account's sessions/tokens through the provider if
   compromise is suspected. Do not copy or parse them. For an incomplete commit
   or unknown identity, block reuse pending operator approval. For a successful
   cache, do not delete it simply because the prior session crashed after
   success. Require identity provenance from independently sanitized evidence.
4. **Private reset only by explicit authorization.** After the operator has
   decided to discard credentials, quarantine the entire fixed cache directory
   on the same protected filesystem under a root-only, mode-0700 name with no
   symlink-following or copying. Recreate an empty bot-owned 0700 cache directory;
   remove only the positively validated fixed lock, and fsync its parent
   directory. Any unexpected names, hardlinks, ownership, mode, process state or
   operation failure are a **STOP**. Secure disposal of the quarantine, if
   required, is a separate action and must not be improvised via glob or
   `rm -rf`.
5. **Revalidate.** Confirm the new cache is empty and the lock is absent
   through metadata alone. Preserve the emergency inhibit and leave both
   systemd units inactive. Report only boolean outcomes and fixed error
   categories. No automatic retry, Microsoft sign-in or Minecraft startup.

This is a **procedure**, not an installed cleanup utility. Because no host
writes are presently authorized, there is deliberately no command that
performs private reset. Implementation and host acceptance of that reset
would be a separately reviewed and approved privileged operation.

## Acceptance checklist for future authorization

- Root-controlled launcher and immutable signed-off reviewed release.
- Explicit human credential-bearing authorization and private browser profile
  for SaraCraft69, not a personal Microsoft session.
- Non-recorded human TTY with normal password-requiring sudo, clean runtime
  environment and no Codex-controlled privileged access.
- Effective systemd transient isolation, private bind, PTY-only synthetic
  canary, process/cgroup cleanup and timeout behavior tested on Hephaestus.
- Written, separately authorized private stale-lock/cache recovery.
- Server-side account-presence/singleton preflight remains separately required
  before any live Minecraft observation.
- Observation inhibit remains active through **all** auth-only procedures.

**STOP:** source tests and draft PR only. No installation, authentication,
Minecraft connections, privileged changes, merges or releases.
