# RDAP Plan — wallet import / unlock

Embedded self-custody import/unlock, Phantom-style: the user unlocks an existing
local wallet with a password, or imports a BIP-39 mnemonic, and the wallet
derives the address(es) and (EVM) signs locally.

**Methodology:** RDAP (Double Diamond × Spiral × small-win milestones).
**Inputs:** conversation history, `docs/research/wallet-import.md`,
`docs/architecture/client.md`, `docs/security/security-audit.md`.
**Worktree:** `.worktrees/wallet-import` on `feat/wallet-import`; `main` clean at
the PR #15 merge.

---

## 1. Scope

### Primary goal

Import/unlock a wallet: password-unlock an existing local vault, or import a
12/24-word BIP-39 mnemonic → derive the EVM address (and Solana address) →
encrypt the mnemonic at rest → show the account. EVM signing as a follow-on
milestone in the same plan.

### Non-goals

- No server-side custody, no key egress, no "account recovery".
- No Solana tx signing in v1 (address derived only).
- No WalletConnect, no hardware wallets, no biometrics.
- No "create new wallet" UI yet (the primitives land; the button can follow).

### Success criteria (measurable)

1. `importMnemonic("abandon … about")` → `0x9858EfFD232B4033E47d90003D41EC34EcaEda94` (test vector).
2. Round-trip: encrypt → decrypt with correct password → same mnemonic; wrong password → fails.
3. Plaintext mnemonic never persisted: `git grep`/runtime check finds it only in memory paths.
4. No mnemonic/private-key string in any log, DOM attribute, or the shipped HTML.
5. `npm run check` green with the new vector + roundtrip tests.
6. Unlock with wrong password leaves nothing derivable (address unavailable).

### Constraints

- MV3: no remote code, `script-src 'self'`, no `unsafe-eval` (the bundle must not
  need it).
- Zero runtime deps **except** the audited `@noble/*` + `@scure/*` bundle (D2).
- No build for app JS; the crypto bundle is built by esbuild and **committed
  unminified** + reproducible (same discipline as `app.css`).
- DOM stays textContent-only; key material never in the DOM.

### Assumptions

- EVM-first path `m/44'/60'/0'/0/0`; Solana `m/44'/501'/0'/0'` derived, not signed.
- PBKDF2-SHA256 (600k iterations) + AES-GCM via WebCrypto.
- Storage: IndexedDB.
- English wordlist only.

### Environment

Node 24 · npm 11 · esbuild added to `tools/` (build-only) · Playwright for UI
verification · vision model for review.

### Top risks

| Risk | Mitigation |
|---|---|
| Key exposure via XSS | Strict CSP + no innerHTML + no third-party JS; keys never in localStorage/DOM |
| Weak KDF | 600k PBKDF2-SHA256 + unique salt |
| Crypto correctness | Audited libs, pinned, reproducible bundle, BIP-39/HD vectors |
| Mnemonic lingering | Clear inputs + buffers on lock/background |
| Phishing | Trusted-origin warning on the import screen |

---

## 2. Decisions to confirm before M3 (crypto code)

| # | Decision | Recommendation |
|---|---|---|
| **D1** | EVM-only signing vs also Solana | **Derive both addresses; sign EVM only in this build.** Solana signing later. |
| **D2** | Ship `@noble/*`+`@scure/*` as a committed esbuild bundle | **Yes** — audited, minimal; bundled unminified + reproducible CI check. This is the one justified break from "no build for JS". |
| **D3** | Storage backend | **IndexedDB** (works in PWA + extension, async, larger than localStorage). |
| **D4** | KDF iterations | **600,000** PBKDF2-SHA256 (OWASP 2023). |

---

## 3. Phases and milestones

### Phase 0 — Environment & isolation

**M0.1** worktree + env (done): `feat/wallet-import` worktree, node/npm/playwright
verified, `.ui-shots` copied.

### Phase 1 — Research & discovery (done)

**M1.1** WebCrypto capabilities — verified (see research doc).
**M1.2** audited libraries + Phantom model — verified.
**M1.3** BIP-39/HD vectors — recorded.
**M1.4** synthesis → `docs/research/wallet-import.md` + this plan (this commit).

### Phase 2 — Define

**M2.1** `crypto.js` module contract: `mnemonicToSeed`, `deriveEvm`, `deriveSolana`,
`encryptVault`, `decryptVault`, `generateMnemonic`; input/output types; the two
test vectors as the API's acceptance tests.
**M2.2** storage schema (`vault` object in IndexedDB) + the lock/unlock state
machine in `ui.js`.
**M2.3** update `docs/security/security-audit.md` posture note: the wallet now
holds encrypted key material locally; add the new invariants (no plaintext
persistence, no DOM exposure, KDF ≥ 600k).

### Phase 3 — Implementation

**M3.1** vendor bundle: add esbuild to `tools/`, build `vendor/crypto.js`
(unminified) from `@noble/hashes`, `@noble/curves`, `@scure/bip32`,
`@scure/bip39`; pin versions; CI reproducibility check. *Verify:* bundle loads in
headless Chromium with `eval` absent.

**M3.2** `crypto.js` BIP-39: validate/generate mnemonic (WebCrypto entropy +
wordlist via `@scure/bip39`), `mnemonicToSeed` (WebCrypto PBKDF2-SHA512).
*Verify:* `abandon…about` → known seed.

**M3.3** `crypto.js` derive: `deriveEvm(seed)` → private/public/address via
`@scure/bip32` + `@noble/curves` + keccak; `deriveSolana(seed)` → ed25519 pubkey.
*Verify:* EVM address == `0x9858EfFD…`.

**M3.4** `crypto.js` vault: `encryptVault(mnemonic, password)` →
`{salt,iv,iterations,ciphertext}` (WebCrypto AES-GCM), `decryptVault`. *Verify:*
round-trip + wrong-password fails.

**M3.5** import UI: empty-state CTA → import screen; mnemonic textarea +
password + confirm; warnings (offline storage, no recovery, trusted origin);
clear-on-submit. *Verify:* vision review + manual.

**M3.6** unlock flow: detect existing vault; password prompt; wrong password →
error, nothing derived. *Verify:* round-trip via the UI.

**M3.7** wire the shell: header shows the imported address; holdings still from
the injected provider for now (import ≠ auto-connect); lock button clears state.

**M3.8** EVM signing (follow-on): build + sign a legacy/EIP-1559 tx with
`@noble/curves`; used by Send later. *Verify:* a known signed-tx vector.

**M3.9** tests: BIP-39/HD vectors, roundtrip, wrong password, no-plaintext
invariant (`grep` the tree), bundle reproducibility.

### Phase 4 — Verification & delivery

**M4.1** full gate + headless render + vision review of the import screen.
**M4.2** audit cross-check update + README/CHANGELOG.
**M4.3** push + PR; merge after CI.

---

## 4. Plan audit

- Every milestone has tasks, commands, and a verification step ✅
- Research → plan gate present (M1.4) ✅
- Worktree lifecycle followed; per-milestone commits ✅
- Crypto is pinned to audited libraries + test vectors; no hand-rolled secp256k1
  or BIP-32 ✅
- The one open item is the four scope decisions (§2) — D1/D2 especially.

Freeze pending Charles's answers to D1–D4.
