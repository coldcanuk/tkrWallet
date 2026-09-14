# Audit cross-check — was every finding closed?

Source: `docs/reviews/wallet-technical-review.md` (W1–W10) and
`docs/security/security-audit.md` (S1–S7, R1–R12). Status after the RDAP build.

## Wallet findings

| # | Finding | Status | Where |
|---|---|---|---|
| W1 | Three third-party origins in `app.js` + permissions | **FIXED** | M3.2 — `app.js` deleted; `host_permissions` = one origin; single-origin grep test |
| W2 | No CSP anywhere | **FIXED** | M3.1 — meta tag in `index.html`; `extension_pages` in `manifest.json`; both tested |
| W3 | `sw.js` cache-first, no lifecycle, unscoped | **FIXED** | M3.3 — network-first, activate cleanup, skipWaiting/claim, same-origin GET-only; 4 tests |
| W4 | SVG icon invalid for Chrome; stale description; no key | **FIXED** | M3.4 — PNG 16/32/48/128 + `default_icon` + pinned key; M3.8 description/version |
| W5 | `role="tab"` with no tabpanels | **FIXED** | M3.5 — plain anchors on hash routes, `aria-current`; test asserts no `role=tab` |
| W6 | Beaver removal incomplete | **FIXED** | M3.2 — all shipped files; case-insensitive scan in tests |
| W7 | PWA manifest fights the dark theme | **FIXED** | M3.2 — `#12100e` both colours; tested |
| W8 | Wire-supplied colour reaches CSS | **FIXED** | M3.6 — colour from a local map in `wallet.js`, never the wire |
| W9 | One `aria-live` region only | **FIXED** | M3.5 + M3.7 — `#wallet-status` announces connect/balances |
| W10 | Single-script test suite | **FIXED** | M3.2/M3.5 — named sequential-async harness, 40 tests |

## Security findings

| # | Finding | Status | Where |
|---|---|---|---|
| S-1 | `host_permissions` grants 3 origins | **FIXED** | M3.2 — deep-equals assertion |
| S-2 | No CSP in either target | **FIXED** | M3.1 |
| S-3 | No no-foreign-origin invariant | **FIXED** | M3.2 — shipped-file origin scan incl. README |
| S-4 | Unscoped SW caching proxy | **FIXED** | M3.3 |
| S-5 | SW precaches dead `app.js` | **FIXED** | M3.2/M3.3 |
| S-6 | Extension ID unpinned | **FIXED** | M3.4 — key pinned, ID `hkljagpgkenlmfemcddcnhoaddpndldn`; private key gitignored + asserted untracked |
| S-7 | Wire colour → CSS property | **FIXED** | M3.6 |

## Router findings (R-1…R-12)

These live in `blockchain-infrastructure/the backend host/nginx/`, which is **out of scope
for this repo**. Status: **ARTIFACT DELIVERED, NOT APPLIED**.

| # | Finding | Artifact |
|---|---|---|
| R-1 | Plain HTTP, unrestricted peers | `deploy/nginx/tkrwallet-edge.conf.template` — CF-only allow, origin-pull mTLS, default-deny 444 server |
| R-2 | No rate limiting | same — `limit_req` zones on auth/API paths |
| R-3 | `CF-Connecting-IP` client-controlled | same — `real_ip` from CF ranges; header never forwarded |
| R-4 | XFF feeds the gateway bypass | same — `X-Forwarded-For: $remote_addr` (single authoritative value); gateway fix still owed in that repo |
| R-5 | `server_name _` catch-alls | same — explicit vhost + 444 default servers |
| R-6 | No in-template allow-lists | same — `allow`/`deny` on :80; LAN faces in the other repo still owe theirs |
| R-7 | No security headers / HSTS | same — full header set + HSTS preload |
| R-8 | No body caps | same — `client_max_body_size 128k` |
| R-9 | `if` in location | N/A — new template uses `limit_req` + `try_files`, no method `if` |
| R-10 | `server_tokens off` one vhost only | deploy README lists the http-context addition |
| R-11 | Upstream Server headers leak | same — `proxy_hide_header` |
| R-12 | No timeouts | facade-owned; noted in the deploy README |

**Still owed, outside this repo:** the rpc-gateway XFF/chain-selector fixes and
the four LAN-face allow-lists (audit §5, S-4 of that document), plus the
`SCRATCHPOST.md` one-exception amendment for `tkrwallet.scratchpost.ai`.

## Never-closable by code

- The shell has never been rendered in a browser: every UI claim is structural.
- Host state (installed templates, firewall, `` liveness) is unverifiable
  from this machine — a one-time live probe list is in the audit §7.
