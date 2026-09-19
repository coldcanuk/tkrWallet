#!/usr/bin/env bash
# Copy the reviewed tree to $HOME so Flatpak Brave's file picker cannot
# bind a stale /run/user/1000/doc portal snapshot of /opt/repo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${HOME}/tkrWallet-unpacked"
mkdir -p "$DEST"
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'actions-runner/' \
  --exclude '.rdapq/' \
  --exclude 'node_modules/' \
  --exclude 'tools/.npm-cache/' \
  --exclude 'deploy/swarm/' \
  "$ROOT/" "$DEST/"
echo "$DEST"
