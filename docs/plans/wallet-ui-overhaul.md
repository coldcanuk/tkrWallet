# tkrWallet — Mobile-first Wallet UI Overhaul + Swap Edge

> **SUPERSEDED.** The operator has redirected tkrWallet from tkrShell (v1) to the
> **Scratchpost** backend. The authoritative plan is now
> [`scratchpost-wallet.md`](./scratchpost-wallet.md). This document is retained
> for its tkrShell/tickerpicker research (the CORS gap, the duplicate-`ACAO`
> bug, the `/v1/*` allow-list), which remains accurate and is still useful
> background for the divorce.

**Status:** superseded — see `scratchpost-wallet.md`. No implementation work has begun.
**Supersedes:** the current card-list UI in `index.html` / `app.js`.
**Research basis:** `tkrWallet@c4e5153`; `tickerpicker@origin/main ab8942c`;
`blockchain-infrastructure@main 0207ff8`.

---

## 0. Corrections and revision caveats — read this first

### 0.1 The `tickerpicker` working tree is 145 commits stale

On-disk `main` is `ff3f353`; `origin/main` is `ab8942c`. Everything tkrShell
lives only at `origin/main`:

- `internal/tkrshell/` (`allow.go`, `decision.go`, `ratelimit.go`, `server.go`)
- `docs/tkrshell/{README,SECURITY,tkrshell.mmd}`
- the `/v1/*` verbs tkrWallet calls

Grepping the on-disk tree for `hosted` or `v1/snapshot` returns **nothing**,
which is actively misleading. All tkrShell findings below were verified against
`origin/main` with read-only git plumbing (`git show origin/main:<path>`).

**Action required before implementation:** pull `tickerpicker` to `ab8942c`.

### 0.2 Two premises from earlier analysis are wrong

These were derived from the stale checkout and are corrected here:

| Earlier claim | Correct position at `origin/main` |
|---|---|
| *"`SWAP_LIVE` is unset, so mainnet swaps return 422 and live swapping is impossible."* | **WRONG.** `docker-compose.yml:35` is `${SWAP_LIVE-true}` — **live mainnet swapping is the default when the variable is unset.** Only the stale tree had `${SWAP_LIVE:-}`. `docs/tkrswap/swap-flow.md:112` and the desk copy at `swap_workspace.go:159` still say "unset / 422" and are themselves stale. |
| *"`SOLANA_CHAIN = 900001` is an undocumented magic sentinel with no shared definition."* | **WRONG.** `internal/quote/lifi.go` defines `ChainSolana int64 = 900_001`, identical to tkrWallet's constant. It is a deliberate repo-wide sentinel. Sui is `927` (dest-only). Prior review finding **F7 is retracted.** |

`blockchain-infrastructure` also carries stale swap copy, but its own
`SWAP_LIVE` reading is moot — the flag lives in the tickerpicker compose file.

### 0.3 A subagent conclusion to discard

A deep-dive reported that `/v1/snapshot` and `/v1/hosted-wallet/attach` "have no
implementation in either tree." That was an artifact of the stale checkout.
Both exist at `internal/tkrshell/allow.go` (lines 60 and 64).

---

## 1. Objective

Replace the current single-page link list with a **mobile-first, Phantom-style
self-custody wallet** shipping as both a PWA and an MV3 Chrome extension from one
tree, preserving the repository's existing security invariants.

1. **New UI.** Target layout (operator mockup):
   ```
   tkrWallet                        [wordmark + search]
   {account}                        [account chip]
   Wallet Value  $0.00  [USD|CAD]   [value block + currency toggle]
   [ Send ][ Swap ][ Receive ][ Buy ]
   Tokens
     SOL        0.12345
     Ethereum   0.12345
     Base       0.34567
     Robinhood  0.45678
   [Home] [Swap] [Activity] [Search]
   ```
2. **Rip out Beaver Nickels** — client, tests, docs. Not deprecate: remove.
3. **Swap tab, under construction**, with its backend edge specified now.

---

## 2. What the research established

### 2.1 The swap engine already exists and is already shaped for this wallet

tkrShell at `origin/main` is an allow-list reverse proxy
(nginx → tkrShell `:8088` → tickerpicker `:8080`) that already exposes the swap
surface (`internal/tkrshell/allow.go:53-66`):

```
GET  /v1/quote        → /api/quote
POST /v1/swap         → /api/swap
GET  /v1/swap/status  → /api/swap/status
POST /v1/swap/batch   → /api/swap/batch
POST /v1/swap/fusion  → /api/swap/fusion
POST /v1/auth/nonce   → /auth/wallet/nonce
POST /v1/auth/session → /auth/wallet/verify
GET  /v1/snapshot, /v1/index-cards, /v1/scoreboard, /v1/beavercoin → /api/public/game
POST /v1/hosted-wallet/attach
```

The engine behind it is **already architecturally correct for a self-custody
wallet**:

- Six vendor quote clients, credentials server-side in `/run/secrets/*`:
  Li.Fi, 1inch, 0x, Uniswap, Coinbase (same-chain EVM) + Jupiter (Solana);
  Li.Fi alone for cross-chain and Robinhood destinations.
- `GET /v1/quote` returns `{quote, tx, approve?, contracts?}` where `tx` is
  **unsigned**: EVM calldata, a base64 Solana transaction, or EIP-712 typed
  data depending on `tx.kind`.
- **The client always signs.** `eth_sendTransaction` (EVM), Phantom
  `signAndSendTransaction` (Solana), `eth_signTypedData_v4` (Fusion),
  `personal_sign` of a canonical intent (books). **There is no server-side
  signing and no key custody anywhere.**
- `GET /v1/swap/status` polls fill status.
- `900001` (Solana) matches tkrWallet exactly, and a `batch_card`/`mode`
  deep-link handshake already exists in both directions.

**Conclusion: the swap logic does not need to be built. Transport and auth are
the blockers.** That is a far smaller project than it first appeared.

### 2.2 The actual blockers

**(a) The swap verbs are not CORS-open.** tkrShell sets CORS for exactly two
families:

```go
// internal/tkrshell/server.go:131-135
if got.Family == FamIndex || got.Family == FamHosted {
    allowPublicCORS(sw)
    if r.Method == http.MethodOptions { sw.WriteHeader(http.StatusNoContent); return }
}
```

`FamQuote` and `FamSwap` are excluded, and their method sets omit `OPTIONS`.
So `GET /v1/quote` gets no `Access-Control-Allow-Origin`, and `POST /v1/swap`
dies at preflight with a 404.

**(b) There is no credential that works cross-origin.** The session is the
`tickerpicker_session` cookie, `HttpOnly; Secure; SameSite=Lax`. There is **no
bearer-token, API-key, or HMAC path for inbound callers anywhere** in
tickerpicker — every `Authorization` in the tree is *outbound* to a vendor. And
`Access-Control-Allow-Credentials` is never set, so `ACAO: *` can never carry
credentials. A `github.io` PWA is third-party; the cookie will not travel.

**(c) The swap endpoints are gated.** `/v1/quote` requires a session **and a
linked wallet** — `resolvePayer` (`payer.go:45-63`) requires `from_address` to
equal the session's linked wallet, else 422. `/v1/swap` requires session +
compliance `Clear` (else 403). `/v1/swap/batch` additionally requires a **paid**
tier (else 402).

**(d) There is no public price endpoint.** Prices exist in SQLite but are only
rendered into the HTML `/portfolio` view. No JSON route, and **no CAD/FX source
anywhere**.

**(e) There is no transaction-history API** for a self-custody wallet.

### 2.3 A newly found bug that breaks calls tkrWallet makes *today*

tkrShell pre-sets CORS on the shared `ResponseWriter` **before** proxying, and
Go's `httputil.ReverseProxy` merges upstream headers with `Add`, not `Set`:

```go
// /usr/local/go/src/net/http/httputil/reverseproxy.go:352-358  (verified)
func copyHeader(dst, src http.Header) {
    for k, vv := range src {
        for _, v := range vv { dst.Add(k, v) }   // append, not replace
    }
}
```

Both upstream handlers also set `Access-Control-Allow-Origin`
(`internal/web/public_game.go:26-30` and `:74-78`). The result is a
**duplicated** header:

```
Access-Control-Allow-Origin: ["*", "*"]
```

**Browsers reject a multi-valued `ACAO`.** Consequences:

- `GET /v1/snapshot` and `POST /v1/hosted-wallet/attach` are **broken
  cross-origin**.
- `GET /api/public/game` **works** — it is `FamDesk`, so tkrShell does not
  pre-set, and the upstream's single `ACAO: *` survives.

**This precisely explains why tkrWallet's `loadGame` only ever succeeds via its
fallback**, and why `attachHosted` shows "tkrShell unreachable" rather than the
401 the server actually sends. The existing Go tests miss it because
`Header().Get()` returns only the first value.

*(Reproduced in an isolated harness that mirrors `server.go:131` +
`httputil.ReverseProxy`; **not** yet confirmed against the live deployment. One
live request with `Origin: https://coldcanuk.github.io` settles it — see M6.0.)*

### 2.4 Backend findings that constrain real execution

From `blockchain-infrastructure` — the broadcast + token-safety half:

| Finding | Impact |
|---|---|
| `caesar/rpc-gateway` (`:8799`) is the broadcast path: one write method `eth_sendRawTransaction`, 16 read methods, hard reject-list, default-deny. Correct model: client signs, backend never holds keys. | Reusable. |
| **Chain selection is broken for writes.** `upstreamFor()` reads `params[0].chainId`, but `eth_sendRawTransaction` takes `params[0] = "0x…"`. Empirically a real raw tx **always routes to Ethereum**, so a Base swap would be broadcast to Ethereum. | **Blocker.** Needs an out-of-band selector. |
| **`X-Forwarded-For` bypasses the write allowlist.** `peerIp()` trusts element `[0]`; the nginx template propagates the client's value. Demonstrated 403 → 200. | Fix before any exposure. Latent today (loopback-only). |
| rpc-gateway has **no auth, rate limits, CORS, or body cap**. `caesar/api` is **GET-only** (405 for POST) with no OPTIONS handler. | The bridge goes in tkrShell; `:8799` stays loopback. |
| `AGENTS.md:42` forbids a public surface for RPC; `SECURITY.md:55` requires Desch review + Charles auth for a new public hostname. | **Do not publish `:8799`.** Reach it over loopback from tkrShell. |
| `security-worker` is a Redis-stream consumer, not HTTP. It **cannot quote** (hardcoded `amountOutMin = 0n`, mainnet-hardcoded router/WETH) but **can** return `SAFE/WATCH/DANGER/FATAL`. | Useful as a pre-sign safety gate, not a router. Needs extraction into a callable module. |
| No payment/billing logic exists in the backend at all. | tkrWallet's *"Paid tkrSwap is required…"* copy (`app.js:389`) has no backend counterpart. |
| Doc drift: `security-worker/README.md` advertises live Blockscout/Uniswap enrichment, but `main.ts` never injects `HttpEnrichment` → always `MockEnrichment`. | Do not rely on enrichment. |
| Alchemy and Helius are **not called from Go at all** (Rust solver only; reserved for unfunded books). | Not part of the client path. |

### 2.5 Smaller findings worth acting on

- **`/api/intent` is a submission endpoint, not a quote builder.** It forwards an
  already-signed intent to the solver and returns the solver's status. It returns
  no quote, calldata, or route plan.
- **The solver gate is fail-open.** `solver_token_ok` returns `true` when its
  expected token is empty, and `scripts/update.sh:91` sources it with
  `|| echo ''`. A missing `pass` entry means unauthenticated intents are
  accepted silently.
- **`/internal/compliance/decision` has no caller authentication** — it is off
  the public allow-list but reachable on the Compose network.
- **Tron `728126428` is UI-only**; there is no server adapter and tests assert
  its rejection. Do not promise Tron.
- **Robinhood Chain is `4663`**, tokens `{ETH, USDG, HOOD}`. **This resolves open
  decision D3.** Note: subagent research indicates the chain's RPC hostname is
  `rpc.mainnet.chain.robinhood.com`; confirm before hardcoding any address.
- **Hosted attach is confirmed unauthenticated by design** (anonymous 401 →
  unpaid 402 → paid 501 plan-only), matching tkrWallet's existing code. The
  prior review's `[needs tkrShell confirmation]` is resolved. With the
  duplicate-`ACAO` bug in §2.3, the wallet currently shows "unreachable" instead.

### 2.6 Frontend platform facts

- **MV3 popup cap is 800×600 px**; comfortable range **360–400 px wide**, so a
  360 px phone layout serves both targets.
- **Tailwind must be compiled, not CDN** — MV3 enforces `script-src 'self'` and
  `'unsafe-inline'` cannot be re-enabled.
- **Tailwind v4 is CSS-first** (`@import "tailwindcss"` + `@theme`, standalone
  `@tailwindcss/cli`) — no PostCSS, no JS config.
- **iOS PWA safe areas** need `viewport-fit=cover` + `env(safe-area-inset-*)`
  and `height: 100vh`.

---

## 3. Architecture decisions

### 3.1 Keep it vanilla, zero runtime dependencies

No React/Vue/router. MV3 forbids remote code; the extension loads **unpacked
from the repo root**, so everything that ships must be in the tree and readable;
and `app.js`'s Node export (`app.js:506-509`) is why a test suite exists at all.

The UI improves *structurally*: an HTML `<template>` per screen, cloned by JS,
filled with `textContent`. Preserves the no-XSS property (no `innerHTML` in the
tree) and keeps every Tailwind class statically visible to the scanner.

### 3.2 Commit the compiled CSS; keep the build out of the extension

```
package.json         # scripts only, NO dependencies → no root node_modules
tools/package.json   # devDependencies: tailwindcss, @tailwindcss/cli
tools/src/app.css    # @import "tailwindcss"; @theme { ... }
app.css              # COMMITTED build output, loaded by index.html
```

The root `package.json` deliberately has **no dependencies**, so `node_modules`
never sits beside `manifest.json` and never bloats the unpacked extension. CI
regenerates `app.css` and fails if the committed copy is stale.

### 3.3 Fix the review findings while we are in these files

The overhaul rewrites `app.js`, `index.html`, `sw.js`, and `manifest.json`
anyway: **F3** (SVG extension icon), **F5** (service-worker staleness), **F6**
(inline script vs. MV3 CSP), **F1** (RPC failure must not render as zero),
**F2** (unsupported chains must not borrow mainnet addresses). **F7 is
retracted** (§0.2).

---

## 4. Milestones

### M0 — Guardrails and build skeleton
- `package.json` (scripts only) + `tools/package.json` (Tailwind v4 CLI);
  `tools/src/app.css`; commit `app.css`; `.gitignore` `tools/node_modules`.
- GitHub Actions: `node app_test.js` + a CSS-freshness check on every PR.
- Convert `app_test.js` into a named-test harness that aggregates failures.
- **Exit:** CI green; `app.css` reproducible; `npm test` works.

### M1 — Design system and app shell
- `@theme`: dark-first palette, radii, spacing, type scale, safe-area spacing.
- Shell: sticky header, scroll region, fixed bottom nav.
- Hash routing (`#/home`, `#/swap`, `#/activity`, `#/search`) with back-button
  and deep-link support.
- Safe areas: `viewport-fit=cover`, `env(safe-area-inset-*)`, `100vh`.
- Extension popup: `width: 360px`, `max-height` 560 px, internal scroll.
- Accessibility: 44 px targets, focus-visible rings, `aria-live`, `role="tablist"`.
- **Exit:** four screens render; nav works; no horizontal scroll at 320 px;
  popup correct at 360×560; Lighthouse a11y ≥ 95.

### M2 — Home screen, data layer, Beaver Nickels removal
- `wallet.js`: per-chain holdings, caching, currency formatting, explicit
  `{ value } | { unknown }` results (**F1**).
- Chain catalog for `1`, `8453`, `4663`, `900001` (+ testnets); uncatalogued
  chains degrade to native-only (**F2**).
- Token rows: icon, name, chain badge, amount, fiat value. Robinhood tokens
  `{ETH, USDG, HOOD}`.
- States: loading skeleton, empty, partial-failure, total-failure.
- **Beaver Nickels removed** from `renderBeaver`, `applyGame`, `index.html`,
  `app_test.js`, `README.md`, `docs/systems/*`, both manifest descriptions.
  The backend verb `GET /v1/beavercoin` **stays**; `/v1/snapshot` keeps sending
  `beaver_nickels` and the wallet ignores it. **Client-only removal.**
- **Game-pane source:** given the duplicate-`ACAO` bug (§2.3), `/v1/snapshot` is
  the broken path and `/api/public/game` is the working one. Keep the fallback,
  but surface the failure distinctly instead of silently masking it.
- **Exit:** no `beaver` string in the tkrWallet tree; tests updated.

### M3 — Prices and wallet value (new backend edge)
- **Edge spec** (tkrShell PR): `GET /v1/prices?assets=<chain:addr,…>&vs=usd,cad`
  — public CORS, no session, strict rate limit, `{asset, usd, cad, as_of}`,
  server-side FX for CAD.
- Client: fetch prices for held assets, compute total, USD/CAD toggle persisted.
- Until the edge ships: render `—`, **never** `$0.00`.
- **Exit:** value correct for a known wallet; unpriced assets excluded and
  disclosed.

### M4 — Receive and Send
- **Receive** — per-chain address, copy, QR via a **vendored MIT** generator
  (remote scripts are impossible under MV3); license verified and pinned.
- **Send** — the largest new security surface:
  - asset/amount form with balance and fee display;
  - explicit confirmation showing chain, recipient, amount, estimated fee — no
    default-filled recipient;
  - EVM `eth_sendTransaction` via injected provider; Solana
    `signAndSendTransaction` via Phantom;
  - never auto-retry, never auto-execute, no unlimited-approval flow;
  - format/checksum validation and a first-time-recipient warning.
- **Exit:** testnet send completes; dedicated security review before merge.

### M5 — Swap tab (client) — under construction
- **UI:** token-in/token-out selectors, amount, an honest "Under construction"
  panel, and an "Open tkrSwap desk" deep link. No fake quote.
- Ships disabled **because of the transport/auth gap (§2.2)** — not because
  swapping is off. Live mainnet swapping is already the default (§0.2).
- **Exit:** rendered and reviewed; nothing implies a working quote.

### M6 — Swap edge (backend, separate repos, operator-gated)

**M6.0 — One live probe, first.** Send a single request to
`https://tkrpik.com/v1/snapshot` with `Origin: https://coldcanuk.github.io` and
inspect the raw `Access-Control-Allow-Origin`. This confirms or refutes §2.3 in
one step and decides whether the existing game pane is also broken.

**M6.1 — Fix the duplicate-ACAO bug.** Set CORS headers *after* proxying (e.g.
in `ReverseProxy.ModifyResponse`) instead of pre-setting on the shared writer;
keep the OPTIONS short-circuit. Add a test asserting
`len(Header().Values("Access-Control-Allow-Origin")) == 1`. **This restores
`/v1/snapshot` and hosted attach for the PWA — i.e. it fixes functionality
tkrWallet already has, not just swaps.**

**M6.2 — Open CORS + OPTIONS for `FamQuote` and `FamSwap`**, mirroring the
existing `FamHosted` handling, with `OPTIONS` added to those method sets in
`allow.go`. Origin-specific with `Vary: Origin`, and
`Access-Control-Allow-Headers` must include `Authorization`.

**M6.3 — Add a wallet-scoped bearer token.** Mint via the existing
`/v1/auth/nonce` + `/v1/auth/session` challenge; check it in a new middleware on
`/v1/quote` and `/v1/swap*`. This is the only clean fix — `ACAO: *` plus
`SameSite=Lax` cannot authenticate a third-party origin, and third-party cookies
will keep degrading. The `x-api-key`/Bearer + SHA-256 pattern in
`blockchain-infrastructure` `caesar/api` is a usable model.

**M6.4 — Harden the broadcast bridge.** Keep `:8799` loopback-only; reach it
from tkrShell. First fix: the **`X-Forwarded-For` trust bug**, the **broken
chain selector for `eth_sendRawTransaction`**, and add a **body cap, rate limit,
and idempotency**. Without these, a Base swap is broadcast to Ethereum and the
write allowlist is forgeable.

**M6.5 — Optional, high value: pre-sign safety gate.** Extract
`runSimMatrix` + `bandFor` from `security-worker` into a callable module and
expose a band lookup so the wallet can show `SAFE/WATCH/DANGER/FATAL` before the
user signs. Fix the mainnet-hardcoded router/WETH for Base.

Also: Desch/Charles sign-off (`SECURITY.md:55`); a tier→band policy (does not
exist); and bind the Swap tab to the **linked wallet**, since `resolvePayer`
rejects any other `from_address` (422).

- **Exit:** spec published as `docs/swap-edge.md`; implementation tracked in
  `tickerpicker` / `blockchain-infrastructure`, not this repo.

### M7 — Activity and Search
- **Activity** — no indexer exists, so v1 is **local-first**: an IndexedDB log
  of transactions this wallet builds and submits, with provider status and a
  "local history only" disclosure.
- **Search** — filter the asset catalog and holdings; plus a **Discover**
  section carrying the tkrpik index cards and scoreboard (see D2).

### M8 — Packaging, PWA polish, docs
- PNG icons 16/32/48/128, `action.default_icon`, popup sizing (**F3**).
- `sw.js`: `activate` cleanup, `skipWaiting`, `clients.claim`, network-first for
  `app.js`/`app.css`/`index.html`, same-origin GET scoping (**F5**).
- `index.html` CSP-clean, no inline script (**F6**).
- PWA: manifest review, install prompt, offline shell.
- Docs: `README.md`, `docs/systems/README.md`, `docs/systems/tkrwallet.mmd`
  (fix the stale `adb19bd` pin — **F14**), new `docs/swap-edge.md`.
- Verification: load unpacked, popup + icons + a real connect; iOS Safari.
- **Exit:** full manual pass plus automated suite on both targets.

---

## 5. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Theme. Phantom is violet-on-near-black. | **Dark-first** with the existing warm tkr palette (charcoal `#1c1917`, warm amber/copper) rather than Phantom's violet — keeps brand identity, avoids cloning a competitor's trade dress. |
| **D2** | Index cards + scoreboard have no place in the new nav. | Move under **Search → Discover**. Preserves the funnel; drops nothing. Given §2.3 they are currently fetched via the broken `/v1/snapshot` path, so M6.1 should land first. |
| **D3** | ~~Robinhood chain id~~ | **RESOLVED: `4663`**, tokens `{ETH, USDG, HOOD}`. Confirm the RPC hostname before hardcoding an address. |
| **D4** | Price source for wallet value. | Build the **M3** edge. Until then render `—`, never `$0.00`. |
| **D5** | Is **Send** in scope now? | Yes as its own milestone (M4) with a security review — it is the first code in this repo that broadcasts. If you would rather not widen the signing surface, M4 ships Receive-only and Send becomes under-construction. |
| **D6** | Buy. | No fiat provider and no billing logic exists; the README forbids embedding Stripe. External hosted link, labelled under construction. |
| **D7** | Activity data. | Local-first IndexedDB log with an explicit disclosure. Do not imply complete history. |
| **D8** | **The big one.** An in-app swap reverses `app_test.js:26` (`/api/quote` must not appear) and `tickerpicker/docs/tkrswap/tkrwallet.md:10` (*"the wallet does not shop vendors"*). | **(a) Target:** wallet becomes a thin authenticated client of the existing `/v1/quote` + `/v1/swap`, and the invariant test is rewritten deliberately, not deleted. **(b) Interim:** the Swap tab stays a deep-link launcher. **Recommend (a) as target, (b) shipping today.** The research strengthens (a): the engine already returns unsigned calldata and never signs. |
| **D9** | Who owns the M6 backend PRs? | They land in `tickerpicker` and `blockchain-infrastructure`, outside this repo. tkrWallet stays client-only. Needs an owner and sequencing. |

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Duplicate `ACAO` (§2.3)** | Breaks `/v1/snapshot` and hosted attach for the PWA **today** | M6.0 confirms; M6.1 fixes. Independent of the swap work — this is a live regression in existing functionality. |
| **No cross-origin credential** | The swap surface is unreachable from the PWA | M6.3 bearer token. Extension works meanwhile via `host_permissions`. |
| **`X-Forwarded-For` bypass** | Write allowlist forgeable once exposed | Fix before any exposure. Latent today (loopback only). |
| **Broken chain selector** | Base swaps broadcast to Ethereum | Out-of-band chain selection before the edge goes live. |
| **`resolvePayer` wallet binding** | Any non-linked `from_address` → 422 | Bind the Swap tab to the linked wallet; document it. |
| **Stale backend checkout** | Research and implementation against the wrong revision | Pull `tickerpicker` to `ab8942c` first. |
| Send is a new signing surface | A bug moves user funds | Dedicated milestone, explicit confirm, no auto-execute, testnet-only first. |
| Trademark / trade dress | Cloning Phantom invites a complaint | D1: emulate the *pattern*, not the palette or logo. |
| Committed CSS drift | Classes used but absent from `app.css` | CI freshness check in M0. |
| Scope growth | "Nice wallet" is unbounded | Milestones are independently shippable; D5/D2/D8 let scope shrink without rework. |

---

## 7. What I need from you

1. **Approve the plan** (or reorder the milestones).
2. **D8** — in-app swap via the existing tkrShell edge, or deep-link to the desk?
3. **D5** — Send in scope now, or under construction alongside Swap?
4. **D1** — theme direction (warm-dark vs. Phantom-violet).
5. **D9** — who owns the `tickerpicker` / `blockchain-infrastructure` PRs, and
   should I draft the M6 edge spec now?
6. **Authorisation to run the M6.0 live probe** (one request with a custom
   `Origin` header — no data written, no transaction).

Everything else proceeds on the recommended defaults.
