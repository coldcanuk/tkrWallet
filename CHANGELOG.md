# Changelog

## 0.5.0 — self-custody import / unlock + local signing

- Import a BIP-39 recovery phrase or unlock a local wallet with a password; the
  phrase is encrypted (PBKDF2-SHA256 600k → AES-GCM) and stored on-device only.
- Derives Ethereum and Solana addresses; signs EIP-191 messages and legacy
  EIP-155 transactions locally with audited @noble/@scure primitives.
- vendor/noble.js committed unminified + reproducible (check:crypto).
- Locked by the canonical BIP-39 vector; 55 tests, 0 failures.
- Docs: docs/security/wallet-custody.md.

## 0.4.0 — Scratchpost repurpose, hardening, data layer

Divorce from tkrShell (v1) complete; the wallet is now built for the Scratchpost
stack with icehut as its only counterparty.

**Security**

- Single-origin enforcement: `host_permissions` is exactly
  `https://tkrwallet.scratchpost.ai/*`; a grep test fails on any other origin in
  any shipped file.
- CSP in both targets: meta tag in `index.html`, tightened `extension_pages`
  policy in `manifest.json`. `connect-src 'self'` makes "never talks to eva"
  browser-enforced.
- `app.js` (v1) deleted: no `tkrpik.com`, no `tkrswap.com`, no public Solana RPC
  anywhere in the tree.
- Service worker rewritten: network-first shell, stale-cache cleanup,
  `skipWaiting`/`clients.claim`, same-origin GET-only.
- Extension: PNG icons 16/32/48/128, pinned key
  (ID `hkljagpgkenlmfemcddcnhoaddpndldn`), private key gitignored.
- Hardened edge vhost artifact in `deploy/nginx/` covering audit findings
  R-1…R-12 (CF-only origin, real-IP trust, rate limits, default-deny server,
  no RPC passthrough).

**Wallet**

- Data layer `wallet.js`: EIP-1193 connect, native + ERC-20 balances for
  Ethereum/Base/Robinhood, honest `unknown ≠ zero` semantics, edge price
  contract, value estimation with unpriced-asset disclosure.
- Shell wired to the data layer: connect button, token list, USD/CAD toggle,
  `aria-live` announcements.
- Beaver Nickels fully removed from the client.
- Navigation uses real links on hash routes (no invalid tab ARIA).
- Named 40-test harness with a sequential async runner; committed-CSS freshness
  and class-resolution guards in CI.

**Docs**

- README rewritten (topology, invariants, dev workflow).
- `docs/architecture/client.md`, `docs/specs/icehut-edge.md`,
  `docs/research/RESEARCH.md`, `docs/plans/rdap-build-plan.md`,
  `docs/reviews/AUDIT-CROSSCHECK.md`, `docs/security/security-audit.md`,
  `docs/reviews/wallet-technical-review.md`.

## 0.3.0 and earlier

v1 era — tkrShell/tkrpik funnel. Superseded and removed.
