# tkrWallet — Technical Review

**Revision reviewed:** `feat/scratchpost-wallet` @ `24c9a87` (worktree
`.worktrees/scratchpost-wallet`)
**Baseline:** `main` @ `c4e5153`, untouched
**Method:** full read of every shipped file, automated invariant checks, and
direct greps for network sinks and origins. Every claim below is reproduced
from the tree, not from memory.
**Gate state:** `npm test` ok · `check:css` clean · `check:classes` 116/116.

---

## 1. Verdict

**The shell is in good shape. The wallet is not finished, and the review should
not pretend otherwise.**

What exists is a clean, dependency-free, well-tested *interface shell* with
genuinely strong security hygiene in the parts that have been written. What does
not exist yet is the wallet: there is no data layer, no balances, no connection
to anything. `app.js` — the old v1 logic — is dead code that the shell never
loads.

So the honest summary is: **excellent bones, no muscle yet.** The strengths below
are real and mostly structural, which is exactly when they are cheap to get
right and expensive to retrofit.

---

## 2. Strengths

### S1 — Zero internal-network surface (verified)

The single most important property asked for, and it holds:

```
grep -rE 'a\.b\.c\.d|w\.x\.y\.z|localhost|:NNNN|\.local' \
  index.html ui.js app.js sw.js manifest.json manifest.webmanifest
→ no matches
```

No chain-host address, no brain port, no `.local`. The wallet cannot
address the internal network because no internal address appears anywhere in it.
That is a stronger guarantee than a network policy, because it survives a
misconfigured firewall.

### S2 — The shell has no network capability at all

`ui.js` contains no `fetch`, no `XMLHttpRequest`, no `WebSocket`, no
`EventSource`, no `sendBeacon`. The only `fetch` in the tree is the service
worker's pass-through (`sw.js:6`), which forwards the browser's own request
rather than choosing a destination.

This is enforced, not observed: `app_test.js` asserts the absence of those calls,
so the property cannot regress silently.

### S3 — No markup-string sink anywhere

No `.innerHTML`, `.outerHTML`, `.insertAdjacentHTML`, `document.write`, or
`eval` in `ui.js` or `index.html`. Every dynamic value goes through
`textContent` or `setAttribute`. Also asserted in the test suite.

For a wallet this is the difference between "XSS is hard" and "XSS is a bug
class we have to keep re-auditing."

### S4 — Zero runtime dependencies, and a build that cannot leak into the extension

No framework, no bundler for JS, no runtime npm packages. `package.json` has
**no dependencies at all**; Tailwind lives in `tools/` as a build-only
devDependency, and `node_modules` is gitignored specifically so it never lands
beside `manifest.json` in the unpacked extension.

The consequence: the thing that ships is the thing that is readable. For a
client that signs transactions, that is a security property, not tidiness.

### S5 — The invariants are executable

Four separate guards, all wired into CI:

| Guard | Catches |
|---|---|
| `app_test.js` | vendor strings, XSS sinks (app), network calls (ui), route parsing, fiat honesty |
| `check:css` | committed CSS drifting from source |
| `check-classes` | a class used in markup that does not exist in `app.css` |
| `check:classes` in CI | all of the above on every push and PR |

The class-resolution guard is unusual and worth calling out: `app.css` is a
committed build artifact and class names are hand-written, so a typo otherwise
renders unstyled with **no error anywhere** — not in the console, not in CI.

### S6 — Honest UX as a design rule

Three places where the interface refuses to lie:

- `formatFiat(null)` returns **—**, never `$0.00`. "We could not price this" and
  "this is worth nothing" are different claims, and a wallet that confuses them
  is dangerous.
- Swap ships as an explicit **Under construction** panel that names the reason
  (routing has to be written for this stack).
- Activity states that history is **device-local** and that the nodes are pruned,
  so the list will not claim to be complete.

### S7 — Mobile-first and same-origin by construction

360 px layout (MV3 popups cap at 800×600, so one layout serves both targets),
safe-area insets via `env()`, `height: 100vh` for the iOS chin gap, 44 px minimum
touch targets, `viewport-fit=cover`, and the same-origin decision that removes
CORS, preflight, and third-party cookies from the design entirely.

### S8 — Accessibility baseline is present

Skip link, `aria-live` status region, `aria-pressed` on the currency toggle,
`aria-selected` on nav, `focus-visible` outlines on every control, `sr-only`
headings on each screen, `aria-hidden` on decorative SVG. (One real defect — W5.)

---

## 3. Weaknesses

Severity is about consequence to a user or to the security posture, not effort.

### W1 — Three third-party origins are still live in the tree and in the manifest — **High**

`app.js` still contains `https://api.mainnet-beta.solana.com`,
`https://tkrpik.com`, and `https://tkrswap.com`, and `manifest.json` still grants
all three:

```json
"host_permissions": [
  "https://tkrpik.com/*",
  "https://tkrswap.com/*",
  "https://api.mainnet-beta.solana.com/*"
]
```

`sw.js:3` also caches `./app.js`, so the dead file is fetched and stored.

**Why it matters despite being dead code.** `index.html` loads only `ui.js`, so
none of this executes. But `host_permissions` is a *live* capability grant: any
future script in the extension — including one added by a compromised
dependency — may call those origins without further review. And a public Solana
RPC in the trust path of a self-custody wallet is exactly what the edge spec
exists to remove.

**Fix (M3, already scoped).** Delete `app.js`, `renderBeaver` and the v1 fetch
layer; drop `host_permissions` to `https://tkrwallet.scratchpost.ai/*` alone;
drop `./app.js` from the service-worker precache. Then make it an invariant:

```
assert no origin in the shipped tree other than tkrwallet.scratchpost.ai
assert manifest host_permissions === ["https://tkrwallet.scratchpost.ai/*"]
```

### W2 — There is no Content-Security-Policy anywhere yet — **High**

The plan and the spec both lean on `connect-src 'self'` as the mechanism that
*makes* "the wallet never talks to the chain host" enforceable rather than aspirational.
**That enforcement does not exist yet.** There is no CSP meta tag in
`index.html`, no CSP in `manifest.json`, and no header because the edge is not
built.

Right now the only thing preventing an outbound call is that no code makes one.
That is a code-review property, not a browser-enforced one.

**Fix — and this is cheap, so do it before the edge exists:**

1. **PWA:** add to `index.html`
   `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'self'">`
2. **Extension:** MV3 lets `manifest.json` **tighten** `extension_pages`. Add
   `"content_security_policy": { "extension_pages": "script-src 'self'; object-src 'none'; connect-src 'self' https://tkrwallet.scratchpost.ai" }`
   — note the explicit origin, because in the extension `'self'` is
   `chrome-extension://<id>`, not the wallet host.
3. Keep the edge header as the authoritative copy; the meta tag is defence in
   depth for the window before headers exist and for any host that forgets them.

### W3 — `sw.js` is unchanged from v1 and is the weakest file in the tree — **High**

```js
const CACHE = "tkrwallet-v3";
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE)
  .then(c => c.addAll(["./", "./index.html", "./app.js", "./manifest.webmanifest"]))));
self.addEventListener("fetch", e => e.respondWith(
  caches.match(e.request).then(hit => hit || fetch(e.request))));
```

Four defects, all previously identified and none fixed:

1. **Cache-first for the shell.** Once `index.html`/`ui.js` are cached, only
   bumping the `CACHE` string replaces them. A deploy that forgets to bump ships
   the old wallet indefinitely — for a signing client, that is a live risk.
2. **No `activate` handler**, so every `tkrwallet-vN` cache ever created persists
   forever.
3. **No `skipWaiting`/`clients.claim`**, so a fix waits for every tab to close.
4. **Unscoped caching.** `caches.match(e.request)` runs for every request
   including cross-origin ones, and `fetch(e.request)` forwards them. It should
   only handle same-origin GETs.

It also precaches `app.js`, which W1 deletes.

**Fix.** Add an `activate` handler deleting non-current caches, `skipWaiting` +
`clients.claim`, network-first for `index.html`/`ui.js`/`app.css` with cache
fallback, and:

```js
if (event.request.method !== "GET") return;
if (new URL(event.request.url).origin !== self.location.origin) return;
```

### W4 — Extension packaging is still v1 — **Medium**

`manifest.json`:

| Problem | Consequence |
|---|---|
| `"icons": { "128": "icon.svg" }` | **Chrome does not support SVG for extension icons.** The extension ships with no working icon. |
| No `action.default_icon` | Same. |
| Description still mentions "tkrpik cards, scoreboard, Beaver Nickels" | Stale; describes a product that no longer exists. |
| No `key` | The `chrome-extension://<id>` origin varies per unpacked install, so the edge cannot allow-list it — which CORS for the extension depends on (spec §5). |
| `host_permissions` (see W1) | Over-broad. |

**Fix (M11, but the icon and `key` are quick wins).** Export PNG 16/32/48/128,
add `action.default_icon`, generate and pin a `key`, rewrite the description.

### W5 — The tab pattern is invalid ARIA — **Medium**

All four nav buttons declare `role="tab"`, but there are **no `role="tabpanel"`
elements and no `aria-controls`**. A `tab` that controls nothing is worse for
screen-reader users than a plain link: it announces a widget with no panels, and
arrow-key navigation that the pattern implies does not exist.

**Fix — pick one, both are small:**

- **Preferred:** drop `role="tab"`/`aria-selected` and use a plain `<nav>` with
  `<a href="#/home">` links. The hash router already gives correct semantics,
  deep links, and back-button behaviour for free.
- Or complete the pattern: `role="tabpanel"` + `id` on each `<section>`,
  `aria-controls` on each tab, and roving `tabindex` with arrow-key handling.

### W6 — Beaver Nickels removal is incomplete — **Medium**

Still present in `manifest.webmanifest:4` (user-visible description),
`app_test.js` (5 references), and `app.js` (`renderBeaver`, `applyGame`).
`index.html` is clean. This is M3 scope, but it is user-visible today in the
install prompt.

### W7 — PWA manifest fights the dark theme — **Low**

```
index.html            theme-color      #12100e   (new warm-dark base)
manifest.webmanifest  theme_color      #1c1917   (v1)
manifest.webmanifest  background_color #f3f0e6   (v1 cream)
```

`background_color` is the splash screen. A cream splash flashing to a near-black
wallet is exactly the "crappy page" impression we are trying to kill.

**Fix.** `theme_color: "#12100e"`, `background_color: "#12100e"`.

### W8 — A future server value reaches a CSS property — **Low, but fix before M3**

```js
// ui.js:210
badge.style.backgroundColor = holding.color || "#cfc8b8";
```

Style-property assignment (not a string sink) so the injection risk is minimal —
an invalid colour is simply ignored. But it is the first place a *server-supplied*
value touches presentation, and M3 will feed this from real data.

**Fix.** Map symbol → colour through a local table in the client, and ignore any
colour from the wire.

### W9 — Only one `aria-live` region — **Low**

`#account-status` announces connection changes. Balance updates, price refreshes
and errors are silent to assistive tech. **Fix in M3**, when there is data to
announce.

### W10 — Test suite is still a single script — **Low**

`app_test.js` aborts on the first failure and reports no per-test name, so a
regression says *that* something broke, not *what*. Deferred twice; it is worth
doing when M3 rewrites the tests anyway.

---

## 4. What is missing entirely

Not weaknesses — absences, listed so the review is not mistaken for a verdict on
a finished product.

| Missing | Milestone |
|---|---|
| Data layer: balances, prices, currency conversion | M3 |
| Any connection to the edge | M4/M5 |
| Wallet connection (injected provider) | M3 |
| Send / Receive | M7 |
| Swap engine (does not exist anywhere in the stack) | M8 |
| Activity persistence | M10 |
| The edge itself (`tkrwallet.scratchpost.ai`) | M4/M5 |
| Price + CAD source (no FX concept exists in the backend) | M6 |

---

## 5. Prioritised recommendations

**Before M3**

1. **W2** — add the CSP meta tag and the MV3 `extension_pages` policy. Small, and
   it converts the central security claim from aspirational to enforced.
2. **W4** — PNG icons + `action.default_icon` + a pinned `key`, so the extension
   is installable and its origin is allow-listable.

**In M3**

3. **W1** — delete `app.js`, cut `host_permissions` to the single wallet origin,
   and add the two new invariants (no foreign origin; exact permission list).
4. **W3** — rewrite `sw.js` with lifecycle, cache discipline, and origin scoping.
5. **W6** — finish the beaver removal, including the web manifest description.
6. **W7** — align the web manifest colours to the dark theme.
7. **W8** — stop trusting a wire-supplied colour.
8. **W10** — convert the suite to named tests while the tests are being rewritten.

**Before shipping**

9. **W5** — fix the tab semantics (prefer plain links).
10. **W9** — announce balance and error updates.

---

## 6. Verification performed

| Check | Result |
|---|---|
| Internal-network addresses in shipped files | **none** |
| Network sinks in `ui.js` | **none** |
| Markup-string sinks (`innerHTML` family, `eval`) | **none** |
| Absolute origins in shipped files | 3, all in dead `app.js` + `manifest.json` (W1) |
| `node app_test.js` | `ok` |
| `npm run check:css` | no diff |
| `npm run check:classes` | 116/116 present |
| Files tracked | 26 |
| `main` | clean, unmoved at `c4e5153` |
| Licensed Tailwind Plus kits | gitignored, not tracked |

**Limits of this review.** The shell has never been rendered in a browser — every
UI claim is structural (tests, class resolution, valid CSS) rather than visual.
The edge does not exist, so no claim about the runtime enforcement of same-origin,
CORS or CSP can be tested; they are design intent. Host state (nginx installed or
not, firewall rules, whether `` is live) is not verifiable from this machine.
