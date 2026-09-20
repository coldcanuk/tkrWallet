# tkrWallet — Client Architecture

Frozen at M2.1. Changes to this contract change the tests, which are the
enforcement of the audit.

## File map

```
index.html          markup only. Templates + static structure. CSP meta tag.
                    Loads: ./app.css, ./ui.js, ./wallet.js. No inline script.
ui.js               shell controller. Routing, currency, render primitives,
                    account chip, status announcements. NO network calls —
                    asserted by test.
wallet.js           data layer. THE ONLY network caller. Edge fetch
                    (balances + prices). Relative /api/… on the PWA origin
                    (served FROM the edge), absolute edge origin for
                    extension pages. Single-origin invariant enforced by test.
sw.js               service worker. Network-first for the shell, cache
                    fallback, same-origin GET only, /api/* never cached.
app.css             committed Tailwind build (tools/src/app.css).
manifest.json       MV3 extension: pinned key, PNG icons, single-origin
                    host_permissions, tightened extension_pages CSP.
manifest.webmanifest PWA manifest, dark-aligned colours.
icons/              shape-only SVG source + PNG 16/32/48/128.
```

## Boundaries

1. **The shell never fetches.** `ui.js` has zero network sinks (tested). Any
   data the UI needs is returned by `wallet.js`.
2. **One origin.** `wallet.js` declares `BASE_URL = "https://tkrwallet.scratchpost.ai"`
   and nothing else. A test greps every shipped file and fails on any other
   `https://` origin.
3. **Unknown ≠ zero.** Every value in the system is
   `{ state: "ok", value } | { state: "unknown" }`. Rendering maps `unknown` to
   `—` and never invents a number. No code path may convert a failure to `0`.
4. **No markup-string sinks.** `textContent` only (tested).
5. **No auto-execution.** The data layer reads; it never sends transactions.

## Data shapes

```js
// wallet.js — holdings (one row per non-zero balance the edge could read)
{ symbol: "ETH", address: null,            // null = native gas
  chain_id: 1, chain_name: "Ethereum",
  amount: 1.25, decimals: 18, color: "#a8a29e",
  state: "ok" }                            // or { amount: null, state: "unknown" }

// wallet.js — getBalances() result. `chains` mirrors the edge's read report.
{ state: "ok",      balances: [...], chains: [ { chain_id: 1, state: "ok" } ], as_of: 1737000000 }
{ state: "partial", balances: [...], chains: [ { chain_id: 1, state: "ok" },
                                               { chain_id: 8453, state: "unknown", error: "…" } ] }
{ state: "unknown", reason: "edge-unreachable" | "all-chains-failed" | "bad-response" }

// prices (edge, M6)
{ "1:native": { usd: 3120.55, cad: 4291.20 } }   // absent asset = unpriced

// estimate
{ state: "ok", value: 3900.68, priced: 2, total: 3 } | { state: "unknown" }

// user-added tokens (localStorage, public metadata only — never key material)
{ "8453": [ { "address": "0x8335…2913", "symbol": "USDC", "name": "USD Coin", "decimals": 6 } ] }
```

**State semantics.** `ok` means *every requested chain was read*; `partial` means
*some were*; `unknown` means *none were, or the edge could not be reached*. Only
`ok` with an empty `balances` array may be rendered as "you hold none of the
catalogued tokens". `partial` and `unknown` must disclose the failure and offer a
retry. This is the client half of the edge contract in
`docs/specs/edge-server.md` §3.3.

## Routes

| Hash | Screen |
|---|---|
| `#/home` | wallet value, actions, holdings |
| `#/swap` | same-chain plus Ethereum/Base ↔ Solana, Sui, TRON, Stellar |
| `#/activity` | device-local placeholder |
| `#/search` | catalogue search |
| `#/settings` | auto-lock, currency, lock now |
| `#/accounts` | several IndexedDB wallets: New / Remove / Import + Watch |
| `#/token/<chain_id>:<native\|0xaddress>` | **token detail** (reachable from a holding row and a search row) |

## Chain catalog

| id | Name | Native | Queried via | Status |
|---|---|---|---|---|
| 1 | Ethereum | ETH | wallet edge | active |
| 8453 | Base | ETH | wallet edge | active |
| 4663 | Robinhood | ETH | wallet edge | active |
| 900001 | Solana | SOL | wallet edge | active |
| 728126428 | TRON | TRX | wallet edge | active |
| 900002 | Sui | SUI | swap dest via Li.Fi | dest-only |
| 900003 | Stellar | XLM | swap dest via Li.Fi | dest-only |

Balances for an unlocked wallet arrive from the wallet edge, never from an
injected provider. There is no EIP-1193 connect path.

## Invariants → tests

| Invariant | Test |
|---|---|
| single origin | grep all shipped files for `https?://`, only BASE_URL |
| permissions | `host_permissions` deep-equals `[BASE_URL+"/*"]` |
| CSP × 2 | meta tag in index.html; `extension_pages` in manifest.json |
| no beaver | case-insensitive grep of shipped files |
| no v1 | `app.js` absent from tree and from the SW precache |
| shell has no network | `ui.js` free of fetch/XHR/WS/EventSource |
| no markup sinks | `ui.js` free of innerHTML family + eval |
| SW lifecycle | `sw.js` contains skipWaiting/clients.claim/activate + origin check |
| unknown ≠ zero | wallet.js unit tests: absent/omitted prices and unknown states stay `—`, never `0` |
