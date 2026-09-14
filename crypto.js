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

  var BIP44_EVM = "m/44'/60'/0'/0/0";
  var BIP44_SOL = "m/44'/501'/0'/0'";
  var KDF_ITERATIONS = 600000;

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

  function deriveEvm(seed) {
    var node = noble.HDKey.fromMasterSeed(seed).derive(BIP44_EVM);
    var priv = node.privateKey; // 32 bytes
    var pub = noble.secp256k1.getPublicKey(priv, false); // 65 bytes, 0x04-prefixed
    var addr = noble.keccak_256(pub.slice(1)).slice(-20); // last 20 bytes
    return {
      path: BIP44_EVM,
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

  function importMnemonic(mnemonic) {
    var phrase = String(mnemonic || "").trim().toLowerCase();
    if (!noble.validateMnemonic(phrase, noble.wordlist)) {
      throw new Error("invalid-mnemonic");
    }
    var seed = noble.mnemonicToSeedSync(phrase);
    var evm = deriveEvm(seed);
    var sol = deriveSolana(seed);
    return {
      mnemonic: phrase,
      evmAddress: evm.address,
      solAddress: sol.address,
    };
  }

  function generateWallet(strength) {
    var phrase = noble.generateMnemonic(noble.wordlist, strength || 128);
    return importMnemonic(phrase);
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

  var api = {
    KDF_ITERATIONS: KDF_ITERATIONS,
    importMnemonic: importMnemonic,
    generateWallet: generateWallet,
    encryptVault: encryptVault,
    decryptVault: decryptVault,
    toEip55: toEip55,
    base58Encode: base58Encode,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.tkrCrypto = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
