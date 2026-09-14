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
wallet.js           data layer. THE ONLY network caller. Provider reads
                    (EIP-1193) + edge fetch. Single origin constant.
sw.js               service worker. Network-first for the shell, cache
                    fallback, same-origin GET only, lifecycle correct.
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
// wallet.js — holdings
{ symbol: "ETH", address: null,            // null = native gas
  chain_id: 1, chain_name: "Ethereum",
  amount: 1.25, state: "ok" }              // or { amount: null, state: "unknown" }

// prices (edge, M6)
{ "1:native": { usd: 3120.55, cad: 4291.20 } }   // absent asset = unpriced

// estimate
{ state: "ok", value: 3900.68 } | { state: "unknown" }
```

## Chain catalog

| id | Name | Native | Queried via | Status |
|---|---|---|---|---|
| 1 | Ethereum | ETH | injected provider | active |
| 8453 | Base | ETH | injected provider | active |
| 4663 | Robinhood | ETH | injected provider | active |
| 900001 | Solana | SOL | — | **catalogued-not-queried** (D10: no balance RPC; edge reads pending) |

Unsupported EVM chains degrade to native-only, never to another chain's token
addresses (audit F2).

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
| unknown ≠ zero | wallet.js unit tests with a failing fake provider |
