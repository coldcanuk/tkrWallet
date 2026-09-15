/* tkrWallet — wallet crypto.
 *
 * The only file that touches private-key material. Built on top of the audited
 * @noble/@scure bundle (vendor/noble.js); this file holds OUR logic: mnemonic
 * import, HD derivation, EIP-55 addressing, and the local encrypted vault.
 *
 * Hard rules (enforced by tests):
 *   - the mnemonic/seed/private key are plaintext ONLY in memory here;
 *   - the vault on disk is AES-GCM ciphertext, keyed by a 600k-iteration
 *     PBKDF2-SHA256 of the user's password;
 *   - nothing here ever logs a secret or puts one in a DOM attribute.
 */
(function (root) {
  "use strict";

  var noble =
    typeof require === "function" && typeof module === "object" && module.exports
      ? require("./vendor/noble.js")
      : root.nobleCrypto;

  if (!noble || !noble.secp256k1) {
    throw new Error("crypto bundle missing: vendor/noble.js");
  }

  var BIP44_SOL = "m/44'/501'/0'/0'";
  var KDF_ITERATIONS = 600000;
  var MAX_ACCOUNTS = 20;

  var te = typeof TextEncoder === "function" ? new TextEncoder() : null;
  var td = typeof TextDecoder === "function" ? new TextDecoder() : null;

  function utf8(s) {
    return te.encode(String(s));
  }
  function fromUtf8(b) {
    return td.decode(b);
  }

  /* ---- base58 (Solana address), base64 (vault) --------------------------- */

  var B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function base58Encode(bytes) {
    var digits = [0];
    for (var i = 0; i < bytes.length; i++) {
      var carry = bytes[i];
      for (var j = 0; j < digits.length; j++) {
        carry += digits[j] * 256;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    var out = "";
    for (var k = 0; k < bytes.length && bytes[k] === 0; k++) {
      out += "1";
    }
    for (var d = digits.length - 1; d >= 0; d--) {
      out += B58[digits[d]];
    }
    return out;
  }

  function b64encode(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i]);
    }
    return typeof btoa === "function" ? btoa(s) : Buffer.from(bytes).toString("base64");
  }
  function b64decode(str) {
    if (typeof atob === "function") {
      var bin = atob(str);
      var u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) {
        u[i] = bin.charCodeAt(i);
      }
      return u;
    }
    return new Uint8Array(Buffer.from(str, "base64"));
  }

  function hex(bytes) {
    return Array.prototype.map
      .call(bytes, function (b) {
        return ("0" + b.toString(16)).slice(-2);
      })
      .join("");
  }

  /* ---- EIP-55 checksum address ------------------------------------------ */

  function toEip55(bytes20) {
    var lower = hex(bytes20); // 40 lowercase hex chars
    var hashHex = hex(noble.keccak_256(utf8(lower))); // 64 hex chars
    var out = "0x";
    for (var i = 0; i < 40; i++) {
      // i-th hex digit of the hash (not the i-th byte's high nibble).
      out += parseInt(hashHex[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
    }
    return out;
  }

  /* ---- derivation -------------------------------------------------------- */

  function wipeBytes(buf) {
    if (buf && typeof buf.fill === "function") {
      buf.fill(0);
    }
    return buf;
  }

  function normalizeIndex(index) {
    if (index == null || index === "") {
      return 0;
    }
    var n = Number(index);
    if (!Number.isInteger(n) || n < 0 || n > 0x7fffffff) {
      throw new Error("invalid-index");
    }
    return n;
  }

  function evmPath(index) {
    return "m/44'/60'/0'/0/" + normalizeIndex(index);
  }

  function deriveEvm(seed, index) {
    var path = evmPath(index);
    var node = noble.HDKey.fromMasterSeed(seed).derive(path);
    var priv = node.privateKey; // 32 bytes
    var pub = noble.secp256k1.getPublicKey(priv, false); // 65 bytes, 0x04-prefixed
    var addr = noble.keccak_256(pub.slice(1)).slice(-20); // last 20 bytes
    return {
      path: path,
      privateKey: priv,
      address: toEip55(addr),
    };
  }

  function deriveSolana(seed) {
    var node = noble.HDKey.fromMasterSeed(seed).derive(BIP44_SOL);
    var priv = node.privateKey; // 32-byte ed25519 seed
    var pub = noble.ed25519.getPublicKey(priv);
    return {
      path: BIP44_SOL,
      privateKey: priv,
      address: base58Encode(pub),
    };
  }

  /* ---- public API: import / generate ------------------------------------ */

  function importMnemonic(mnemonic, index) {
    var phrase = String(mnemonic || "").trim().toLowerCase();
    if (!noble.validateMnemonic(phrase, noble.wordlist)) {
      throw new Error("invalid-mnemonic");
    }
    var i = normalizeIndex(index);
    var seed = noble.mnemonicToSeedSync(phrase);
    var evm = deriveEvm(seed, i);
    var sol = deriveSolana(seed);
    return {
      mnemonic: phrase,
      index: i,
      path: evm.path,
      evmAddress: evm.address,
      solAddress: sol.address,
    };
  }

  function generateWallet(strength) {
    var phrase = noble.generateMnemonic(noble.wordlist, strength || 128);
    return importMnemonic(phrase, 0);
  }

  function accountsFromMnemonic(mnemonic, count) {
    var phrase = String(mnemonic || "").trim().toLowerCase();
    if (!noble.validateMnemonic(phrase, noble.wordlist)) {
      throw new Error("invalid-mnemonic");
    }
    var n = count == null ? 1 : Number(count);
    if (!Number.isInteger(n) || n < 1 || n > MAX_ACCOUNTS) {
      throw new Error("invalid-count");
    }
    var seed = noble.mnemonicToSeedSync(phrase);
    var out = [];
    for (var i = 0; i < n; i++) {
      var evm = deriveEvm(seed, i);
      out.push({ i: i, path: evm.path, evmAddress: evm.address });
      wipeBytes(evm.privateKey);
    }
    wipeBytes(seed);
    return out;
  }

  function nextAccountIndex(accounts) {
    if (!accounts || !accounts.length) {
      return 0;
    }
    var max = -1;
    for (var i = 0; i < accounts.length; i++) {
      var n = Number(accounts[i] && accounts[i].i);
      if (Number.isInteger(n) && n > max) {
        max = n;
      }
    }
    return max + 1;
  }

  /* One-time Phantom-parity reveal of the EVM private key. Caller must wipe
   * the hex from the DOM after the user confirms they saved the phrase. */
  function revealEvmSecret(mnemonic, index) {
    var w = importMnemonic(mnemonic, index);
    var seed = noble.mnemonicToSeedSync(w.mnemonic);
    var evm = deriveEvm(seed, w.index);
    var hexKey = "0x" + hex(evm.privateKey);
    wipeBytes(evm.privateKey);
    wipeBytes(seed);
    return {
      index: w.index,
      path: evm.path,
      evmAddress: evm.address,
      privateKeyHex: hexKey,
    };
  }

  /* ---- local vault: PBKDF2-SHA256 -> AES-GCM (WebCrypto) ---------------- */

  var subtle =
    root.crypto && root.crypto.subtle
      ? root.crypto.subtle
      : typeof require === "function"
        ? require("crypto").webcrypto.subtle
        : null;
  var getRandom =
    root.crypto && root.crypto.getRandomValues
      ? function (n) {
          var b = new Uint8Array(n);
          root.crypto.getRandomValues(b);
          return b;
        }
      : function (n) {
          return new Uint8Array(require("crypto").randomBytes(n));
        };

  function deriveKey(password, salt, iterations) {
    return subtle
      .importKey("raw", utf8(password), { name: "PBKDF2" }, false, ["deriveBits"])
      .then(function (baseKey) {
        return subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: iterations },
          baseKey,
          256
        );
      })
      .then(function (bits) {
        return subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
      });
  }

  function encryptVault(mnemonic, password, iterations) {
    var salt = getRandom(16);
    var iv = getRandom(12);
    var iters = iterations || KDF_ITERATIONS;
    return deriveKey(password, salt, iters).then(function (key) {
      return subtle.encrypt({ name: "AES-GCM", iv: iv }, key, utf8(mnemonic)).then(function (ct) {
        return {
          v: 1,
          kdf: "pbkdf2-sha256",
          iterations: iters,
          salt: b64encode(salt),
          iv: b64encode(iv),
          ciphertext: b64encode(new Uint8Array(ct)),
        };
      });
    });
  }

  function decryptVault(vault, password) {
    var salt = b64decode(vault.salt);
    var iv = b64decode(vault.iv);
    var ct = b64decode(vault.ciphertext);
    return deriveKey(password, salt, vault.iterations || KDF_ITERATIONS).then(function (key) {
      return subtle
        .decrypt({ name: "AES-GCM", iv: iv }, key, ct)
        .then(function (pt) {
          return fromUtf8(new Uint8Array(pt));
        })
        .catch(function () {
          throw new Error("wrong-password");
        });
    });
  }

  /* ---- RLP (Ethereum) + local signing ------------------------------------ */

  function hexToBytes(h) {
    var s = String(h || "").replace(/^0x/, "");
    if (s.length % 2) {
      s = "0" + s;
    }
    var out = new Uint8Array(s.length / 2);
    for (var i = 0; i < out.length; i++) {
      out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  function concatBytes() {
    var len = 0;
    for (var i = 0; i < arguments.length; i++) {
      len += arguments[i].length;
    }
    var out = new Uint8Array(len);
    var off = 0;
    for (var j = 0; j < arguments.length; j++) {
      out.set(arguments[j], off);
      off += arguments[j].length;
    }
    return out;
  }

  /* Minimal big-endian integer, 0 -> empty string (RLP). */
  function rlpInt(n) {
    var v = BigInt(n);
    if (v === 0n) {
      return new Uint8Array(0);
    }
    var h = v.toString(16);
    if (h.length % 2) {
      h = "0" + h;
    }
    return hexToBytes(h);
  }

  /* An integer as a RLP list element: minimal bytes wrapped as a string. */
  function rlpBigInt(n) {
    return rlpBytes(rlpInt(n));
  }

  function rlpBytes(b) {
    if (b.length === 1 && b[0] < 0x80) {
      return b;
    }
    if (b.length <= 55) {
      var o = new Uint8Array(b.length + 1);
      o[0] = 0x80 + b.length;
      o.set(b, 1);
      return o;
    }
    var lb = rlpInt(b.length);
    var o2 = new Uint8Array(1 + lb.length + b.length);
    o2[0] = 0xb7 + lb.length;
    o2.set(lb, 1);
    o2.set(b, 1 + lb.length);
    return o2;
  }

  function rlpList(items) {
    var payload = new Uint8Array(0);
    for (var i = 0; i < items.length; i++) {
      payload = concatBytes(payload, items[i]);
    }
    if (payload.length <= 55) {
      var o = new Uint8Array(payload.length + 1);
      o[0] = 0xc0 + payload.length;
      o.set(payload, 1);
      return o;
    }
    var lb = rlpInt(payload.length);
    var o2 = new Uint8Array(1 + lb.length + payload.length);
    o2[0] = 0xf7 + lb.length;
    o2.set(lb, 1);
    o2.set(payload, 1 + lb.length);
    return o2;
  }

  function eip191Prefix(message) {
    var m = String(message);
    return "\u0019Ethereum Signed Message:\n" + m.length + m;
  }

  /* EIP-191 personal_sign. Returns 65-byte r||s||v (v = 27 + parity) as hex. */
  function signMessage(privateKey, message) {
    var hash = noble.keccak_256(utf8(eip191Prefix(message)));
    var rec = noble.secp256k1.sign(hash, privateKey, { prehash: false, format: "recovered", lowS: true });
    var out = new Uint8Array(65);
    out.set(rec.subarray(1, 33), 0); // r
    out.set(rec.subarray(33, 65), 32); // s
    out[64] = 27 + (rec[0] & 1); // v
    return hex(out);
  }

  /* Sign an edge connect statement with HD index i. Private key is derived,
   * used, and zeroed. Signature is 0x-prefixed 65-byte personal_sign hex. */
  function signPersonal(mnemonic, index, message) {
    var w = importMnemonic(mnemonic, index);
    var seed = noble.mnemonicToSeedSync(w.mnemonic);
    var evm = deriveEvm(seed, w.index);
    var sig = signMessage(evm.privateKey, message);
    wipeBytes(evm.privateKey);
    wipeBytes(seed);
    return { address: w.evmAddress, signature: "0x" + sig, index: w.index };
  }

  /* Legacy EIP-155 transaction signing. tx: { nonce, gasPrice, gasLimit, to,
   * value, data, chainId } (numbers/bigint as strings, to/data as 0x-hex).
   * Returns the raw signed transaction as 0x-hex. */
  function signTransaction(privateKey, tx) {
    var chainId = BigInt(tx.chainId);
    var fields = [
      rlpBigInt(tx.nonce),
      rlpBigInt(tx.gasPrice),
      rlpBigInt(tx.gasLimit),
      rlpBytes(hexToBytes(tx.to || "")), // 20-byte address (or empty for create)
      rlpBigInt(tx.value || 0),
      rlpBytes(hexToBytes(tx.data || "")),
    ];
    var unsigned = rlpList(fields.concat([rlpBigInt(chainId), rlpBigInt(0), rlpBigInt(0)]));
    var hash = noble.keccak_256(unsigned);
    var rec = noble.secp256k1.sign(hash, privateKey, { prehash: false, format: "recovered", lowS: true });
    var v = chainId * 2n + 35n + BigInt(rec[0] & 1);
    var raw = rlpList(fields.concat([rlpBigInt(v), rlpBytes(rec.subarray(1, 33)), rlpBytes(rec.subarray(33, 65))]));
    return hex(raw);
  }

  /* Recover the signer's EIP-55 address from a 65-byte personal_sign hex. */
  function recoverSigner(sigHex, message) {
    var sig = hexToBytes(sigHex);
    if (sig.length !== 65) {
      throw new Error("bad-signature");
    }
    var parity = sig[64] - 27;
    var hash = noble.keccak_256(utf8(eip191Prefix(message)));
    var want = null;
    for (var rec = parity; rec <= parity + 2; rec += 2) {
      try {
        var sr = new Uint8Array(65);
        sr[0] = rec;
        sr.set(sig.subarray(0, 32), 1);
        sr.set(sig.subarray(32, 64), 33);
        var pub = noble.secp256k1.recoverPublicKey(sr, hash, { prehash: false });
        var uncompressed = noble.secp256k1.Point.fromHex(hex(pub)).toBytes(false);
        var addr = toEip55(noble.keccak_256(uncompressed.slice(1)).slice(-20));
        want = addr;
        break;
      } catch (e) {
        /* try the other recovery candidate */
      }
    }
    return want;
  }

  /* Minimal recursive RLP decoder (verification only). Each item returns
   * { item, consumed } so nesting is unambiguous. */
  function rlpDecodeItem(bytes) {
    var b0 = bytes[0];
    if (b0 < 0x80) {
      return { item: bytes.subarray(0, 1), consumed: 1 };
    }
    if (b0 <= 0xb7) {
      var l = b0 - 0x80;
      return { item: bytes.subarray(1, 1 + l), consumed: 1 + l };
    }
    if (b0 <= 0xbf) {
      var ll = b0 - 0xb7;
      var l2 = Number("0x" + hex(bytes.subarray(1, 1 + ll)));
      return { item: bytes.subarray(1 + ll, 1 + ll + l2), consumed: 1 + ll + l2 };
    }
    if (b0 <= 0xf7) {
      var l3 = b0 - 0xc0;
      return { item: decodeList(bytes.subarray(1, 1 + l3)), consumed: 1 + l3 };
    }
    var ll4 = b0 - 0xf7;
    var l4 = Number("0x" + hex(bytes.subarray(1, 1 + ll4)));
    return { item: decodeList(bytes.subarray(1 + ll4, 1 + ll4 + l4)), consumed: 1 + ll4 + l4 };
  }

  function decodeList(payload) {
    var items = [];
    var off = 0;
    while (off < payload.length) {
      var r = rlpDecodeItem(payload.subarray(off));
      items.push(r.item);
      off += r.consumed;
    }
    return items;
  }

  function rlpDecode(bytes) {
    var r = rlpDecodeItem(bytes);
    return r.item;
  }

  /* Recover the signer of a legacy EIP-155 raw transaction (verification). */
  function recoverTxSigner(rawHex, chainId) {
    var bytes = hexToBytes(rawHex);
    var list = rlpDecode(bytes);
    if (list.length !== 9) {
      throw new Error("unexpected tx field count");
    }
    var v = BigInt("0x" + hex(list[6]) || "0");
    var parity = Number(v - 35n - BigInt(chainId) * 2n);
    var fields = list.slice(0, 6).map(function (b) {
      return rlpBytes(b); // decoded raw values re-encoded as RLP strings
    });
    var unsigned = rlpList(fields.concat([rlpBigInt(chainId), rlpBigInt(0), rlpBigInt(0)]));
    var hash = noble.keccak_256(unsigned);
    var sr = new Uint8Array(65);
    sr[0] = parity & 3;
    sr.set(list[7], 1);
    sr.set(list[8], 33);
    var pub = noble.secp256k1.recoverPublicKey(sr, hash, { prehash: false });
    var uncompressed = noble.secp256k1.Point.fromHex(hex(pub)).toBytes(false);
    return toEip55(noble.keccak_256(uncompressed.slice(1)).slice(-20));
  }

  var api = {
    KDF_ITERATIONS: KDF_ITERATIONS,
    importMnemonic: importMnemonic,
    generateWallet: generateWallet,
    accountsFromMnemonic: accountsFromMnemonic,
    nextAccountIndex: nextAccountIndex,
    revealEvmSecret: revealEvmSecret,
    wipeBytes: wipeBytes,
    evmPath: evmPath,
    encryptVault: encryptVault,
    decryptVault: decryptVault,
    toEip55: toEip55,
    base58Encode: base58Encode,
    signMessage: signMessage,
    signPersonal: signPersonal,
    signTransaction: signTransaction,
    recoverSigner: recoverSigner,
    recoverTxSigner: recoverTxSigner,
    rlpInt: rlpInt,
    rlpList: rlpList,
    rlpBytes: rlpBytes,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.tkrCrypto = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
