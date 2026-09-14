# tkrWallet technical review — 2026-09-14

**Tree:** `main` `eb4ed2c` + this branch (`gb/tech-review-audit`). Package version **0.7.0**.
**Live counterparty:** `https://tkrwallet.scratchpost.ai` (probed the same day).
**Audience:** operators and reviewers who need a current map of the UA, not a reprint of 0.4–0.6 reviews.

This document is the knowledge file for *how the app is built and how it talks to the edge*. The companion security audit is [`../security/2026-09-14-security-audit.md`](../security/2026-09-14-security-audit.md).

---

## 1. What it is

tkrWallet is a **self-custody customer UA**: a same-origin PWA plus an MV3 extension from one tree. It holds keys on the device, reads balances/prices/token metadata from **one** HTTPS origin, and never talks to a chain node, a lab host, or a vendor RPC from the browser.

It is not a custodian, not a swap venue, and not a window onto injected providers (`window.ethereum` is absent).

Shipped, browser-loaded artifacts:

| File | Role |
| --- | --- |
| `index.html` | Shell, CSP meta, templates. No inline script. |
| `ui.js` | Navigation, gate, render. **No `fetch`.** |
| `wallet.js` | **Only** network I/O. Catalogue, balances, prices, token meta. |
| `crypto.js` | Mnemonic, HD derive, vault encrypt/decrypt, local signing. |
| `store.js` | IndexedDB for the **ciphertext** vault only. |
| `sw.js` | Network-first shell; **never caches `/api/`**. |
| `manifest.webmanifest` / `manifest.json` | PWA / MV3. |
| `vendor/noble.js` | Audited `@noble`/`@scure` bundle (committed). |
| `app.css` | Committed Tailwind output (MV3 forbids a CDN). |

---

## 2. How it connects to the Scratchpost edge

### 2.1 The only hostname the wallet knows

```
var BASE_URL = "https://tkrwallet.scratchpost.ai";   // wallet.js
```

`apiUrl(path)`:

- **PWA** (page origin is already the edge): `path` only — e.g. `/api/wallet/balances?…`. CSP `connect-src 'self'` makes any other host a browser refusal, not a policy hope.
- **Extension** (`chrome-extension://…`): `BASE_URL + path`. `host_permissions` and extension `connect-src` allow-list **exactly** `https://tkrwallet.scratchpost.ai`.

There is no config for a second API host. There is no JSON-RPC client. `ui.js` / `crypto.js` / `store.js` contain no `fetch`, XHR, or WebSocket.

### 2.2 Reads the wallet performs (and nothing else)

After unlock, `ui.js#refreshBalances` calls into `wallet.js`:

| Call | Path | What comes back |
| --- | --- | --- |
| `getBalances(address, [1, 8453], …, extraTokens)` | `GET /api/wallet/balances?address=&chains=1,8453[&tokens=chain:address,…]` | `{ balances: [...], chains: [{chain_id, state, error?}], as_of }` |
| `getPrices(assets, [currency])` | `GET /api/wallet/prices?assets=1:native,1:0x…&vs=usd` | `{ prices: { "1:native": { usd, cad? } }, vs, as_of }` — missing keys mean **unpriced**, never `0` |
| `getTokenMeta(chainId, address)` | `GET /api/wallet/token?chain=&address=` | `{ token: { symbol, name, decimals, address, chain_id } }` or `{ ok:false, error }` |

Amounts on the wire are **decimal strings**. The client converts to numbers for display. Zero holdings are omitted by the edge; an empty `balances` array means “none of the requested tokens” **only if** every `chains[]` entry is `ok`. Missing `chains[]` is treated as `partial` (`edge-no-read-status`). HTTP failure → `{ state: "unknown" }`. The UI must not render unknown as $0.

The service worker short-circuits `/api/` so those responses are never cached.

### 2.3 What the wallet deliberately does not know

The public Path B (infrastructure, **not encoded in the UA**):

```
browser → Cloudflare (tkrwallet.scratchpost.ai)
       → icehut nginx → rathole → damRouter Host split
       → origin 127.0.0.1:18899
       → rank-1 chain reads (not the wallet's problem)
```

If a future change put `eva.local`, `caesar.local`, `192.168.x.x`, or a public RPC URL into `wallet.js` / `ui.js` / `index.html`, that is a **contract break**. The hygiene test in `app_test.js` (`shipped client files contain no lab IPs, internal hostnames, or extra origins`) is the CI tripwire.

### 2.4 Live behaviour (same day as this review)

`GET https://tkrwallet.scratchpost.ai/healthz` → `ok`, plus `connect-src 'self'`, HSTS preload, COOP `same-origin`.

`GET /api/wallet/balances` for a known-funded address: Ethereum rows present, `chains[]` reports Base `unknown` / `rpc http 502`. The JSON contains **no lab IPs**. Prices and token metadata succeed on the same origin.

So: Mainnet reads work through the edge; Base is an **edge/node** outage disclosed as unknown, not a client bug.

---

## 3. Strengths

1. **Single-origin is enforced by the browser.** CSP + relative PWA fetches + extension allow-list + a grep test. A contributor cannot “just add Alchemy” without failing CI and the page CSP.
2. **One I/O module.** All `fetch` lives in `wallet.js`. The shell cannot accidentally talk to the network.
3. **Honesty of reads (0.7.0).** `ok` / `partial` / `unknown` with Retry. Failed Base is “could not be read”, not “you own nothing”.
4. **No injected provider.** Import/unlock only. No `eth_requestAccounts` phishing surface inside this app.
5. **No client-side RPC.** Catalogue tokens are read by the edge; add-token asks the edge for `symbol()`/`decimals()`.
6. **Offline search of a fixed catalogue** plus user-added addresses — no third-party indexer in the UA.
7. **Network-first SW** with `/api/` excluded; cache name must bump on shell changes (tested).
8. **Committed, reviewable JS.** No bundler for the app; what you audit is what runs.

---

## 4. Weaknesses and remediations

Remediations are **recommendations**. This review does not implement them (except the `eva` HTML-comment hygiene fix on this branch, which the 0-knowledge test requires).

| ID | Weakness | Why it hurts | Turn it into a strength |
| --- | --- | --- | --- |
| W1 | **`main` viewing session is RAM-only.** Reload re-prompts even inside the auto-lock window. (0.7.1 on `gb/edge-session-honesty` / live PWA already stores `{address, lastActivity}` in `sessionStorage` — not on this `main`.) | Feels broken; users force-unlock constantly. | Merge PR #27. Keep mnemonic out of `sessionStorage`. Treat lock / tab-close / expiry as still requiring the password. |
| W2 | **Base chain reads fail at the edge** (`chains[].state = unknown`). | Users with Base-only bags see an incomplete wallet even with a correct address. | Repair the rank-1 Base node. Do **not** put a public Base RPC in the UA or as a production origin default. |
| W3 | **Holdings = catalogue ∪ user-added tokens.** Phantom-class “all your ERC-20s” needs an indexer. | Real bags look empty until Add token. | Keep add-token; optionally add an **edge** catalogue/index endpoint later. Never a client-side scanner against a public RPC. |
| W4 | **Extension `manifest.json` version is `0.4.0`** while `package.json` is `0.7.0`. | Chrome and git disagree on what shipped. | One version source; CI asserts equality. |
| W5 | **Swap / send / receive / buy / Solana reads are honest placeholders.** Spec §3.1 nonce/session is unimplemented (and origin prove **forbids** nonce/session today). | Product looks unfinished; spec and origin disagree on auth. | Either implement §3.1 at the origin and client together, or strike it from the UA spec until then. Swap stays disabled until a quote engine exists **on the edge**. |
| W6 | **Git/docs still name icehut/eva** (`CHANGELOG.md`, `deploy/`). Not loaded by the PWA, but public. | 0-knowledge is incomplete at the *repository* boundary. | Scrub operator names from changelog/deploy README; keep them in the infrastructure repo. |
| W7 | **`tools/dev-edge.js` uses publicnode.** Correct for local `npm run dev`; dangerous if someone copies it into production origin. | A future “just ship the dev edge” would teach the stack a vendor RPC. | Keep the prove that production `wallet-edge` src has no `publicnode`. Document that `npm run dev` is not Path B. |
| W8 | **Custody doc had claimed the production edge was undeployed.** | Reviewers would distrust every other claim. | **Done on this branch:** `wallet-custody.md` now names `https://tkrwallet.scratchpost.ai` and points at the 2026-09-14 audit. |
| W9 | **No SRI / content-hash on scripts.** Cache-Control is `no-cache` / `no-store`. | A compromised origin can swap `crypto.js`. | Origin integrity is the control today (Path B + CF). Optional: subresource integrity once filenames are hashed. |
| W10 | **Origin drift vs git `main`.** Live PWA was previously a Sep 13 snapshot; shipping is a manual rsync to caesar `WALLET_ROOT`. | Users “don’t see recent improvements.” | Ship `WALLET_ROOT` from a tagged git SHA as part of origin apply; CI check that live `ui.js` hash matches the tag. |

---

## 5. Architecture decisions (frozen for this review)

- The wallet talks to **`https://tkrwallet.scratchpost.ai` only**.
- Chain topology, RPC URLs, and hostnames stay in `blockchain-infrastructure`, never in the UA.
- `unknown ≠ zero` is a client invariant even when the edge misbehaves.
- Dev (`tools/dev-edge.js`) may use public RPCs; production origin may not.

---

## 6. Verdict

As a **client**, tkrWallet is a small, auditable, single-origin reader/signer that correctly treats the Scratchpost edge as its only network peer. Its product gaps (Base availability, catalogue coverage, session-on-reload on `main`, extension version) are real but localized. Its architectural bet — *the UA must not know the lab* — holds in the browser-loaded files after the `eva` comment removal on this branch.
