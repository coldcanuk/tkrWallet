# icehut edge specification — `wallet.scratchpost.ai`

**Audience:** whoever tailors the icehut edge.
**Status:** requirements from the wallet side. Nothing here is implemented yet.
**Owner of record:** Charles Pitre.

This is the complete set of things the wallet needs from the edge. It is written
so the edge can be built to fit, rather than the wallet being bent to fit an edge
built for something else.

---

## 0. The one rule, and how we enforce it

> **The wallet talks to icehut and to nothing else. Ever.**

Not eva. Not the brain. Not tickerpicker. Not a vendor. Not a public RPC.

That rule is worth more than a policy note, because it can be **enforced by the
browser** rather than trusted:

1. **No RPC passthrough.** The edge exposes no generic JSON-RPC surface, so
   there is no endpoint through which any node could be reached.
2. **`connect-src 'self'` in the CSP.** The browser then refuses any request
   from the wallet to another origin. A future contributor cannot add an eva
   call by accident — it fails in dev, not in production.
3. **`host_permissions` in the extension** lists exactly `wallet.scratchpost.ai`.

So "never talks to eva" becomes a property of the shipped artifact instead of a
promise in a README. That is the main reason I would keep this hostname
same-origin with its API (§2).

---

## 1. Hostname, DNS and TLS

| Item | Value |
|---|---|
| Hostname | `wallet.scratchpost.ai` |
| DNS / registrar | Cloudflare |
| Wallet origin | `https://wallet.scratchpost.ai` |
| API origin | **the same origin** — `/api/*` on the same host |
| HTTP :80 | 301 → HTTPS, no content served |
| HSTS | `max-age=31536000; includeSubDomains; preload` |

**Decisions needed from you (§10):** proxied (orange) vs DNS-only, and who
terminates TLS.

**Recommendation: proxied, with Authenticated Origin Pulls.** Cloudflare
terminates client TLS, adds WAF/bot management and DDoS absorption, and reaches
icehut over mTLS so icehut can *prove* a request came from Cloudflare. icehut
serves a Cloudflare Origin Certificate. This matters for §7.

**One correction to make in the sibling repo:** `blockchain-infrastructure/
docs/theticker/SCRATCHPOST.md:4` currently states that `scratchPost.ai` is a
"meta name only… do not use it as a hostname, TLS name, API base, nginx
`server_name`, or public URL." That was written to stop bots inventing a
Scratchpost portal. It is now wrong, and it is cited by `SCRATCHPOST-FEED-*
{RESEARCH,PLAN,ARCHITECTURE}.md` and `theticker/README.md`. Suggested amendment:

> `scratchpost.ai` is used **only** for `wallet.scratchpost.ai`, the customer
> wallet UA. There is still no Scratchpost portal, and no other
> `scratchpost.ai` hostname is authorised.

---

## 2. Static hosting — same origin as the API

Why same-origin: it removes CORS, preflight, third-party cookies, and Chrome's
Private Network Access block in one move, and it makes the CSP in §6 meaningful.
Serving the PWA from `github.io` and the API from `scratchpost.ai` would
reintroduce every one of those problems.

Serve from the web root:

| Path | Content-Type | Cache-Control |
|---|---|---|
| `/index.html` | `text/html; charset=utf-8` | `no-store` |
| `/ui.js` | `text/javascript; charset=utf-8` | `no-cache` |
| `/app.js` | `text/javascript; charset=utf-8` | `no-cache` |
| `/app.css` | `text/css; charset=utf-8` | `no-cache` |
| `/sw.js` | `text/javascript; charset=utf-8` | `no-cache` + `Service-Worker-Allowed: /` |
| `/manifest.webmanifest` | `application/manifest+json` | `no-cache` |
| `/icon.svg`, `/icons/*.png` | correct type | `public, max-age=604800` |

`no-cache` (revalidate) rather than long-lived immutable: the files are not
content-hashed, and the service worker is network-first for the shell. If you
would rather content-hash, say so and the build will emit hashed names plus an
`index.html` rewrite — but revalidation is simpler and adequate at this size.

**`sw.js` must be served from the root scope.** The wallet registers `./sw.js`
and the service worker is useless if it is scoped to a subdirectory.

---

## 3. API surface

All endpoints are JSON, `content-type: application/json; charset=utf-8`, on the
same origin. Errors use a consistent envelope:

```json
{ "ok": false, "error": "code", "detail": "human readable" }
```

Auth: **session cookie for the PWA** (same-origin, so `SameSite=Strict` works
and JavaScript never sees the token), **bearer token for the extension** (§5).

### 3.1 Wallet authentication

Challenge–response over a wallet signature. The server never sees a private key
and never signs anything.

**`POST /api/wallet/nonce`** — no auth, tightly rate-limited.
```json
→ { "nonce": "<32+ bytes, single-use>", "statement": "<human-readable>",
    "issued_at": 0, "expires_at": 0 }
```

**`POST /api/wallet/session`** — no auth.
```json
{ "address": "0x…", "chain_id": 1, "nonce": "…", "signature": "0x…" }
→ 200 { "address": "0x…", "tier": "basic|essential|super-pro" }
   Set-Cookie: tkrw_session=<opaque>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=<short>
→ 401 invalid signature
→ 410 nonce unknown, expired, or already used
→ 429 rate limited
```
The nonce must be single-use and server-side. A signed nonce must never be
replayable.

**`POST /api/wallet/logout`** → `204`, clears the cookie.
**`GET /api/wallet/me`** → `200 { "address", "tier" }` | `401`.

### 3.2 Prices — required for "Wallet Value"

**`GET /api/wallet/prices?assets=<chain:address,…>&vs=usd,cad`**

`chain` is the numeric chain id. Gas tokens use the literal `native`:

```
GET /api/wallet/prices?assets=1:native,1:0xA0b8…eB48,8453:native,900001:native&vs=usd,cad
```

```json
→ 200 {
  "as_of": 1737000000,
  "vs": ["usd", "cad"],
  "prices": {
    "1:native":          { "usd": 3120.55, "cad": 4291.20 },
    "1:0xa0b8…eb48":     { "usd": 1.0,     "cad": 1.375 }
  }
}
```

Hard requirements:

- **An asset with no price must be omitted from `prices`, never returned as
  `0`.** The client must be able to tell "unpriced" from "worthless", and it
  renders an em dash for the former. A `0` here would be a lie the wallet then
  repeats to the user.
- **CAD is required.** There is currently no FX concept anywhere in the backend
  — a grep for `cad|fx_rate|exchange_rate` across `blockchain-infrastructure`
  returns nothing. This is new work, not a wiring job.
- Cacheable: `Cache-Control: public, max-age=15`. Prices are public, so no auth.
- Cap the number of assets per request (say 64) and return `400` beyond it.
- Case-insensitive addresses in the response keys, or state the normalisation
  you use — the client must be able to match them back.

### 3.3 Solana token reads — the one chain read the wallet cannot avoid

EVM balances come from the user's own injected provider (MetaMask and friends
expose `eth_getBalance` / `eth_call` / `eth_chainId`). **Phantom exposes no
balance RPC**, so the v1 wallet called `https://api.mainnet-beta.solana.com`
directly — a third-party RPC. Under the §0 rule that is not acceptable.

Either:
- **`GET /api/wallet/solana/tokens?address=<pubkey>`** →
  `{ "tokens": [ { "mint": "…", "symbol": "SOL", "amount": "2.0", "decimals": 9 } ] }`, or
- a **narrow** `POST /api/wallet/solana/rpc` allow-listing exactly
  `getBalance` and `getTokenAccountsByOwner`.

REST is preferred: the allow-list is explicit and the wallet stays RPC-free.
Whitelist known mints server-side, as v1 did (SOL, USDC, USDT) — an unbounded
token list is both slow and a privacy leak.

**Note:** if you would rather the wallet never ask about Solana at all, we drop
the Solana row and say so. What we must not do is quietly point it at a public
RPC.

### 3.4 Swap — under construction, spec only

The wallet's Swap tab ships disabled. This is the contract it will need, written
down now so the edge is not built into a corner.

The shape follows the v1 desk, which got the custody model right: **the server
returns unsigned calldata; the client signs with its own provider and
broadcasts.** The edge must never return a signed transaction and must never
hold a key.

**`POST /api/swap/quote`** (auth required)
```json
{ "source_chain_id": 1, "dest_chain_id": 8453,
  "token_in": "native", "token_out": "0x…",
  "amount_in": "1.5", "units": "human",
  "from_address": "0x…", "prefer": "out", "slippage_bps": 50 }
→ { "quote_id": "…", "amount_out": "…", "min_amount_out": "…",
    "estimated_seconds": 12, "provider": "…", "contracts": […],
    "expires_at": 0 }
```

**`POST /api/swap/build`** (auth required)
```json
{ "quote_id": "…" }
→ { "tx": { "kind": "evm", "chain_id": 1, "to": "0x…",
            "data": "0x…", "value": "0x0", "gas": "0x…" },
    "approve": { … } | null }
```
**`tx` is unsigned.** No private key, no signed blob, ever.

**`GET /api/swap/status?quote_id=…`** → `{ status, tx_hash, confirmations }`.
The client may instead broadcast through its own provider; supporting both is
fine, requiring either is not.

Long-chain ids are already agreed: **ETH 1, Base 8453, Robinhood 4663,
Solana 900001** (tickerpicker's `ChainSolana = 900_001` matches tkrWallet's
constant exactly).

### 3.5 Discover — optional

If we keep a Discover section (index cards, scoreboard, launches), it needs a
small tier-filtered read. Anonymous callers must get the public tier only. This
is optional; the wallet is complete without it.

---

## 4. What the edge does *not* need to provide

Deliberately short, because each omission is a security win:

- **No generic JSON-RPC passthrough.** Not for eth, not for base, not for
  Solana beyond §3.3. This is what makes §0 enforceable.
- **No WebSocket** in v1. `eth_subscribe` on eva is unusable from a browser
  anyway — the endpoints are plain `ws://` on a LAN bind, and an HTTPS page and
  a `chrome-extension://` page are both secure contexts that refuse insecure
  WebSockets. If live updates are wanted later: `wss://wallet.scratchpost.ai/ws`
  on 443, proxied, never `ws://` to a node.
- **No SSE** in v1. `/events` is inert in production anyway — `caesar/api`
  `main.ts` never passes `uiReader`, so the bridge returns immediately and only
  pings and heartbeats are emitted.
- **No vendor anything.** No quote shopping at the edge.
- **No keys, no signing, no custody.**

---

## 5. CORS

The PWA is same-origin, so it needs **no CORS at all**. The extension is not.

The extension popup runs at `chrome-extension://<id>`. With `host_permissions`
declared, extension pages are privileged and bypass CORS — but that is an
implicit dependency on a browser behaviour, so please also emit explicit headers
for the extension origin, and handle preflight:

```
Access-Control-Allow-Origin: <echoed extension origin, or *>
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 600
Vary: Origin
```

- The extension will use **`Authorization: Bearer <token>`** stored in
  `chrome.storage.local`, *not* cookies. A cross-origin cookie from an extension
  is unreliable and modern browsers are removing third-party cookies anyway.
  Because no credentials are used, `ACAO: *` is acceptable and simplest.
- `OPTIONS` must return `204` with the headers above. **This is the single most
  common way a browser wallet silently fails** — an `OPTIONS` that 404s or 405s
  means the real request is never sent, and the browser reports only a generic
  network error.
- **Please pin the extension ID.** Add a `key` to `manifest.json` so the
  `chrome-extension://<id>` origin is stable for an unpacked load; otherwise it
  varies by install path and cannot be allow-listed. I will generate this.

---

## 6. Security headers (static responses)

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self';
  base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none';
  worker-src 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
X-Frame-Options: DENY
```

`connect-src 'self'` is the load-bearing line — see §0. The wallet loads no
third-party resources, so nothing here needs loosening; if a future change wants
to loosen it, that should be a deliberate, reviewed act.

---

## 7. Client-IP handling — please do not repeat this bug

There is a known defect in `blockchain-infrastructure/caesar/rpc-gateway`:
`peerIp()` trusts element `[0]` of a client-supplied `X-Forwarded-For`, while
the nginx template propagates the client's value via
`$proxy_add_x_forwarded_for`. A forged header flipped a write-path decision
from `403` to `200` in a local reproduction.

At the edge:

- **Never trust a client-supplied `X-Forwarded-For`.** Overwrite it with the
  address you actually observed.
- Behind Cloudflare, use **`CF-Connecting-IP`** as the client IP — and only
  after you can prove the request arrived from Cloudflare, which is what
  **Authenticated Origin Pulls (mTLS)** is for.
- Do not pass client-supplied hop headers through to the backend. Strip them and
  set your own.

Any per-IP rate limit (§8) is only as trustworthy as this handling.

---

## 8. Rate limits

| Scope | Suggested | Why |
|---|---|---|
| `POST /api/wallet/nonce` | 10 / min / IP | prevents nonce farming and storage exhaustion |
| `POST /api/wallet/session` | 20 / min / IP | signature-verification is CPU work |
| `GET /api/wallet/prices` | 60 / min / IP | cacheable and cheap, but public |
| authenticated endpoints | 60 / min / session | carrier NAT makes per-IP wrong for mobile users |
| `POST /api/swap/quote` | 20 / min / session | fronts whatever routing costs |

Return `429` with `Retry-After`. Note the client is a mobile wallet that will
retry on reconnect — a hard ban on a shared carrier IP would punish unrelated
users, which is the argument for the per-session limits above.

---

## 9. Logging and health

- Access log: timestamp, method, path, status, `CF-Connecting-IP`, and a session
  identifier — **not** the wallet address, and never a signature or token.
- `GET /healthz` → `200`, no auth, no data.
- The wallet has no telemetry and sends none.

---

## 10. Decisions I need from you

1. **Proxied or DNS-only** for `wallet.scratchpost.ai`?
2. **Who terminates TLS** — Cloudflare with an Origin Certificate, or icehut
   with Let's Encrypt? (If proxied, Authenticated Origin Pulls is what makes
   `CF-Connecting-IP` trustworthy.)
3. **Solana:** do we build §3.3, or drop the Solana row entirely? What we must
   not do is leave the wallet pointed at a public RPC as v1 was.
4. **CAD source** — what supplies the FX rate? Nothing in the backend has an FX
   concept today.
5. **Extension:** Web Store ID, or a pinned `key` for unpacked loads?
6. **Swap:** confirm that routing will live behind icehut, so §3.4 is the right
   contract. Today there is no router anywhere in this stack.

---

## 11. Summary — the smallest edge that works

If you want the short version, the wallet needs exactly five things:

1. Serve static files at `wallet.scratchpost.ai` with the caching in §2.
2. Four auth endpoints (§3.1) and an `HttpOnly` session cookie.
3. One prices endpoint with **USD and CAD** (§3.2).
4. Solana token reads, or drop Solana (§3.3).
5. CORS + `OPTIONS` for the extension only (§5).

Everything else is optional or later. Notably it does **not** need an RPC
passthrough — which is precisely what makes the "never talks to eva" rule
enforceable rather than aspirational.
