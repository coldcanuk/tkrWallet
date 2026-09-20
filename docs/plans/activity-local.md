# Activity — local broadcasts + official explorer links

**Status:** implementing. Supersedes `docs/plans/activity-readthrough.md` (Alchemy
read-through is out of scope).

## Product

- Activity lists **successful Swap Now / Send broadcasts this device made**.
- Each row links to that tx on the **official** explorer (new tab).
- Shortcuts open this address on Ethereum, Base, and Robinhood explorers.
- History lives in IndexedDB until **Remove Wallet**. Lock, reload, Connect
  do not wipe it.
- Watch-only: explorer shortcuts only (no key, no broadcasts).
- No Alchemy/Blockscout/webhook read-through. No vendor fetch from the client.

## Explorers

| Chain | Host | Address | Tx |
|---|---|---|---|
| Ethereum | `https://etherscan.io` | `/address/{addr}` | `/tx/{hash}` |
| Base | `https://basescan.org` | `/address/{addr}` | `/tx/{hash}` |
| Robinhood | `https://robinhoodchain.blockscout.com` | `/address/{addr}` | `/tx/{hash}` |

These hosts are **navigation only** (`<a target="_blank" rel="noopener">`).
They are not `fetch` targets. CSP `connect-src` stays the wallet origin.

## Non-goals

Webhooks, toast inbox, SOL/TRON explorers, chain history via pruned nodes.
