#!/usr/bin/env bash
# Generate the platform fee EOA and store ciphertext in ATHENA Vault.
# Prints the public address only. Never logs the mnemonic or private key.
#
# Run on ATHENA as chuck:
#   ./scripts/generate-platform-fee-wallet.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VAULT_OPS="${VAULT_OPS:-/opt/repo/thePlatform/blockchain-infrastructure/host/vault/vault_ops.py}"
VAULT_PATH="${VAULT_PATH:-theplatform/fee-wallet/evm}"
OUTFILE="${OUTFILE:-/dev/shm/tkr-fee-wallet.$$.json}"

die() { echo "error: $*" >&2; exit 1; }
info() { echo "→ $*" >&2; }

host="$(hostname -s 2>/dev/null || hostname)"
[[ "${host,,}" == "athena" ]] || die "run on ATHENA (this host is ${host})"
[[ "$(id -u)" == "1000" ]] || die "run as chuck"
[[ -x "$HERE/new_evm_wallet.sh" ]] || die "missing $HERE/new_evm_wallet.sh"
[[ -f "$VAULT_OPS" ]] || die "missing vault_ops.py"

if [[ -e "$OUTFILE" ]]; then
  die "temp outfile exists: $OUTFILE"
fi

info "checking Vault path ${VAULT_PATH}"
present="$(python3 "$VAULT_OPS" exists --path "$VAULT_PATH")"
if python3 -c 'import json,sys; raise SystemExit(0 if json.loads(sys.argv[1]).get("present") else 1)' "$present"; then
  die "Vault already has ${VAULT_PATH}; refusing to mint a second fee wallet"
fi

cleanup() {
  if [[ -e "$OUTFILE" ]]; then
    shred -u "$OUTFILE" 2>/dev/null || rm -f "$OUTFILE"
  fi
}
trap cleanup EXIT

info "generating dedicated fee EOA (silent, no keyring)"
OUTFILE="$OUTFILE" SECRET_ACCOUNT="platform-fee" SECRET_LABEL="platform fee wallet" \
  "$HERE/new_evm_wallet.sh" --silent --no-secret

[[ -f "$OUTFILE" ]] || die "generator did not write tempfile"
chmod 600 "$OUTFILE"

addr="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["address"])' "$OUTFILE")"
[[ "$addr" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "generator wrote a non-address"

info "writing secret to Vault ${VAULT_PATH} (stdin, CAS=0)"
python3 "$VAULT_OPS" put --path "$VAULT_PATH" <"$OUTFILE"

echo
echo "======== fee wallet ready ========"
echo "address:    $addr"
echo "vault path: ${VAULT_PATH}"
echo "role:       receive-only platform fee sink"
echo "next:       publish this address in Scratchpost YAML; do not import the key into tkrWallet"
echo "================================="
