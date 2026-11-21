#!/usr/bin/env bash
# SaraCraft Claude Code cloud pre-launch setup v0.1.0
set -euo pipefail
printf 'SaraCraft environment inspection (no installation or builds)\n'
for bin in git node npm docker; do
  if command -v "$bin" >/dev/null 2>&1; then
    printf '%s: %s\n' "$bin" "$(command -v "$bin")"
  else
    printf '%s: NOT INSTALLED\n' "$bin"
  fi
done
printf 'No packages installed, services started, or credentials accessed.\n'
