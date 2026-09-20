#!/usr/bin/env bash
# Generate a dedicated Sui ed25519 keypair for a trading / bridge agent.
# Safe defaults: writes a dedicated JSON outfile; does NOT import into
# ~/.sui/sui_config/sui.keystore (default CLI wallet).
#
# On kiff.local this stores a copy in the GNOME Keyring (libsecret / Secret
# Service) via `secret-tool` — not `pass`.
#
# Usage (on kiff.local):
#   chmod +x ~/scripts/new_sui_wallet.sh
#   ~/scripts/new_sui_wallet.sh                 # interactive; prints seed once
#   ~/scripts/new_sui_wallet.sh --silent        # no seed on screen
#   ~/scripts/new_sui_wallet.sh --force         # overwrite outfile + keyring entry
#   ~/scripts/new_sui_wallet.sh --no-secret     # skip GNOME Keyring; file only
#
# Env overrides:
#   OUTFILE          default: $HOME/.config/sui/lifi-trading.json
#   SECRET_SERVICE   default: sui             (libsecret attribute)
#   SECRET_ACCOUNT   default: lifi-trading    (libsecret attribute)
#   SECRET_LABEL     default: Sui li.fi trading keypair
#
# Outfile JSON shape (mode 600):
#   { address, mnemonic, keyScheme, derivationPath, keypairBase64,
#     publicBase64Key, chainHint }
#
# Import: Sui Wallet / Slush → Import with the 12-word mnemonic.
# Agent use: load keypairBase64 or recover via `sui keytool import '<mnemonic>' ed25519`.

set -euo pipefail

OUTFILE="${OUTFILE:-$HOME/.config/sui/lifi-trading.json}"
SECRET_SERVICE="${SECRET_SERVICE:-sui}"
SECRET_ACCOUNT="${SECRET_ACCOUNT:-lifi-trading}"
SECRET_LABEL="${SECRET_LABEL:-Sui li.fi trading keypair}"
PROTECTED_KEYSTORE="$HOME/.sui/sui_config/sui.keystore"
DERIVATION_PATH="m/44'/784'/0'/0'/0'"

SILENT=0
FORCE=0
USE_SECRET=1

for arg in "$@"; do
  case "$arg" in
    --silent) SILENT=1 ;;
    --force) FORCE=1 ;;
    --no-secret|--no-pass) USE_SECRET=0 ;;
    -h|--help)
      sed -n '1,32p' "$0"
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

if [[ "$(realpath -m "$OUTFILE")" == "$(realpath -m "$PROTECTED_KEYSTORE")" ]]; then
  die "refusing to write to $PROTECTED_KEYSTORE (default Sui CLI keystore). Set OUTFILE to another path."
fi

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

install_sui_cli() {
  export PATH="$HOME/.local/bin:$PATH"

  if need_cmd sui; then
    info "sui already on PATH: $(command -v sui) ($(sui --version 2>/dev/null | head -1))"
    return 0
  fi

  if ! need_cmd suiup; then
    info "installing suiup into ~/.local/bin"
    curl -sSfL https://raw.githubusercontent.com/Mystenlabs/suiup/main/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
  fi

  if ! need_cmd suiup; then
    die "suiup not found after install. Add ~/.local/bin to PATH and re-run."
  fi

  info "installing Sui CLI (mainnet channel) via suiup"
  suiup install sui@mainnet -y
  export PATH="$HOME/.local/bin:$PATH"

  if ! need_cmd sui; then
    die "sui not found after install. Add to PATH:
  export PATH=\"\$HOME/.local/bin:\$PATH\"
Then re-run this script."
  fi
}

# keytool generate needs client.yaml present; create a minimal one without
# generating / activating a default address in the CLI keystore.
ensure_sui_client_config() {
  local cfg_dir="$HOME/.sui/sui_config"
  local cfg="$cfg_dir/client.yaml"
  local ks="$cfg_dir/sui.keystore"

  mkdir -p "$cfg_dir"
  chmod 700 "$cfg_dir" 2>/dev/null || true

  if [[ ! -f "$ks" ]]; then
    echo '[]' >"$ks"
    chmod 600 "$ks"
  fi

  if [[ -f "$cfg" ]]; then
    return 0
  fi

  info "creating minimal ~/.sui/sui_config/client.yaml (empty keystore; no default address)"
  cat >"$cfg" <<EOF
keystore:
  File: $ks
envs:
  - alias: mainnet
    rpc: "https://fullnode.mainnet.sui.io:443"
    ws: null
  - alias: testnet
    rpc: "https://fullnode.testnet.sui.io:443"
    ws: null
active_env: mainnet
EOF
  chmod 600 "$cfg"
}

ensure_secret_service() {
  [[ "$USE_SECRET" -eq 1 ]] || return 0

  if ! need_cmd secret-tool; then
    info "secret-tool not available; skipping GNOME Keyring (--no-secret implied)"
    USE_SECRET=0
    return 0
  fi

  if ! echo -n 'probe' | secret-tool store --label='sui-wallet-script-probe' \
      service sui-wallet-script account probe 2>/dev/null; then
    die "cannot talk to GNOME Keyring / Secret Service via secret-tool.
Log into the graphical session on kiff (so the keyring is unlocked), or run:
  seahorse   # confirm 'Login' keyring is unlocked
Then re-run this script. Or use --no-secret to write the JSON file only."
  fi
  secret-tool clear service sui-wallet-script account probe >/dev/null 2>&1 || true
}

json_get() {
  # Minimal JSON string field extractor (no jq dependency).
  # Usage: json_get "$json" fieldName
  local json="$1" key="$2"
  printf '%s' "$json" | python3 -c '
import json,sys
d=json.load(sys.stdin)
k=sys.argv[1]
v=d.get(k,"")
if v is None: v=""
print(v if not isinstance(v, (dict, list)) else json.dumps(v))
' "$key"
}

generate_wallet() {
  mkdir -p "$(dirname "$OUTFILE")"
  chmod 700 "$(dirname "$OUTFILE")" 2>/dev/null || true

  if [[ -e "$OUTFILE" && "$FORCE" -ne 1 ]]; then
    die "outfile exists: $OUTFILE (pass --force to overwrite, or set OUTFILE=...)"
  fi

  local tmp raw address mnemonic keypair_b64 pubkey scheme keyfile
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  info "generating Sui ed25519 keypair → $OUTFILE"
  # Runs in temp dir so the *.key file is not left in $PWD; we do NOT import
  # into sui.keystore (that would pollute the default CLI wallet).
  raw="$(
    cd "$tmp"
    sui keytool generate ed25519 "$DERIVATION_PATH" word12 --json
  )" || die "sui keytool generate failed:
$raw"

  address="$(json_get "$raw" suiAddress)"
  mnemonic="$(json_get "$raw" mnemonic)"
  pubkey="$(json_get "$raw" publicBase64Key)"
  scheme="$(json_get "$raw" keyScheme)"
  keyfile="$tmp/${address}.key"

  [[ -n "$address" && -n "$mnemonic" && -f "$keyfile" ]] || \
    die "failed to parse sui keytool output:
$raw"

  keypair_b64="$(tr -d '\n' <"$keyfile")"

  if [[ "$SILENT" -ne 1 ]]; then
    echo >&2
    echo "================================================================" >&2
    echo " WRITE DOWN THE 12-WORD SEED PHRASE BELOW (shown once)." >&2
    echo " No BIP39 passphrase. Seed recovers the key in Sui Wallet / CLI." >&2
    echo " This key is NOT imported into the default sui.keystore." >&2
    echo "================================================================" >&2
    echo >&2
    echo "mnemonic:  $mnemonic" >&2
    echo "address:   $address" >&2
    echo >&2
  fi

  umask 077
  cat >"$OUTFILE" <<EOF
{
  "address": "$address",
  "mnemonic": "$mnemonic",
  "keyScheme": "${scheme:-ed25519}",
  "derivationPath": "$DERIVATION_PATH",
  "keypairBase64": "$keypair_b64",
  "publicBase64Key": "$pubkey",
  "chainHint": "sui (mainnet/testnet — same address)"
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
  echo "  2. Import mnemonic into Sui Wallet / Slush (or: sui keytool import '<mnemonic>' ed25519)."
  echo "  3. Fund $addr with SUI (gas) + tokens you intend to move."
  echo "  4. Agent use: read keypairBase64 / mnemonic from JSON — never paste into chat/git."
  echo "  • Default CLI keystore untouched: $PROTECTED_KEYSTORE"
  echo "=============================="
}

# --- main ---
info "prereqs: curl, ca-certificates; libsecret-tools; Sui CLI via suiup"
install_apt_prereqs
install_sui_cli
ensure_sui_client_config
ensure_secret_service
generate_wallet
store_in_keyring
print_summary
