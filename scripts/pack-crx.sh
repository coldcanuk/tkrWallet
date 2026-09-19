#!/usr/bin/env bash
# Pack tkrWallet on kiff with Brave. Vault stays on ATHENA (headless).
# Usage: ./scripts/pack-crx.sh
# Writes /dev/shm/tkrwallet.crx on kiff and shreds the PEM.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ATHENA="chuck@athena.local"
VAULT_OPS="/opt/repo/thePlatform/blockchain-infrastructure/host/vault/vault_ops.py"
VAULT_PATH="theplatform/tkrwallet/chrome-crx-key"
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
  shred -u "$KEY" "$STAGE.pem" /dev/shm/tkrwallet-crx-pub.der 2>/dev/null || true
  rm -f "$KEY" "$STAGE.pem" /dev/shm/tkrwallet-crx-pub.der
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

# Same RSA key, not the same base64 spelling. kiff's openssl base64 wrap
# (or a different SPKI DER) made a string compare fail on a matching PEM.
python3 - "$KEY" "$ROOT/manifest.json" <<'PY'
import base64
import json
import re
import subprocess
import sys
from pathlib import Path

pem_path = Path(sys.argv[1])
raw = pem_path.read_bytes()
match = re.search(
    br"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
    raw,
    re.S,
)
if not match:
    raise SystemExit("checkout is not a PEM private key")
block = match.group(0)
if not block.endswith(b"\n"):
    block += b"\n"
if block != raw:
    pem_path.write_bytes(block)

want = json.loads(Path(sys.argv[2]).read_text())["key"]
pub = Path("/dev/shm/tkrwallet-crx-pub.der")
try:
    pub.write_bytes(base64.b64decode(want))
    try:
        pem_mod = subprocess.check_output(
            ["openssl", "rsa", "-in", str(pem_path), "-noout", "-modulus"],
            stderr=subprocess.DEVNULL,
        )
        pub_mod = subprocess.check_output(
            ["openssl", "rsa", "-pubin", "-inform", "DER", "-in", str(pub), "-noout", "-modulus"],
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, ValueError):
        raise SystemExit("Vault PEM does not match manifest.json key") from None
finally:
    if pub.exists():
        pub.unlink()
if pem_mod != pub_mod:
    raise SystemExit("Vault PEM does not match manifest.json key")
PY

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
