# tkrWallet → Scratchpost — Repurposing Plan

**Revision 3.** Status: active — M1 and M2 done, see §7.0.
**Owner:** Charles Pitre.
**Edge contract:** [`docs/specs/icehut-edge.md`](../specs/icehut-edge.md).
**Supersedes:** `docs/plans/wallet-ui-overhaul.md` (the tkrShell-based plan).
**Research basis:** `tkrWallet@c4e5153`; `blockchain-infrastructure@0207ff8`
(Scratchpost); `tickerpicker@origin/main ab8942c` (v1, being divorced).

---

## 0.0 Authority — read this before the rest

**This repo has no `AGENTS.md`.** Verified: tkrWallet tracks 12 files and
`AGENTS.md` is not one of them.

Earlier revisions of this plan treated process language found in the *sibling*
repos — "Desch review + Charles auth", "Réjean HOLDs PRs that violate",
`AGENTS.md:42`'s unconditional "no public surface" — as a gate on this work.
**That was wrong.** Charles Pitre is the owner and the approver, and that text is
bot-generated persona scaffolding: `tickerpicker/AGENTS.md` was added by commits
literally titled *"Add The Interface Grok Bot agent"* and *"Add The Webmaster Grok
Bot agent."*

**There is no external approval step.** What survives from that research is the
engineering, which is real and is the valuable part:

- `caesar/api` is GET-only, has no CORS preflight, no credential a browser can
  hold, and no public route. **Facts about code.**
- The B2B face binds a LAN address; the nodes are pruned. **Facts.**
- There is no swap router anywhere in Scratchpost. **A fact.**

What does not survive is the ceremony. Cleaning those sibling-repo docs is
optional housekeeping *in those repos*, not a prerequisite here. Items previously
described as "blocked" are now simply **decisions Charles makes** — §9.

---

## 0. The pivot, stated plainly

| | v1 (today) | v2 (target) |
|---|---|---|
| Backend | `tickerpicker` / `tkrshell` — aggregator-era | **Scratchpost** (`blockchain-infrastructure`) |
| Shell | tkrShell, an allow-list proxy to an aggregator | **retired** |
| Edge | `tkrpik.com/v1/*` (tkrshell) | **icehut**, the physical edge server |
| Wallet origin | `coldcanuk.github.io/tkrWallet` | **`tkrwallet.scratchpost.ai`** (Charles owns the domain; Cloudflare is the registrar) |
| What the wallet may contact | `tkrpik.com`, `tkrswap.com`, **and `api.mainnet-beta.solana.com`** | **icehut and nothing else — never eva** |
| Routing | six vendor quote clients in `tickerpicker` | **does not exist yet** (§6.1) |
| Chain truth | third-party RPC + vendor APIs | own pruned Reth (ETH) + Base + op-node |

### 0.1 The boundary is enforced, not promised

"The wallet never talks to eva" is not a policy note in this plan. Three shipped
artefacts make it a property of the program:

1. **No RPC passthrough exists** at the edge, so there is no endpoint through
   which any node could be reached (`docs/specs/icehut-edge.md` §4).
2. **`connect-src 'self'`** in the CSP means the browser refuses any request from
   the wallet to another origin. A future contributor cannot add an eva call by
   accident — it fails in development.
3. **`host_permissions`** in the extension lists exactly `tkrwallet.scratchpost.ai`.

This also fixes a live v1 defect: the current `app.js:10` hardcodes
`https://api.mainnet-beta.solana.com` and calls it directly. That is a
third-party RPC in the trust path of a self-custody wallet, and it goes away.

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
   Browser — PWA + MV3 extension
   https://tkrwallet.scratchpost.ai
        │  same origin — no CORS, no preflight, no third-party cookie
        │  CSP connect-src 'self' — the browser blocks anything else
        ▼
   ══ icehut ══  the physical edge. TLS, HSTS, static assets, /api/*,
   Cloudflare    rate limits, wallet auth, prices, allow-list.
   in front      Holds any backend credential SERVER-SIDE.
        │  LAN/loopback — the wallet never sees this side
        ▼
   Scratchpost brain        caesar/api :8791   reads
   (damshell replaces       rpc-gateway :8799 signed raw bytes only
    the tkrshell role)      B2B nginx :8790   unchanged, LAN/VPN
```

**The wallet's only counterparty is icehut.** Everything past that line —
fan-out to the brain, the pruned nodes, the B2B face — is icehut's business.
`docs/specs/icehut-edge.md` is the contract.

This keeps your spine, keeps the brain off the public internet, and is the
arrangement browser wallets actually use. Mature architectures run the BFF
*behind* the gateway, with the gateway handling infrastructure concerns. The
GPLv3 obligation is unaffected: the source stays public on GitHub; only the
*served* copy moves to your edge.

### 2.6 What the sibling-repo rules actually mean for us

Those repos contain process language that reads like a gate. Per §0.0 it is not
one — but two of the underlying constraints are still *good engineering* and
worth honouring deliberately rather than by accident:

- **Keep the brain off the public internet.** Not because a doc says so, but
  because a read-only per-org B2B feed has no business being directly reachable
  by browsers (see §2.7 for what that would leak).
- **Keep the B2B face LAN/VPN.** Same reason: browser traffic should terminate on
  a purpose-built edge, not on the internal origin.

The original wording, retained for reference in case those docs get cleaned up:

- `blockchain-infrastructure/AGENTS.md:42-43` — *"No Cloudflare/public surface
  for brain, ingest, SSE, B2B, RPC, or webhook delivery."*
- `blockchain-infrastructure/SECURITY.md:55-57` — new public hostname requires
  "Desch review + Charles auth"; IcePike is "the browser-facing surface".
- `blockchain-infrastructure/docs/CHARTER.md:48` — *"Réjean HOLDs PRs that
  violate."*

**Consequence: none of this blocks the work.** The wallet edge is a *new
browser-facing surface* by design, which is the whole point of the repurposing.
It is Charles's call, and it is recorded as decision **D1** in §9.

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

**W = tkrWallet repo · S = Scratchpost · O = operator (Charles)**

### 7.0 Status

| | Milestone | State |
|---|---|---|
| ✅ | M1 build skeleton | **Done** — `a4e59ec` |
| ✅ | M2 design system and app shell | **Done** — `d53c67b`, CSS determinism fix `ac7d857` |
| ✅ | icehut edge **spec** | **Done** — [`docs/specs/icehut-edge.md`](../specs/icehut-edge.md) |
| ▶ | M3 home, data layer, Beaver Nickels removal | Next |
| ○ | M4/M5 icehut edge + facade | Blocked on the spec's six answers |
| ○ | M0 chain probe | Backend concern; needs a route to eva |
| ○ | M6–M11 | Not started |

Work happens in the worktree `.worktrees/scratchpost-wallet` on
`feat/scratchpost-wallet`; `main` stays clean and untouched. `npm run check`
runs the whole gate: unit tests, committed-CSS freshness, and a class-resolution
check.

**Uncommitted observation for M3:** the shell has never been opened in a
browser. It is verified structurally (tests, class resolution, valid CSS) but
not visually. First task in M3 is to load it and look at it.

### M0 — Chain-plane probe **(O/S)** — *backend concern, NOT a wallet blocker*

**This does not gate the wallet.** The wallet never talks to eva (§0.1), and EVM
balances come from the user's own injected provider. The probe matters to
whatever icehut fans out to for prices and swap — a backend concern, not a
client one. Re-scoped accordingly.

It still needs a network path to eva, which this host does not have. Can be run
by Charles, or by me if given a route.

One session against the node **directly** (not through the gateway, whose chain
selection is broken — §6.2):

```
web3_clientVersion                          → resolves the unrecorded Reth version
eth_blockNumber                             → head N
eth_getBalance(<addr>, N-20000)             → errors ⇒ historical state is gone
eth_getTransactionReceipt(<old tx>)         → distinguishes --full from --minimal
eth_getLogs(N-20000, N)                     → pins the prune horizon
```

Repeat against Base `:9545` to confirm it is up at all (§5.5).

**Exit:** the prune preset, the measured retention horizon, and Base liveness are
known facts instead of doc assertions. This shapes what the backend can promise
the edge; it does not change the wallet.

### M1 — Build skeleton **(W)** — ✅ DONE (`a4e59ec`)

- Root `package.json` with **no dependencies**, so `node_modules` never lands
  beside `manifest.json` in the unpacked extension. `tools/` holds the Tailwind
  v4 CLI as a build-only devDependency.
- `tools/src/app.css` → **committed** `app.css` (MV3 forbids the CDN and cannot
  relax `script-src`, so the shipped CSS must be a reviewable file).
- Warm-dark `@theme` tokens (ink / cream / ember). Safe-area insets are plain
  custom properties, because Tailwind tree-shakes unused `@theme` tokens — found
  and fixed during the build.
- `.npmrc` documents that npm ignores a project-level `cache` key; `npm run
  setup` passes it explicitly for read-only-`$HOME` environments.
- CI: unit tests **plus** a committed-CSS freshness gate.
- **Verified:** `app.css` builds (4,923 B), `node app_test.js` → `ok`,
  `npm run check:css` → no diff.

**Still open from M1:** the CORS/preflight assertion belongs to the backend's
prove suite (S), and converting `app_test.js` to a named-test harness is folded
into M2 when the tests are next touched.

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
- **EVM balances come from the injected provider** — MetaMask and friends expose
  `eth_getBalance` / `eth_call` / `eth_chainId`. This is the user's own
  infrastructure, not ours, and it is why the wallet never contacts eva.
- **Solana is the exception:** Phantom exposes no balance RPC, so v1 called a
  public Solana RPC (`app.js:10`). That leaves the trust path. Either icehut
  serves it (spec §3.3) or the Solana row goes — decision D10.
- Delete the hardcoded `SOLANA_RPC` constant and the `solanaRpc` transport from
  `app.js`; the wallet must ship with **no third-party origin in it at all**.
- Explicit supported-chain catalog; uncatalogued chains degrade to native-only.
- **Beaver Nickels removed** from client, tests, docs, both manifests. Client-only
  removal; the server concept is untouched.
- **Exit:** no `beaver` string, and no non-icehut origin, anywhere in the
  tkrWallet tree. Both are now testable invariants.

### M4 — icehut edge at `tkrwallet.scratchpost.ai` **(S/O)**

Contract: [`docs/specs/icehut-edge.md`](../specs/icehut-edge.md). That document
is the deliverable for this milestone — the edge gets built to fit it.

- DNS + TLS for `tkrwallet.scratchpost.ai` (Cloudflare registrar; proxied with
  Authenticated Origin Pulls recommended, so `CF-Connecting-IP` is trustworthy).
- Serve the wallet **same-origin** with its API: static files and `/api/*` on one
  host. Static caching, `Service-Worker-Allowed: /`, and the security headers
  including **`connect-src 'self'`** — the line that makes §0.1 enforced.
- Client-IP handling that does **not** trust a client-supplied `X-Forwarded-For`
  (spec §7 — this is the `rpc-gateway` bug; do not repeat it at the edge).
- Keep the GitHub repo public; deploy the served copy to icehut.
- **Exit:** the wallet loads from its own origin, `document.origin` equals the
  API origin, and a request to any other origin is refused by the browser.

### M5 — Wallet facade on icehut **(S)**

The edge must do more than proxy: it mints wallet identity and holds any backend
credential **server-side**. nginx alone cannot verify a signature or rate-limit
per wallet.

- Closed verb allow-list (reuse the `tkrshell` allow-list and limiter *design*),
  wallet-signature login (nonce → verify → session), `HttpOnly; SameSite=Strict`
  cookie for the PWA and a bearer token for the extension.
- Per-wallet + per-IP rate limits, request logging, body caps, and **the first
  `429` this stack has ever returned**.
- Reaches the brain and `rpc-gateway` over LAN/loopback. No SoT database.
- Write the §3.1 no-aggregation prohibition into the repo before the code.
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

## 9. Decisions

Previously framed as questions. There is no approval gate (§0.0), so these are
**defaults I am proceeding on** — overrule any of them and I will re-plan that
part. Only D5 and D6 genuinely need your input, because I cannot know them.

| # | Decision | Resolution |
|---|---|---|
| **D1** | Public wallet surface vs. keeping the brain LAN-only | **Proceed.** The wallet edge is a new browser-facing surface by design; the brain and B2B face stay LAN-only. No approval step. |
| **D2** | Topology — my deviation from `wallet <-> nginx <-> nginx <-> backend` | **Serve the PWA same-origin with its API edge** (§2.5). Keeps your nginx↔nginx spine, removes CORS, preflight, third-party cookies, and the Private Network Access problem in one move. |
| **D3** | `damshell` | **Build it — as a wallet facade, not a shell**, with the §3.1 no-aggregation prohibition committed before the code. nginx alone cannot mint identity, hold the key, or rate-limit per wallet. |
| **D4** | Swap engine | **Option A as the direction** (on-chain on your own nodes, Uniswap V2 first, `security-worker` band as the pre-sign gate). B is available as a stopgap. Reversible; recorded in `docs/swap-routing.md` in M8. |
| **D5** | Wallet hostname | **RESOLVED: `https://tkrwallet.scratchpost.ai`** — the only `scratchpost.ai` hostname the wallet will ever use. Cloudflare is the registrar. Note `SCRATCHPOST.md:4`'s "meta name only, do not use as a hostname" rule is a **deliberate guardrail** protecting a separate project, not an error: amend it with exactly one named exception and keep the guard up. Wording in the spec §1. |
| **D6** | Chain-plane probe access | **Re-scoped, no longer a wallet blocker.** The wallet never contacts eva; EVM balances come from the user's injected provider. A route to eva is still needed for the *backend* (prices/swap), not for the client. |
| **D9** | **icehut edge contract** | **Written:** [`docs/specs/icehut-edge.md`](../specs/icehut-edge.md). Six open questions for Charles are listed there (§10). |
| **D10** | Solana reads | **Needs a decision.** Phantom exposes no balance RPC, so v1 called a public Solana RPC directly — unacceptable under the §0.1 rule. Either icehut serves Solana token reads (spec §3.3) or the Solana row is dropped. |
| **D11** | Tailwind Plus kits | **Use them; do not vendor them.** Both kits are licensed commercial products and this repo is GPLv3 + public. Building the wallet with their components is explicitly permitted; committing a copy of a kit is repackaging and is not. Kits are gitignored, referenced from disk. Policy: [`docs/specs/tailwind-plus-usage.md`](../specs/tailwind-plus-usage.md). |
| **D12** | Catalyst's React runtime | **Recommendation: do not adopt.** Catalyst is React + Headless UI + `motion` + `clsx`. Take its dark-mode craft, not its runtime — this is a signing client, where "the shipped thing is the reviewable thing" is a security property, and MV3's `unsafe-eval` ban would need auditing against `motion` first. Reversible if you want it: esbuild + a dependency audit, no milestone changes. |
| **D7** | Theme | **Warm-dark**, already implemented in `tools/src/app.css`: `ink` surfaces, `cream` text, `ember` amber accent. Deliberately not Phantom violet — the pattern is what we emulate, not the palette. Change is a one-file edit. |
| **D8** | Ownership of Scratchpost-side milestones (M4, M5, M6, M9) | **Unassigned.** They land in `blockchain-infrastructure`. I can work them if you grant that repo; otherwise they need an owner there. |

## 10. Research status and iteration log

Both deep-dives are complete. Everything above is sourced from repo code, config,
or official upstream documentation, with each claim labelled in the underlying
reports as verified / inferred / unknown.

**One genuine unknown remains and it is deliberately not guessed:** the node
prune profile. The flags live on eva, not in the repo — Reth's default with no
profile is *archive*, while `--minimal` would leave only 64 blocks of receipts.
**M0 resolves it with five read-only calls.** Everything downstream is designed so
the answer changes the *diagnostics and the Activity window*, not the
architecture.

### Revision history

- **rev 1** — plan built around tkrShell (v1). Superseded; retained as
  `wallet-ui-overhaul.md` for its CORS and duplicate-`ACAO` research, which is
  still useful background for the divorce.
- **rev 2** — this document.
  - Pivoted the whole plan from tkrShell to Scratchpost.
  - Added the chain-plane findings: prune profile is *unverified* (flags are on
    eva), per-method RPC survival matrix, `eth_getTransactionReceipt` and
    `eth_getLogs` are receipts-segment limited, and `ws://` is unusable from a
    browser.
  - Corrected the `rpc-gateway` chain-selector defect upward: Base is unreachable
    for **reads as well as writes**, and `prove.ts` cannot detect it.
  - Added the trust model: custody is genuinely client-side, but the operator can
    censor, front-run, and log a forged IP.
  - **Removed the M-1 policy gate** (see §0.0) and converted the open questions
    into recorded decisions.
  - **Executed M1**: Tailwind v4 pipeline, CI, committed CSS — `a4e59ec` on
    `feat/scratchpost-wallet`.
  - **Executed M2**: mobile-first wallet shell — `d53c67b`. Replaces the v1 card
    list with header + account chip, wallet-value block with a USD/CAD toggle,
    the Send/Swap/Receive/Buy row, a token list, and a four-tab bottom nav.
    Adds `tools/check-classes.js`, because `app.css` is a committed build
    artifact and a class typo otherwise renders unstyled with no error anywhere.
    Pins the Tailwind scan set with `source(none)` so unrelated file edits no
    longer perturb the build and spuriously trip the freshness gate.
- **rev 3** — this document.
  - **Hostname resolved:** `https://tkrwallet.scratchpost.ai` — the one and only
    `scratchpost.ai` hostname the wallet uses — same-origin with its API.
    Cloudflare is the registrar. The sibling repo's "meta name only" rule is a
    deliberate guardrail protecting a separate project; it gets one named
    exception, not removal.
  - **Hard boundary stated and made enforceable:** the wallet talks to icehut and
    nothing else, ever. Not eva, not the brain, not a public RPC. Enforced by
    three shipped artefacts — no RPC passthrough, `connect-src 'self'`, and the
    extension's `host_permissions` — rather than by policy.
  - **New deliverable:** `docs/specs/icehut-edge.md`, the contract the edge is
    built to fit, including the six decisions the edge needs from Charles.
  - **Corrected a live v1 defect:** `app.js:10` hardcodes
    `https://api.mainnet-beta.solana.com` and calls it directly. That third-party
    RPC leaves the trust path.
  - **M0 re-scoped:** the chain probe is a backend concern, not a wallet blocker.
- **rev 4** — this document.
  - **Tailwind Plus kits added** (`application-ui-v4/`, `catalyst-ui-kit/`).
    Licence policy written up and enforced: building the wallet *with* the
    components is permitted; committing the kits is repackaging and is not.
    Both are gitignored — this was caught before they were committed.
  - **Design language adopted from the kits:** rings instead of borders
    (`ring-1 ring-inset ring-white/10`), Catalyst's dark elevation ladder, and
    Tailwind v4's `outline-2 outline-offset-2` focus idiom. Palette stays warm
    (`ink`/`cream`/`ember`) rather than Catalyst's neutral `zinc` — the craft is
    borrowed, not the brand.
  - **`@tailwindplus/elements` is not usable here:** the Application UI examples
    load it from a CDN, which MV3 and `script-src 'self'` both forbid.
    Interactivity stays hand-written.
- **rev 5 — RDAP build freeze (M2.2).** The build proceeds under
  `docs/plans/rdap-build-plan.md`. Decisions frozen for this build: D10 Solana
  is **catalogued-not-queried** (no client read source; edge reads pending);
  D12 no React runtime, confirmed; D5 `tkrwallet.scratchpost.ai` is the single
  origin constant. Audit findings map to milestones per `docs/research/RESEARCH.md`.
