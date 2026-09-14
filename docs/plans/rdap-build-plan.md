# RDAP Build Plan — tkrWallet Hardening & M3 Completion

**Methodology:** Research-Driven Adaptive Planning (RDAP) — Double Diamond ×
Spiral × small-win milestones with strict Definitions of Done, per operator
instruction.
**Inputs:** conversation history · `docs/reviews/wallet-technical-review.md` ·
`docs/security/security-audit.md` · `docs/specs/edge-server.md` ·
`docs/specs/tailwind-plus-usage.md`.
**Worktree:** `.worktrees/scratchpost-wallet` on `feat/scratchpost-wallet`
(existing — see §4 lifecycle note). `main` stays untouched at `c4e5153`.

---

## 1. Scope of work

### 1.1 Primary goal

Execute the "Now" list and M3 of the two audit documents, so that the wallet
client satisfies every enforceable invariant the audits define, has a working
EVM data layer, and is verified, documented, pushed, and PR'd.

### 1.2 Non-goals (deliberate exclusions)

- No backend or edge implementation (the edge, facade, prices, swap engine) — the
  spec exists; the servers are separate work.
- No commits to `blockchain-infrastructure` or `tickerpicker`. The router fixes
  (R-1…R-12) are delivered as an artifact here, not applied there.
- No React/Catalyst runtime (decision D12 stands).
- No Send/Receive/Swap functionality beyond the existing honest shells.
- No live network calls from tests or from this machine.

### 1.3 Success criteria / Definition of Done

| # | Criterion | Measurement |
|---|---|---|
| S1 | Gate green | `npm run check` exits 0 |
| S2 | Named test harness | `app_test.js` reports per-test PASS/FAIL, ≥ 40 assertions |
| S3 | Single-origin tree | grep-assertion: only `https://tkrwallet.scratchpost.ai` occurs in shipped files |
| S4 | Single-origin permissions | `host_permissions` === `["https://tkrwallet.scratchpost.ai/*"]` (asserted) |
| S5 | CSP present in both targets | meta tag in `index.html`; `extension_pages` in `manifest.json` (asserted) |
| S6 | v1 gone | `app.js` deleted; no `beaver` (case-insensitive) in shipped files (asserted) |
| S7 | sw.js rewritten | `activate` + `skipWaiting` + `clients.claim` + origin/method scoping (asserted) |
| S8 | Extension packagable | PNG icons 16/32/48/128 with valid PNG magic; `action.default_icon`; pinned `key` with recorded ID |
| S9 | PWA manifest aligned | `theme_color`/`background_color` `#12100e`; clean description |
| S10 | Data layer tested | `wallet.js` unit tests with a fake EIP-1193 provider: native + ERC-20, unknown ≠ zero, unsupported chain degrades |
| S11 | UI wired | connect button opens provider; holdings render; currency toggle re-renders; `aria-live` announces |
| S12 | Docs current | README rewritten; CHANGELOG; audit-finding status table |
| S13 | Edge artifact | `deploy/nginx/tkrwallet-edge.conf.template` (audit §6) |
| S14 | Delivered | branch pushed; PR opened via `gh`; `main` still `c4e5153` |

### 1.4 Constraints

- Zero runtime dependencies; no JS build; Tailwind v4 via `tools/` only.
- MV3: no inline script, no remote code, no `unsafe-eval`; CSP only tightened.
- GPLv3 + public: no Tailwind Plus kit material committed (kits gitignored).
- Conservative JS style (`var`, `function`) matching `ui.js`.
- Commit after every milestone; work only in the worktree.

### 1.5 Assumptions

- Edge = `https://tkrwallet.scratchpost.ai`, same-origin (D5).
- Prices unavailable until the edge ships → fiat renders `—`, never `$0.00`.
- EVM balances come from the injected provider (EIP-1193). Solana has no client
  read source (D10 pending) → Solana is catalogued but not queried.
- `gh` remains authenticated (verified in Phase 0).

### 1.6 Environment (verified Phase 0)

Node v24.15.0 · npm 11.12.1 · `convert` + `inkscape` + `openssl` (icon work) ·
`gh` authenticated as `coldcanuk` (scopes `repo`, `workflow`) · worktree at
`aad5416`, gate green.

### 1.7 Top risks

| Risk | Mitigation |
|---|---|
| R1 MV3 CSP misconfiguration breaks the popup | Conservative policy per Chrome docs; string-asserted in tests |
| R2 Deleting `app.js` breaks the v1 tests | Test rewrite in the same milestone (M3.2) |
| R3 Icon rasterization fails (fonts) | Shape-only SVG (no text) → inkscape; PNG magic verified |
| R4 Provider variance | EIP-1193 only; fake provider in tests; graceful degrade |
| R5 Push/PR failure | `gh` verified; fallback = report exact commands |
| R6 CSS drift from hand-written classes | `check:classes` guard already in CI |

---

## 2. Phase map

```
Phase 0  Environment & Isolation      M0.1–M0.2   [DONE this session]
Phase 1  Research & Discovery         M1.1–M1.4   → RESEARCH.md + updated plan
Phase 2  Define / Architecture        M2.1–M2.2   contracts, risk register, freezes
Phase 3  Implementation               M3.1–M3.9   one milestone per commit
Phase 4  Verification & Delivery      M4.1–M4.4   gate, audits, docs, push + PR
```

Hard rules: tasks finish before milestones close; milestones before phases;
every task carries its milestone ref, commands, and a verification step.

---

## 3. Phase 0 — Environment & Isolation (DONE)

**M0.1 — Verify environment and gates.** ✅ Verified above in §1.6.

**M0.2 — Baseline snapshot.**
```bash
cd /opt/repo/tkrWallet/.worktrees/scratchpost-wallet
git log --oneline -1            # aad5416 — baseline for this build
npm run check                   # green
```
Recorded in the milestone commit message.

---

## 4. Worktree lifecycle (adapted from the template)

The template's fresh-worktree step is **adapted**: this build continues in the
existing `.worktrees/scratchpost-wallet` on `feat/scratchpost-wallet`, which
already carries the M1/M2 work and the audits. Forking a new worktree from
`main` would orphan ten reviewed commits. Everything else follows the template
exactly:

```bash
# after every milestone
git add .
git commit -m "Milestone X.Y: <what was achieved>"

# Phase 4 delivery
git push -u origin feat/scratchpost-wallet
gh pr create --fill
# merge happens after CI/review (operator or gh), then:
#   cd /opt/repo/tkrWallet && git checkout main && git pull
#   git worktree remove .worktrees/scratchpost-wallet
# (executed in Phase 4, after the PR is opened)
```

---

## 5. Phase 1 — Research & Discovery

### M1.1 — MV3 CSP tightening rules [RESEARCH]

Task 1 of M1.1 — confirm `extension_pages` supports `connect-src` tightening:
`web_search "content_security_policy extension_pages connect-src manifest v3"`.
**Verified:** yes — Chrome enforces a *minimum* of `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';` and permits further restriction of other
directives including `connect-src`
([Chrome manifest docs](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)).
Task 2 — confirm `key` field format and generation:
**Verified:** base64 DER `SubjectPublicKeyInfo` public key;
`openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A`; ID =
SHA-256 of DER, first 32 chars, hex→`a-p`.

### M1.2 — Icon toolchain [RESEARCH]

Task 1 — inventory: `convert` (ImageMagick) and `inkscape` are present.
Task 2 — decision: **shape-only SVG** (no text → deterministic rasterization,
no font dependency), rendered by inkscape at 16/32/48/128.

### M1.3 — Provider API (EIP-1193) [RESEARCH, from knowledge]

Task 1 — freeze the provider contract used by `wallet.js`:
`eth_requestAccounts`, `eth_chainId`, `eth_getBalance`, `eth_call` (ERC-20
`balanceOf`), error semantics = rejection; no other provider methods are used.
Task 2 — freeze the fallback: any failure yields `{value}|{unknown}`, never zero.

### M1.4 — Synthesis gate (mandatory)

Task 1 — write `docs/research/RESEARCH.md` consolidating: the audit findings
(W1–W10, S1–S7, R1–R12), the MV3/key facts, the icon decision, the provider
contract, and the revised milestone order.
Task 2 — commit:
```bash
git add . && git commit -m "Milestone 1.4: research synthesis — RESEARCH.md and RDAP plan"
```

---

## 6. Phase 2 — Define / Architecture

### M2.1 — Client architecture

Task 1 — write `docs/architecture/client.md`:
file map (`index.html` → `ui.js` → `wallet.js`; `sw.js`; `app.css`; icons),
component boundaries (shell never fetches; data layer is the only network
caller; single origin constant), and the data shapes.
Task 2 — record the invariant list as executable tests (§7, S2–S6).

### M2.2 — Decision freeze

Task 1 — update `docs/plans/scratchpost-wallet.md` §9: D1–D12 statuses, with
D10 (Solana) recorded as **catalogued-not-queried** pending the edge.
Task 2 — update the risk register in this plan if anything moved.
Task 3 — commit `"Milestone 2.2: architecture and decisions frozen"`.

---

## 7. Phase 3 — Implementation

### M3.1 — CSP + origin invariants (security audit S-2, S-3)

Task 1 — add the CSP meta tag to `index.html` (after the theme-color metas):
```bash
python3 - <<'EOF'
import re
p="index.html"; s=open(p).read()
csp='''    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'self'" />\n'''
s=s.replace('    <link rel="stylesheet" href="./app.css" />',''+csp+'    <link rel="stylesheet" href="./app.css" />',1)
open(p,"w").write(s)
EOF
```
**Verify:** `grep -c "Content-Security-Policy" index.html` → 1.

Task 2 — add `content_security_policy.extension_pages` to `manifest.json` (M3.8
holds the final manifest; this lands the policy now):
```bash
python3 - <<'EOF'
import json
d=json.load(open("manifest.json"))
d["content_security_policy"]={"extension_pages":"script-src 'self'; object-src 'none'; connect-src 'self' https://tkrwallet.scratchpost.ai; img-src 'self' data:; style-src 'self'"}
open("manifest.json","w").write(json.dumps(d,indent=2)+"\n")
EOF
```
**Verify:** `node -e "console.log(JSON.parse(require('fs').readFileSync('manifest.json')).content_security_policy)"`.

Task 3 — add the two origin invariants to `app_test.js`:
- shipped files contain no `https://` origin other than the wallet origin;
- `manifest.json.host_permissions` deep-equals the single origin.
```js
const ALLOWED_ORIGIN = "https://tkrwallet.scratchpost.ai";
["index.html","ui.js","sw.js","manifest.json","manifest.webmanifest"].forEach(f=>{
  const t=fs.readFileSync(f,"utf8");
  [...t.matchAll(/https?:\/\/[a-zA-Z0-9._-]+/g)].forEach(m=>{
    assert.strictEqual(m[0],ALLOWED_ORIGIN, f+" must reference only the wallet origin, found "+m[0]);
  });
});
assert.deepStrictEqual(JSON.parse(fs.readFileSync("manifest.json")).host_permissions,[ALLOWED_ORIGIN+"/*"]);
```
**Note:** these assertions fail until M3.2 lands — commit M3.1 **without** the
tests, or land M3.1+M3.2 as one commit. Decision: **M3.1 and M3.2 commit
together** as `"Milestone 3.2: CSP, origin invariants, v1 removal"`.

### M3.2 — Remove v1 (W1, W6, S-1, S-5)

Task 1 — delete `app.js`:
```bash
git rm app.js
```
Task 2 — finish Beaver Nickels removal: `manifest.webmanifest` description →
"Self-custody wallet for the Scratchpost stack. You hold the keys."
Task 3 — `manifest.json`: `host_permissions` → `["https://tkrwallet.scratchpost.ai/*"]`;
description → "Self-custody wallet for Scratchpost. You hold the keys.";
Task 4 — rewrite `app_test.js` v1 sections as a named harness (M3.5 grows it;
here: delete `require("./app.js")` tests, keep shell + ui tests, add the origin
invariants and a `test(name,fn)` runner that aggregates failures).
Task 5 — remove `./app.js` from `sw.js` precache (full rewrite in M3.3).
**Verify:** `npm test` green · `grep -rni beaver index.html ui.js sw.js manifest.json manifest.webmanifest` → empty · origin assertions pass.

### M3.3 — sw.js rewrite (W3, S-4)

Task 1 — overwrite `sw.js`:
```bash
cat > sw.js <<'EOF'
const CACHE = "tkrwallet-v1";
const SHELL = ["./", "./index.html", "./ui.js", "./app.css"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
EOF
```
Network-first for the shell, cache fallback, no cross-origin handling.
**Verify:** `node --check sw.js` · assertions in `app_test.js` for
`skipWaiting`, `clients.claim`, `new URL(e.request.url).origin`.

### M3.4 — Extension packaging (W4, W7, S-6)

Task 1 — shape-only icon SVG `icons/icon.svg` (ink rounded square + ember bars):
```bash
mkdir -p icons && cat > icons/icon.svg <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#1c1917"/>
  <g fill="#e8a33d">
    <rect x="28" y="72" width="16" height="28" rx="6"/>
    <rect x="56" y="48" width="16" height="52" rx="6"/>
    <rect x="84" y="28" width="16" height="72" rx="6"/>
  </g>
</svg>
EOF
```
Task 2 — rasterize:
```bash
for s in 16 32 48 128; do inkscape -w $s -h $s icons/icon.svg -o icons/icon$s.png; done
file icons/icon*.png   # must say PNG image data
```
Task 3 — `manifest.json`: `icons` → png sizes; `action.default_icon`; drop SVG.
Task 4 — pin the key:
```bash
openssl genrsa 2048 2>/dev/null | openssl pkcs8 -topk8 -nocrypt -out key.pem
PUB=$(openssl rsa -in key.pem -pubout -outform DER 2>/dev/null | openssl base64 -A)
EXTID=$(openssl rsa -in key.pem -pubout -outform DER 2>/dev/null | openssl dgst -sha256 -binary | head -c32 | tr 0-9a-f a-p)
```
Inject `"key": "<PUB>"` into `manifest.json`; record the ID in
`docs/specs/edge-server.md` §5 and CHANGELOG; **gitignore `key.pem`** (private
CRX key must never be committed); print the ID for the record.
**Verify:** `openssl rsa -in key.pem -pubout -outform DER 2>/dev/null | openssl dgst -sha256 -binary | head -c32 | tr 0-9a-f a-p` matches the recorded ID.

### M3.5 — a11y + named test harness (W5, W9, W10)

Task 1 — fix the tab pattern: replace `role="tab"`/`aria-selected` with plain
links inside the existing `<nav>`:
```html
<nav aria-label="Sections" class="...">
  <a href="#/home" data-nav="home" class="...">…</a>
  ...
</nav>
```
**Verify:** `grep -c 'role="tab"' index.html` → 0.
Task 2 — add `aria-live` region for balance updates (`#wallet-status`, polite)
Task 3 — convert `app_test.js` to a named harness:
```js
let failures=[],count=0;
function test(name,fn){count++;try{fn();console.log("ok  "+name)}catch(e){failures.push(name+": "+(e&&e.message));console.error("FAIL "+name+" — "+e.message)}}
function end(){if(failures.length){console.error(failures.join("\n"));process.exit(1)}console.log(count+" tests, 0 failures")}
```
Wrap each assertion group in `test("…", …)`; call `end()` at the end.
**Verify:** output lists per-test lines and ends `N tests, 0 failures`.

### M3.6 — wallet.js data layer (M3 core, S-10)

Task 1 — create `wallet.js` exposing a UMD-style API (like `ui.js`):
- `CATALOG`: chains 1 / 8453 / 4663 (native + USDC/USDT/WETH), Solana
  `900001` **catalogued-not-queried**.
- `BASE_URL = "https://tkrwallet.scratchpost.ai"` (the only origin constant).
- `connect(provider)` → `{ address, chain_id }` via `eth_requestAccounts` +
  `eth_chainId`.
- `listHoldings(provider, address, chainId)` → per-asset
  `{ symbol, address?, chain_id, chain_name, amount, state: "ok"|"unknown" }`;
  balance reads via `eth_getBalance` (native) and `eth_call` (`balanceOf`,
  ABI `0x70a08231` + 32-byte address); every failure → `state:"unknown"`,
  never `amount:0`.
- `getPrices(assets)` → `fetch(BASE_URL + "/api/wallet/prices?...")`, absent
  assets omitted; network failure → `null` → UI shows `—`.
- `estimateValue(holdings, prices, currency)` → `{ value }|{ unknown }`.
Task 2 — unit tests in `app_test.js` with a fake EIP-1193 provider (reuse the
pattern from the deleted v1 tests, adapted to `state` semantics).
**Verify:** `npm test` green, including: native balance 1 ETH → `amount` 1;
ERC-20 `0xf4240` (6 dp) → 1; failing `eth_call` → `state:"unknown"`; unsupported
chain id → native-only catalogue; `wallet.js` contains no origin other than
`BASE_URL` (origin assertion covers it).

### M3.7 — Wire the shell (S-11)

Task 1 — `index.html`: `connect` button in the header (replace the static
account chip's passive state) with `id="account-btn"` already present —
extend `ui.js`:
- click → `wallet.connect(provider)` → `setAccount(address)` → render holdings.
- token rows via the existing `#tpl-token-row` template, `state` unknown →
  amount `—` with chain label.
- value block: `setWalletValue(estimateValue(...))` → `—` until prices exist,
  note "Prices unavailable until the wallet edge ships."
- currency toggle re-renders fiat column.
Task 2 — `#wallet-status` announcements on connect/error (W9).
**Verify:** `npm test` green · `grep -c "wallet.js" index.html` → 1.

### M3.8 — Extension CSP/permissions final + README (S-4, S-5)

Task 1 — final `manifest.json` review: key, icons, host_permissions,
`content_security_policy`, description, version bump `0.4.0`.
Task 2 — README rewrite: Scratchpost/the edge topology, `tkrwallet.scratchpost.ai`,
run-as-PWA, load-unpacked, licence notes, `npm run check`.

### M3.9 — Edge deploy artifact (S-13)

Task 1 — `deploy/nginx/tkrwallet-edge.conf.template`: the audit §6 vhost
(TLS + HSTS + CSP `connect-src 'self'` + CF origin-pull + rate limits + no RPC
passthrough), with `{{PLACEHOLDERS}}` for certs/upstream.
Task 2 — `deploy/README.md`: install steps, `nginx -t` verification, the
R-1/R-3/R-4 prerequisites.

---

## 8. Phase 4 — Verification, Polish & Delivery

### M4.1 — Full gate + static audit

```bash
npm run check
node --check ui.js && node --check wallet.js && node --check sw.js
grep -rniE 'beaver' index.html ui.js wallet.js sw.js manifest.json manifest.webmanifest || true   # must be empty
file icons/icon*.png
```
**Verify:** all exit 0 / empty; PNG magic correct.

### M4.2 — Audit cross-check

Task 1 — add `docs/reviews/AUDIT-CROSSCHECK.md`: status per finding
(W1–W10, S-1…S-7 → FIXED in which milestone, or TRACKED with owner).

### M4.3 — Docs

Task 1 — CHANGELOG.md (v0.4.0 entry). Task 2 — update
`docs/plans/scratchpost-wallet.md` §7.0 status and revision history.

### M4.4 — Delivery

```bash
git add . && git commit -m "Complete: tkrWallet hardening + M3 — ready for merge"
git push -u origin feat/scratchpost-wallet
gh pr create --title "tkrWallet: Scratchpost repurpose — hardening + M3" --body "$(cat docs/reviews/AUDIT-CROSSCHECK.md)"
```
**Verify:** `gh pr view --json url` prints the PR URL · `git rev-parse main` is
still `c4e5153`. Cleanup per §4 runs after merge.

---

## 9. Plan audit (per template §4)

- Every task carries an M-ref, commands, and a verification step ✅
- Research→plan-update gate present (M1.4) ✅
- Worktree lifecycle adapted and justified (§4); per-milestone commits and
  final push/PR retained ✅
- M3.1/M3.2 deliberately commit together (invariants fail until v1 removal) —
  recorded, not an accident ✅
- Large files are specified at API/assertion level with exact commands; small
  files use full heredocs — a deliberate trade so this plan stays reviewable ✅

Freeze. Execution proceeds in this order: M1.4 → M2 → M3.1+M3.2 → M3.3 → M3.4
→ M3.5 → M3.6 → M3.7 → M3.8 → M3.9 → M4.
