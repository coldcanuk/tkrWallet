#!/usr/bin/env bash
# Generate a dedicated Stellar (XLM / Soroban) identity for a trading / bridge agent.
# Uses the official Stellar CLI (24-word SEP-0005 seed, hd_path 0 → m/44'/148'/0').
#
# Safe defaults:
#   • Writes JSON to a dedicated outfile (mode 600)
#   • Also stores CLI identity alias "lifi-trading" under ~/.config/stellar/identity/
#     so `stellar … --source-account lifi-trading` works for Soroban
#   • Does NOT run `stellar keys use` (won't become the CLI default identity)
#   • Optional GNOME Keyring copy via secret-tool
#
# Usage (on kiff.local):
#   chmod +x ~/scripts/new_stellar_wallet.sh
#   ~/scripts/new_stellar_wallet.sh                 # interactive; prints seed once
#   ~/scripts/new_stellar_wallet.sh --silent        # no seed / secret on screen
#   ~/scripts/new_stellar_wallet.sh --force         # overwrite outfile + identity + keyring
#   ~/scripts/new_stellar_wallet.sh --no-secret     # skip GNOME Keyring; file only
#
# Env overrides:
#   OUTFILE          default: $HOME/.config/stellar/lifi-trading.json
#   IDENTITY         default: lifi-trading          (stellar CLI identity alias)
#   CONFIG_DIR       default: $HOME/.config/stellar (stellar CLI config root)
#   SECRET_SERVICE   default: stellar
#   SECRET_ACCOUNT   default: lifi-trading
#   SECRET_LABEL     default: Stellar / Soroban li.fi trading key
#   HD_PATH          default: 0                     (→ m/44'/148'/0')
#
# Outfile JSON shape (mode 600):
#   { address, secretKey, mnemonic, derivationPath, hdPath, identityAlias, chainHint }
#
# Import: Freighter / Lobstr / xBull → import 24-word mnemonic (or secret key S…).
# Note: a Stellar account must be created/funded on-chain before it can send
# (friendbot on testnet: stellar keys fund --config-dir … IDENTITY -n testnet).

set -euo pipefail

OUTFILE="${OUTFILE:-$HOME/.config/stellar/lifi-trading.json}"
IDENTITY="${IDENTITY:-lifi-trading}"
CONFIG_DIR="${CONFIG_DIR:-$HOME/.config/stellar}"
SECRET_SERVICE="${SECRET_SERVICE:-stellar}"
SECRET_ACCOUNT="${SECRET_ACCOUNT:-lifi-trading}"
SECRET_LABEL="${SECRET_LABEL:-Stellar / Soroban li.fi trading key}"
HD_PATH="${HD_PATH:-0}"
# SEP-0005 / BIP44 coin type 148
DERIVATION_PATH="m/44'/148'/${HD_PATH}'"

SILENT=0
FORCE=0
USE_SECRET=1

for arg in "$@"; do
  case "$arg" in
    --silent) SILENT=1 ;;
    --force) FORCE=1 ;;
    --no-secret|--no-pass) USE_SECRET=0 ;;
    -h|--help)
      sed -n '1,38p' "$0"
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

IDENTITY_TOML="$CONFIG_DIR/identity/${IDENTITY}.toml"

install_apt_prereqs() {
  local pkgs=()
  need_cmd curl || pkgs+=(curl)
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

install_stellar_cli() {
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

  if need_cmd stellar; then
    info "stellar already on PATH: $(command -v stellar) ($(stellar --version 2>/dev/null | head -1))"
    return 0
  fi

  info "installing Stellar CLI into ~/.local/bin"
  curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | sh
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

  if ! need_cmd stellar; then
    die "stellar not found after install. Add to PATH:
  export PATH=\"\$HOME/.local/bin:\$PATH\"
Then re-run this script."
  fi
}

ensure_secret_service() {
  [[ "$USE_SECRET" -eq 1 ]] || return 0

  if ! need_cmd secret-tool; then
    info "secret-tool not available; skipping GNOME Keyring (--no-secret implied)"
    USE_SECRET=0
    return 0
  fi

  if ! echo -n 'probe' | secret-tool store --label='stellar-wallet-script-probe' \
      service stellar-wallet-script account probe 2>/dev/null; then
    die "cannot talk to GNOME Keyring / Secret Service via secret-tool.
Log into the graphical session on kiff (so the keyring is unlocked), or run:
  seahorse   # confirm 'Login' keyring is unlocked
Then re-run this script. Or use --no-secret to write the JSON file only."
  fi
  secret-tool clear service stellar-wallet-script account probe >/dev/null 2>&1 || true
}

generate_wallet() {
  mkdir -p "$(dirname "$OUTFILE")" "$CONFIG_DIR/identity"
  chmod 700 "$(dirname "$OUTFILE")" "$CONFIG_DIR" "$CONFIG_DIR/identity" 2>/dev/null || true

  if [[ -e "$OUTFILE" && "$FORCE" -ne 1 ]]; then
    die "outfile exists: $OUTFILE (pass --force to overwrite, or set OUTFILE=...)"
  fi
  if [[ -e "$IDENTITY_TOML" && "$FORCE" -ne 1 ]]; then
    die "CLI identity exists: $IDENTITY_TOML (pass --force, or set IDENTITY=...)"
  fi

  info "generating Stellar identity '$IDENTITY' (24-word SEP-0005, hd_path=$HD_PATH) → $OUTFILE"

  local gen_args=(keys generate -q --config-dir "$CONFIG_DIR" --hd-path "$HD_PATH" "$IDENTITY")
  [[ "$FORCE" -eq 1 ]] && gen_args+=(--overwrite)

  # Generate into the real config dir so Soroban CLI can use --source-account later.
  stellar "${gen_args[@]}" >/dev/null

  [[ -f "$IDENTITY_TOML" ]] || die "identity toml missing after generate: $IDENTITY_TOML"
  chmod 600 "$IDENTITY_TOML"

  local mnemonic address secret
  mnemonic="$(
    python3 -c '
import re,sys
text=open(sys.argv[1],encoding="utf-8").read()
m=re.search(r"(?m)^seed_phrase\s*=\s*\"([^\"]+)\"", text)
if not m: raise SystemExit("no seed_phrase in toml")
print(m.group(1))
' "$IDENTITY_TOML"
  )"
  address="$(stellar keys public-key --config-dir "$CONFIG_DIR" "$IDENTITY")"
  secret="$(stellar keys secret --config-dir "$CONFIG_DIR" "$IDENTITY")"

  [[ -n "$mnemonic" && -n "$address" && -n "$secret" ]] || \
    die "failed to derive address/secret from identity '$IDENTITY'"
  [[ "$address" == G* && "$secret" == S* ]] || \
    die "unexpected key format (address=$address)"

  local word_count
  word_count="$(wc -w <<<"$mnemonic" | tr -d ' ')"
  [[ "$word_count" -eq 24 || "$word_count" -eq 12 ]] || \
    die "unexpected mnemonic length ($word_count words)"

  if [[ "$SILENT" -ne 1 ]]; then
    echo >&2
    echo "================================================================" >&2
    echo " WRITE DOWN THE ${word_count}-WORD SEED PHRASE BELOW (shown once)." >&2
    echo " SEP-0005 / Freighter path: $DERIVATION_PATH (hd_path=$HD_PATH)." >&2
    echo " CLI default identity was NOT changed (no 'stellar keys use')." >&2
    echo "================================================================" >&2
    echo >&2
    echo "mnemonic:   $mnemonic" >&2
    echo "secret key: $secret" >&2
    echo "address:    $address" >&2
    echo >&2
  fi

  umask 077
  cat >"$OUTFILE" <<EOF
{
  "address": "$address",
  "secretKey": "$secret",
  "mnemonic": "$mnemonic",
  "derivationPath": "$DERIVATION_PATH",
  "hdPath": $HD_PATH,
  "identityAlias": "$IDENTITY",
  "chainHint": "stellar / soroban (same G… address on pubnet & testnet; must be funded on-chain)"
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
  echo "address:   $addr"
  echo "outfile:   $OUTFILE  (mode $(stat -c '%a' "$OUTFILE" 2>/dev/null || echo '?'))"
  echo "cli id:    $IDENTITY_TOML"
  echo "           stellar keys public-key --config-dir $CONFIG_DIR $IDENTITY"
  if [[ "$USE_SECRET" -eq 1 ]]; then
    echo "keyring:   label='$SECRET_LABEL'"
    echo "           secret-tool lookup service $SECRET_SERVICE account $SECRET_ACCOUNT"
    echo "           (also visible in Seahorse / Passwords and Keys)"
  else
    echo "keyring:   (skipped)"
  fi
  echo
  echo "Next (self-custody → Freighter / Soroban):"
  echo "  1. Retrieve: secret-tool lookup service $SECRET_SERVICE account $SECRET_ACCOUNT"
  echo "  2. Import mnemonic into Freighter / Lobstr (or paste secret key S…)."
  echo "  3. Fund/create on-chain: someone must send XLM to $addr (pubnet),"
  echo "     or on testnet: stellar keys fund --config-dir $CONFIG_DIR $IDENTITY -n testnet"
  echo "  4. Soroban: stellar contract … --source-account $IDENTITY"
  echo "     (optional default: stellar keys use $IDENTITY — only if you want that)"
  echo "  5. Agent use: read secretKey / mnemonic from JSON — never paste into chat/git."
  echo "=============================="
}

# --- main ---
info "prereqs: curl, ca-certificates; libsecret-tools; Stellar CLI"
install_apt_prereqs
install_stellar_cli
ensure_secret_service
generate_wallet
store_in_keyring
print_summary
