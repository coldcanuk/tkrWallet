#!/usr/bin/env bash
# Generate a LeSou EVM wallet (address + mnemonic + private key), verify it, and
# store the full JSON in pass (Vault pass engine) plus a mode-600 local backup.
#
# EVM note: one private key produces one address that works on every EVM chain
# (Ethereum, Base, LeSou L3 603148, …). You still create distinct keys for
# distinct roles. This script does not pin a chain ID into the key material.
#
# Usage (on ATHENA as chuck):
#   ./scripts/generate_lesou_evm.sh mn1
#   ./scripts/generate_lesou_evm.sh treasury
#   ./scripts/generate_lesou_evm.sh --all
#
# Env:
#   PASS_PREFIX   default: ae/lesou/wp101/l3
#   BACKUP_DIR    default: $HOME/.lesou/wallet/backup/current
#
# Prints public address and storage paths only. Never prints mnemonic or key.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PASS_PREFIX="${PASS_PREFIX:-ae/lesou/wp101/l3}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/.lesou/wallet/backup/current}"
GEN="$HERE/new_evm_wallet.sh"
ROLES_ALL=(mn1 mn2 mn3 treasury)

die() { echo "error: $*" >&2; exit 1; }
info() { echo "→ $*" >&2; }

need_cast() {
  if command -v cast >/dev/null 2>&1; then
    return 0
  fi
  if [[ -x "$HOME/.foundry/bin/cast" ]]; then
    export PATH="$HOME/.foundry/bin:$PATH"
    return 0
  fi
  die "cast not on PATH (new_evm_wallet.sh installs it into ~/.foundry/bin)"
}

verify_wallet_json() {
  local file="$1"
  need_cast
  python3 - "$file" <<'PY'
import json, subprocess, sys, tempfile, os

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    data = json.load(f)

addr = data.get("address") or ""
pk = data.get("privateKey") or ""
mnemonic = data.get("mnemonic") or ""
derivation = data.get("derivationPath") or "m/44'/60'/0'/0/0"

if not (isinstance(addr, str) and addr.startswith("0x") and len(addr) == 42):
    raise SystemExit("verify: bad address field")
if not (isinstance(pk, str) and pk.startswith("0x") and len(pk) == 66):
    raise SystemExit("verify: bad privateKey field")
words = mnemonic.split()
if len(words) != 12:
    raise SystemExit("verify: mnemonic must be 12 words")

def run(args):
    r = subprocess.run(args, capture_output=True, text=True, check=False)
    if r.returncode != 0:
        raise SystemExit(f"verify: {' '.join(args[:3])} failed")
    return r.stdout.strip()

from_pk = run(["cast", "wallet", "address", "--private-key", pk])
if from_pk.lower() != addr.lower():
    raise SystemExit("verify: privateKey does not recover address")

from_mn = run([
    "cast", "wallet", "address",
    "--mnemonic", mnemonic,
    "--mnemonic-index", "0",
])
if from_mn.lower() != addr.lower():
    raise SystemExit("verify: mnemonic account 0 does not recover address")

msg = "lesou-l3-wallet-verify"
sig = run(["cast", "wallet", "sign", "--private-key", pk, msg])
# cast wallet verify exits 0 when the signature matches the address
r = subprocess.run(
    ["cast", "wallet", "verify", "--address", addr, msg, sig],
    capture_output=True, text=True, check=False,
)
if r.returncode != 0:
    raise SystemExit("verify: signature recover failed")

print("ok")
print(addr)
print(derivation)
PY
}

generate_one() {
  local role="$1"
  local pass_path="${PASS_PREFIX}/${role}"
  local backup="${BACKUP_DIR}/wp101-l3-${role}.json"
  local tmp

  [[ "$role" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "bad role name: $role"
  command -v pass >/dev/null 2>&1 || die "pass not installed"
  [[ -x "$GEN" ]] || die "missing $GEN"

  if pass show "$pass_path" >/dev/null 2>&1; then
    die "pass already has ${pass_path}; refusing to mint a second key"
  fi
  if [[ -e "$backup" ]]; then
    die "backup already exists: $backup"
  fi

  # new_evm_wallet.sh refuses an existing OUTFILE unless --force. Give it a fresh path.
  tmp="/dev/shm/lesou-evm-${role}-$$.json"
  [[ ! -e "$tmp" ]] || die "temp outfile already exists: $tmp"
  cleanup() { [[ -n "${tmp:-}" && -e "$tmp" ]] && { shred -u "$tmp" 2>/dev/null || rm -f "$tmp"; }; }
  trap cleanup EXIT

  info "generating role=${role}"
  OUTFILE="$tmp" SECRET_ACCOUNT="lesou-l3-${role}" SECRET_LABEL="LeSou L3 ${role}" \
    "$GEN" --silent --no-secret

  [[ -f "$tmp" ]] || die "generator wrote nothing"
  chmod 600 "$tmp"

  info "verifying key material for ${role}"
  local verify_out addr derivation
  verify_out="$(verify_wallet_json "$tmp")"
  status="$(printf '%s\n' "$verify_out" | sed -n '1p')"
  addr="$(printf '%s\n' "$verify_out" | sed -n '2p')"
  derivation="$(printf '%s\n' "$verify_out" | sed -n '3p')"
  [[ "$status" == "ok" ]] || die "verification failed for ${role}"
  [[ "$addr" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "verified address looks wrong"

  mkdir -p "$BACKUP_DIR"
  chmod 700 "$(dirname "$BACKUP_DIR")" 2>/dev/null || true
  chmod 700 "$BACKUP_DIR" 2>/dev/null || true
  cp "$tmp" "$backup"
  chmod 600 "$backup"

  info "storing ciphertext in pass ${pass_path}"
  pass insert -m "$pass_path" <"$tmp" >/dev/null

  # Prove pass round-trip recovers the same address without printing secrets.
  local pass_addr
  pass_addr="$(pass show "$pass_path" | python3 -c 'import json,sys; print(json.load(sys.stdin)["address"])')"
  [[ "${pass_addr,,}" == "${addr,,}" ]] || die "pass round-trip address mismatch"

  trap - EXIT
  cleanup

  echo
  echo "======== lesou l3 wallet ready ========"
  echo "role:       ${role}"
  echo "address:    ${addr}"
  echo "derivation: ${derivation}"
  echo "pass path:  ${pass_path}"
  echo "backup:     ${backup} (mode 600)"
  echo "verified:   privateKey→address, mnemonic→address, sign/verify"
  echo "======================================="
}

usage() {
  sed -n '1,24p' "$0"
  exit 2
}

main() {
  local host
  host="$(hostname -s 2>/dev/null || hostname)"
  [[ "${host,,}" == "athena" ]] || die "run on ATHENA (this host is ${host})"

  if [[ $# -eq 0 || "$1" == "-h" || "$1" == "--help" ]]; then
    usage
  fi

  if [[ "$1" == "--all" ]]; then
    local role
    for role in "${ROLES_ALL[@]}"; do
      generate_one "$role"
    done
    return 0
  fi

  [[ $# -eq 1 ]] || usage
  generate_one "$1"
}

main "$@"
