#!/usr/bin/env bash
# Pack tkrWallet on kiff. Vault stays on ATHENA (headless).
# Usage: ./scripts/pack-crx.sh
# Native Chrome/Brave (Pop Shop deb) writes $HOME/tkrwallet.crx.
# Flatpak cannot --pack-extension (bwrap /run/user/1000/doc). In that
# case this script stages $HOME/tkrWallet-unpacked and stops. Never
# writes a CRX into /opt/repo. Shreds the PEM.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ATHENA="chuck@athena.local"
VAULT_OPS="/opt/repo/thePlatform/blockchain-infrastructure/host/vault/vault_ops.py"
VAULT_PATH="theplatform/tkrwallet/chrome-crx-key"
PACK="$HOME/tkrwallet-pack"
STAGE="$PACK/ext"
KEY="$PACK/key.pem"
PUB="$PACK/pub.der"
PACK_PROFILE="$PACK/pack-profile"
HOME_CRX="$HOME/tkrwallet.crx"
PACK_CMD=()
CHROME_UI=()
BRAVE_UI=()
VER="$(node -p "require('$ROOT/package.json').version")"

die() { echo "error: $*" >&2; exit 1; }

resolve_chrome_ui() {
  if [[ -x /usr/bin/google-chrome-stable ]]; then
    CHROME_UI=(/usr/bin/google-chrome-stable)
    return
  fi
  if [[ -x /usr/bin/google-chrome ]]; then
    CHROME_UI=(/usr/bin/google-chrome)
    return
  fi
  if [[ -x /opt/google/chrome/chrome ]]; then
    CHROME_UI=(/opt/google/chrome/chrome)
    return
  fi
}

resolve_brave_ui() {
  if [[ -x /usr/bin/brave-browser ]]; then
    BRAVE_UI=(/usr/bin/brave-browser)
    return
  fi
  if [[ -x /usr/bin/brave-browser-stable ]]; then
    BRAVE_UI=(/usr/bin/brave-browser-stable)
    return
  fi
  if [[ -x /opt/brave.com/brave/brave ]]; then
    BRAVE_UI=(/opt/brave.com/brave/brave)
    return
  fi
}

# Flatpak is UI-only on kiff. --pack-extension dies in bwrap:
#   Can't find source path /run/user/1000/doc/by-app/com.google.Chrome
resolve_packer() {
  if [[ -x /usr/bin/google-chrome-stable ]]; then
    PACK_CMD=(/usr/bin/google-chrome-stable)
    return
  fi
  if [[ -x /usr/bin/google-chrome ]]; then
    PACK_CMD=(/usr/bin/google-chrome)
    return
  fi
  if [[ -x /opt/google/chrome/chrome ]]; then
    PACK_CMD=(/opt/google/chrome/chrome)
    return
  fi
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
}

stage_home_unpacked() {
  "$ROOT/scripts/stage-unpacked.sh"
  echo
  echo "Flatpak cannot pack a CRX (bwrap document portal)."
  echo "Install unpacked from \$HOME. Do not pick /opt/repo in the file dialog."
  echo
  echo "  1. chrome://extensions and brave://extensions"
  echo "  2. Developer mode on"
  echo "  3. Remove tkrWallet if it is already loaded"
  echo "  4. Load unpacked → $HOME/tkrWallet-unpacked"
  echo
  echo "Home card must read tkrWallet $VER."
  echo "Site access for tkrwallet.scratchpost.ai must not be On click."
}

scrub() {
  shred -u "$KEY" "$STAGE.pem" "$PUB" 2>/dev/null || true
  rm -f "$KEY" "$STAGE.pem" "$PUB"
  rm -rf "$PACK_PROFILE"
}
trap scrub EXIT

host="$(hostname -s)"
[[ "${host,,}" == "kiff" ]] || die "run on kiff"
[[ "$(id -un)" == "chuck" ]] || die "run as chuck"
[[ -f "$ROOT/manifest.json" ]] || die "missing $ROOT/manifest.json"
[[ -d "$HOME" ]] || die "missing $HOME"
resolve_chrome_ui
resolve_brave_ui
resolve_packer

if [[ ${#PACK_CMD[@]} -eq 0 ]]; then
  stage_home_unpacked
  exit 0
fi

umask 077
rm -rf "$PACK"
mkdir -p "$PACK"

# TTY only for unseal (GPG may prompt). Checkout is -T so the PEM never hits the terminal.
ssh -t "$ATHENA" python3 "$VAULT_OPS" unseal
ssh -T "$ATHENA" python3 "$VAULT_OPS" checkout --path "$VAULT_PATH" --stdout >"$KEY"
chmod 600 "$KEY"

python3 - "$KEY" "$ROOT/manifest.json" "$PUB" <<'PY'
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
pub = Path(sys.argv[3])
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
cp -a "$ROOT/vendor/qr.js" "$STAGE/vendor/"
cp -a \
  "$ROOT/icons/icon16.png" \
  "$ROOT/icons/icon32.png" \
  "$ROOT/icons/icon48.png" \
  "$ROOT/icons/icon128.png" \
  "$ROOT/icons/icon.svg" \
  "$STAGE/icons/"

"${PACK_CMD[@]}" \
  --user-data-dir="$PACK_PROFILE" \
  --no-first-run \
  --disable-gpu \
  --pack-extension="$STAGE" \
  --pack-extension-key="$KEY"

[[ -f "$STAGE.crx" ]] || die "packer did not write $STAGE.crx"
cp -f "$STAGE.crx" "$HOME_CRX"
chmod 644 "$HOME_CRX"
rm -f "$STAGE.crx"

if [[ ${#CHROME_UI[@]} -gt 0 ]]; then
  "${CHROME_UI[@]}" chrome://extensions >/dev/null 2>&1 &
fi
if [[ ${#BRAVE_UI[@]} -gt 0 ]]; then
  "${BRAVE_UI[@]}" brave://extensions >/dev/null 2>&1 &
fi

echo
echo "packed:"
echo "  $HOME_CRX"
echo
echo "Do not click Pack extension. The PEM is not a file you browse to."
echo
echo "Install in Chrome"
echo "  1. Developer mode on"
echo "  2. Drag $HOME_CRX onto chrome://extensions"
echo
echo "Install in Brave"
echo "  1. Developer mode on"
echo "  2. Drag $HOME_CRX onto brave://extensions"
echo
echo "Same file, both browsers. ID stays kfgmpcgplemjepolfpdbodmakceacook."
echo "Do not pick /opt/repo in any file dialog."
