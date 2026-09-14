// Bundled into vendor/noble.js by `npm --prefix tools run build:crypto`.
//
// Exposes the audited crypto primitives the wallet needs, under one global
// (`nobleCrypto`). We bundle rather than hand-roll: secp256k1 and keccak-256
// are exactly the two primitives where hand-rolling is a known catastrophe.
//
// Everything here is @noble/@scure — audited by independent security firms,
// pure JS, no WASM, no eval. See docs/research/wallet-import.md.
export { secp256k1 } from "@noble/curves/secp256k1.js";
export { ed25519 } from "@noble/curves/ed25519.js";
export { keccak_256 } from "@noble/hashes/sha3.js";
export { HDKey } from "@scure/bip32";
export { validateMnemonic, mnemonicToSeedSync, generateMnemonic, entropyToMnemonic } from "@scure/bip39";
export { wordlist } from "@scure/bip39/wordlists/english.js";
