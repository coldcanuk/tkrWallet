# RESEARCH — tkrWallet technical review & security audit (current tree)

Date: 2026-09-14
Branch: `gb/tech-review-audit` from `main` `eb4ed2c` (package 0.7.0).
Live origin probed the same hour: `https://tkrwallet.scratchpost.ai`.

This note is the Phase 1 gate. It is **not** a reprint of
`docs/reviews/technical-review.md` or `docs/security/wallet-custody.md`
(those predate 0.7.0 honesty and still say the production edge is undeployed).

## Scope captured

| Item | Statement |
| --- | --- |
| **Primary goal** | A current technical review and a current security audit in-repo: how the wallet talks to the Scratchpost **edge**, a 0-knowledge verdict (no backend server names, no IPs), strengths, weaknesses each with a remediation. An automated hygiene test fails CI if a lab IP, internal hostname, or extra origin appears in shipped client files. |
| **Non-goals** | Implementing remediations (Base node, nonce/session, swap, Solana). Changing `blockchain-infrastructure` origin/dam-router. Pentest / noble.js re-audit. |
| **Success** | Review names `/api/wallet/balances`, `/api/wallet/prices`, `/api/wallet/token`. Audit states 0-knowledge with scan result. Hygiene test in `app_test.js` covers IPv4 RFC1918, `.local`, internal hostnames, extra origins. `node app_test.js` → `N tests, 0 failures`. |
| **Constraints** | Allowed origin only: `https://tkrwallet.scratchpost.ai`. Wallet must not encode lab topology. `tools/dev-edge.js` is operator/dev, not the PWA. |
| **Assumptions** | Live Path B origin is the counterparty the PWA actually hits. Repo `main` is 0.7.0; viewing-session 0.7.1 lives on `gb/edge-session-honesty` (PR #27) and is already on the live PWA. |
| **Top risks** | (R1) Stale reviews copied forward. Mitigate: re-derive from grep + file read. (R2) Naive `10.` grep false-positives (LICENSE “section 10”, SVG `M4 10.5`). Mitigate: RFC1918 octets. (R3) `eva` in a shipped HTML comment is a server-name leak; a hostname test will fail until the comment is rewritten (hygiene fix, not a product feature). (R4) `tools/dev-edge.js` publicnode URLs look like client leaks if the scan is unscoped. |

## Finding 1 — Edge connection (client has one origin)

All network I/O is in `wallet.js`. `ui.js`, `crypto.js`, and `store.js` contain no `fetch` / XHR / WebSocket.

```
PWA (origin https://tkrwallet.scratchpost.ai)
  apiUrl(path) = path                          // relative, CSP connect-src 'self'
  GET /api/wallet/balances?address=&chains=    // + optional tokens=
  GET /api/wallet/prices?assets=&vs=
  GET /api/wallet/token?chain=&address=

MV3 extension (origin chrome-extension://…)
  apiUrl(path) = "https://tkrwallet.scratchpost.ai" + path
  host_permissions and connect-src allow exactly that host
```

`BASE_URL` is the only public hostname in `wallet.js`. The service worker ignores `/api/*` (never caches balances/prices).

Live (2026-09-14, captured `{SCRATCH}/live-edge.log`):

- `GET /healthz` → `ok`, CSP `connect-src 'self'`, HSTS preload, COOP `same-origin`.
- `GET /api/wallet/balances` for Vitalik → 200 `{balances, chains, as_of}`; Ethereum `ok`, Base `unknown` / `rpc http 502`; **no IP in the JSON**.
- `GET /api/wallet/prices` → CoinGecko-backed numbers via the edge, not via the browser.
- `GET /api/wallet/token` → `{token: {symbol, name, decimals, …}}`.

The wallet does not know (and must not know) icehut, rathole, damRouter, eva-boundary, or Reth. Those names belong in infrastructure docs, not in the UA.

## Finding 2 — 0-knowledge scan of shipped client files

Files: `index.html`, `ui.js`, `wallet.js`, `crypto.js`, `store.js`, `sw.js`, `manifest.json`, `manifest.webmanifest`.

| Class | Result |
| --- | --- |
| RFC1918 IPv4 | **none** |
| `*.local` | **none** |
| Extra `https://` origins | only `https://tkrwallet.scratchpost.ai` (wallet.js + manifest.json) |
| Internal host/role names (`eva`, `caesar`, `icehut`, `athena`, `kiff`, `rathole`) | **`eva` in `index.html` line 14 HTML comment** — violation |

Existing `app_test.js` origin scan only matches `https?://…`, so the `eva` comment does not fail CI today.

Out of scope for the client scan (classified, not a PWA leak):

- `tools/dev-edge.js` — `ethereum-rpc.publicnode.com` / `base-rpc.publicnode.com` (local `npm run dev` stand-in).
- `CHANGELOG.md`, `deploy/README.md` — `icehut`, `eva` in operator prose.
- `LICENSE` “section 10” / SVG `10.5` — not IPs.

## Finding 3 — Custody / CSP (current tree)

- Vault: PBKDF2-SHA256 600k → AES-GCM; IndexedDB holds ciphertext only (`store.js`).
- Derive: BIP-39 → BIP-44 `m/44'/60'/0'/0/0` (vector-tested).
- Page CSP: `default-src 'none'; script-src 'self'; connect-src 'self'; …` (no `unsafe-inline` / `unsafe-eval`). `frame-ancestors` is header-only (correct).
- DOM: `textContent` only; comment forbids `innerHTML`.
- Auto-lock: 1–60 min, never off. On this `main` the viewing session is **RAM-only** (reload re-prompts). 0.7.1 sessionStorage is not on this branch.
- Extension `manifest.json` **version `0.4.0`** vs `package.json` `0.7.0` — drift.
- `docs/security/wallet-custody.md` still says “The production edge is not deployed yet” — stale.

## Finding 4 — Product strengths / weaknesses (preview)

Strengths: single-origin enforcement in browser; unknown ≠ zero (0.7.0 `chains[]`); no injected provider; no client RPC; keys never fetched.

Weaknesses: `eva` comment; RAM-only session on `main`; Base reads fail at the edge (honest `unknown`, but no Base rows); catalogue-only holdings; no §3.1 session auth; spec’d swap/Solana unread; XSS = in-memory keys; extension version drift; public git still names icehut/eva in CHANGELOG/deploy.

## Updated remaining plan

1. Expand `app_test.js` hygiene (RED: `eva` in `index.html`; GREEN: rewrite the comment without a backend name). RFC1918 + `.local` + internal names + extra origins. Run `node app_test.js`, capture `{SCRATCH}/app_test.log`.
2. Write `docs/reviews/2026-09-14-technical-review.md` and `docs/security/2026-09-14-security-audit.md` from this research (not from old reviews). Commit.
3. Re-run tests; `rg` hygiene into `{SCRATCH}/hygiene-rg.log`; Complete commit; push PR.

Remediations in the documents stay recommendations except the `eva` comment, which the hygiene test requires to be gone.
