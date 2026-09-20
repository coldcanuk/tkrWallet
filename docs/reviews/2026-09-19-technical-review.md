# tkrWallet technical review — 2026-09-19

**Tree:** worktree `feat/send-qr-camera-agents` off `origin/main` `a33c54f`,
package **0.10.17**. Service worker cache `tkrwallet-v15`.
**Not current:** `docs/reviews/technical-review.md`,
`docs/reviews/wallet-technical-review.md`, and the 2026-09-14 0.7.0
`app.js`-era files. Those describe a client that no longer exists.
**Companion audit:** [`../security/2026-09-19-audit.md`](../security/2026-09-19-audit.md).
**Suite:** `node app_test.js` — 122 tests, 0 failures (run twice).

This is the knowledge file for *how the current UA is built and how it talks
to the Scratchpost edge*.

---

## 1. What it is

tkrWallet is a **self-custody customer UA**: one tree ships a same-origin PWA
and an MV3 Chrome/Brave extension. It holds keys on the device, reads
balances/prices/token metadata from **one** HTTPS origin
(`https://tkrwallet.scratchpost.ai`), and never talks to a chain node, a lab
host, or a vendor RPC from the browser.

It is a client signer, not a custodian: it never holds keys for the user on a
server, never auto-executes, and never shops vendors. `window.ethereum` is
absent. Send of arbitrary ERC-20/native still waits on unsigned calldata from
the edge; **swap quote/build is live in the client**.

Shipped, browser-loaded artifacts:

| File | Role |
| --- | --- |
| `index.html` | Shell, CSP meta, templates. No inline script. |
| `shell.js` | Popup vs panel vs page class before CSS. |
| `ui.js` | Navigation, gate, CLI, render. **No `fetch`.** |
| `wallet.js` | **Only** network I/O. Catalogue, balances, prices, token meta, session, swap quote/build, broadcast. |
| `crypto.js` | Mnemonic, HD derive (EVM / Solana / TRON), vault encrypt/decrypt, local signing. |
| `store.js` | IndexedDB for the **ciphertext** vault and local contacts. |
| `sw.js` | Network-first shell; **never caches `/api/`**. Cache name `tkrwallet-v15`. |
| `manifest.webmanifest` / `manifest.json` | PWA / MV3. |
| `vendor/noble.js` | Audited `@noble`/`@scure` bundle (committed). |
| `vendor/qr.js` | QR encoder (committed). |
| `app.css` | Committed Tailwind output (MV3 forbids a CDN). |

Operator-only (not loaded by the PWA): `tools/dev-edge.js`, `scripts/new_*.sh`,
`scripts/pack-crx.sh`, `deploy/`.

---

## 2. How it connects to the Scratchpost edge

### 2.1 The only hostname the wallet knows

```
var BASE_URL = "https://tkrwallet.scratchpost.ai";   // wallet.js
```

`apiUrl(path)`:

- **PWA** (page origin is already the edge): `path` only — e.g.
  `/api/wallet/balances?…`. CSP `connect-src 'self' https://tkrwallet.scratchpost.ai`
  makes any other host a browser refusal.
- **Extension** (`chrome-extension://…`): `BASE_URL + path`.
  `host_permissions` and extension `connect-src` allow-list **exactly**
  `https://tkrwallet.scratchpost.ai`.

There is no config for a second API host. There is no JSON-RPC client in the
shipped UA. `ui.js` / `crypto.js` / `store.js` contain no `fetch`, XHR, or
WebSocket (asserted).

### 2.2 Reads and writes the wallet performs

After unlock, `ui.js` calls into `wallet.js`:

| Call | Path | What comes back |
| --- | --- | --- |
| `getBalances` | `GET /api/wallet/balances?address=&chains=…` | `{ balances, chains[], as_of }` |
| `getPrices` | `GET /api/wallet/prices?assets=…&vs=` | `{ prices, vs, as_of }` — missing keys mean **unpriced**, never `0` |
| `getTokenMeta` | `GET /api/wallet/token?chain=&address=` | metadata or `{ ok:false, error }` |
| `searchTokens` | `GET /api/wallet/tokens/search` | Ethereum + Base catalogue |
| `requestNonce` / `openSession` / `closeSession` | `POST /api/wallet/nonce`, `/session`, `/logout` | EIP-191 connect |
| `listPendingSigns` | `GET /api/wallet/pending-signs` | IcePike unsigned payloads |
| `quoteSwap` | `POST /api/wallet/swap/quote` | `{ out_amount, expires_at, quote, … }` |
| `buildSwap` | `POST /api/wallet/swap/build` | unsigned `tx` / `unsigned_tx`; optional `needs_approval` |
| `broadcastRaw` | `POST /api/wallet/broadcast` | `{ tx_hash }` after **local** sign |

Amounts on the wire are decimal strings. Zero holdings are omitted by the
edge. An empty `balances` array means “none of the requested tokens” **only
if** every `chains[]` entry is `ok`. Missing `chains[]` is `partial`. HTTP
failure → `{ state: "unknown" }`. The UI must not render unknown as $0.

The service worker short-circuits `/api/` so those responses are never cached.

### 2.3 What the wallet deliberately does not know

Backend hostnames, LAN IPs, rathole, dam-router, publicnode, Helius, Jupiter,
Alchemy, TronGrid are **not encoded in the UA**. A hygiene test greps
`CLIENT_SHIPPED` for RFC1918, `*.local`, internal names, and extra `https://`
origins. `tools/dev-edge.js` may dial public RPCs; it is operator/dev, not
shipped to the browser.

---

## 3. Screens (0.10.17)

| Hash / screen | What it does |
| --- | --- |
| `#/home` | Wallet value (USD/CAD/MXN, optional live FX), Send/Swap/Receive/Buy, Mine / Tokens / Airdrop lists |
| `#/swap` | Same-chain Quote + Swap Now modal (ETH, Base, Robinhood, Solana, TRON) |
| `#/send` | Contacts, last recipients, webcam QR. Broadcast still waits on edge calldata |
| `#/receive` | QR of the unlocked EVM address |
| `#/activity` | Device-local placeholder (“No activity yet”) |
| `#/search` | Ethereum + Base catalogue |
| `#/settings` | Auto-lock, currency, Connect / Disconnect, extra accounts, version |
| `#/token/<chain>:<asset>` | Token detail; Buy Now opens Swap with that coin |
| `#/airdrops` | Unpriced inbound tokens |

Header: Terminal (in-wallet CLI), Search, Dock (MV3 side panel).
Gate: Unlock / Import / Create. Create shows the phrase once, typed confirm
`I saved my recovery phrase`, then wipe.

Scan QR from the **toolbar popup or side panel** opens Send in a tab
(`?scan=1#/send`) so Chrome can show the camera prompt. Desk webcam uses
`getUserMedia({ video: true, audio: false })`. Camera errors do not claim a
signature happened.

---

## 4. In-wallet CLI

`ui.js#runCliCommand` is pure (no DOM). The Terminal overlay shares the
unlocked session. Commands: `help`/`?`, `status` (lock + **short** address),
`home`/`search`/`settings`/`swap`/`activity`, `search <query>`, `lock`,
`dock`, `clear`, `close`/`exit`. Secret verbs (`seed`, `mnemonic`, `phrase`,
`secret`, `private`, `privkey`, `password`, `passwd`, `export`, `backup`)
are refused and never print key material.

This is the AI-facing surface. It does **not** currently quote, send, or
unlock. See the parity matrix in the companion audit.

---

## 5. Swap (client)

Same-chain only. The edge returns an unsigned swap; this device signs
(EVM `signAndBroadcastPayload`, Solana versioned tx, TRON txID) and POSTs
raw bytes to `/api/wallet/broadcast`. Quote TTL defaults to 15s when the
edge omits `expires_at`. Swap Now is `disabled` once `quoteStillLive()` is
false. Approval, if required, is a second local sign then a rebuild.

No vendor hostname appears in shipped client files (asserted).

---

## 6. Custody (unchanged model, current tree)

- BIP-39 12-word phrase; EVM `m/44'/60'/0'/0/{i}`; Solana `m/44'/501'/0'/0'`;
  TRON `m/44'/195'/0'/0/0`.
- Vault: PBKDF2-SHA256 600k → AES-GCM in IndexedDB. Public accounts only
  beside the ciphertext.
- Phrase in RAM while unlocked; auto-lock 1/5/15/30/60 min, never off,
  1 hour max. Viewing session stores **public** addresses only
  (`sessionStorage` on PWA; `localStorage` on `chrome-extension:` because
  MV3 destroys the popup).
- Canonical BIP-39 vector is locked by tests.

---

## 7. Strengths and residual product gaps

**Strengths.** Single-origin CSP; shell/data split; unknown ≠ zero; local
signing; SW never caches API; tests actually call `runCliCommand`,
`quoteSwap`, and `buildSwap`.

**Gaps (product, not regressions of this branch).**

- Activity is a placeholder.
- Send broadcast is not built (UI says so; nothing is signed).
- CLI cannot perform swap/send/unlock — navigation and status only.
- `docs/architecture/client.md` still says `#/swap` is under construction
  (stale vs 0.10.11+).
- `docs/specs/edge-server.md` §3.4 still documents `/api/swap/quote`; the
  client speaks `/api/wallet/swap/quote`.
- Production edge live-POST of swap is not exercised from this host; the
  client contract is.
- `npm run check` CSS rebuild needs `npm run setup` in a worktree (Tailwind
  lives in gitignored `tools/node_modules`).

---

## 8. Why the primary checkout was dirty

Agents edited `main` in `/opt/repo/thePlatform/tkrWallet` because this repo
had no Prime Directive. IcePike already forbids that. The uncommitted 0.10.16
QR-camera patch collided with origin’s already-shipped 0.10.16 (live FX/MXN).
This branch restates the camera fix as **0.10.17**, adds `AGENTS.md`, and
keeps the live GitHub runner and `.rdapq/` out of git.
