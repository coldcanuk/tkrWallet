# tkrWallet → Scratchpost — Repurposing Plan

**Status:** draft for operator approval. No implementation work has begun.
**Supersedes:** `docs/plans/wallet-ui-overhaul.md` (the tkrShell-based plan).
**Research basis:** `tkrWallet@c4e5153`; `blockchain-infrastructure@0207ff8`
(Scratchpost); `tickerpicker@origin/main ab8942c` (v1, being divorced).

---

## 0. The pivot, stated plainly

| | v1 (today) | v2 (target) |
|---|---|---|
| Backend | `tickerpicker` / `tkrshell` — aggregator-era | **Scratchpost** (`blockchain-infrastructure`) |
| Shell | tkrShell, an allow-list proxy to an aggregator | **retired** |
| Wallet talks to | `https://tkrpik.com/v1/*` | the Scratchpost **edge** (does not exist yet — §2) |
| Routing | six vendor quote clients in `tickerpicker` | **does not exist yet** (§6.1) |
| Chain truth | third-party RPC + vendor APIs | **own pruned Reth (ETH) + Base + op-node** |

The wallet's core invariants survive the move unchanged, and that is not a
coincidence — Scratchpost's charter states the same rule for every customer
(`docs/CHARTER.md:19`):

> "Backend is the **sole third-party connector**: the customer never holds vendor
> secrets or makes vendor calls."

That is exactly tkrWallet's existing contract. The v1 architecture was compatible
in principle; what broke it was the vendor-shopping layer, not the wallet.

---

## 1. What Scratchpost actually is

From `docs/theticker/SCRATCHPOST.md` and `docs/ARCHITECTURE.md`:

```
Blockchain / third-party world
            │
            ▼
         BACKEND            caesar: ingest → SQLite (WAL, SoT) → Redis streams → workers
            │
      one contract          REST + SSE
            │
            ▼
         ICEPIKE            customer UA
```

- **`eva` (`192.168.1.79`)** — chain plane. Reth (Ethereum mainnet, **pruned**) +
  Lighthouse; Base execution (**pruned**) + op-node. ETH `:8545`/`:8546` WS,
  Base `:9545`/`:9546` WS. (`docs/ARCHITECTURE.md:37-38`)
- **`caesar`** — brain. SQLite SoT (`brain.sqlite`, WAL), Redis streams
  `6380–6383`, workers, backend API on loopback `:8791`.
- **B2B edge** — `ticker-b2b-radar.conf.template` listens `192.168.1.254:8790`
  → `127.0.0.1:8791`, serving `GET /v1/radar`, `GET /api/v2/*`, `GET /events`
  (SSE). Header: **"LAN/VPN only; no CF"**. Non-GET → 405 at nginx.
- **IcePike UA edge** — `icepike-desk-ua.conf.template`, `192.168.1.254:443`,
  TLS, `server_name icepike.onerelay.app`, proxies `/`, `/events`,
  `/api/nouveau*` → `127.0.0.1:8788`.
- **`scratchPost.ai` is meta-only.** `SCRATCHPOST.md:4` — not a hostname, not a
  TLS name, not an API base. **Do not build against it.**
- **There is no Scratchpost portal.** IcePike is UA #1. tkrWallet would be UA #2 —
  a new architectural fact that should be recorded as such.

### 1.1 The API surface, precisely

`caesar/api` (`:8791`) is a **read-only, per-organisation B2B feed**.

- **Verbs:** ~25 `GET` routes — `/api/v2/{protocol,health,me,customers,
  launches,entities,security,markets,candles,pulse,atlas,signals,token}`,
  `/v1/radar`, `/events` SSE. **There is no POST/PUT/PATCH/DELETE anywhere.**
- **Auth:** `x-api-key` or `Authorization: Bearer` → SHA-256 against
  `customers.key_hash` (`shared/brain-sot/customers.ts:54-63`). Absent/invalid →
  `{customer_id: "anonymous", tier: "Basic"}`. `?tier=` and `x-customer-tier`
  cannot upgrade identity.
- **GET-only, enforced before everything:** `routes.ts:236-239` returns 405 for
  any non-GET — **including `OPTIONS`**.
- **CORS reality:** `access-control-allow-origin: *` is the **only** CORS header.
  `Allow-Methods`, `Allow-Headers`, `Allow-Credentials`, `Max-Age`, and `Vary`
  are all absent. `caesar/nginx/*` sets **no CORS header at all**.
- **No public route exists.** The only public template
  (`tickerpicker.conf.template`, `:80`, `tkrpik.com`/`tkrswap.com`) points at
  `tkrshell:8088` — **not** at `caesar/api`. Every template that reaches
  `:8791` binds a LAN address.
- **Tiering** works and is enforced at serialization (hidden fields are deleted,
  not renamed). **Metering** writes `usage_delivery`.
- **Quotas are documented but not enforced.** No `429` logic exists;
  `ENTITLEMENTS.md:48-62` describes counters for reconciliation only. There is
  **no billing or payment code anywhere** in the tree.
- **One inconsistency to adjudicate:** `ENTITLEMENTS.md:40` says `SECURITY_` is
  BLOCKED for Basic, and `signalAllowedForTier` enforces that in
  `/api/v2/signals` — but `/api/v2/security/:token` returns `band` +
  `observed_at` to Basic. The inline comment suggests intent. Flagged, not
  called a leak.

---

## 2. Topology — evaluating `wallet <-> nginx <-> nginx <-> scratchpost`

**Short answer: the nginx↔nginx spine is right, and it is already your charter
(`docs/CHARTER.md:17`: "**One** connection: UA → theTicker (B2B nginx↔nginx)").
Keep it. But it does not work as drawn, and the blockers are not network
topology — two nginx hops cannot fix any of the four things below.**

The two-hop pattern is a legitimate DMZ-reverse-proxy → internal-service shape,
and it is what this repo already does for server-to-server consumers. It solves
*network placement*. A browser wallet needs four more things that no nginx
template here provides, and that this backend does not provide anywhere.

### 2.1 A browser physically cannot reach the LAN face

Chrome implements **Private Network Access**: a public-origin page fetching a
private-network address is blocked, and the preflight must be answered with
`Access-Control-Allow-Private-Network` ([Connect CORS notes](https://connectrpc.com/docs/cors/)).
`:8790` is `192.168.1.254`. The wallet can never talk to it directly.

### 2.2 A browser cannot hold a Scratchpost API key

Public clients — browsers, extensions, mobile apps — cannot keep secrets;
anything shipped is extractable ([BFF rationale](https://securityboulevard.com/2026/01/stop-leaking-api-keys-the-backend-for-frontend-bff-pattern-explained/)).
A key in a GPLv3 public repo is a published key.

**And the tempting shortcut is the dangerous one.** If auth is "solved" by having
the edge inject `x-api-key`, then every anonymous internet caller becomes an
authenticated customer. With a Super Pro key that is total entitlement bypass
plus unmetered billing. The current absence of key injection in every nginx
template is **correct** and must be preserved.

### 2.3 The authenticated call cannot even complete

`x-api-key`/`Authorization` are **non-simple** headers → the browser preflights
with `OPTIONS` → `caesar/api` returns **405** with no `Allow-Methods`/
`Allow-Headers` → the real request is never sent. Verified call matrix from
`https://coldcanuk.github.io`:

| Call | Result |
|---|---|
| Simple GET (`/api/v2/launches`, `/v1/radar`, `/api/v2/markets`, `/api/v2/pulse`) | succeeds — as `anonymous`/`Basic` |
| GET with `x-api-key` or `Authorization` | **FAILS** — preflight 405 |
| `EventSource('/events')` | succeeds, unauthenticated |
| `/api/v2/security/:token/wallets.csv` | **FAILS even unauthenticated** — that branch omits `ACAO` entirely |

**An authenticated browser call is impossible today.** The identical failure mode
hit the Esplora API: *"no CORS headers and no OPTIONS route, so browser-based
wallets cannot use it"* ([reference](https://github.com/gosuda/bitcoin-rs/issues/670)).

**The test suite structurally cannot catch this.** `caesar/api/prove.ts` uses
Node's `fetch`, and **Node does not enforce CORS**; the suite never issues an
OPTIONS request. Any real verification must come from a browser or an explicit
CORS assertion.

### 2.4 Cross-origin cookies are a dead end

Any `SameSite=Lax` session cookie from a different origin is third-party, and
those are being removed by Chrome and Safari. A plan that depends on it is a plan
to break later.

### 2.5 The recommendation: make the wallet same-origin with its API

**Serve the PWA from the same origin as the edge it calls.** One move eliminates
CORS, preflight, third-party cookies, and the Private Network Access problem
together — and makes an `HttpOnly; SameSite=Strict` cookie usable again, which is
the recommended session mechanism because it keeps tokens out of JavaScript.

```
   Browser (mobile-first PWA + extension)
        │  same origin — no CORS, no preflight
        ▼
   wallet edge nginx        public, TLS, HSTS, per-IP limit_req, static assets
        │                   serves /<static>  AND  proxies /api/*
        ▼
   wallet facade            wallet auth, allow-list, per-wallet limits, prices
   (damshell, §3)           holds the backend API key SERVER-SIDE
        │  loopback
        ▼
   caesar/api :8791         reads
   caesar/rpc-gateway :8799 signed raw tx only
        │
   B2B nginx :8790           LAN/VPN, unchanged
```

This keeps your spine, keeps the brain off the public internet, and is the
arrangement browser wallets actually use. Mature architectures run the BFF
*behind* the gateway, with the gateway handling infrastructure concerns. The
GPLv3 obligation is unaffected: the source stays public on GitHub; only the
*served* copy moves to your edge.

### 2.6 This is currently blocked by policy, not engineering

The wallet is a **new browser-facing surface**, which is precisely the class
these rules forbid:

- `AGENTS.md:42-43` — *"No Cloudflare/public surface for brain, ingest, SSE, B2B,
  RPC, or webhook delivery. LAN/VPN only; eva-IP-only allowlists."*
- `SECURITY.md:55` — *"This backend must not expose a new public hostname without
  Desch review + Charles auth."*
- `SECURITY.md:56` — *"IcePike UA is the browser-facing surface; B2B nginx is
  lab/VPN only unless Fog + Desch lock otherwise."*
- `SECURITY.md:57` — *"Asymmetric firewall: lab may initiate to edge; edge must
  not open NEW into lab without an explicit lock."*
- `docs/CHARTER.md:48` — *"Réjean HOLDs PRs that violate. Fog: no CF on
  brain/desk B2B; Redis not public."*

**Prerequisite M-1: obtain Desch review + Charles auth before any of this is
built.** Without it the plan is unimplementable, and it is better to discover
that now than after the UI is finished.

### 2.7 The exposure risk if `/api/v2/*` were simply published

An unauthenticated caller is `anonymous`/`Basic` and can read `/v1/radar`,
`/api/v2/launches`, `/api/v2/markets`, `/api/v2/atlas`, `/api/v2/pulse`,
`/api/v2/signals` (Basic-filtered), `/api/v2/security/:token` (band only),
`/api/v2/health`, and `/api/v2/protocol`. **That is the entire launch and market
feed, free.** Publishing the B2B face is not a neutral act.

---

## 3. Do you need `damshell`? — Yes, but not as a shell

You said you don't think you need a shell, and that if you do it should be called
`damshell`. My evaluation: **you need a small service, and nginx alone cannot
substitute — but the thing you need is a wallet *facade*, not a shell.** The
naming matters, because the v1 failure mode was scope creep into aggregation.

Four things are required and nginx cannot do any of them:

1. **Mint wallet identity.** Wallet-signature login (nonce → verify → session)
   needs application logic. nginx cannot verify an secp256k1/ed25519 signature.
2. **Hold the backend key server-side, or issue per-wallet tokens.** Either the
   facade holds the Scratchpost key and the wallet holds only a session, or
   Scratchpost grows per-wallet customers. Both need code. **Scratchpost's
   `customers` table is per-organisation** (`{id, customer_id, tier, key_hash,
   webhook_url, cidr}`), not per-wallet.
3. **Per-wallet rate limiting.** nginx `limit_req` is per-IP; carrier NAT breaks
   per-IP on mobile. There is **no rate limiting anywhere in this stack today** —
   not in `caesar/api`, not in any nginx template.
4. **Expose a wallet verb set the brain does not have.** Prices, broadcast, and
   status are not `/api/v2/*`.

**On `customers.cidr` as a wallet identity model: not viable.** The column exists
but is **never read for authorization**; the only `ipInCidr` implementation in the
repo is in `rpc-gateway` and reads its own option/env, not the table. CIDR is the
wrong primitive for mobile wallets anyway — no stable source IP.

### 3.1 What `damshell` must NOT become

The v1 lesson is specific: tkrShell was fine as a proxy and became a problem as
an **aggregator**. Write the prohibition into the repo before the code:

- **No vendor clients. No quote shopping. No Li.Fi/1inch/0x/Uniswap/Jupiter/
  Coinbase calls. Ever.**
- **No data duplication.** Sessions and rate-limit counters only. It is not a
  second source of truth and has no SoT database.
- **No keys, no signing, no custody.** It relays; the wallet signs.
- **A closed allow-list of verbs**, not a path-prefix passthrough. The
  `internal/tkrshell/allow.go` pattern (explicit routes, longest-match, default
  404) is the right design and is worth reusing — the *pattern*, not the purpose.

If that discipline holds, it is a facade. If it slips, it is tkrShell again.

---

## 4. What exists vs what must be built

| Capability the wallet needs | Status | Where |
|---|---|---|
| Chain truth (ETH + Base, own nodes) | **EXISTS** | eva Reth `:8545` / `:9545` |
| Token safety bands (pre-sign gate) | **EXISTS**, Redis-consumer only, mainnet-hardcoded | `caesar/security-worker` |
| Raw-tx broadcast | **EXISTS**, two defects (§6.2) | `caesar/rpc-gateway` `:8799` |
| Tier filtering + metering | **EXISTS** | `caesar/api`, `usage_delivery` |
| Intelligence REST | **EXISTS** | `caesar/api` `/api/v2/*` |
| Public route to any of it | **MISSING** — no public vhost reaches `:8791` | `caesar/nginx/*` |
| CORS + preflight for authed calls | **MISSING** | backend returns 405 to OPTIONS |
| Wallet-signature login | **MISSING** | no nonce/challenge/session route |
| Per-wallet identity | **MISSING** | `customers` is per-org; `cidr` is inert |
| Rate limiting / quota enforcement | **MISSING** | no limiter; no `429` logic anywhere |
| Billing / paid tier | **MISSING** | no payment code anywhere |
| **Price** endpoint, asset → USD | **PARTIAL** — USD only, embedded inside launch/market payloads | `/api/v2/markets`, `/atlas`, `/token`, `/v1/radar` |
| Price endpoint, asset → **CAD** | **MISSING** — no FX concept exists anywhere | grep `cad\|fx_rate\|exchange_rate` → zero |
| Balances over REST | **MISSING** (RPC only) | `eth_getBalance` in rpc-gateway allowlist |
| Transaction history / activity | **MISSING** — and constrained by pruning (§5) | — |
| **Swap routing / quoting** | **MISSING — see §6.1** | nowhere in Scratchpost |
| Fiat on-ramp (Buy) | **MISSING** | out of scope |

### 4.1 Two production drift findings to plan around

1. **`/events` SSE does not actually deliver data in production.**
   `caesar/api/src/main.ts:18-22` calls `startApiServer({db, host, port})`
   without passing `uiReader`, so the bridge gets `reader = null` and returns
   early — **only the initial ping and 15 s heartbeats are emitted.**
   `docs/B2B-nginx-hop.md:3-10` advertises a unified SSE stream; that is false in
   the deployed entrypoint. **The wallet must not depend on SSE for liveness.**
2. **Solana and Robinhood token/candle reads are not wired.**
   `/api/v2/token/{solana,robinhood}/…` returns
   `note:"vendor_reader_not_configured"` and SOL/RH candles return an empty
   series. Yet the mockup lists Sol and Robinhood rows — so those balances must
   come from the wallet's own RPC reads, not from this API.

---

## 5. The chain plane — pruning, and what it forbids

### 5.1 We do not actually know the prune profile

"Pruned" is asserted in **five places, all prose or diagrams** —
`docs/ARCHITECTURE.md:37-38`, `docs/theticker/ARCHITECTURE.md:90-91`,
`docs/graphs/theticker-canonical.mmd:8,13`, `docs/RETENTION.md:41`
("Keep **pruned node datadirs only**"), `eva/README.md:22`.

**The node flags are not in this repository.** The compose file that defines the
nodes lives on eva at `/opt/ethereum_production/docker-compose.yml`
(`eva/README.md:9`), and that path does not exist on this host. **Reth's own
default with no profile set is archive.** So while pruning is clearly the intent,
the *preset* is unverified — and the two built-in presets differ by ~150× on the
number that matters to a wallet:

| Preset | Receipt / log retention |
|---|---|
| `--full` | last **10,064** blocks ≈ **1.4 days** ETH, **~5.6 h** Base |
| `--minimal` | last **64** blocks ≈ **13 min** ETH |

**Do not hardcode a window.** Probe the horizon at runtime, or the wallet breaks
silently the day someone changes the flag.

### 5.2 Per-method reality (Reth's published support matrix)

| Method | Safe? | Note |
|---|---|---|
| `eth_chainId`, `eth_blockNumber`, `eth_gasPrice`, `eth_feeHistory`, `eth_maxPriorityFeePerGas`, `eth_getBlockBy*` | ✅ always | unaffected |
| `eth_sendRawTransaction` | ✅ always | pruning is irrelevant to broadcast |
| `eth_subscribe` | ✅ on the node | but unusable by the browser — §5.3 |
| `eth_getTransactionByHash` | ✅ always | `--full` leaves tx lookup *disabled* (unpruned) |
| `eth_getBalance`, `eth_getTransactionCount` | ⚠️ `latest` only | historical tags fail beyond the window |
| `eth_call`, `eth_estimateGas`, `eth_getStorageAt` | ⚠️ `latest` only | depend on account **and** storage history |
| **`eth_getTransactionReceipt`** | ⚠️ **recent only** | receipts segment — the wallet-relevant casualty |
| **`eth_getLogs`** | ⚠️ **recent only** | receipts segment, plus its own caps |

`eth_getLogs` has two independent limits: the **pruning horizon** (Reth rejects a
range reaching pruned history with `PrunedHistoryUnavailable`, EIP-4444) and
configurable caps (`100,000` blocks / `20,000` logs by default, which **reject
rather than truncate**). Under `--full` the pruning horizon binds first
(~10,064 ≪ 100,000).

One unresolved conflict worth probing: the official matrix marks `eth_getCode`
unaffected by account-history pruning, which is counterintuitive — resolving code
at a historical block should need that block's account state.

### 5.3 The wallet cannot subscribe to the nodes

The emitters already use `eth_subscribe` over `ws://192.168.1.79:8546` and
`ws://192.168.1.79:9546`. **The wallet cannot**, for two independent reasons:

1. **Mixed content.** A PWA served over HTTPS, and a `chrome-extension://` page
   (also a secure context), are both **blocked from opening an insecure `ws://`**
   endpoint. This is enforced by the browser, not a policy choice.
2. **They bind `0.0.0.0` on the LAN** (`OPERATIONS.md:13,15`) — not publicly
   routable.

So live updates must be **polling over HTTPS** or a **backend-proxied `wss://`**
through the facade. This is a design constraint for balance refresh and Activity,
not something the wallet can work around client-side.

### 5.4 Consequences for the wallet

- **Balances, token lists, and Wallet Value are safe** — current state only.
- **Send is unaffected.** `eth_sendRawTransaction` works regardless of pruning.
- **"What was my balance on date X" is impossible** against these nodes.
- **Activity cannot come from the chain.** Receipts and logs cover ~1.4 days on
  ETH and ~5.6 h on Base at best, and less under `--minimal`. Reth's docs are
  blunt: *"Pruning is destructive… Reth cannot serve that data again."* This
  independently confirms the **local-first Activity** design — the wallet must
  persist receipts itself when it sees them, or lose them.

### 5.5 Two open chain-plane questions

- **Base may be down.** Docs cite Base `:9545` as "RPC empty, snapshot
  re-downloading" (`P11-FINAL-REPORT.md:35,48`). The mockup has a BASE row, so
  confirm before planning around it.
- **The XFF pattern is in every nginx template**, so any future IP-based control
  on this stack inherits the same weakness as §6.2.

---

## 6. The two real gaps

### 6.1 Swap routing does not exist in the new stack

**Scratchpost has no router and no quote engine.** Verified by exhaustive search:
no `getAmountsOut`, no `getReserves`, no pool math, no DEX client. The only
Li.Fi/Uniswap artifacts are **pure normalizers that make no network call**
(`external-adapters/src/adapters/lifi.ts` takes an already-obtained quote payload
and emits analytics signals). All routing lives in
`tickerpicker/internal/quote/*` — **the v1 aggregator you are divorcing.**
`security-worker` cannot substitute: it simulates tokens but hardcodes
`amountOutMin = 0n` and a mainnet router, with no price math.

So the Swap tab is under construction because **the engine is on the wrong side
of the divorce**, not because of a feature flag.

| Option | Shape | Tradeoff |
|---|---|---|
| **A. On-chain routing on your own nodes** | Uniswap V2/V3 pool-state reads at `latest` against eva; quote locally; build the tx; `security-worker` band as pre-sign gate | Matches "our own system", no vendor keys. Largest build. Pruned nodes are fine for head-state pool reads. V2 is tractable; V3 concentrated liquidity is a serious project. |
| **B. Port the v1 vendor clients** | Move `tickerpicker/internal/quote/*` behind the facade | Fastest to working swaps, six-vendor coverage and cross-chain for free. Re-introduces the aggregator model you are leaving, and vendor keys into Scratchpost. |
| **C. Hybrid** | On-chain V2/V3 for ETH/Base; vendors for long-tail and cross-chain | Pragmatic, most moving parts. |

**Recommendation: A as the direction, scoped to Uniswap V2 first**, with the
`security-worker` band ladder as the mandatory pre-sign gate. It is the only
option consistent with owning the mainnet and Base stack, and it keeps vendor
secrets away from customers. It is also a big enough build that "under
construction" is the honest state for some time.

### 6.2 The broadcast path has two defects, one worse than first reported

1. **An `X-Forwarded-For` allowlist bypass.** `peerIp()` trusts XFF element `[0]`
   (`server.ts:55-59`) and the nginx template propagates a client-supplied value
   (`$proxy_add_x_forwarded_for`). A deep-dive reproduced a **403 → 200** flip on
   the write path. Latent today because systemd binds loopback; exploitable the
   moment the LAN template is deployed. **The prove suite misses it because it
   only tests the deny direction** — never the bypass. Fix: use the socket
   address (the template already sets `X-Real-IP` and the gateway ignores it).

2. **Chain selection is broken, and Base is unreachable — for reads *and*
   writes.** `upstreamFor()` reads `params[0].chainId`, but `params[0]` is a hex
   string for `eth_sendRawTransaction`, an **address** for `eth_getBalance`, a
   **call object** for `eth_call`, and a **filter** for `eth_getLogs`. None is
   `{chainId}`, so everything routes to Ethereum. The documented workaround
   (inject `{chainId: 8453}`) cannot work either, because the gateway forwards
   `params` **verbatim** (`server.ts:117`) and the node would receive a bogus
   parameter. `prove.ts` points both upstreams at the same mock URL, so there is
   **zero Base coverage** and the suite cannot detect any of this.

Also absent: auth, rate limits, CORS, body cap, idempotency. The bridge belongs
in the facade, with `:8799` staying loopback-only.

### 6.3 Trust model — what the operator can and cannot do

The custody model is genuinely sound. No private key, mnemonic, or keystore
exists anywhere in the repo; `eth_sendTransaction`/`eth_sign*`/`personal_*`/unlock
are **rejected before the node**; and a signed raw transaction is
self-authenticating — it commits to chainId, nonce, gas, to, value, and data, so
**the backend cannot alter, forge, re-sign it, or move funds without a valid user
signature.**

What the operator *can* do, and the wallet must be honest about:

| Capability | Mitigation |
|---|---|
| **Censor or delay** broadcast | The tx is already signed, so the user can broadcast elsewhere — this is delay, not prevention |
| **Front-run / sandwich** — the node sees signed bytes *before* public p2p, a privileged MEV position | Tight slippage/min-out on every swap; support pointing the wallet at the user's own RPC or a protected relay |
| **Return a fabricated hash** while dropping the tx | Verify the hash on-chain before showing success |
| **Attribute wrongly** — the XFF bug means the audit log records a forged IP | Do not treat gateway logs as proof of submission |

**Design consequence: treat the backend as a submission convenience, not a trust
anchor.** The wallet should never imply that routing through it is required.

---

## 7. Milestones

**W = tkrWallet repo · S = Scratchpost · P = policy/operator**

### M-1 — Policy approval **(P)** — *prerequisite*
Obtain Desch review + Charles auth for a new browser-facing surface
(`SECURITY.md:55`), or an explicit amendment to `AGENTS.md:42`. Decide and record
UA #2 status for tkrWallet. **Nothing else starts until this lands.**

### M0 — Chain-plane probe **(P/S)** — *cheap, read-only, unblocks §5*

One session against the node **directly** (not through the gateway, whose chain
selection is broken — §6.2):

```
web3_clientVersion                          → resolves the unrecorded Reth version
eth_blockNumber                             → head N
eth_getBalance(<addr>, N-20000)             → errors ⇒ historical state is gone
eth_getTransactionReceipt(<old tx>)         → distinguishes --full from --minimal
eth_getLogs(N-20000, N)                     → pins the prune horizon
```

Repeat against Base `:9545` to confirm it is up at all (§5.5). Record the measured
horizon in the wallet's diagnostics rather than hardcoding it.

**Exit:** the prune preset, the measured retention horizon, and Base liveness are
all known facts instead of doc assertions.

### M1 — Guardrails and build skeleton **(W)**
- Root `package.json` with **no dependencies** (so `node_modules` never sits
  beside `manifest.json`), `tools/package.json` for Tailwind v4 CLI.
- `tools/src/app.css` → committed `app.css`; CI runs tests **and** a CSS-freshness
  check.
- Convert `app_test.js` into a named-test harness that aggregates failures.
- **Add a CORS/preflight assertion** to the backend's prove suite — Node `fetch`
  cannot catch CORS, so this needs an explicit OPTIONS check.
- **Exit:** CI green; `app.css` reproducible.

### M2 — Design system and app shell **(W)**
- `@theme` dark-first tokens; sticky header, scroll region, fixed bottom nav.
- Hash routing (`#/home`, `#/swap`, `#/activity`, `#/search`) with back-button.
- Safe areas (`viewport-fit=cover`, `env(safe-area-inset-*)`, `100vh`).
- Extension popup `width: 360px` (MV3 caps at 800×600), internal scroll.
- Accessibility: 44 px targets, focus-visible, `aria-live`, `role="tablist"`.
- **Exit:** four screens; no horizontal scroll at 320 px; Lighthouse a11y ≥ 95.

### M3 — Home, data layer, Beaver Nickels removal **(W)**
- `wallet.js`: per-chain holdings for Ethereum, Base, Solana, Robinhood
  (`4663`, tokens `{ETH, USDG, HOOD}`); explicit `{value}|{unknown}` results so an
  RPC failure never renders as a zero balance.
- **Balances come from the wallet's own RPC reads**, not the REST API — see
  §4.1.2 (Sol/RH reads are unwired; there is no balances endpoint at all).
- Explicit supported-chain catalog; uncatalogued chains degrade to native-only.
- **Beaver Nickels removed** from client, tests, docs, both manifests. Client-only
  removal; the server concept is untouched.
- **Exit:** no `beaver` string in the tkrWallet tree.

### M4 — Wallet origin and edge **(S)**
- Decide the wallet hostname and serve the PWA **same-origin** with its API edge
  (§2.5). Static assets and `/api/*` on one nginx server block; TLS; HSTS.
- Keep the GitHub repo public; deploy the served copy to the edge.
- **Exit:** `document.origin` equals the API origin; no CORS needed for any
  wallet call.

### M5 — Wallet facade (`damshell`) **(S)**
- New small service: closed verb allow-list (reuse the `tkrshell` allow-list and
  limiter **design**), wallet-signature login (nonce → verify → session), an
  `HttpOnly; SameSite=Strict` session cookie (valid once same-origin), per-wallet
  + per-IP rate limits, request logging, body caps, and **the first `429` this
  stack has ever returned**.
- Holds the Scratchpost key **server-side**. Reaches `caesar/api` and
  `rpc-gateway` over loopback. No SoT database.
- Write the §3.1 prohibition into the repo before the code.
- **Exit:** a browser logs in with a wallet signature and makes an authenticated
  call with no CORS, no preflight, and no key in the client.

### M6 — Prices and Wallet Value **(S + W)**
- `GET /api/wallet/prices?assets=<chain:addr,…>&vs=usd,cad`. USD can be sourced
  from existing per-token data; **CAD needs a new FX source — none exists.**
- Client: total value, USD/CAD toggle persisted locally.
- Until it ships: render `—`, **never** `$0.00`.
- **Exit:** value correct for a known wallet; unpriced assets excluded and
  disclosed.

### M7 — Receive and Send **(W)**
- **Receive** — per-chain address, copy, QR via a vendored MIT generator
  (remote scripts are impossible under MV3); license verified and pinned.
- **Send** — asset/amount form, balance and fee display, an explicit confirmation
  screen (chain, recipient, amount, fee; no default-filled recipient), EVM
  `eth_sendTransaction` via injected provider, Solana `signAndSendTransaction`
  via Phantom, format/checksum validation, first-time-recipient warning. Never
  auto-retry, never auto-execute, no unlimited-approval flow.
- **Exit:** testnet send completes; dedicated security review of the confirm
  screen before merge.

### M8 — Swap tab **(W)** + routing decision **(S)**
- **UI:** token-in/token-out selectors, amount, an honest "Under construction"
  panel, and a deep link. No fake quote, no pretend button.
- **Decision:** choose A / B / C from §6.1; record it as `docs/swap-routing.md`
  with the `security-worker` band as the pre-sign gate and V2-first scope.
- **Exit:** UI shipped honestly; routing decision recorded.

### M9 — Broadcast hardening **(S)**
- Fix the XFF trust bug; add a working out-of-band chain selector; add auth,
  rate limits, body cap, idempotency. Keep `:8799` loopback-only.
- **Exit:** a testnet raw tx broadcasts to the *intended* chain from an
  authenticated caller, and a forged XFF does not change the decision.

### M10 — Activity and Search **(W)**
- **Activity** — local-first IndexedDB log of transactions this wallet submits,
  plus recent on-chain receipts; a "local history only" disclosure.
- **Search** — filter the asset catalog and holdings; plus a **Discover** section
  carrying appropriate public Scratchpost intelligence via the facade, respecting
  tier filtering. **Do not depend on `/events` SSE** (§4.1.1).

### M11 — Packaging, PWA polish, docs **(W)**
- PNG icons 16/32/48/128 + `action.default_icon` (the current SVG icon is invalid
  for Chrome); popup sizing.
- `sw.js`: `activate` cleanup, `skipWaiting`, `clients.claim`, network-first for
  `app.js`/`app.css`/`index.html`, same-origin GET scoping.
- `index.html` CSP-clean, no inline script (MV3 blocks it).
- Docs: `README.md` (divorce from tkrShell, name Scratchpost), systems map, the
  stale `adb19bd` pin, and `docs/swap-routing.md`.
- **Exit:** manual pass on both PWA and unpacked extension; iOS Safari verified.

---

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Policy forbids a public surface** | Planned work is unimplementable as drawn | **M-1 first**: Desch + Charles sign-off, or an explicit amendment |
| **No swap router exists** | Headline feature has no engine | §6.1 decision on the critical path; ship the tab honestly under construction |
| Publishing `/api/v2/*` | Entire launch/market feed free to anonymous callers | Publish only a facade with a closed verb allow-list, never the B2B face |
| Edge-injected API key | Every anonymous caller becomes an authenticated customer; Super Pro key = total entitlement bypass | Never inject the key at nginx; hold it in the facade |
| `:8799` XFF bypass | Write allowlist forgeable once exposed | M9, before any exposure; note the same pattern is in every nginx template |
| `:8799` chain selector broken | Base swaps broadcast to Ethereum | M9, before any real swap |
| Cross-origin auth | Authenticated wallet calls cannot work | M4 same-origin + M5 session |
| **PWA/extension capability asymmetry** | The extension bypasses CORS via `host_permissions`, so a PWA-only CORS bug is invisible in extension testing | Always test both; assert CORS server-side in prove |
| **prove suite cannot catch CORS** | Node `fetch` ignores CORS; tests never send OPTIONS | Add an explicit OPTIONS/CORS assertion (M1) |
| `/events` SSE is inert in production | A live-data feature built on it silently shows nothing | Do not depend on SSE; poll or read RPC (§4.1.1) |
| Sol/RH reads unwired | Mockup rows would show nothing | Read Sol/RH balances from RPC in the client (§4.1.2) |
| No CAD/FX source anywhere | "Wallet Value in CAD" cannot be built from existing data | M6 must add an FX source — new, not a wiring job |
| Quotas unenforced, no billing | Cannot gate a paid tier | Treat tier gating as unbuilt; do not ship paid copy until it exists |
| Pruned nodes | No historical state; receipts/logs only back ~1.4 d (ETH) / ~5.6 h (Base) | Latest-state only; local-first Activity; never hardcode the window |
| **Prune profile unverified** | Reth's default with no profile is *archive*; `--minimal` would cut receipts to **64 blocks** | M0 probe pins the preset and the horizon before anything depends on it |
| **Base may be down** | Docs cite `:9545` as "RPC empty, snapshot re-downloading"; the mockup has a BASE row | Confirm in M0; degrade the row honestly if dark |
| **`ws://` unusable by the browser** | Mixed content blocks insecure WebSockets from an HTTPS PWA and from `chrome-extension://` | Poll over HTTPS, or proxy `wss://` through the facade |
| **Operator front-running** | The node sees signed bytes before public p2p — a privileged MEV position | Tight min-out on swaps; let users point at their own RPC or a protected relay |
| `damshell` scope creep | Rebuilds the v1 aggregator | §3.1 prohibition written into the repo before code |
| `scratchPost.ai` misuse | It is meta-only, not a hostname | Never use it as an API base or TLS name |
| Send is a new signing surface | A bug moves user funds | Dedicated milestone, explicit confirm, no auto-execute, testnet first |
| Trademark / trade dress | Cloning Phantom invites a complaint | Emulate the pattern, not the palette or logo |

---

## 9. Decisions I need from you

1. **Approve the pivot and the milestone order.**
2. **Policy (M-1)** — who approaches Desch and Charles, and is tkrWallet
   officially UA #2? This gates everything.
3. **Topology (§2.5)** — accept serving the PWA **same-origin** with its API
   edge? This is my main deviation from your proposal and it removes the entire
   CORS/preflight/cookie class of problems.
4. **`damshell` (§3)** — accept a small wallet facade with a hard no-aggregation
   prohibition? Or push per-wallet identity into Scratchpost and skip the
   service?
5. **Swap engine (§6.1)** — A (on-chain, own nodes), B (port v1 vendor clients),
   or C (hybrid)? This decides whether Swap is under construction for a quarter
   or a year.
6. **Wallet hostname** — what should the wallet's origin be, given
   `scratchPost.ai` is off-limits?
7. **Ownership** — who owns the Scratchpost-side milestones (M4, M5, M6, M9)?
8. **Theme** — confirm warm-dark (existing charcoal/amber identity) over
   Phantom-violet.
9. **M0 probe access** — can the five read-only calls in M0 be run against eva
   (and Base) before implementation starts? This is the cheapest way to remove
   the largest remaining unknown.

## 10. Research status

Both deep-dives are complete. Everything above is sourced from repo code, config,
or official upstream documentation, with each claim labelled in the underlying
reports as verified / inferred / unknown.

**One genuine unknown remains and it is deliberately not guessed:** the node
prune profile. The flags live on eva, not in the repo — and Reth's default with
no profile is *archive*, while `--minimal` would leave only 64 blocks of
receipts. **M0 resolves it with five read-only calls.** Everything downstream is
designed so that the answer changes the *diagnostics and the Activity window*,
not the architecture.
