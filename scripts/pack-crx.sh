#!/usr/bin/env bash
# Pack tkrWallet on kiff with Brave. Vault stays on ATHENA (headless).
# Usage: ./scripts/pack-crx.sh
# Writes /dev/shm/tkrwallet.crx on kiff and shreds the PEM.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ATHENA="chuck@athena.local"
VAULT_OPS="/opt/repo/thePlatform/blockchain-infrastructure/host/vault/vault_ops.py"
VAULT_PATH="tkrwallet/crx/key.pem"
STAGE="/dev/shm/tkrwallet-ext"
KEY="/dev/shm/tkrwallet-crx-key.pem"
CRX="/dev/shm/tkrwallet.crx"
BRAVE_PROFILE="/dev/shm/tkrwallet-brave-pack"
PACK_CMD=()

die() { echo "error: $*" >&2; exit 1; }

resolve_brave() {
  if [[ -x /usr/bin/brave-browser ]]; then
    PACK_CMD=(/usr/bin/brave-browser)
    return
  fi
  if [[ -x /usr/bin/brave-browser-stable ]]; then
    PACK_CMD=(/usr/bin/brave-browser-stable)
    return
  fi
  if [[ -x /opt/brave.com/brave/brave ]]; then
    PACK_CMD=(/opt/brave.com/brave/brave)
    return
  fi
  if command -v flatpak >/dev/null && flatpak info com.brave.Browser >/dev/null 2>&1; then
    PACK_CMD=(flatpak run --filesystem=/dev/shm com.brave.Browser)
    return
  fi
  die "Brave not found. Pop Shop installs /usr/bin/brave-browser or Flathub com.brave.Browser."
}

scrub() {
  shred -u "$KEY" "$STAGE.pem" 2>/dev/null || true
  rm -f "$KEY" "$STAGE.pem"
  rm -rf "$BRAVE_PROFILE"
}
trap scrub EXIT

host="$(hostname -s)"
[[ "${host,,}" == "kiff" ]] || die "run on kiff"
[[ "$(id -un)" == "chuck" ]] || die "run as chuck"
[[ -f "$ROOT/manifest.json" ]] || die "missing $ROOT/manifest.json"
resolve_brave

umask 077
rm -f "$KEY" "$CRX" "$STAGE.crx" "$STAGE.pem"
rm -rf "$STAGE" "$BRAVE_PROFILE"

# TTY only for unseal (GPG may prompt). Checkout is -T so the PEM never hits the terminal.
ssh -t "$ATHENA" python3 "$VAULT_OPS" unseal
ssh -T "$ATHENA" python3 "$VAULT_OPS" checkout --path "$VAULT_PATH" --stdout >"$KEY"
chmod 600 "$KEY"

python3 - "$KEY" <<'PY'
from pathlib import Path
import sys
raw = Path(sys.argv[1]).read_bytes()
if b"BEGIN" not in raw or b"PRIVATE KEY" not in raw:
    raise SystemExit("checkout is not a PEM private key")
PY

want="$(python3 -c 'import json; print(json.load(open("'"$ROOT"'/manifest.json"))["key"])')"
got="$(openssl pkey -in "$KEY" -pubout -outform DER 2>/dev/null | openssl base64 -A)"
[[ "$got" == "$want" ]] || die "Vault PEM does not match manifest.json key"

mkdir -p "$STAGE/icons" "$STAGE/vendor"
cp -a \
  "$ROOT/index.html" \
  "$ROOT/ui.js" \
  "$ROOT/wallet.js" \
  "$ROOT/crypto.js" \
  "$ROOT/store.js" \
  "$ROOT/sw.js" \
  "$ROOT/manifest.json" \
  "$ROOT/manifest.webmanifest" \
  "$ROOT/app.css" \
  "$ROOT/icon.svg" \
  "$STAGE/"
cp -a "$ROOT/vendor/noble.js" "$STAGE/vendor/"
cp -a \
  "$ROOT/icons/icon16.png" \
  "$ROOT/icons/icon32.png" \
  "$ROOT/icons/icon48.png" \
  "$ROOT/icons/icon128.png" \
  "$ROOT/icons/icon.svg" \
  "$STAGE/icons/"

"${PACK_CMD[@]}" \
  --user-data-dir="$BRAVE_PROFILE" \
  --no-first-run \
  --disable-gpu \
  --pack-extension="$STAGE" \
  --pack-extension-key="$KEY"

[[ -f "$STAGE.crx" ]] || die "Brave did not write $STAGE.crx"
mv -f "$STAGE.crx" "$CRX"
chmod 644 "$CRX"

echo
echo "packed: $CRX"
echo "next: brave://extensions → Developer mode on → drag $CRX onto the page"
