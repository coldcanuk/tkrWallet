# RESEARCH — wallet import / unlock

Synthesis gate (RDAP Phase 1) for the embedded self-custody import/unlock
feature. The wallet will hold an encrypted mnemonic and derive its own keys —
Phantom-style — instead of only reading an injected provider.

## 1. What the platform gives us (WebCrypto) — verified

Tested against Node's WebCrypto (`crypto.subtle`), which mirrors browsers:

| Primitive | Status | Use |
|---|---|---|
| `SHA-512` digest | ✅ | available |
| `PBKDF2` with `HMAC`/`SHA-512` | ✅ | BIP-39 mnemonic → 512-bit seed |
| `PBKDF2` with `HMAC`/`SHA-256` | ✅ | password → encryption key (recommended KDF) |
| `AES-GCM` (256) | ✅ | encrypt the mnemonic at rest |
| `HMAC`/`SHA-512` | ✅ | BIP-32 CKD child-key derivation |
| `getRandomValues` | ✅ | entropy, salts, nonces |
| secp256k1 (`ECDSA`, `namedCurve: K-256`) | ❌ "Unrecognized namedCurve" | **the gap** |
| keccak-256 | ❌ not in WebCrypto | **the second gap** |

**Conclusion:** WebCrypto covers KDF, AEAD, hashing and BIP-32 HMAC. It does not
cover secp256k1 (EVM keys/signing) or keccak-256 (EVM address + tx hashing).
Those two require an audited library — and they are the two places hand-rolling
is a known catastrophe (nonce handling, side channels, endianness).

## 2. The one new dependency — audited, minimal

[@noble/curves](https://github.com/paulmillr/noble-curves) — audited by
independent security firms, pure JS, no WASM, ~15 KB gzipped secp256k1, provides
secp256k1 + ed25519. `@noble/hashes` provides keccak_256. `@scure/bip32` +
`@scure/bip39` (same author) cover HD derivation and BIP-39 so we do not
hand-roll hardened-vs-non-hardened derivation.

Same library family production wallets use. Justified and non-negotiable for
EVM; the only question is how it ships (decision D2).

## 3. Phantom's model (what we emulate)

- **Non-custodial**: the Secret Recovery Phrase is stored locally, encrypted with
  the wallet password, never on a server
  ([Phantom FAQ](https://help.phantom.com/hc/en-us/articles/45135465489555)).
- **12-word default**, imports any BIP-39 12/24-word phrase.
- Reverse-engineered storage (hashcat thread): **PBKDF2-SHA256(password) →
  xsalsa20-poly1305**, blob carries salt + nonce + iterations + ciphertext.

We keep the same shape with WebCrypto **AES-GCM** (same AEAD security, zero
extra dependency) and a **stronger KDF**: 600,000 PBKDF2-SHA256 iterations per
OWASP 2023 (Phantom's observed 10,000 is weak).

## 4. Chosen crypto design

```
mnemonic (12/24 words, BIP-39)
   │  PBKDF2-HMAC-SHA512(mnemonic, "mnemonic", 2048)      [WebCrypto]
   ▼
seed (64 bytes)
   │  BIP-32 m/44'/60'/0'/0/0   [@scure/bip32 → @noble/curves secp256k1]
   ▼
private key → public key → keccak-256(pub)[12:] → EVM address  [@noble/hashes]
              (m/44'/501'/… → ed25519 → Solana address, derived but NOT signed v1)

at rest:
   key = PBKDF2-HMAC-SHA256(password, salt, 600000)  [WebCrypto]
   ct  = AES-GCM(key, iv, mnemonic)                   [WebCrypto]
   IndexedDB: { v, salt, iv, iterations, ciphertext, address }
```

- Plaintext mnemonic/seed/private key exists **only in memory**, cleared on lock
  (best effort — a browser cannot guarantee zeroing).
- Never logged, never in a DOM attribute, never sent anywhere.

## 5. Test vectors that lock correctness

- BIP-39 English: the 12-word all-`abandon` vector → published 64-byte seed.
- Ethereum: `m/44'/60'/0'/0/0` of that seed →
  `0x9858EfFD232B4033E47d90003D41EC34EcaEda94`.

Run in `app_test.js`: proves the whole import→derive→address chain, not just
each primitive in isolation.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| XSS steals the decrypted key | Strict CSP + no innerHTML + no third-party JS already; key never in localStorage/DOM; inputs cleared |
| Weak KDF | 600k PBKDF2-SHA256 + unique 16-byte salt |
| Hand-rolled crypto bug | Audited `@noble/*` + `@scure/*`, pinned + reproducible bundle + vectors |
| Mnemonic lingers in memory | Clear input + derived buffers on lock/background |
| Phishing (phrase typed into a fake page) | Trusted-origin warnings; never auto-open |
| Bundle drift / tampered vendor code | Committed unminified bundle + CI reproducibility check (as with app.css) |

## 7. Revised milestone order (see the plan)

M0.1 env → M1.x research (done) → M2 define → M3.1 vendor bundle → M3.2 BIP-39
→ M3.3 HD+address → M3.4 vault → M3.5 import UI → M3.6 unlock → M3.7 wire shell
→ M3.8 EVM sign → M3.9 vectors → M4 verify + PR.
