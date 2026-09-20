#!/usr/bin/env bash
# Generate a dedicated TRON key (BIP39 + BIP44 m/44'/195'/0'/0/0) for a
# trading / bridge agent. Self-custody: file + optional GNOME Keyring.
#
# On kiff.local this stores a copy in the GNOME Keyring (libsecret / Secret
# Service) via `secret-tool` — not `pass`.
#
# Usage (on kiff.local):
#   chmod +x ~/scripts/new_tron_wallet.sh
#   ~/scripts/new_tron_wallet.sh                 # interactive; prints seed once
#   ~/scripts/new_tron_wallet.sh --silent        # no seed / private key on screen
#   ~/scripts/new_tron_wallet.sh --force         # overwrite outfile + keyring entry
#   ~/scripts/new_tron_wallet.sh --no-secret     # skip GNOME Keyring; file only
#
# Env overrides:
#   OUTFILE          default: $HOME/.config/tron/lifi-trading.json
#   SECRET_SERVICE   default: tron            (libsecret attribute)
#   SECRET_ACCOUNT   default: lifi-trading    (libsecret attribute)
#   SECRET_LABEL     default: TRON li.fi trading key
#   TRONWEB_DIR      default: $HOME/.local/share/lifi-wallet-tools/tron
#
# Outfile JSON shape (mode 600):
#   { address, privateKey, mnemonic, derivationPath, chainHint }
#
# Import: TronLink → Import wallet (mnemonic) or Import account (private key).
# Note: TRON uses secp256k1 like Ethereum, but addresses are Base58 (T…).
# Do NOT reuse an EVM private key here unless you intentionally want the
# related TRON address for that same key — this script generates a fresh one
# on the TRON BIP44 path used by TronLink.

set -euo pipefail

OUTFILE="${OUTFILE:-$HOME/.config/tron/lifi-trading.json}"
SECRET_SERVICE="${SECRET_SERVICE:-tron}"
SECRET_ACCOUNT="${SECRET_ACCOUNT:-lifi-trading}"
SECRET_LABEL="${SECRET_LABEL:-TRON li.fi trading key}"
TRONWEB_DIR="${TRONWEB_DIR:-$HOME/.local/share/lifi-wallet-tools/tron}"
DERIVATION_PATH="m/44'/195'/0'/0/0"

SILENT=0
FORCE=0
USE_SECRET=1

for arg in "$@"; do
  case "$arg" in
    --silent) SILENT=1 ;;
    --force) FORCE=1 ;;
    --no-secret|--no-pass) USE_SECRET=0 ;;
    -h|--help)
      sed -n '1,34p' "$0"
      exit 0
      ;;
    *)
      echo "unknown flag: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
info() { echo "→ $*" >&2; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

install_apt_prereqs() {
  local pkgs=()
  need_cmd curl || pkgs+=(curl)
  # package name ≠ PATH binary; detect via certs dir / update helper
  [[ -d /etc/ssl/certs || -x /usr/sbin/update-ca-certificates ]] || pkgs+=(ca-certificates)
  if [[ "$USE_SECRET" -eq 1 ]]; then
    need_cmd secret-tool || pkgs+=(libsecret-tools)
  fi

  if ((${#pkgs[@]} == 0)); then
    info "apt packages already present"
    return 0
  fi

  if ! need_cmd apt-get; then
    die "missing: ${pkgs[*]} — install them manually (no apt-get on this host)"
  fi

  info "installing apt packages: ${pkgs[*]}"
  sudo apt-get update -y
  sudo apt-get install -y "${pkgs[@]}"
}

ensure_node() {
  # Prefer nvm node if present; otherwise system node.
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.nvm/nvm.sh"
    nvm use default >/dev/null 2>&1 || nvm use node >/dev/null 2>&1 || true
  fi
  need_cmd node || die "node not found. Load nvm or install Node.js, then re-run."
  need_cmd npm || die "npm not found. Load nvm or install Node.js, then re-run."
  info "node $(node --version) / npm $(npm --version)"
}

install_tronweb() {
  mkdir -p "$TRONWEB_DIR"
  if [[ ! -f "$TRONWEB_DIR/package.json" ]]; then
    info "initializing local tronweb tool dir → $TRONWEB_DIR"
    (cd "$TRONWEB_DIR" && npm init -y >/dev/null)
  fi
  if [[ ! -d "$TRONWEB_DIR/node_modules/tronweb" ]]; then
    info "installing tronweb (user-local, no sudo) into $TRONWEB_DIR"
    (cd "$TRONWEB_DIR" && npm install tronweb@latest --no-fund --no-audit)
  else
    info "tronweb already present in $TRONWEB_DIR"
  fi
}

ensure_secret_service() {
  [[ "$USE_SECRET" -eq 1 ]] || return 0

  if ! need_cmd secret-tool; then
    info "secret-tool not available; skipping GNOME Keyring (--no-secret implied)"
    USE_SECRET=0
    return 0
  fi

  if ! echo -n 'probe' | secret-tool store --label='tron-wallet-script-probe' \
      service tron-wallet-script account probe 2>/dev/null; then
    die "cannot talk to GNOME Keyring / Secret Service via secret-tool.
Log into the graphical session on kiff (so the keyring is unlocked), or run:
  seahorse   # confirm 'Login' keyring is unlocked
Then re-run this script. Or use --no-secret to write the JSON file only."
  fi
  secret-tool clear service tron-wallet-script account probe >/dev/null 2>&1 || true
}

generate_wallet() {
  mkdir -p "$(dirname "$OUTFILE")"
  chmod 700 "$(dirname "$OUTFILE")" 2>/dev/null || true

  if [[ -e "$OUTFILE" && "$FORCE" -ne 1 ]]; then
    die "outfile exists: $OUTFILE (pass --force to overwrite, or set OUTFILE=...)"
  fi

  info "generating TRON wallet (BIP39 12-word, $DERIVATION_PATH) → $OUTFILE"

  local raw address private_key mnemonic path
  raw="$(
    NODE_PATH="$TRONWEB_DIR/node_modules${NODE_PATH:+:$NODE_PATH}" \
    node <<'NODE'
const { TronWeb } = require('tronweb');
const acct = TronWeb.createRandom('', "m/44'/195'/0'/0/0");
const mnemonic = (acct.mnemonic && acct.mnemonic.phrase) || acct.mnemonic || '';
const out = {
  address: acct.address,
  privateKey: acct.privateKey,
  mnemonic,
  derivationPath: acct.path || "m/44'/195'/0'/0/0",
  chainHint: 'tron (mainnet/nile/shasta — same address)'
};
process.stdout.write(JSON.stringify(out, null, 2));
NODE
  )" || die "TronWeb.createRandom failed"

  address="$(printf '%s' "$raw" | python3 -c 'import json,sys; print(json.load(sys.stdin)["address"])')"
  private_key="$(printf '%s' "$raw" | python3 -c 'import json,sys; print(json.load(sys.stdin)["privateKey"])')"
  mnemonic="$(printf '%s' "$raw" | python3 -c 'import json,sys; print(json.load(sys.stdin)["mnemonic"])')"
  path="$(printf '%s' "$raw" | python3 -c 'import json,sys; print(json.load(sys.stdin)["derivationPath"])')"

  [[ -n "$address" && -n "$private_key" && -n "$mnemonic" ]] || \
    die "failed to parse TronWeb output:
$raw"

  if [[ "$SILENT" -ne 1 ]]; then
    echo >&2
    echo "================================================================" >&2
    echo " WRITE DOWN THE 12-WORD SEED PHRASE BELOW (shown once)." >&2
    echo " No BIP39 passphrase — so an unattended agent can load the" >&2
    echo " private key from JSON. Seed is for offline recovery / TronLink." >&2
    echo "================================================================" >&2
    echo >&2
    echo "mnemonic:     $mnemonic" >&2
    echo "private key:  $private_key" >&2
    echo "address:      $address" >&2
    echo >&2
  fi

  umask 077
  cat >"$OUTFILE" <<EOF
{
  "address": "$address",
  "privateKey": "$private_key",
  "mnemonic": "$mnemonic",
  "derivationPath": "$path",
  "chainHint": "tron (mainnet/nile/shasta — same address)"
}
EOF
  chmod 600 "$OUTFILE"
}

store_in_keyring() {
  [[ "$USE_SECRET" -eq 1 ]] || return 0

  if secret-tool lookup service "$SECRET_SERVICE" account "$SECRET_ACCOUNT" >/dev/null 2>&1; then
    if [[ "$FORCE" -ne 1 ]]; then
      die "keyring entry exists (service=$SECRET_SERVICE account=$SECRET_ACCOUNT). Re-run with --force."
    fi
    info "clearing existing keyring entry"
    secret-tool clear service "$SECRET_SERVICE" account "$SECRET_ACCOUNT"
  fi

  info "storing key JSON in GNOME Keyring ($SECRET_LABEL)"
  secret-tool store --label="$SECRET_LABEL" \
    service "$SECRET_SERVICE" \
    account "$SECRET_ACCOUNT" \
    <"$OUTFILE"
}

print_summary() {
  local addr
  addr="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["address"])' "$OUTFILE")"
  echo
  echo "======== wallet ready ========"
  echo "address:  $addr"
  echo "outfile:  $OUTFILE  (mode $(stat -c '%a' "$OUTFILE" 2>/dev/null || echo '?'))"
  if [[ "$USE_SECRET" -eq 1 ]]; then
    echo "keyring:  label='$SECRET_LABEL'"
    echo "          secret-tool lookup service $SECRET_SERVICE account $SECRET_ACCOUNT"
    echo "          (also visible in Seahorse / Passwords and Keys)"
  else
    echo "keyring:  (skipped)"
  fi
  echo
  echo "Next (self-custody):"
  echo "  1. Retrieve: secret-tool lookup service $SECRET_SERVICE account $SECRET_ACCOUNT"
  echo "  2. Import into TronLink: mnemonic (preferred) or private key."
  echo "  3. Fund $addr with TRX (energy/bandwidth) + tokens you intend to move."
  echo "  4. Agent use: read privateKey from JSON / keyring — never paste into chat/git."
  echo "  • EVM / Solana / Sui need separate keys; this script is TRON only."
  echo "=============================="
}

# --- main ---
info "prereqs: curl, ca-certificates; libsecret-tools; Node + local tronweb"
install_apt_prereqs
ensure_node
install_tronweb
ensure_secret_service
generate_wallet
store_in_keyring
print_summary
