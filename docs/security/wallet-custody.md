# Wallet custody — security posture

The wallet import/unlock feature changes one thing about the security model:
tkrWallet is a **key holder** — a pure self-custody wallet, not a reader of any
injected provider. This file records the new invariants so the change is
deliberate, not accidental.

## The model

```
recovery phrase (BIP-39, 12/24 words)
   └─ PBKDF2-HMAC-SHA512 → seed   (WebCrypto)
        ├─ m/44'/60'/0'/0/0 → secp256k1 → keccak → EVM address  [@noble/@scure]
        └─ m/44'/501'/0'/0' → ed25519 → base58 → Solana address

at rest (IndexedDB):
   vault = AES-GCM( PBKDF2-SHA256(password, salt, 600000), mnemonic )
```

## Invariants (asserted where testable)

1. **The mnemonic never leaves the device.** There is no endpoint in the spec,
   no `fetch`, and no log line that transmits it. `crypto.js` contains no
   network primitive (tested).
2. **Only ciphertext persists.** `store.js` writes the encrypted vault blob and
   nothing else; the plaintext phrase is never written to storage (the vault
   round-trip test asserts the phrase does not appear in the serialized vault).
3. **The private key exists in memory only.** It is derived on unlock/import and
   used transiently; there is no long-lived in-memory keyring.
4. **Wrong password ⇒ nothing.** AES-GCM authentication fails closed; no address
   is derivable without the password (tested).
5. **The KDF is not weak.** 600,000 PBKDF2-SHA256 iterations, per OWASP 2023
   (asserted). Phantom's observed 10,000 is not a benchmark we follow.
6. **No hand-rolled primitives.** secp256k1 and keccak-256 come from the audited
   `@noble/*` bundle; the whole import→derive→address→sign pipeline is locked by
   the canonical BIP-39 vector (`abandon … about` →
   `0x9858EfFD232B4033E47d90003D41EC34EcaEda94`).
7. **No plaintext in the DOM.** Inputs are cleared on close; key material never
   reaches an attribute or a template; the page has no markup-string sink.

## What this does NOT protect against

- **XSS** would let an attacker read the in-memory plaintext. The defense is the
  existing posture: strict CSP, no `innerHTML`, no third-party JS, no remote
  code. That posture is now load-bearing, not advisory.
- **A malicious or buggy browser extension** on the same machine. This is
  inherent to every browser wallet, Phantom included.
- **User loss of password or phrase.** Non-custodial by design: recovery is
  impossible, which is the point.
- **Memory forensics.** A browser cannot guarantee zeroing; "cleared" here means
  "dereferenced and best-effort overwritten".

## Threat-model notes

- The wallet has no injected-provider path: there is no `window.ethereum`, no
  EIP-1193 connect, and no MetaMask/Uniswap/Brave integration. The only way in
  is importing a recovery phrase or unlocking the local vault with a password.
- An unlocked wallet's balances require the wallet edge, which does not exist
  yet — the UI says so honestly rather than pretending to read them.
- EVM signing is implemented and vector-verified. Solana signing is **not**
  implemented (only the address is derived); that is a separate ed25519
  transaction-builder task, deliberately deferred.
