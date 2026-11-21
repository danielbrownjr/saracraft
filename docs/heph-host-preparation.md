# M0.3 Hephaestus host preparation runbook

**Authority:** Dan authorized installation and private storage setup after checking compatibility and existing services, but **not Minecraft deployment**. This document is an executable plan, not evidence the host was changed.

## Preflight
Run `bash scripts/heph-preflight.sh` locally on Hephaestus, record UTC output without secrets. Recheck OS, current RAM/disk, package candidates, conflicting services, existing directory ownership, Docker install state and TCP 25565. Stop if anything materially differs from the November 21 inventory or if software/service changes would interfere with running workloads.

## Package selection
- Prefer supported distro-provided Java 21 JRE (Paper 1.21.11), Node 22+ and Docker Engine + Compose v2 plugin or equivalent official supported packages.
- Verify package signatures, actual Ubuntu 26.04 repository candidates and architecture. **Do not blindly use installer curl|sh scripts or unverified third-party APT repositories.**
- If a package is unavailable, stop and report supported alternative and provenance; do not substitute Java 25 or download random JARs.
- Installing packages is within the user's current host-preparation authorization, but starting servers/containers is not.
- Avoid altering working SSH/network/firewall configurations without separate inspection and specific justification; **do not expose Minecraft or Docker API**.

## Storage preparation
- Proposed `/srv/saracraft/{world,controller,backups}`, owner non-root dedicated service account to be confirmed against local policy.
- Check existing paths; never overwrite, chown or delete unknown content.
- Keep secrets outside Git, in mode 0600 files owned by intended service user.
- Reserve persistent local NVMe space for world; NAS backup path and restore still require separate connectivity verification.
- Do not download or launch a Paper server or execute Docker Compose.

## Verification and report
After package installation, only inspect `java -version`, `node --version`, `docker --version`, `docker compose version`, directories and permissions, package logs and current services. Docker daemon start may be needed to validate Docker runtime, but **do not start or enable it silently** if host service consequences remain uncertain; report what is staged.

Record which actions actually ran, package versions, failed operations, host-level service mutations and precise blockers. This runbook is not a deployment authorization.
