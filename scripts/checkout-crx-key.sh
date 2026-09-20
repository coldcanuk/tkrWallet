#!/usr/bin/env bash
# Checkout the tkrWallet CRX private PEM from ATHENA Vault onto tmpfs, pack,
# then shred. Never prints the PEM. Never writes it into the git tree.
#
# First store (on ATHENA, once, CAS=0 — will not overwrite):
#   python3 "$VAULT_OPS" put --path tkrwallet/crx/key.pem < /dev/shm/key.pem
#   shred -u /dev/shm/key.pem
#
# Later pack:
#   ./scripts/checkout-crx-key.sh
# Chrome → Extensions → Pack extension → private key file = the printed path.
# Press Enter. The file is shredded even on Ctrl-C.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
VAULT_OPS="${VAULT_OPS:-/opt/repo/thePlatform/blockchain-infrastructure/host/vault/vault_ops.py}"
VAULT_PATH="${VAULT_PATH:-tkrwallet/crx/key.pem}"
ATHENA_HOST="${ATHENA_HOST:-athena.local}"
OUTFILE="${OUTFILE:-/dev/shm/tkrwallet-crx-key.$$.pem}"

die() { echo "error: $*" >&2; exit 1; }
info() { echo "→ $*" >&2; }

scrub() {
  if [[ -e "$OUTFILE" ]]; then
    shred -u "$OUTFILE" 2>/dev/null || rm -f "$OUTFILE"
  fi
}
trap scrub EXIT

[[ "$(id -u)" == "1000" ]] || die "run as chuck"
[[ -f "$ROOT/manifest.json" ]] || die "missing $ROOT/manifest.json"
command -v openssl >/dev/null || die "openssl is required"
command -v python3 >/dev/null || die "python3 is required"

umask 077
[[ ! -e "$OUTFILE" ]] || die "checkout target exists: $OUTFILE"

host="$(hostname -s 2>/dev/null || hostname)"
if [[ "${host,,}" == "athena" ]]; then
  [[ -f "$VAULT_OPS" ]] || die "missing vault_ops.py"
  info "checking out ${VAULT_PATH} to tmpfs"
  python3 "$VAULT_OPS" checkout --path "$VAULT_PATH" --out "$OUTFILE"
else
  command -v ssh >/dev/null || die "ssh is required off ATHENA"
  info "checking out ${VAULT_PATH} via ${ATHENA_HOST} (no TTY so the PEM never hits the terminal)"
  ssh -T "chuck@${ATHENA_HOST}" python3 "$VAULT_OPS" checkout --path "$VAULT_PATH" --stdout >"$OUTFILE"
fi

[[ -f "$OUTFILE" ]] || die "checkout wrote nothing"
chmod 600 "$OUTFILE"

python3 - "$OUTFILE" <<'PY'
from pathlib import Path
import sys
raw = Path(sys.argv[1]).read_bytes()
if b"BEGIN" not in raw or b"PRIVATE KEY" not in raw:
    raise SystemExit("checkout is not a PEM private key")
PY

want="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["key"])' "$ROOT/manifest.json")"
got="$(openssl pkey -in "$OUTFILE" -pubout -outform DER 2>/dev/null | openssl base64 -A)"
[[ -n "$got" ]] || die "could not read a public key from the PEM"
if [[ "$got" != "$want" ]]; then
  die "PEM does not match manifest.json key; refusing to leave a mismatched file. Path was ${VAULT_PATH}"
fi

info "PEM matches the pinned extension public key"
echo
echo "Pack extension"
echo "  root: $(realpath "$ROOT")"
echo "  private key file: $OUTFILE"
echo
echo "Do not pack this git worktree if it contains actions-runner or node_modules."
echo "After Chrome finishes, press Enter. Ctrl-C still shreds the PEM."
read -r _

info "shredding checkout"
# trap EXIT runs scrub
