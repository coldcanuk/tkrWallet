#!/usr/bin/env bash
# Generate a dedicated Solana keypair for a trading / li.fi agent.
# Safe defaults: never overwrites ~/.config/solana/id.json (workingagenc).
#
# On kiff.local this stores a copy in the GNOME Keyring (libsecret / Secret
# Service) via `secret-tool` — not `pass`.
#
# Usage (on kiff.local):
#   chmod +x ~/new_sol_wallet.sh
#   ~/new_sol_wallet.sh                 # interactive; prints seed phrase once
#   ~/new_sol_wallet.sh --silent        # no seed phrase on screen
#   ~/new_sol_wallet.sh --force         # overwrite outfile + keyring entry
#   ~/new_sol_wallet.sh --no-secret     # skip GNOME Keyring; file only
#
# Env overrides:
#   OUTFILE          default: $HOME/.config/solana/lifi-trading.json
#   SECRET_SERVICE   default: solana          (libsecret attribute)
#   SECRET_ACCOUNT   default: lifi-trading    (libsecret attribute)
#   SECRET_LABEL     default: Solana li.fi trading keypair

set -euo pipefail

OUTFILE="${OUTFILE:-$HOME/.config/solana/lifi-trading.json}"
SECRET_SERVICE="${SECRET_SERVICE:-solana}"
SECRET_ACCOUNT="${SECRET_ACCOUNT:-lifi-trading}"
SECRET_LABEL="${SECRET_LABEL:-Solana li.fi trading keypair}"
PROTECTED_DEFAULT="$HOME/.config/solana/id.json"

SILENT=0
FORCE=0
USE_SECRET=1

for arg in "$@"; do
  case "$arg" in
    --silent) SILENT=1 ;;
    --force) FORCE=1 ;;
    --no-secret|--no-pass) USE_SECRET=0 ;;
    -h|--help)
      sed -n '1,22p' "$0"
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

# Refuse to clobber the workingagenc / default CLI wallet.
if [[ "$(realpath -m "$OUTFILE")" == "$(realpath -m "$PROTECTED_DEFAULT")" ]]; then
  die "refusing to write to $PROTECTED_DEFAULT (workingagenc default wallet). Set OUTFILE to another path."
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

install_apt_prereqs() {
  local pkgs=()
  need_cmd curl || pkgs+=(curl)
  # package name ≠ PATH binary; detect via certs dir / update helper
  [[ -d /etc/ssl/certs || -x /usr/sbin/update-ca-certificates ]] || pkgs+=(ca-certificates)
  # GNOME Keyring CLI: secret-tool (package libsecret-tools)
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

install_solana_cli() {
  if need_cmd solana-keygen; then
    info "solana-keygen already on PATH: $(command -v solana-keygen)"
    return 0
  fi

  info "installing Solana CLI (Anza stable) into ~/.local/share/solana"
  # Official installer — not apt/npm. Places bins under ~/.local/share/solana/install/active_release/bin
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

  local bin="$HOME/.local/share/solana/install/active_release/bin"
  if [[ -x "$bin/solana-keygen" ]]; then
    export PATH="$bin:$PATH"
  fi

  if ! need_cmd solana-keygen; then
    die "solana-keygen not found after install. Add to PATH:
  export PATH=\"\$HOME/.local/share/solana/install/active_release/bin:\$PATH\"
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

  # Probe the Secret Service (GNOME Keyring / Seahorse backend). Needs an unlocked
  # desktop session — normal on kiff after graphical login; may fail over raw SSH.
  if ! echo -n 'probe' | secret-tool store --label='solana-wallet-script-probe' \
      service solana-wallet-script account probe 2>/dev/null; then
    die "cannot talk to GNOME Keyring / Secret Service via secret-tool.
Log into the graphical session on kiff (so the keyring is unlocked), or run:
  seahorse   # confirm 'Login' keyring is unlocked
Then re-run this script. Or use --no-secret to write the JSON file only."
  fi
  secret-tool clear service solana-wallet-script account probe >/dev/null 2>&1 || true
}

generate_wallet() {
  mkdir -p "$(dirname "$OUTFILE")"
  chmod 700 "$(dirname "$OUTFILE")" 2>/dev/null || true

  if [[ -e "$OUTFILE" && "$FORCE" -ne 1 ]]; then
    die "outfile exists: $OUTFILE (pass --force to overwrite, or set OUTFILE=...)"
  fi

  local args=(new --outfile "$OUTFILE" --no-bip39-passphrase)
  [[ "$FORCE" -eq 1 ]] && args+=(--force)
  [[ "$SILENT" -eq 1 ]] && args+=(--silent)

  info "generating keypair → $OUTFILE"
  if [[ "$SILENT" -eq 1 ]]; then
    solana-keygen "${args[@]}"
  else
    echo >&2
    echo "================================================================" >&2
    echo " WRITE DOWN THE 12-WORD SEED PHRASE BELOW (shown once)." >&2
    echo " A BIP39 passphrase is skipped so an unattended agent can load" >&2
    echo " the JSON keypair. The seed phrase is for offline recovery only." >&2
    echo "================================================================" >&2
    echo >&2
    solana-keygen "${args[@]}"
    echo >&2
  fi

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

  info "storing keypair in GNOME Keyring ($SECRET_LABEL)"
  # secret-tool reads the secret from stdin; attributes are the lookup key.
  secret-tool store --label="$SECRET_LABEL" \
    service "$SECRET_SERVICE" \
    account "$SECRET_ACCOUNT" \
    <"$OUTFILE"
}

print_summary() {
  local pubkey
  pubkey="$(solana-keygen pubkey "$OUTFILE")"
  echo
  echo "======== wallet ready ========"
  echo "pubkey:   $pubkey"
  echo "outfile:  $OUTFILE  (mode $(stat -c '%a' "$OUTFILE" 2>/dev/null || echo '?'))"
  if [[ "$USE_SECRET" -eq 1 ]]; then
    echo "keyring:  label='$SECRET_LABEL'"
    echo "          secret-tool lookup service $SECRET_SERVICE account $SECRET_ACCOUNT"
    echo "          (also visible in Seahorse / Passwords and Keys)"
  else
    echo "keyring:  (skipped)"
  fi
  echo
  echo "Next:"
  echo "  • Retrieve later: secret-tool lookup service $SECRET_SERVICE account $SECRET_ACCOUNT"
  echo "  • Copy to the trading server out-of-band — never paste the secret into chat/git."
  echo "  • Fund this pubkey with only what the agent may lose."
  echo "  • EVM chains need a separate EVM key; this script only creates Solana."
  echo "=============================="
}

# --- main ---
info "prereqs: curl, ca-certificates; libsecret-tools (secret-tool → GNOME Keyring); Solana CLI via Anza installer"
install_apt_prereqs
install_solana_cli
ensure_secret_service
generate_wallet
store_in_keyring
print_summary
