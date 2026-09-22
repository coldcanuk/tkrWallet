# Wallet generators

These scripts generate chain identities for tkrWallet users and for the
platform fee sink. They are operator tools, not a browser click-path.

Canonical copies live here. Workstation copies under `~/scripts/new_*_wallet.sh`
are the same files.

| Script | Default outfile (mode 600) |
| --- | --- |
| `new_evm_wallet.sh` | `~/.config/ethereum/lifi-trading.json` |
| `new_sol_wallet.sh` | `~/.config/solana/lifi-trading.json` |
| `new_sui_wallet.sh` | `~/.config/sui/lifi-trading.json` |
| `new_tron_wallet.sh` | `~/.config/tron/lifi-trading.json` |
| `new_stellar_wallet.sh` | `~/.config/stellar/lifi-trading.json` |
| `generate-platform-fee-wallet.sh` | none — JSON goes to ATHENA Vault, never git |
| `generate_lesou_evm.sh` | `~/.lesou/wallet/backup/current/wp101-l3-<role>.json` plus pass `ae/lesou/wp101/l3/<role>` |

Override the outfile with `OUTFILE=` for a per-user EVM wallet:

```sh
OUTFILE="$HOME/.config/tkrwallet/users/example.json" \
  ./scripts/new_evm_wallet.sh --silent --no-secret
```

`--silent` does not print the seed or private key. `--no-secret` skips the
desktop keyring. Do not commit JSON outfiles. Do not put private keys in git
or in IcePike.

User wallets that tkrWallet itself creates still happen **on the device**
(IndexedDB AES-GCM vault). These scripts are the operator path for platform
and provisioned identities.

## Platform fee wallet

`generate-platform-fee-wallet.sh` must run on ATHENA as chuck. It creates a
dedicated receive-only EVM account, stores the JSON in HashiCorp Vault at
`theplatform/fee-wallet/evm`, and prints **only the public address**.

That address is the swap-fee destination once Scratchpost `swap/build` exists.
The public address is published at
`blockchain-infrastructure/shared/wallet/platform_fee_recipient.v1.yaml`.
Until skim is live the ciphertext sits in Vault and no route sends it tokens.
Do not import this key into a customer tkrWallet. Do not reuse ATA rails or
trading wallets.

## LeSou L3 EVM wallets

`generate_lesou_evm.sh` creates BIP-39 EVM accounts for LeSou L3 genesis roles
(`mn1`, `mn2`, `mn3`, `treasury`). One EVM key works on every EVM chain,
including LeSou L3 (603148) and Base; distinct roles still get distinct keys.

```sh
./scripts/generate_lesou_evm.sh --all
./scripts/generate_lesou_evm.sh mn1
```

The script verifies private-key→address, mnemonic→address, and a sign/verify
round-trip before writing pass. It prints **only the public address** and
storage paths. Refuse to overwrite an existing pass leaf or backup file.

## Chrome CRX private key

Run `pack-crx.sh` on **kiff**. It SSHs to ATHENA for Vault unseal/checkout,
packs with local Brave (Pop Shop deb or Flathub), writes `$HOME/tkrwallet.crx`,
and shreds the Vault checkout PEM on exit. Chrome UI may also write
`$HOME/tkrWallet-chrome-extension-kfgmpcgplemjepolfpdbodmakceacook.pem`; the
script sleeps 5 minutes then `shred -u` that exact file.
