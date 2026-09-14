# tkrWallet security audit — 2026-09-14

**Tree:** `gb/tech-review-audit` off `main` `eb4ed2c` (0.7.0), including the hygiene fix in this branch.
**Companion:** [`../reviews/2026-09-14-technical-review.md`](../reviews/2026-09-14-technical-review.md).
**Not a pentest.** Not a re-audit of `vendor/noble.js`. Custody primitives are described and test-locked; they are not independently proven here.

---

## 0. Executive verdict

| Question | Verdict |
| --- | --- |
| Does the **shipped client** know backend server names or IPs? | **No, after this branch.** Scan of `index.html`, `ui.js`, `wallet.js`, `crypto.js`, `store.js`, `sw.js`, `manifest.json`, `manifest.webmanifest`: **0 RFC1918 IPs, 0 `*.local` hosts, 0 extra origins** besides `https://tkrwallet.scratchpost.ai`. The HTML comment that named **`eva`** was a **0-knowledge violation**; it is rewritten on this branch and the new `app_test.js` case fails CI if it returns. |
| Can the browser reach a chain node or lab host from the PWA? | **No.** `connect-src 'self'`. Relative `/api/wallet/*` only. |
| Are keys ever sent to the edge? | **No.** Vault is local AES-GCM. Unlock is local. Balance GETs send only the public address. |
| Residual 0-knowledge debt | **Public git** (`CHANGELOG.md`, `deploy/`) still names `icehut` / `eva`. Those files are not executed by the PWA. **Dev edge** (`tools/dev-edge.js`) hard-codes publicnode URLs — operator-only. |

**Overall posture:** strong for a 0.7 browser wallet on a single origin, with the usual browser-wallet residual (XSS ⇒ in-memory keys) and an operational Base outage that the client now reports honestly.

---

## 1. 0-knowledge scan (method and result)

### 1.1 What was scanned

Browser-loaded client files only (`CLIENT_SHIPPED` in `app_test.js`):

`index.html`, `ui.js`, `wallet.js`, `crypto.js`, `store.js`, `sw.js`, `manifest.json`, `manifest.webmanifest`.

Patterns (must not match):

- RFC1918: `\b10.x.x.x\b`, `\b172.16–31.x.x\b`, `\b192.168.x.x\b` (four octets — not LICENSE “section 10” or SVG `10.5`)
- `\bname.local\b`
- `\b(eva|caesar|icehut|athena|kiff|rathole)\b`
- `https?://…` other than `https://tkrwallet.scratchpost.ai`

### 1.2 Result (this branch)

| File | IPs | `.local` | Internal names | Extra origins |
| --- | --- | --- | --- | --- |
| `index.html` | none | none | **none** (was `eva` in a comment; removed) | none |
| `wallet.js` | none | none | none | `https://tkrwallet.scratchpost.ai` only (`BASE_URL`) |
| `manifest.json` | none | none | none | same host in `host_permissions` / `connect-src` |
| others listed | none | none | none | none |

Live JSON from `/api/wallet/balances` was also checked for `192.168`: **absent**. Error text is `rpc http 502`, not a URL.

### 1.3 Classified non-client hits (not a UA leak)

| Location | What | Class |
| --- | --- | --- |
| `tools/dev-edge.js` | `ethereum-rpc.publicnode.com`, `base-rpc.publicnode.com` | Local `npm run dev` stand-in. Must never become production origin src (infra prove already bans `publicnode` there). |
| `CHANGELOG.md`, `deploy/README.md` | `icehut`, `eva` | Public git / operator notes. Recommendation: scrub. |
| `LICENSE` “section 10”, SVG `M4 10.5` | Naive `10.` grep | False positive. |

**Violation policy:** a lab IP or internal hostname in a **shipped client** file is a **huge** break of the product contract. This branch makes that a red test, not a comment.

---

## 2. How data is received (security-relevant)

```
Unlock (local PBKDF2+AES-GCM) → EVM address in RAM
    → GET /api/wallet/balances?address=0x…&chains=1,8453   (public address only)
    → GET /api/wallet/prices?assets=…&vs=usd
    → optional GET /api/wallet/token?chain=&address=       (add-token)
```

- PWA: same-origin GET. No CORS. No cookies required today (balance data is public chain state).
- Extension: absolute URL to the same host.
- SW: `/api/` is not intercepted for caching.
- Response `chains[]` is trusted only as a **read report**, not as executable content. Token colours are a **local** table (`TOKEN_COLORS`), never from the wire (old W8/S-7).
- Spec §3.1 (nonce + session cookie) is **not** implemented. Origin prove **rejects** `/api/wallet/nonce` and `/session`. Unauthenticated GETs of public balances are acceptable; they must not grow into authenticated write paths without the challenge-response in the spec.

---

## 3. Custody and session

| Control | Status on this tree |
| --- | --- |
| Mnemonic never fetched / logged | Pass (no network in `crypto.js`; tests) |
| At rest: AES-GCM, PBKDF2-SHA256 **600 000** iters, random salt/IV | Pass |
| IndexedDB stores ciphertext only | Pass (`store.js`) |
| Wrong password fails closed | Pass (`wrong-password`) |
| BIP-44 `m/44'/60'/0'/0/0` vector | Pass (`abandon…about` → `0x9858EfFD…da94`) |
| Auto-lock 1–60 min, never off | Pass |
| Reload keeps viewing session | **Fail on `main`** (RAM only). 0.7.1 `sessionStorage` of the **address** (not the phrase) exists on PR #27 / live PWA. |
| XSS | CSP + no `innerHTML`. If XSS ever exists, in-memory phrase/keys are in scope — same as every browser wallet. |
| Extension public key in `manifest.json` | Stable ID; **not** a private key. |

`docs/security/wallet-custody.md` on this branch names the live hostname and points here. Do not cite older copies that said the production edge was undeployed.

---

## 4. CSP and transport

**Page meta CSP:**  
`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; worker-src 'self'`

`frame-ancestors` is correctly **omitted** from the meta tag (browsers ignore it there). Live origin **headers** send `frame-ancestors 'none'`, `X-Frame-Options: DENY`, HSTS preload, COOP `same-origin`, `Referrer-Policy: no-referrer`.

**Extension CSP:** `script-src 'self'; object-src 'none'; connect-src 'self' https://tkrwallet.scratchpost.ai; …`

No `'unsafe-eval'`, no `'unsafe-inline'`, no CDN scripts.

---

## 5. Strengths (security)

1. 0-knowledge UA (this branch) with a **failing test** if it regresses.
2. Browser-enforced single origin.
3. Keys never leave the device; edge sees only an address.
4. `unknown ≠ zero` — a failed read cannot be laundered into “you are broke.”
5. No injected-provider connect; no client RPC; no `eth_sendRawTransaction` on the wallet hostname.
6. High KDF iteration count (600k), not Phantom-like 10k.
7. Network-first SW; API uncached.
8. DOM fill via `textContent` only.

---

## 6. Weaknesses and remediations

| ID | Weakness | Severity | Remediation (recommendation) |
| --- | --- | --- | --- |
| S1 | **`eva` was in shipped HTML** (closed on this branch). CHANGELOG/deploy still name icehut/eva. | High if in UA; Low in git prose | Keep the CI scan. Scrub git prose or move operator docs to the infra repo. |
| S2 | **XSS = keys.** CSP is the load-bearing control. | High (inherent) | Keep CSP tests. No third-party JS. Consider a lock-on-hidden-tab option shorter than 5 min for shared machines. |
| S3 | **RAM session on `main`.** Reload drops unlock; users type the password more often (phishing-adjacent UX, not a crypto break). | Medium | Merge 0.7.1 viewing session (address only, `sessionStorage`, auto-lock bounded). |
| S4 | **Unauthenticated balance GET.** Fine for public chain data; a future write API must not ride this. | Medium if writes land | Implement spec §3.1 **before** any signed-tx or swap POST, or keep writes nonexistent (current origin). |
| S5 | **Dev edge publicnode.** | Medium (ops) | Never compose that file on caesar. Production prove already forbids `publicnode` in origin src. |
| S6 | **No SRI / hashed filenames.** Compromised origin ⇒ swapped signer. | Medium | Path B + CF + no-store headers are the current control. Hash + SRI if the origin threat rises. |
| S7 | **PBKDF2 vs Argon2id.** 600k SHA-256 is acceptable 2023 OWASP; GPU still cheaper than Argon2. | Low | Migrate vault `v:` with a re-encrypt-on-unlock if threat model includes stolen IndexedDB + GPU. |
| S8 | **Mnemonic in a `<textarea>` at import.** Password managers / accessibility tools may snapshot it. | Low | One-word-at-a-time import; wipe clipboard; keep `autocomplete=off` (already). |
| S9 | **Extension version `0.4.0`.** | Low | Align with package version; CI. |
| S10 | **Base RPC 502.** Not a client secret leak; availability. | Ops | Fix rank-1 Base. Client already reports `unknown`. |

---

## 7. Threat model (short)

| Attacker | What they get | What they do not get |
| --- | --- | --- |
| Network observer (outside TLS) | Nothing useful (HSTS, HTTPS). | Keys, phrase. |
| Malicious website | Cannot `fetch` the edge from this PWA (different origin + CSP on **this** page). | N/A |
| XSS **in** tkrWallet | In-memory mnemonic/keys if unlocked; vault ciphertext always. | Other users. |
| Stolen disk / IndexedDB | Vault blob. Offline brute of PBKDF2-600k. | Phrase without password. |
| Compromised edge | Lies about balances; **cannot** sign. | Keys (never sent). |
| Lab topology recon via the UA | **Should get nothing.** This branch + CI. | Hostnames/IPs of eva/caesar/icehut. |

---

## 8. What we would do next (priority)

1. Keep `CLIENT_SHIPPED` hygiene in CI (done on this branch).
2. Merge viewing-session 0.7.1 so reload is not a password hammer.
3. Scrub `CHANGELOG.md` / `deploy/` of lab names **or** accept them as infra-adjacent git, never UA.
4. Align extension version.
5. Repair Base at the origin; do not teach the wallet a vendor RPC.
6. Before any send/swap: spec §3.1 or an explicit “no wallet auth, no writes” freeze.

---

## 9. Sign-off

Shipped client artifacts on this branch have **0 knowledge** of backend server names and IPs. The Scratchpost edge is reached only as `https://tkrwallet.scratchpost.ai` via `GET /api/wallet/balances`, `GET /api/wallet/prices`, and `GET /api/wallet/token`. Custody is local and conventional for a serious browser wallet. The remaining work is operational (Base, ship-from-git) and product (session merge, catalogue coverage, future writes) — not a hole in the 0-knowledge rule.
