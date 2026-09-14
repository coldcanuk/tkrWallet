# RESEARCH.md — tkrWallet hardening & M3

Synthesis gate for Phase 1 of the RDAP build. Sources: the two audit documents,
the icehut spec, the Tailwind Plus policy, and targeted verification of the
remaining unknowns.

## 1. Consolidation of the audits

### Wallet findings (technical review W1–W10)

| # | Finding | Plan |
|---|---|---|
| W1 | 3 third-party origins live in `app.js` + `host_permissions` | M3.2 delete v1; permissions → single origin |
| W2 | No CSP anywhere | M3.1 meta tag + MV3 `extension_pages` policy |
| W3 | `sw.js` cache-first, no lifecycle, unscoped | M3.3 full rewrite |
| W4 | SVG icon invalid for Chrome; stale description; no key | M3.4 icons + key; M3.8 manifest |
| W5 | `role="tab"` with no tabpanels | M3.5 → plain anchor nav |
| W6 | Beaver removal incomplete (webmanifest, tests, app.js) | M3.2 |
| W7 | PWA manifest colours fight the dark theme | M3.2/M3.4 |
| W8 | Wire-supplied colour reaches `style.backgroundColor` | M3.6 local colour table |
| W9 | One `aria-live` region only | M3.5 + M3.7 |
| W10 | Single-script test suite | M3.5 named harness |

### Security findings (audit S-1…S-7, router R-1…R-12)

| # | Finding | Plan |
|---|---|---|
| S-1 | `host_permissions` grants 3 origins | M3.2 single origin + assertion |
| S-2 | No CSP in either target | M3.1 |
| S-3 | No no-foreign-origin invariant | M3.2 assertion |
| S-4 | Unscoped SW caching proxy | M3.3 |
| S-5 | SW precaches dead `app.js` | M3.3 |
| S-6 | Extension ID unpinned | M3.4 `key` |
| S-7 | Wire colour → CSS property | M3.6 |
| R-1…R-12 | nginx router hardening | **artifact** M3.9 (applied in `blockchain-infrastructure` separately, out of scope here) |

## 2. Verified technical facts

1. **MV3 CSP.** `content_security_policy.extension_pages` enforces a minimum of
   `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';` and may be
   *tightened* — including `connect-src` allow-listing.
   ([Chrome manifest docs](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy))
   Our policy: `script-src 'self'; object-src 'none'; connect-src 'self' https://tkrwallet.scratchpost.ai; img-src 'self' data:; style-src 'self'`.
2. **Manifest `key`.** Base64-encoded DER public key (SubjectPublicKeyInfo).
   Generation: `openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem`
   then `openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A`.
   Extension ID = SHA-256 of the DER, first 32 chars, hex→`a-p`.
   **The private key (`key.pem`) must never be committed** — gitignored.
3. **Icon toolchain.** `convert` and `inkscape` are present. Decision: shape-only
   SVG (no text → no font dependency → deterministic rasterization), inked at
   16/32/48/128.
4. **Provider contract (EIP-1193).** `wallet.js` uses only `eth_requestAccounts`,
   `eth_chainId`, `eth_getBalance`, `eth_call`. Errors reject. Every failure
   yields `{ state: "unknown" }`, never a zero amount.
5. **Solana (D10, unresolved).** Phantom has no balance RPC and the v1 public-RPC
   call is forbidden. Solana stays **catalogued-not-queried** until the icehut
   edge provides reads (spec §3.3).
6. **Prices.** `GET /api/wallet/prices` against the single origin; absent assets
   are omitted, not zeroed; until the edge ships the value block shows `—`.

## 3. Revised milestone order (committed in the RDAP plan)

M1.4 (this file) → M2.1/M2.2 (architecture) → M3.1+M3.2 (CSP, invariants, v1
removal — one commit, because the origin invariants fail until `app.js` is
gone) → M3.3 (sw) → M3.4 (icons/key) → M3.5 (a11y + harness) → M3.6 (wallet.js)
→ M3.7 (wire shell) → M3.8 (manifest/README) → M3.9 (nginx artifact) → M4
(verification, cross-check, push + PR).
