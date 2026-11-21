#!/usr/bin/env bash
# SaraCraft Hephaestus pre-install inspection v0.2.0
set -euo pipefail
printf 'SaraCraft: read-only host preflight (no installations or service changes)\n'
printf '\n== Host ==\n'
hostnamectl 2>/dev/null || uname -a
printf '\n== CPU and memory ==\n'
lscpu | grep -E 'Model name|CPU\(s\)|Architecture' || true
free -h
printf '\n== Storage ==\n'
df -h / /home
printf '\n== Tools ==\n'
for tool in java node npm docker git curl; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '%s: %s\n' "$tool" "$(command -v "$tool")"
  else
    printf '%s: absent from PATH\n' "$tool"
  fi
done
printf '\n== Candidate APT packages (installed and candidate) ==\n'
for package in openjdk-21-jre-headless nodejs npm docker.io docker-compose-v2 docker-compose-plugin; do
  dpkg-query -W -f='${db:Status-Abbrev} ${Version}\n' "$package" 2>/dev/null | sed "s/^/$package: /" || true
  apt-cache policy "$package" 2>/dev/null | grep -m1 Candidate || true
done
printf '\n== Port 25565 ==\n'
ss -lnt '( sport = :25565 )' || true
printf '\n== Existing important processes ==\n'
ps -eo pid,comm,%cpu,%mem --sort=-%mem | head -n 18
printf '\n== Current service state (read-only) ==\n'
for service in docker containerd ssh; do
  systemctl is-active "$service" 2>/dev/null || true
done
printf '\n== Paths ==\n'
stat /srv /srv/saracraft 2>/dev/null || true
printf '\nInspection complete. No writes or installs performed.\n'
