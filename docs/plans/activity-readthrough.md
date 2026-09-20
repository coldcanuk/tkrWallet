# Activity — read-through (ETH, Base, Robinhood)

**Status:** design for Charles approval. Not implemented.
**Owner:** Charles Pitre.
**Depends on:** wallet-edge + Caesar in `blockchain-infrastructure`.
**Does not change:** Eva prune flags, swap routing, Connect/session cookies.

## Problem

`#/activity` is a placeholder. Eva L1/L2 are pruned: they can quote and
broadcast at `latest`, they cannot serve address history. The wallet must not
call Alchemy or Blockscout. Scratchpost already holds those keys.

A Robinhood ETH → Base ETH swap is two chain facts: a **from** tx on 4663 and a
**to** fill on 8453 (Across relayer). Local “txs I signed” misses the fill.

## Goal (this round)

Show recent transfers for the unlocked EVM address on **Ethereum (1), Base
(8453), Robinhood (4663)**, plus rows this device **broadcast**, merged by hash.

Honesty line: “Recent transfers Scratchpost can see on Ethereum, Base, and
Robinhood, plus swaps this device sent.”

## Non-goals

- SOL / TRON / Sui / Stellar activity
- Running an archive node or changing Eva prune
- Complete chain history
- Client links to basescan.org / alchemy.com (no vendor hosts in shipped files)
- IcePike trade reaction to webhooks
- Full webhook indexer (follow-up)

## Architecture

```
tkrWallet (wallet.js only)
  GET /api/wallet/activity?address=0x…&chains=1,8453,4663
        │
wallet-edge (public read, same posture as balances)
        │
Caesar GET /api/v2/wallet/activity
        ├── Alchemy alchemy_getAssetTransfers (from OR to)
        └── Blockscout /api/v2/addresses/{addr}/transactions (fallback)
```

Local IndexedDB store `activity_local`: append on successful `broadcastRaw`.
UI merges edge rows + local rows by `tx_hash`. Local-only rows show until the
read-through catches them.

## Row shape (edge)

```json
{
  "ok": true,
  "address": "0x…",
  "as_of": 1737000000,
  "chains": [{ "chain_id": 4663, "state": "ok" }],
  "items": [{
    "chain_id": 4663,
    "tx_hash": "0x…",
    "block_time": 1789939651,
    "direction": "out",
    "asset": { "symbol": "ETH", "mint": "native", "decimals": 18 },
    "amount": "5000000000000000",
    "counterparty": "0xB477…",
    "status": "ok",
    "source": "alchemy"
  }]
}
```

`direction` is `in` | `out` | `self` relative to the queried address.
`status` is `ok` | `failed` | `pending`. Failed chain reads are
`chains[].state = "unknown"`, never an empty success.

## Client

- `wallet.js` `getActivity({ address, chains })` — credentials omitted (public
  chain data, same as balances).
- `ui.js` `#/activity`: list newest first; unknown is “—” / retry, not “none”.
- After Swap/Send broadcast: append local row, then refresh edge list.
- Tx hash: copy on tap. No outbound explorer URL in shipped JS.
- CLI: `activity` already opens the screen.

## Edge / Caesar

- Cap `chains[]` to `{1, 8453, 4663}`; reject others this round.
- Address required, checksum optional, lowercase compare.
- Alchemy first; if unconfigured or 4xx/5xx, Blockscout for that chain.
- Robinhood Blockscout: `robinhoodchain.blockscout.com` (already proven).
- Rate limit with other `/api/wallet/*` GETs.
- Do not log full tx payloads.

## Local log

- Per-wallet IndexedDB, no secrets, no mnemonic.
- Fields: `wallet_id`, `chain_id`, `tx_hash`, `at`, `kind` (`swap`|`send`),
  `amount`, `symbol`.
- Lock does not wipe it (public receipts). Remove Wallet deletes that wallet’s
  rows.

## Tests

- Client: `getActivity` path, no vendor hosts in shipped files, unknown ≠ empty.
- Edge prove: query forward, invalid chain 400, missing address 400.
- Caesar: fixture for Alchemy + Blockscout including a 4663→8453 Across pair
  (from + to) for one address.

## Follow-up (not this PR)

Webhook indexer (`wallet_hook_inbox` → per-address activity table) so inbound
fills arrive without polling. SOL/TRON read-through. Optional Scratchpost
tx-hash page so the UI can “open” a receipt without naming a vendor.

## Exit

Unlock `0x69cc…AF95`, open Activity, see the Robinhood 0.005 ETH out and the
Base ~0.004984 ETH in (or local swap row + edge when indexed). Copy hash
matches `0x57d7d9b8…`.
