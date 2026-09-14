# tkrWallet — Security Audit

**Scope:** the wallet client at `feat/scratchpost-wallet` @ `24c9a87`, and the
nginx router templates at `blockchain-infrastructure@0207ff8`
(`caesar/nginx/`, `eva/nginx/`).
**Requested checks:**
1. The wallet never speaks to the internal network.
2. All comms are stopped at the edge.
3. The nginx router is used, and is safe and secure.

**Method:** direct grep of every shipped file for internal addresses and network
sinks; full read of all seven nginx templates; cross-check against the
blockchain-infrastructure security docs. Nothing was run against a host — see
§7 for what that leaves unverified.

---

## 1. Executive answer

| Question | Answer | Confidence |
|---|---|---|
| Does the wallet address the internal network? | **No.** Zero internal addresses in any shipped file. | **Verified** |
| Can the wallet reach the internal network? | **No**, and it cannot be made to without editing the client. | **Verified** |
| Is all comms stopped at the edge? | **Not yet.** Designed, specified, and *not built*. | **Not enforced** |
| Is the nginx router safe? | **Structurally sound, under-hardened.** 20 findings, 6 High. | **Verified from templates** |

**The headline:** the client half of the isolation requirement is genuinely
satisfied, and better than a firewall — no internal address exists in the code,
so no misconfiguration can expose one. The edge half does not exist yet, so
nothing is *stopped* at an edge today. And the existing router templates have
real gaps, several of which matter the moment anything is exposed.

---

## 2. Check 1 — the wallet and the internal network

### 2.1 Verified clean

```
grep -rE '192\.168\.|127\.0\.0\.1|10\.[0-9]|localhost|:87[0-9][0-9]|:854[0-9]|:954[0-9]|\.local|onerelay'
     index.html ui.js app.js sw.js manifest.json manifest.webmanifest
→ no matches
```

No eva RPC (`:8545`/`:9545`), no brain (`:8791`), no BFF (`:8790`), no
`rpc-gateway` (`:8799`), no `.local`, no `onerelay` hostname, no LAN prefix.

**This holds even in the dead code.** `app.js` — which the shell never loads —
contains three public origins and zero internal ones.

### 2.2 Network capability inventory

| File | Network sinks | Destinations |
|---|---|---|
| `ui.js` | **none** | — |
| `index.html` | **none** | — |
| `app.js` (dead) | `fetch` | 3 public origins (W1 below) |
| `sw.js` | `fetch(event.request)` pass-through | whatever the browser already requested |
| `manifest.json` | `host_permissions` | 3 public origins |

The shell — the only thing that loads — has **no network capability whatsoever**.
`app_test.js` asserts this, so it cannot regress quietly.

### 2.3 Verdict on Check 1

**Pass, with one caveat.** The wallet cannot address the internal network. The
caveat is not about the internal network at all: three *public* third-party
origins remain live in `manifest.json` `host_permissions` (§3, S-1), which is a
capability grant the wallet does not need and should not carry.

### 2.4 What "never speaks to eva" still lacks

The claim in the plan is that this is enforced by browser policy, not just by
code review. **Three of the four enforcement mechanisms do not exist yet:**

| Mechanism | Status |
|---|---|
| No internal address in the client | ✅ **present and verified** |
| No RPC passthrough at the edge | ⬜ spec'd, edge not built |
| `connect-src 'self'` CSP | ❌ **absent from both `index.html` and `manifest.json`** |
| Single-origin `host_permissions` | ❌ **still three origins** |

Until the third and fourth land, "the wallet never talks to eva" rests entirely on
nobody editing the code. That is a real property, but it is a code-review property
— not the enforced one the plan claims. Both fixes are small (§5, S-1 and S-2).

---

## 3. Check 2 — comms stopped at the edge

**There is no edge yet.** `tkrwallet.scratchpost.ai` is specified in
`docs/specs/icehut-edge.md` and does not exist. So the honest answer is:
**containment is designed, not enforced.**

What the design provides once built, and why it is the right shape:

1. **One public face.** Only icehut is reachable from the internet. Every other
   face in the router binds a LAN address (`192.168.1.254`) or loopback
   (`127.0.0.1`).
2. **No RPC passthrough**, so there is no endpoint through which a node could be
   reached even if the client were compromised.
3. **`connect-src 'self'`**, so the browser refuses any other origin.
4. **No backend credential in the client**, so a compromised client cannot act as
   the backend.

**The gap that matters most:** nothing today stops a contribution from adding a
fetch to an internal address. The client is clean and the test suite asserts the
absence of *network sinks* in `ui.js`, but there is no assertion that the tree
contains no foreign *origin*. That assertion is the single cheapest control in
this audit and belongs in `app_test.js` now (§5, S-3).

---

## 4. Check 3 — the nginx router

### 4.1 What is good

- **Every internal service is proxied, never directly exposed.** `tickerpicker`
  and the `solver` stay `expose`-only; `rpc-gateway` binds loopback. The router
  is genuinely doing its job as the only door.
- **The two ingest faces are exemplary.**
  `icepike-nouveau-ingest.conf.template` and `eva-brain-ingest.conf.template`
  both have an explicit `allow 192.168.1.79; deny all;`, `limit_except POST`,
  and a default-deny `location /` returning 404 JSON. This is the pattern the
  other faces should copy.
- **Default-deny on the JSON faces.** `ticker-b2b-radar`, the SSE face, and the
  ingest faces all end with `location / { return 404 '{"ok":false,...}'; }`
  rather than falling through to a proxy.
- **Method gating is present** on the LAN faces (`if ($request_method != GET)
  return 405`), and `limit_except` on the SSE and ingest paths.
- **The webhook is isolated** onto its own vhost with `location / { return 404; }`
  and `location ^~ /webhook/ { return 404; }` on the main host.
- **`server_tokens off`** on the public vhost, and a custom log format that
  records upstream status and timings.
- **The UA face refuses ingest** (`location = /api/ingest/launch { return 403; }`),
  which is a deliberate and correct separation.

### 4.2 Findings

Severity reflects consequence if the face is reachable. "Reachable" is assumed
for LAN faces because several rely on an external firewall that this audit cannot
verify.

#### R-1 — Plain HTTP on `:80` with no peer restriction — **High**

`tickerpicker.conf.template`:

```nginx
server {
    listen 80 default_server;
    server_name tkrpik.com www.tkrpik.com tkrswap.com www.tkrswap.com _;
```

TLS is terminated by Cloudflare upstream, so the origin serves **plaintext**.
Nothing in the template restricts port 80 to Cloudflare's ranges. If the origin
IP is reachable directly — and it is, it is a host with an IP — then any peer can:

- talk to the origin **unencrypted**,
- **bypass Cloudflare** entirely: WAF, bot management, and any CF rate limiting,
- **forge `CF-Connecting-IP`** (see R-3),
- reach tkrshell through the `_` catch-all with any Host header (R-5).

**Fix.** Either firewall :80 to Cloudflare ranges, or — better and
self-contained — do it in nginx and require authenticated origin pulls:

```nginx
# http context
set_real_ip_from <cloudflare ranges>;
real_ip_header CF-Connecting-IP;
server_tokens off;

server {
    listen 80 default_server;
    server_name _;
    return 444;                      # kill unknown hosts outright
}

server {
    listen 80;
    server_name tkrpik.com www.tkrpik.com tkrswap.com www.tkrswap.com;
    allow <cloudflare ranges>; deny all;
    return 301 https://$host$request_uri;
}
```

#### R-2 — No rate limiting in any template — **High**

Grepped all seven templates: no `limit_req`, no `limit_conn`, no `limit_req_zone`
anywhere. Every unauthenticated face accepts unlimited requests. `/v1/quote` and
`/v1/swap` front **paid vendor quotas**, and the brain API is metered per
customer — so an unthrottled edge is a direct cost and availability exposure.

**Fix.** Define zones in the http context and apply per class:

```nginx
limit_req_zone $binary_remote_addr zone=wallet_auth:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=wallet_api:10m  rate=60r/m;
limit_req_status 429;
```

`CF-Connecting-IP` is the correct key **only after R-1 and R-3 are fixed** —
otherwise the key is attacker-chosen and the limiter is trivially defeated.

#### R-3 — `CF-Connecting-IP` is forwarded from a client-controlled header — **High**

```nginx
proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
```

`$http_*` is the **incoming request header**, verbatim. This does not *derive*
the client IP; it *forwards whatever the caller sent*. Any peer that can reach
the origin directly — which R-1 permits — sets `CF-Connecting-IP: 1.2.3.4` and
the backend sees it as fact.

`X-Real-IP $remote_addr` is set correctly on the same lines, which makes this
worse: the config carries a trustworthy value and an untrustworthy one side by
side, and a backend author has no way to tell which to trust.

**Fix.** Never forward the raw header. Use the `real_ip` module (R-1) so
`$remote_addr` **becomes** the true client, then send `$remote_addr` and nothing
else. If `CF-Connecting-IP` must be preserved for compatibility, overwrite it:
`proxy_set_header CF-Connecting-IP $remote_addr;`.

#### R-4 — `X-Forwarded-For` feeds the confirmed rpc-gateway bypass — **High**

Every template uses `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
which produces `<client-supplied>, <real-peer>`.

`caesar/rpc-gateway/src/server.ts:55-59` reads element **[0]**:

```ts
const fwd = req.headers["x-forwarded-for"];
if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
```

A local reproduction flipped the write-path decision from **403 to 200** by
sending `X-Forwarded-For: 192.168.1.50`. In other words: the router's XFF
handling and the gateway's XFF trust combine into a bypass of the CIDR allow-list
that `CUSTOMER-RPC.md` presents as a security control. The nginx side even sets
`X-Real-IP $remote_addr` correctly and the gateway ignores it.

**Fix — both ends, not one.**

- Gateway: use `req.socket.remoteAddress`, or take the **last** XFF element with
  a configured trusted-proxy count. Never element [0].
- nginx: `proxy_set_header X-Forwarded-For $remote_addr;` (single, authoritative)
  or rely on `real_ip` and send `$remote_addr`.

#### R-5 — `server_name _` catch-alls, and a default server that proxies — **Medium**

`tickerpicker.conf.template` combines `listen 80 default_server` with
`server_name ... _`, and `ticker-b2b-radar`, `ticker-rpc-exec`,
`icepike-nouveau-ingest`, and `icepike-nouveau-sse` all use `server_name _;`.
On port 80 this means **any** Host header — including one pointing at an
unrelated domain — is proxied to tkrshell. That is a host-header catch-all, and
it is how an origin becomes usable for domain fronting or as an accidental
reverse proxy for someone else's hostname.

**Fix.** A dedicated default server that returns `444`; real vhosts list explicit
names. For the LAN faces `server_name _` is harmless *provided* an `allow`/`deny`
exists (R-6).

#### R-6 — Four internal faces have no in-template IP allow-list — **Medium**

Precise count, verifying against `allow <ip>;` directives specifically (and not
against `limit_except { deny all; }`, which is *method* denial and looks similar
to a grep):

| Face | In-template IP allow-list |
|---|---|
| `eva-brain-ingest.conf.template` (`:8792`) | ✅ `allow 192.168.1.79`, `allow 127.0.0.1` |
| `icepike-nouveau-ingest.conf.template` (`:8787`) | ✅ `allow 192.168.1.79` |
| `icepike-desk-ua.conf.template` (`:443`) | ❌ none |
| `icepike-nouveau-sse.conf.template` (`:8786`) | ❌ none |
| `ticker-b2b-radar.conf.template` (`:8790`) | ❌ none |
| `ticker-rpc-exec.conf.template` (`:8799`) | ❌ none |

The four without one are protected by their own headers' claims — *"FW (UniFi) is
the real allowlist"*, *"LAN allowlist is Host FW"*, *"LAN/AdGuard only"* — and by
binding a LAN address rather than `0.0.0.0`. So they are not internet-routable.
The gap is **within** the LAN and VPN: any peer that can route to
`192.168.1.254` reaches `:8790` and `:8799`, and that control lives in a firewall
rule on a different host, not in git, not reviewed in a PR, and with no
defence in depth behind it.

The two ingest faces show the correct pattern. Copy it:

```nginx
allow 192.168.1.0/24;
allow 192.168.100.0/24;
deny all;
```

Three lines per vhost, and the firewall stops being a single point of failure.

#### R-7 — No security headers, and no HSTS on the TLS vhost — **Medium**

`icepike-desk-ua.conf.template` is the only template terminating TLS
(`:443 ssl`, TLSv1.2/1.3) and it sets **no HSTS** and no security headers at all.
Grepping all templates for `Strict-Transport-Security`, `Content-Security-Policy`,
`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` returns nothing.
The only `add_header` directives present are `Cache-Control` and
`X-Accel-Buffering`.

**Fix.** Baseline on every TLS vhost, and the full set on the wallet vhost
(§6). Note nginx's `add_header` does not inherit into a `location` that has its
own `add_header` — use `include` in every block, or the headers silently vanish.

#### R-8 — No body cap on the RPC or ingest faces — **Medium**

`client_max_body_size 64k` appears only in `tickerpicker.conf.template` (32k on
`/api/intent`). `ticker-rpc-exec.conf.template` has **none**, and
`caesar/rpc-gateway/src/server.ts:87-88` buffers the request body unbounded while
`grep` finds no body cap in that service either. A POST of arbitrary size is
read into memory.

**Fix.** `client_max_body_size 128k;` on the RPC face — a signed EVM transaction
is a few hundred bytes — and enforce the same limit in the gateway so the two
agree.

#### R-9 — `if` inside `location` — **Low**

`if ($request_method != POST) { return 405; }` (RPC face) and
`if ($request_method != GET) { return 405; }` (B2B face). This is the *safe* use
of `if` — a bare `return` — so it is not the classic "if is evil" bug. But
`limit_except` is clearer, is already used elsewhere in the same directory, and
cannot be mis-extended later.

#### R-10 — `server_tokens off` is set on only one vhost — **Low**

Other faces leak the nginx version in `Server:` and error pages. Move it to the
http context.

#### R-11 — Upstream `Server` headers pass through — **Low**

No `proxy_hide_header Server;` anywhere. Combined with R-10, the backend's own
software banners are visible.

#### R-12 — No timeouts on the JSON faces — **Low**

`proxy_read_timeout`/`proxy_send_timeout` are set only for the SSE and WebSocket
locations. Default 60 s on the rest is a slow-loris surface with no rate limiting
(R-2) to compensate.

### 4.3 Router summary

| ID | Finding | Severity |
|---|---|---|
| R-1 | Plain HTTP :80, unrestricted peers, CF bypassable | **High** |
| R-2 | No rate limiting anywhere | **High** |
| R-3 | `CF-Connecting-IP` forwarded from a client-controlled header | **High** |
| R-4 | XFF handling feeds the confirmed rpc-gateway allow-list bypass | **High** |
| R-5 | `server_name _` catch-all + default server that proxies | Medium |
| R-6 | Four internal faces have no in-template IP allow-list | Medium |
| R-7 | No security headers; no HSTS on the TLS vhost | Medium |
| R-8 | No body cap on RPC/ingest faces | Medium |
| R-9 | `if` inside `location` instead of `limit_except` | Low |
| R-10 | `server_tokens off` on one vhost only | Low |
| R-11 | Upstream `Server` headers leak | Low |
| R-12 | No timeouts on JSON faces | Low |

**Overall:** the router is *structurally* correct — one door per service,
default-deny on the JSON faces, method gating, ingest allow-lists. It is
**under-hardened**: no rate limits, no headers, no permissive-peer protection,
and an IP-trust story that is spoofable in two independent ways.

The two that must be fixed before *anything* is exposed are **R-1** (so the
origin is not directly reachable) and **R-3/R-4** (so IP-derived decisions mean
something). Every IP-based control in the wallet spec — per-IP rate limits,
`CF-Connecting-IP`, abuse handling — is worthless until those are closed.

---

## 5. Wallet-side security findings

### S-1 — Three third-party origins in `host_permissions` — **High**

Live capability grant in `manifest.json`, including
`https://api.mainnet-beta.solana.com/*`. `app.js` (dead code) uses them, but the
permission is what any future script inherits. A public RPC is exactly the
third-party dependency the icehut design exists to remove.

**Fix.** `"host_permissions": ["https://tkrwallet.scratchpost.ai/*"]`, delete
`app.js`, assert the exact list in tests.

### S-2 — No CSP anywhere — **High**

The plan states that `connect-src 'self'` makes the isolation enforceable. It is
in no file. See the technical review W2 for the exact strings for both the PWA
meta tag and the MV3 `extension_pages` policy — **including the fact that the
extension needs the wallet origin named explicitly**, because in an extension
`'self'` means `chrome-extension://<id>`, not the API host.

### S-3 — No invariant that forbids a foreign origin — **Medium**

The suite asserts there are no vendor strings and no XSS sinks. It does not
assert that the tree contains **no origin other than the wallet's**. That is the
assertion that turns "never talks to eva" into a merge gate — and it is five
lines.

```js
const allowed = ["https://tkrwallet.scratchpost.ai"];
const found = [...src.matchAll(/https?:\/\/[a-zA-Z0-9._-]+/g)].map(m => m[0]);
assert.deepStrictEqual([...new Set(found)].filter(o => !allowed.includes(o)), []);
```

### S-4 — Service worker is an unscoped caching proxy — **Medium**

`sw.js` handles every request including cross-origin, with no method or origin
check, and is cache-first for the shell. Full detail in the technical review W3.
From a security angle the notable part is the **unscoped** handler: it should
decline anything that is not a same-origin GET.

### S-5 — `sw.js` precaches dead code containing third-party origins — **Low**

`sw.js:3` caches `./app.js`. Delete it from the precache with the file.

### S-6 — Extension ID cannot be allow-listed — **Low**

No `key` in `manifest.json`, so `chrome-extension://<id>` varies per unpacked
install. The edge cannot pin the extension origin in CORS. Generate and pin a key.

### S-7 — Wire-supplied value reaches a CSS property — **Low**

`ui.js:210` assigns `holding.color` to `style.backgroundColor`. Not a string
sink, so the injection risk is minimal, but it is the first server-supplied
value touching presentation. Map colours locally from the symbol instead.

---

## 6. What the wallet vhost must include

Beyond `docs/specs/icehut-edge.md`, so it does not inherit R-1–R-12:

```nginx
# http context
server_tokens off;
limit_req_zone $binary_remote_addr zone=wallet_auth:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=wallet_api:10m  rate=60r/m;

server {
    listen 80;
    server_name tkrwallet.scratchpost.ai;
    allow <cloudflare ranges>; deny all;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name tkrwallet.scratchpost.ai;

    ssl_certificate     <origin cert>;
    ssl_certificate_key <key>;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_verify_client on;            # Cloudflare Authenticated Origin Pulls

    client_max_body_size 128k;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'self'" always;

    # Static + same-origin API. No RPC passthrough, ever.
    location = /api/wallet/nonce   { limit_req zone=wallet_auth burst=5 nodelay; proxy_pass http://127.0.0.1:<facade>; }
    location = /api/wallet/session { limit_req zone=wallet_auth burst=5 nodelay; proxy_pass http://127.0.0.1:<facade>; }
    location /api/                 { limit_req zone=wallet_api  burst=20 nodelay; proxy_pass http://127.0.0.1:<facade>; }
    location /                     { proxy_pass http://127.0.0.1:<facade>; }

    location / { return 404; }       # if the facade is not same-host; never proxy internal faces
}
```

Two rules that matter more than the rest:

- **`add_header` does not inherit into a `location` that defines its own.** Use
  `include` or repeat them, or the CSP silently disappears on the API paths.
- **`connect-src 'self'` is the control that makes "never talks to eva" a browser
  guarantee.** If it is ever loosened, that guarantee is gone.

---

## 7. What this audit could not verify

Stated plainly so the gaps are not mistaken for passes:

1. **Host state.** Whether any template is installed, whether `:8799` is live,
   firewall rules, and the nginx binary's version are all unverifiable from this
   machine. Every "LIVE" claim in the sibling docs is a doc assertion.
2. **Cloudflare configuration.** The tunnel ingress, whether Authenticated Origin
   Pulls is enabled, and whether the origin IP is discoverable and reachable
   directly (which decides whether R-1 is theoretical or live).
3. **`rpc-gateway` runtime exposure.** The systemd unit binds loopback; the LAN
   face is an optional template. Whether it is deployed decides whether R-4 is
   latent or exploitable now.
4. **The runtime behaviour of the edge.** It does not exist, so nothing about
   same-origin, CORS, CSP or cookie behaviour has been exercised. Those are
   design intent, not test results.
5. **The wallet in a browser.** The client has never been rendered; all UI claims
   are structural.

## 8. Recommended order

**Now (cheap, high value, no dependencies)**

1. **S-2** — add the CSP meta tag and the MV3 `extension_pages` policy.
2. **S-3** — add the no-foreign-origin assertion to `app_test.js`.
3. **R-3/R-4** — fix the IP-trust story at both ends. Everything IP-based depends
   on it, and it is a known-confirmed bypass.

**In M3**

4. **S-1/S-5** — delete `app.js`, cut `host_permissions` to one origin, drop it
   from the precache.
5. **S-4** — rewrite `sw.js` with lifecycle and origin scoping.
6. **S-6, S-7** — pin the extension key; stop trusting wire colours.

**Before any exposure**

7. **R-1** — close direct access to the origin; require authenticated origin
   pulls.
8. **R-2** — rate limiting, once the IP key is trustworthy.
9. **R-6** — add an IP allow-list to the four faces that lack one.
10. **R-7, R-8** — security headers and body caps.
11. **R-5, R-9–R-12** — the remaining hygiene.
