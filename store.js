/* tkrWallet — local vault store (IndexedDB).
 *
 * Holds ONLY the encrypted vault blob (the AES-GCM ciphertext + KDF params).
 * The plaintext mnemonic never reaches this layer: crypto.js encrypts before
 * anything is saved. IndexedDB works in both the PWA and the extension popup,
 * is async, and is not part of the page's XSS surface the way localStorage is.
 */
(function (root) {
  "use strict";

  var DB_NAME = "tkrwallet";
  var DB_VERSION = 1;
  var STORE = "vault";
  var KEY = "default";

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) {
        reject(new Error("no-indexeddb"));
        return;
      }
      var req = root.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error("indexeddb-open-failed"));
      };
    });
  }

  function tx(db, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(STORE, mode);
      var store = t.objectStore(STORE);
      var req = fn(store);
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error("indexeddb-failed"));
      };
    });
  }

  function saveVault(vault) {
    return openDb().then(function (db) {
      return tx(db, "readwrite", function (store) {
        return store.put(vault, KEY);
      });
    });
  }

  function loadVault() {
    return openDb().then(function (db) {
      return tx(db, "readonly", function (store) {
        return store.get(KEY);
      });
    });
  }

  function clearVault() {
    return openDb().then(function (db) {
      return tx(db, "readwrite", function (store) {
        return store.delete(KEY);
      });
    });
  }

  var api = { saveVault: saveVault, loadVault: loadVault, clearVault: clearVault };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.tkrStore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
