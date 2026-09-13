# tkrWallet — Technical Review

**Revision reviewed:** `c4e5153` (`main`, clean working tree)
**Date of review:** current session
**Reviewer:** automated engineering review
**Artifacts inspected:** `app.js` (526 L), `app_test.js` (211 L), `index.html` (80 L),
`sw.js` (7 L), `manifest.json`, `manifest.webmanifest`, `README.md`,
`docs/systems/README.md`, `docs/systems/tkrwallet.mmd`, `icon.svg`, `.gitignore`, git history.

---

## 1. Scope and method

This is a full read of every source and documentation file in the repository, plus a
git-history and tooling survey. The test suite was executed to establish a baseline
(`node app_test.js` → `ok`, exit 0). Claims about browser/platform behaviour were checked
against the platform documentation rather than assumed; those checks are cited inline.

This review assesses the code as-is against its own stated contract: a **GPLv3
self-custody client signer** — a PWA and an MV3 Chrome extension that serves the
tkrpik / tkrSwap funnel, talks HTTPS only to `tkrpik.com` and `tkrswap.com`, holds no
keys, embeds no vendor API, and never auto-executes a trade. Where a finding depends on
tkrShell behaviour that is not in this tree, it is marked **[needs tkrShell confirmation]**.

---

## 2. Executive summary

The codebase is in good shape for its size and risk class. It is ~820 lines of
dependency-free, build-free ES5-flavoured JavaScript with a small, honest test suite and
unusually disciplined documentation of the trust boundary. The security posture that the
README claims is, with the specific exceptions below, actually true in the code.

The strongest properties:

- **No custody, no keys, no secrets.** No private-key handling, no `pass` paths, no vendor
  hostnames, no API keys anywhere in the tree or in git history (README asserts the
  history walk; spot-checks agree).
- **No XSS surface.** Every dynamic value reaches the DOM through `textContent`,
  `createElement`, or `createTextNode`. There is no `innerHTML`/`outerHTML`/
  `insertAdjacentHTML`/`eval`/`new Function` in the tree.
- **No supply chain.** Zero npm dependencies, zero build step, zero lockfile. The thing
  that ships is the thing that is reviewed.
- **Testable by construction.** The UMD-style export in `app.js:506-509` lets Node import
  the module without a DOM, and the test suite injects fake `fetch` and fake providers —
  this is why the logic is testable at all.

The material problems are concentrated in four places, in priority order:

| # | Severity | Area | Finding |
|---|----------|------|---------|
| F1 | **High** | Holdings correctness | RPC/contract failure is indistinguishable from a zero balance; `login()` fabricates a zero ETH row |
| F2 | **High** | Holdings correctness | Unsupported EVM chains silently fall back to **Ethereum mainnet token addresses** while relabelling them with the connected chain id |
| F3 | **High** | Extension packaging | `manifest.json` declares an **SVG** icon; Chrome does not support SVG for extension icons, so the extension ships with no working icon |
| F4 | **Medium-High** | Hosted attach | `attachHosted` sends no credentials of any kind, so the endpoint can never be authenticated from this client; the 401 branch is unreachable in practice **[needs tkrShell confirmation]** |
| F5 | **Medium** | Offline/lifecycle | `sw.js` is cache-first with no `activate` cleanup, no `skipWaiting`, and no cache-busting discipline — a deploy that forgets to bump the cache name ships stale wallet code indefinitely |
| F6 | **Medium** | Extension packaging | Inline `<script>` in `index.html` violates the MV3 default CSP and is blocked in the popup context |
| F7 | **Medium** | Integration contract | `SOLANA_CHAIN = 900001` is an undocumented magic sentinel with no shared definition with tkrSwap |
| F8 | **Medium** | Test coverage | No CI, no `package.json`, and the test that enforces the security invariants is a source-text grep that does not cover `index.html`, `sw.js`, or the manifests |
| F9 | **Low** | Robustness | No timeouts/aborts on any network call; a hung tkrShell leaves the UI in "Asking tkrShell…" forever |
| F10 | **Low** | Correctness | Numeric precision loss and silent `0` conversion in `hexToAmount` / `weiToEth` |
| F11 | **Low** | UX/state | No `accountsChanged` / `chainChanged` handling; holdings go stale after an account or network switch |
| F12 | **Low** | Privacy/consent | Solana holdings are read from `window.solana.publicKey` without an explicit `connect()`; the address is sent to a third-party public RPC |
| F13 | **Low** | Dead code / drift | `LOGIN_URL` is exported and tested but never used by the page, which hardcodes the same URL |
| F14 | **Low** | Docs | The systems map pins itself to `adb19bd`, five commits behind `main` |

None of these are fund-loss bugs: this client never holds funds and never signs without a
user gesture. F1–F3 are the ones I would fix before the next release; F1 and F2 are the
ones most likely to mislead a user about their own money.

---

## 3. Architecture assessment

### 3.1 Shape

```
app.js  ── pure logic + DOM binding, exports an API in Node
  │
  ├─ shellFetch targets: tkrpik.com /v1/snapshot, /api/public/game, /v1/hosted-wallet/attach
  ├─ injected provider: eth_requestAccounts, eth_chainId, eth_getBalance, eth_call
  ├─ Solana RPC: api.mainnet-beta.solana.com (getBalance, getTokenAccountsByOwner)
  └─ outbound links: tkrswap.com with token_in / from_address / source_chain_id
```

One file carries both the pure functions and the boot sequence. That is the right call at
this size — splitting it now would add ceremony without buying testability, since
`app.js:506-509` already gives Node the functions it needs.

### 3.2 What is done well

- **The trust boundary is enforced by absence, and the absence is tested.** `app_test.js:29-31`
  greps the source for every vendor hostname, `pass` path, and key prefix named in the
  README. `app_test.js:26` greps for `/api/quote`. This is an unusual and genuinely good
  pattern: the compliance claim is executable.
- **The module/browser split is clean.** `typeof module === "object" && module.exports`
  short-circuits before any DOM work, so requiring the module in Node never touches
  `document`. `el()` (`app.js:166-168`) guards `typeof document === "undefined"`.
- **Input validation at the edges.** `normalizeMode` (`app.js:184-190`) whitelists two
  modes and defaults anything else to `consolidate`; `applyBatchQuery` trims and rejects
  empty card ids; `balanceOfData` zero-pads and lowercases the address before ABI
  encoding. `app_test.js:59-60` covers both the uppercase and the hostile mode value.
- **Safe URL construction.** `URLSearchParams` is used everywhere instead of string
  concatenation, so `from_address` and `batch_card` are properly encoded.
- **Honest failure copy.** `attachHosted` distinguishes 401 / 402 / other and always
  appends "Keys stay off tkrWallet." The plan-only reality is not papered over.

### 3.3 Structural weaknesses

- **Two rendering paths, one fetch path, no shared guard.** `loadGame`, `attachHosted`, and
  the provider calls each do their own error handling with different policies. Centralising
  them behind one `shellFetch(url, opts)` would let the origin allowlist be enforced *in
  code* rather than by grep (see F8).
- **The DOM-binding block is duplicated** (`app.js:510-524`): the readyState branch repeats
  the same four calls. A `boot()` function called from both branches removes the drift risk.
- **`login()` is doing four jobs** — provider discovery, account request, EVM holdings, and
  Solana holdings — in a 60-line nested promise pyramid. Solana enumeration in particular
  has nothing to do with EVM login and is only there because that is where the click
  handler lands.

---

## 4. Findings

### F1 — RPC failure is indistinguishable from a zero balance — **High**

**Evidence.** `app.js:136-138` and `app.js:155-157` collapse every provider error to `null`,
and `app.js:160-162` then filters those rows out. `app.js:111-113` and `app.js:114-116` do
the same for Solana. Finally, `app.js:436-447` *manufactures* a holding when the list comes
back empty:

```js
if (!holdings.length) {
  holdings = [{ kind: "holding", symbol: "ETH", token: NATIVE_ETH,
                chain_id: chainId, address: address, amount: 0 }];
}
```

**Impact.** If the RPC is unreachable, rate-limits the user, or the node is degraded, the
wallet renders a confident "Holding ETH · 0.0000" — and a "Start tkrSwap" link — for a user
who may hold ETH. If a single token contract reverts, that token vanishes from the list with
no indication anything failed. For a wallet, *"I could not check"* must never be presented
as *"you have nothing."* This is the highest-value fix in this review.

**Recommendation.**
1. Delete the fabricated zero row. An empty result is a legitimate empty result.
2. Make the per-asset `catch` record a failure rather than discard it, e.g. return
   `{ failed: true, symbol: tok.symbol }`.
3. In `renderHoldings`, render a distinct line for failed assets
   ("ETH — balance unavailable") and, when *every* read failed, a single
   "Could not reach the chain. Balances unknown." banner.
4. Keep the existing partial-success behaviour: if some reads succeed, show those and the
   failure notice together. `listSolanaHoldings` already does this correctly for the
   token-account leg (`app.js:111-113`) — that pattern should be generalised, not the shape
   of the outer `catch`.

---

### F2 — Unsupported EVM chains silently use mainnet token addresses — **High**

**Evidence.** `app.js:120`:

```js
var catalog = TOKEN_CATALOG[chainId] || TOKEN_CATALOG[1];
```

Every row then carries `chain_id: chainId` (`app.js:131, 149`), whatever `chainId` was.

**Impact.** Connect on Polygon, Arbitrum, Optimism, or any chain other than 1 and 8453 and
the wallet issues `eth_call` balance queries against **Ethereum mainnet USDC/USDT/WETH
contract addresses** on that other chain. The calls return `0x` (no contract) → `hexToAmount`
returns 0 → rows are filtered out. The user sees only native ETH with a `source_chain_id`
pointing at a chain this client has no catalog for. The failure is silent and the labels are
actively wrong: a row can claim `symbol: "USDC"` with `chain_id: 137` and a mainnet address.
Downstream, `swapHref` emits `token_in=USDC&source_chain_id=137` — an ambiguous instruction
built from a mismatched address.

**Recommendation.** Do not fall back across chains. Either
- treat an uncatalogued chain as native-only (`[native asset]`), which is honest and useful, or
- gate the holdings pane on a supported-chain check and message the user
  ("Holdings are supported on Ethereum and Base; you are connected to chain 137"), which is
  clearer.

In both cases `chain_id` must stay consistent with the address it is paired with.

---

### F3 — SVG icon is not a valid Chrome extension icon — **High (for the extension artifact)**

**Evidence.** `manifest.json:10-12` declares `"icons": { "128": "icon.svg" }`, and
`icon.svg` is an SVG (`<svg xmlns=...>`). The `action` block has no `default_icon`.

**Impact.** Chrome's manifest `icons` block accepts raster formats (PNG, BMP, GIF, ICO,
JPEG); **SVG is not supported for extension icons** ([Chrome extension icon format
guidance](https://pixellize.io/blog/chrome-extension-icon-sizes)). The extension loads but
shows a blank/generic puzzle-piece icon in the toolbar and on the extensions page. The same
file is *correct* for the PWA (`manifest.webmanifest` uses it with `"sizes": "any"` and
`purpose: "any maskable"`), so this is specifically an extension-packaging defect.

**Recommendation.** Export `icon.svg` to PNG at 16/32/48/128, point `manifest.json` at the
PNGs, and add a `default_icon` block to `action`. Keep the SVG for the web manifest.

---

### F4 — Hosted attach cannot carry authentication — **Medium-High** `[needs tkrShell confirmation]`

**Evidence.** `app.js:371-375`:

```js
return fetchFn(HOSTED_ATTACH_URL, {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: "{}",
})
```

There is no `credentials` option anywhere in the file (verified by grep), and no
`Authorization` header or token in the body.

**Impact.** The default `fetch` credentials mode is `same-origin`. The wallet always runs on
a *different* origin from `tkrpik.com` — `coldcanuk.github.io` for the PWA, or
`chrome-extension://<id>` for the extension — so **no cookie is ever attached to this
request**, and no other credential is supplied either. If tkrShell authenticates attach by
session cookie, every caller is anonymous and always receives 401. The carefully written
401 branch at `app.js:386-388` ("Sign in on tkrpik (paid) to attach") would then be the
*only* branch a signed-in user ever sees, which is the opposite of the intent.

This may be intentional — "plan-only and returns no keys" could mean the endpoint is a
deliberate unauthenticated probe. But the code reads as though it expects auth to work.

**Recommendation.** Confirm with tkrShell which of these is true:
1. **Unauthenticated by design** → simplify: remove the 401/sign-in branch or reframe the
   copy, since it can never be reached legitimately.
2. **Should be authenticated** → add an explicit credential. For the extension, a
   `credentials: "include"` call against a host-permitted origin is viable; for the PWA, a
   session cookie requires `credentials: "include"` *and* `Access-Control-Allow-Credentials`
   plus a non-wildcard `Access-Control-Allow-Origin` on tkrShell. A bearer token is the more
   robust option and avoids third-party-cookie restrictions entirely.

Either way, this should be resolved explicitly rather than left ambiguous.

---

### F5 — Service worker caches forever and never cleans up — **Medium**

**Evidence.** The entire `sw.js`:

```js
const CACHE = "tkrwallet-v3";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) =>
    cache.addAll(["./", "./index.html", "./app.js", "./manifest.webmanifest"])));
});
self.addEventListener("fetch", (event) => {
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
```

Confirmed absent by grep: no `activate` handler, no `caches.delete`, no `skipWaiting`, no
`clients.claim`.

**Impact.**
1. **Stale code.** The handler is cache-first for same-origin GETs. Once `app.js` is cached
   under `tkrwallet-v3`, only bumping the `CACHE` string to `v4` will ever replace it. A
   deploy that forgets to bump ships the old wallet to returning users indefinitely. For a
   signing client, shipping a stale UI after a fix is a live risk.
2. **Cache accumulation.** Without an `activate` handler that deletes non-current caches,
   every version name ever shipped persists in the user's storage forever.
3. **Update latency.** Without `skipWaiting`/`clients.claim`, a new worker waits for all
   tabs to close, so the fix may not apply for days.

**Recommendation.** Add an `activate` handler that deletes every cache whose key is not
`CACHE`, call `self.skipWaiting()` in `install` and `self.clients.claim()` in `activate`,
and change the fetch policy for `app.js`/`index.html` to **network-first with cache
fallback** (stale-while-revalidate is also acceptable). Keeping cache-first for the shell
is fine; keeping it for the code that signs is not.

**Not a bug, contrary to first appearance:** passing a POST to `caches.match` does **not**
reject — it resolves to `undefined`, so `hit || fetch(event.request)` correctly forwards the
hosted-attach POST to the network ([confirmed behaviour](https://stackoverflow.com/questions/35270702/can-service-workers-cache-post-requests)).
The handler is nevertheless broader than it needs to be: it intercepts cross-origin requests
to `tkrpik.com` and the Solana RPC, which it should never touch. Scope it:

```js
if (event.request.method !== "GET") return;
if (new URL(event.request.url).origin !== self.location.origin) return;
```

---

### F6 — Inline script violates the MV3 CSP — **Medium (extension context only)**

**Evidence.** `index.html:74-78` registers the service worker from an inline block. MV3
applies a default `script-src 'self'` to extension pages, and **inline scripts cannot be
re-enabled in MV3** — `'unsafe-inline'` is ignored and hashes/nonces are not accepted for
`extension_pages` ([MDN: content_security_policy](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_security_policy)).

**Impact.** In the popup (`manifest.json:6`), the block is blocked and logs a CSP violation.
It is not a functional break: `navigator.serviceWorker` is not available in extension pages
anyway, so the `"serviceWorker" in navigator` guard would have skipped it. In the PWA on
GitHub Pages there is no such CSP, so registration works. The defect is a console error and a
file that is not valid under one of its two declared deployment targets.

**Recommendation.** Move the registration into `app.js` behind the same feature check:

```js
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
```

`index.html` then contains no inline script at all and is CSP-clean in both contexts. While
there, consider adding a `<meta http-equiv="Content-Security-Policy">` to `index.html` for
the PWA deployment — it costs nothing and hardens the GitHub Pages path.

---

### F7 — `SOLANA_CHAIN = 900001` is an undocumented sentinel — **Medium**

**Evidence.** `app.js:9` defines it; `app.js:77, 105, 500` use it; `app_test.js:143-150`
asserts it. Grep confirms it appears in **no documentation file**. `docs/systems/README.md`
and `tkrwallet.mmd` describe the Solana path but not this value.

**Impact.** `source_chain_id=900001` in a `swapHref` is a contract with tkrSwap. There is no
canonical EVM-style chain id for Solana; common conventions include CAIP-2
(`solana:5eykt4…`) and chain-id values such as `1399811149`. If tkrSwap does not agree on
`900001`, every Solana swap link is silently misrouted — and there is no test that could
detect this, because the test asserts the constant against itself.

**Recommendation.** Document the sentinel in `docs/systems/README.md` with its provenance and
the tkrSwap counterpart that must agree on it. If the value was chosen arbitrarily, replace
it with the convention tkrSwap already uses before more Solana surface is built on it.

---

### F8 — Invariant enforcement is grep-based and tooling is absent — **Medium**

**Evidence.** No `package.json`, no CI workflow, no linter config (verified by directory
listing). The suite is run by hand as `node app_test.js`. The security invariants are
enforced at `app_test.js:25-34` by string-searching `app.js` only.

**Impact.**
1. **Coverage gap.** The grep covers `app.js` but not `index.html` (which does contain
   `tkrpik.com` and `tkrswap.com` links — benign, but unchecked), nor `sw.js`,
   `manifest.json`, `manifest.webmanifest`, or `docs/`.
2. **Evadable.** A vendor hostname assembled at runtime (`"li" + ".fi"`) or read from a
   config would pass. The invariant *"this client contacts only tkrpik.com and tkrswap.com"*
   is currently a text assertion, not a runtime one: `GAME_URL`, `GAME_FALLBACK_URL`,
   `HOSTED_ATTACH_URL`, and `SOLANA_RPC` are passed straight to `fetch` with no origin check
   at the call site.
3. **No CI** means none of this runs on a pull request. The README's workflow guidance
   ("work in a git worktree; never commit on `main`") is convention, not enforcement.

**Recommendation.**
1. Add a minimal `package.json` (`"test": "node app_test.js"`) and a GitHub Actions job that
   runs it on `push` and `pull_request`. This is ~15 lines and converts every invariant into
   a merge gate.
2. Extend the invariant scan to the whole tree (excluding `.git` and `.worktrees`) rather
   than `app.js` alone.
3. **Enforce the allowlist in code, not just in a test.** Route every outbound call through
   one helper that asserts the origin is in `{SHELL_URL, SWAP_URL, SOLANA_RPC}`. Then the
   README's central claim is a property of the running program.

**Coverage gaps worth closing** (currently untested): `login()` with no provider;
`login()` on chain 8453; `listHoldings` failure paths (F1); `attachHosted` network failure
(the `.catch` at `app.js:399-402`); `renderCards`/`renderScoreboard` empty and missing-element
cases; `loadGame` when *both* verbs fail; `applyBatchQuery` with no `window`.

---

### F9 — No network timeouts — **Low**

**Evidence.** Grep for `AbortController` / `signal` / timeout logic returns nothing;
`fetchGame` (`app.js:344-351`) and `attachHosted` (`app.js:371-375`) pass no signal.

**Impact.** A hung tkrShell leaves `hosted-attach-status` on "Asking tkrShell…" and the index
cards on "Loading cards…" indefinitely, with no way for the user to tell a slow response from
a dead one. Given that `attachHosted` is a POST to an endpoint documented as plan-only, an
indefinite spinner is a poor outcome.

**Recommendation.** Add an `AbortController` with an ~8 s timeout to `shellFetch` and map the
abort to the existing unreachable copy ("tkrShell unreachable…"). Solana RPC calls deserve
the same treatment.

---

### F10 — Numeric precision and silent zero — **Low**

**Evidence.** `app.js:39-47`:

```js
var n = BigInt(hex || "0x0");
var d = BigInt(10) ** BigInt(decimals || 18);
return Number(n) / Number(d);
```

and `app.js:176-182` (`weiToEth`) is the same computation with `1e18` hardcoded.

**Impact.** Converting through `Number` discards precision above 2^53 and can saturate to
`Infinity` for absurd inputs; `BigInt("0x")` throws and is swallowed to `0`, so a reverting
contract reads as a genuine zero — feeding directly into F1. The two functions are
duplicates of one idea, which invites them to drift.

**Recommendation.** Deduplicate into one `rawToAmount(hex, decimals)` that returns a `BigInt`
scaled value or a formatted string, and keep the `Number` conversion only at the final
display step in `renderHoldings`. At minimum, have the catch return a distinguishable
sentinel (`null`) rather than `0`, so callers can apply the F1 fix.

---

### F11 — No account or chain change handling — **Low**

**Evidence.** `login()` (`app.js:415-474`) calls `eth_requestAccounts` once and never
subscribes to `accountsChanged` or `chainChanged`. No listener is registered anywhere.
`bindLogin` (`app.js:476-484`) attaches a single click handler.

**Impact.** After connecting, switching accounts or networks in MetaMask leaves the holdings
list showing the previous account's assets and the previous chain id. The "Connected 0x…"
status text also goes stale. For a wallet this is a correctness-of-display issue, and it is
the kind of thing users report as "the wallet is wrong."

**Recommendation.** If `provider.on` is available, subscribe to `accountsChanged` and
`chainChanged` and re-run the holdings load (clearing the list first). Also offer an explicit
disconnect/reset that clears the status text and holdings — currently there is no way to log
out.

---

### F12 — Solana address read without an explicit connect — **Low**

**Evidence.** `app.js:448-453` reads `window.solana.publicKey` directly; `window.solana.connect()`
is never called. The address is then sent to `https://api.mainnet-beta.solana.com`.

**Impact.** In practice Phantom only exposes `publicKey` after the origin has been approved, so
consent has usually been granted at some point — but it may have been granted to a different
session, and the wallet never asks. The user clicked a button labelled "Connect wallet" that
only ever talks to the EVM provider; Solana enumeration is a side effect they did not
explicitly authorise, and it transmits their Solana address to a third-party endpoint.

**Recommendation.** Call `window.solana.connect()` (or `request({ method: "connect" })`) as
part of the flow, or label the Solana portion separately ("Also show Solana holdings"). Low
severity because the practical exposure is small, but it is cheap to make explicit.

Related, lower priority: `getTokenAccountsByOwner` is filtered to the legacy
`Tokenkeg…` program (`app.js:11, 83-87`), so **Token-2022** accounts are never returned. The
current mint allowlist (USDC/USDT) makes this harmless today, but it will bite the first time
a Token-2022 asset is added.

---

### F13 — `LOGIN_URL` is dead and duplicated — **Low**

**Evidence.** `LOGIN_URL` is defined at `app.js:7`, exported at `app.js:492`, and asserted at
`app_test.js:11` — but the page hardcodes the same string at `index.html:28`. Grep confirms
no consumer.

**Impact.** Two sources of truth for the login URL; the exported constant can drift from the
link the user actually clicks, and the test would not notice.

**Recommendation.** Either drive the link from the constant (set `href` in `boot()` /
`bindLogin`) or drop the constant and its assertion. Prefer the former — it also gives one
place to handle the `next=` parameter.

---

### F14 — Documentation drift — **Low**

**Evidence.** `docs/systems/tkrwallet.mmd:2` says *"Verified against app.js, app_test.js,
manifest.json on origin/main (adb19bd)"*. Current `main` is `c4e5153`, five commits ahead;
the graph does not mention the batch-intent flow (`batchHref` / `applyBatchQuery`, added in
`0e8957d`) or the gas-legs query parameter.

**Impact.** A document that claims a specific verified revision is only as good as that
claim. Once it drifts, readers cannot tell which parts are current.

**Recommendation.** Update the verification hash, or replace it with a "last reviewed" date
so it does not silently rot. Add the consolidate/split intent path to the graph — it is a
real outbound flow (`batch_card`, `mode`, `gas` → tkrSwap) and is currently invisible in the
systems map.

---

## 5. Security posture

Treated separately because it is the repository's stated purpose.

| Claim in README / docs | Verified? | Notes |
|---|---|---|
| Never holds keys or funds | ✅ | No key material, no signing code, no storage |
| No tickerpicker `pass` paths | ✅ | Grep clean; test enforces it (`app_test.js:29`) |
| No vendor API keys (Li.Fi, 1inch, Jupiter, 0x, Alchemy, Helius, Coinbase, Uniswap, Blockscout, Stripe) | ✅ | Grep clean across the tree and history |
| Never embeds `/api/quote` | ✅ | `app.js` grep clean; test asserts it (`app_test.js:26`) |
| HTTPS only | ✅ | All three origins are `https://`; no mixed content |
| Never auto-executes | ✅ | No `eth_sendTransaction`, no `signTransaction`, no `sendTransaction` anywhere |
| Talks only to tkrpik.com / tkrswap.com | ⚠️ | Also talks to `api.mainnet-beta.solana.com` — correctly disclosed in `docs/systems/README.md`, but the README's "HTTPS only to the public tkrShell API" phrasing, read alone, understates it |
| Hosted attach returns no keys | ✅ | `attachHosted` only reads `status`/`detail` from the response body |
| XSS-safe rendering | ✅ | No `innerHTML`-family sink in the tree |
| Minimum-privilege extension | ✅ | `host_permissions` lists exactly the three origins used; no `permissions` requested |

**Two observations that are not defects but are worth stating explicitly:**

1. **There is no runtime allowlist.** The "talks only to X" property holds because no other
   URL is written down, not because the code refuses to call one. Adding a vendor integration
   later would be undetected by anything except the grep. F8's `shellFetch` recommendation
   converts a convention into an invariant.
2. **The extension and the PWA have different trust contexts for the same code.** The
   extension page benefits from `host_permissions`; the PWA depends entirely on tkrShell's
   CORS headers. A tkrShell CORS regression would silently break the PWA and not the
   extension, or vice versa. This is an integration assumption worth recording in
   `docs/systems/README.md` alongside the trust boundary — the section is otherwise excellent
   and this is the one missing line.

No security defect rises to the level of "stop shipping." The custody model is sound and the
attack surface is genuinely small.

---

## 6. Testing assessment

**What exists.** One 211-line assertion script. It is better than its size suggests: it
injects a fake provider, a fake `fetch`, and a fake Solana RPC function; it covers the
snapshot-to-`/api/public/game` fallback (`app_test.js:152-178`), the three hosted-attach
outcomes (`app_test.js:179-205`), batch-mode normalisation including hostile input
(`app_test.js:55-65`), and EVM/Solana holdings (`app_test.js:76-150`). The module split makes
all of this possible, which is the single most valuable design decision in the file.

**Weaknesses.**

- **It is one script, not a suite.** A failure aborts the chain; there is no per-test
  reporting, so a regression tells you *that* something broke, not *what*. The success signal
  is a bare `console.log("ok")` (`app_test.js:203`).
- **Async assertions depend on the process staying alive.** The promise chain does keep the
  event loop busy, so this works today, but it is fragile: any future `await`-free early exit
  would let Node return 0 before the assertions run. An explicit `await`/`then` with a final
  `process.exitCode` is more honest.
- **The invariant scan covers one file** (F8).
- **`__filename.replace("app_test.js", "index.html")`** (`app_test.js:16, 25`) is a brittle
  way to locate siblings — it would misbehave if the path contained the string twice. A
  `path.join(__dirname, ...)` is clearer.
- **No negative tests for network failure**, which is precisely where F1 lives.

**Recommendation.** Keep the zero-dependency style — do not pull in Jest for 200 lines. Wrap
each concern in a named `test("…", fn)` helper that prints a pass/fail line and aggregates
failures so the whole suite runs to completion, then add the missing cases listed under F8.

---

## 7. Documentation assessment

The documentation is a real strength and unusual for a repository this size. `README.md`
states the custody model, the trust boundary, and the funnel's shape in under 60 lines.
`docs/systems/README.md` adds an explicit "What it is not" section and an honest note that a
"talks via our CLI" expectation is *not implemented here* — that kind of disconfirmation is
rare and valuable.

Gaps, in order of importance:

1. **`SOLANA_CHAIN = 900001` is undocumented** (F7) — the highest-value documentation fix.
2. **The systems map is pinned to a stale revision** (F14) and omits the batch-intent flow.
3. **The README's "HTTPS only to the public tkrShell API" phrasing** does not mention the
   Solana RPC origin, which the systems doc does. Align them.
4. **CORS / credentials expectations for tkrShell are not written down** — see §5 and F4.
   This is the kind of integration assumption that is obvious to the author and invisible to
   the next reader.
5. **No contribution or release process.** The README says "work in a git worktree; never
   commit on `main`", but there is no `CONTRIBUTING.md`, no release checklist, and no note on
   how `manifest.json`'s `version` (`0.3.0`) relates to the SW cache name (`v3`) — which is
   exactly the coupling that F5 shows is easy to get wrong.

---

## 8. Prioritised recommendations

**Before the next release**

1. **F1** — Stop reporting "balance unavailable" as "zero balance"; delete the fabricated ETH
   row. *(Correctness)*
2. **F2** — Remove the cross-chain catalog fallback; treat uncatalogued chains as native-only.
   *(Correctness)*
3. **F3** — Ship PNG extension icons at 16/32/48/128 and add `action.default_icon`.
   *(Packaging)*

**Next**

4. **F4** — Decide with tkrShell whether hosted attach is authenticated; make the code match.
   *(Integration)*
5. **F5** — Add `activate` cleanup, `skipWaiting`, `clients.claim`, and network-first for
   `app.js`/`index.html`; scope the fetch handler to same-origin GETs. *(Operations)*
6. **F6** — Move the SW registration into `app.js`; `index.html` becomes CSP-clean for both
   targets. *(Packaging)*
7. **F8** — Add `package.json` + a CI job; extend the invariant scan to the whole tree.
   *(Process)*

**Backlog**

8. **F7** — Document (or replace) the `900001` sentinel.
9. **F9** — Timeouts on all outbound calls.
10. **F10** — Deduplicate and de-`Number` the amount conversion; return `null` on failure.
11. **F11** — Subscribe to `accountsChanged` / `chainChanged`; add disconnect.
12. **F12** — Explicit Solana `connect()`; note the Token-2022 limitation.
13. **F13 / F14** — Remove the `LOGIN_URL` duplication; refresh the systems map.

---

## 9. Verification performed

| Check | Result |
|---|---|
| `node app_test.js` | `ok`, exit 0 |
| `innerHTML` / `eval` / `new Function` / `document.write` in tree | none |
| Vendor hostnames, `pass` paths, key prefixes | none (tree and history) |
| `eth_sendTransaction` / `signTransaction` / `sendTransaction` | none |
| `credentials` / `AbortController` / `signal` in `app.js` | none (basis for F4, F9) |
| `activate` / `skipWaiting` / `clients.claim` in `sw.js` | none (basis for F5) |
| `900001` in documentation | none (basis for F7) |
| `LOGIN_URL` consumers | none outside tests (basis for F13) |
| Working tree | clean; `docs/systems/tkrwallet.mmd` pins `adb19bd`, `main` is `c4e5153` (F14) |
| `.worktrees/gauntlet-session-ask` | gitignored stale checkout of `feat/gauntlet-session-ask`; not a defect |

**Limitations.** tkrShell (`tkrpik.com`) is a separate, private repository and was not
available for inspection; findings that depend on its behaviour are marked
**[needs tkrShell confirmation]** and should be verified before acting on them. No live
network calls were made. The extension was not loaded into a browser, so F3 and F6 rest on
documented platform behaviour rather than on observed failures in this environment.

---

## 10. Bottom line

This is a small, honest, well-documented client that does what it claims and does not
overreach. The custody model is correct, the rendering is XSS-safe, and the dependency-free
build is the right choice for a signing surface. The defects found are almost all in the
*reporting* layer rather than the *custody* layer — the wallet can tell a user something
untrue about their balances (F1, F2), ship without an icon (F3), and go stale in the cache
(F5), but it cannot lose funds, leak a key, or execute a trade the user did not ask for.

Fixing F1, F2, and F3 would take an afternoon and remove every finding I would call
user-visible. Adding CI and the runtime origin allowlist (F8) would make the repository's
central security claim something the code enforces rather than something a grep hopes for.
