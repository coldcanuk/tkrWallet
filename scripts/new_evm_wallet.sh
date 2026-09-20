#!/usr/bin/env bash
# Generate a dedicated EVM private key for a trading / li.fi agent.
# One key → one address on all EVM chains (Ethereum, Base, Arbitrum, Polygon, …).
# Safe defaults: never overwrites a protected path; dedicated outfile only.
#
# On kiff.local this stores a copy in the GNOME Keyring (libsecret / Secret
# Service) via `secret-tool` — not `pass`.
#
# Usage (on kiff.local):
#   chmod +x ~/scripts/new_evm_wallet.sh
#   ~/scripts/new_evm_wallet.sh                 # interactive; prints seed once
#   ~/scripts/new_evm_wallet.sh --silent        # no seed / private key on screen
#   ~/scripts/new_evm_wallet.sh --force         # overwrite outfile + keyring entry
#   ~/scripts/new_evm_wallet.sh --no-secret     # skip GNOME Keyring; file only
#
# Env overrides:
#   OUTFILE          default: $HOME/.config/ethereum/lifi-trading.json
#   SECRET_SERVICE   default: ethereum        (libsecret attribute)
#   SECRET_ACCOUNT   default: lifi-trading    (libsecret attribute)
#   SECRET_LABEL     default: EVM li.fi trading key
#
# Outfile JSON shape (mode 600):
#   { "address", "privateKey", "mnemonic", "derivationPath", "chainHint" }
#
# li.fi: import privateKey (or mnemonic) into MetaMask / Rabby, then Connect
# Wallet on https://li.fi — or feed privateKey to an agent signer. Same
# address works on every EVM chain you fund.

set -euo pipefail

OUTFILE="${OUTFILE:-$HOME/.config/ethereum/lifi-trading.json}"
SECRET_SERVICE="${SECRET_SERVICE:-ethereum}"
SECRET_ACCOUNT="${SECRET_ACCOUNT:-lifi-trading}"
SECRET_LABEL="${SECRET_LABEL:-EVM li.fi trading key}"
# Refuse to write here if someone points OUTFILE at a common default keystore.
PROTECTED_DEFAULT="$HOME/.ethereum/keystore"

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

if [[ "$(realpath -m "$OUTFILE")" == "$(realpath -m "$PROTECTED_DEFAULT")" ]] || \
   [[ "$(realpath -m "$OUTFILE")" == "$(realpath -m "$PROTECTED_DEFAULT")"/* ]]; then
  die "refusing to write under $PROTECTED_DEFAULT. Set OUTFILE to another path."
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

install_cast_only() {
  local tmp tar cast_bin
  tmp="$(mktemp -d)"
  tar="$tmp/foundry.tar.gz"
  info "downloading Foundry stable linux amd64 (cast only; anvil stays running)"
  curl -sSfL "https://github.com/foundry-rs/foundry/releases/download/stable/foundry_stable_linux_amd64.tar.gz" -o "$tar"
  tar -xzf "$tar" -C "$tmp"
  cast_bin="$(find "$tmp" -type f -name cast | head -n 1)"
  [[ -n "$cast_bin" ]] || die "Foundry tarball had no cast binary"
  mkdir -p "$HOME/.foundry/bin"
  install -m 755 "$cast_bin" "$HOME/.foundry/bin/cast"
  export PATH="$HOME/.foundry/bin:$PATH"
  rm -rf "$tmp"
}

install_foundry_cast() {
  # Prefer cast on PATH, then ~/.foundry/bin
  if need_cmd cast; then
    info "cast already on PATH: $(command -v cast)"
    return 0
  fi
  if [[ -x "$HOME/.foundry/bin/cast" ]]; then
    export PATH="$HOME/.foundry/bin:$PATH"
    info "using cast from ~/.foundry/bin"
    return 0
  fi

  info "installing Foundry (cast) into ~/.foundry"
  # Official installer — user-local, no apt/npm sudo.
  curl -sSfL https://foundry.paradigm.xyz | bash
  # foundryup is installed into ~/.foundry/bin
  export PATH="$HOME/.foundry/bin:$PATH"
  if need_cmd foundryup; then
    foundryup || install_cast_only
  else
    install_cast_only
  fi

  if ! need_cmd cast; then
    die "cast not found after Foundry install. Add to PATH:
  export PATH=\"\$HOME/.foundry/bin:\$PATH\"
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

  if ! echo -n 'probe' | secret-tool store --label='evm-wallet-script-probe' \
      service evm-wallet-script account probe 2>/dev/null; then
    die "cannot talk to GNOME Keyring / Secret Service via secret-tool.
Log into the graphical session on kiff (so the keyring is unlocked), or run:
  seahorse   # confirm 'Login' keyring is unlocked
Then re-run this script. Or use --no-secret to write the JSON file only."
  fi
  secret-tool clear service evm-wallet-script account probe >/dev/null 2>&1 || true
}

# Parse `cast wallet new-mnemonic` text into address / privateKey / mnemonic.
# Foundry (v1.8+) prints:
#   Phrase:
#   word1 word2 ... word12
#   - Account 0:
#   Address:     0x...
#   Private key: 0x...
parse_cast_mnemonic_output() {
  local raw="$1"
  MNEMONIC="$(printf '%s\n' "$raw" | awk '
    tolower($0) ~ /^phrase:[[:space:]]*$/ {
      getline
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      if (NF >= 12) { print; exit }
    }
    tolower($0) ~ /^phrase:[[:space:]]+/ {
      sub(/^[^:]+:[[:space:]]*/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      if (NF >= 12) { print; exit }
    }
  ')"
  PRIVATE_KEY="$(printf '%s\n' "$raw" | awk '
    tolower($0) ~ /private[[:space:]]*key:/ {
      sub(/^[^:]*:[[:space:]]*/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      print
      exit
    }
  ')"
  ADDRESS="$(printf '%s\n' "$raw" | awk '
    tolower($0) ~ /^[[:space:]]*address:/ {
      sub(/^[^:]*:[[:space:]]*/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      print
      exit
    }
  ')"

  [[ -n "$MNEMONIC" && -n "$PRIVATE_KEY" && -n "$ADDRESS" ]] || \
    die "failed to parse cast wallet new-mnemonic output:
$raw"
}

generate_wallet() {
  mkdir -p "$(dirname "$OUTFILE")"
  chmod 700 "$(dirname "$OUTFILE")" 2>/dev/null || true

  if [[ -e "$OUTFILE" && "$FORCE" -ne 1 ]]; then
    die "outfile exists: $OUTFILE (pass --force to overwrite, or set OUTFILE=...)"
  fi

  info "generating EVM wallet (BIP39 12-word, account 0) → $OUTFILE"

  local raw
  # Account 0 at m/44'/60'/0'/0/0 — MetaMask / Rabby / li.fi default path.
  raw="$(cast wallet new-mnemonic --words 12 --accounts 1 2>&1)" || \
    die "cast wallet new-mnemonic failed:
$raw"

  parse_cast_mnemonic_output "$raw"

  if [[ "$SILENT" -ne 1 ]]; then
    echo >&2
    echo "================================================================" >&2
    echo " WRITE DOWN THE 12-WORD SEED PHRASE BELOW (shown once)." >&2
    echo " No BIP39 passphrase — so an unattended agent can load the" >&2
    echo " private key from JSON. Seed is for offline recovery / MetaMask." >&2
    echo "================================================================" >&2
    echo >&2
    echo "mnemonic:     $MNEMONIC" >&2
    echo "private key:  $PRIVATE_KEY" >&2
    echo "address:      $ADDRESS" >&2
    echo >&2
  fi

  # Compact JSON without depending on jq.
  umask 077
  cat >"$OUTFILE" <<EOF
{
  "address": "$ADDRESS",
  "privateKey": "$PRIVATE_KEY",
  "mnemonic": "$MNEMONIC",
  "derivationPath": "m/44'/60'/0'/0/0",
  "chainHint": "evm-any (same address on all EVM L1/L2s)"
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
  addr="$(awk -F'"' '/"address"/ {print $4; exit}' "$OUTFILE")"
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
  echo "Next (self-custody → li.fi):"
  echo "  1. Retrieve: secret-tool lookup service $SECRET_SERVICE account $SECRET_ACCOUNT"
  echo "  2. Import into MetaMask/Rabby: Account menu → Import account → Private key"
  echo "     (or Import wallet → seed phrase). Do this only on your machine."
  echo "  3. On https://li.fi click Connect Wallet → pick that browser wallet."
  echo "  4. Fund $addr on whichever EVM chains you need (ETH/USDC/etc)."
  echo "  5. Agent use: read privateKey from the JSON / keyring — never paste into chat/git."
  echo "  • Solana needs a separate key (see new_sol_wallet.sh); this is EVM only."
  echo "=============================="
}

# --- main ---
info "prereqs: curl, ca-certificates; libsecret-tools; Foundry cast via foundryup"
install_apt_prereqs
install_foundry_cast
ensure_secret_service
generate_wallet
store_in_keyring
print_summary
