/* tkrWallet — local vault store (IndexedDB).
 *
 * Holds the encrypted vault blob (AES-GCM ciphertext + KDF params) plus
 * operator-private Send contacts and recent recipients. The plaintext
 * mnemonic never reaches this layer: crypto.js encrypts before anything
 * is saved. IndexedDB works in both the PWA and the extension popup.
 */
(function (root) {
  "use strict";

  var DB_NAME = "tkrwallet";
  var DB_VERSION = 2;
  var STORE = "vault";
  var KEY = "default";
  var CONTACTS = "contacts";
  var RECENT = "recent_recipients";

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) {
        reject(new Error("no-indexeddb"));
        return;
      }
      var req = root.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
        if (!db.objectStoreNames.contains(CONTACTS)) {
          db.createObjectStore(CONTACTS, { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(RECENT)) {
          db.createObjectStore(RECENT, { keyPath: "address" });
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

  function tx(db, storeName, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(storeName, mode);
      var store = t.objectStore(storeName);
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
      return tx(db, STORE, "readwrite", function (store) {
        return store.put(vault, KEY);
      });
    });
  }

  function loadVault() {
    return openDb().then(function (db) {
      return tx(db, STORE, "readonly", function (store) {
        return store.get(KEY);
      });
    });
  }

  function clearVault() {
    return openDb().then(function (db) {
      return tx(db, STORE, "readwrite", function (store) {
        return store.delete(KEY);
      });
    });
  }

  function listContacts() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(CONTACTS, "readonly");
        var req = t.objectStore(CONTACTS).getAll();
        req.onsuccess = function () {
          var rows = Array.isArray(req.result) ? req.result.slice() : [];
          rows.sort(function (a, b) {
            return String(a.label || "").localeCompare(String(b.label || ""));
          });
          resolve(rows);
        };
        req.onerror = function () {
          reject(req.error || new Error("indexeddb-failed"));
        };
      });
    });
  }

  function addContact(label, address) {
    var row = {
      label: String(label || "").trim().slice(0, 64),
      address: String(address || "").trim(),
      created_at: Date.now(),
    };
    if (!row.label || !row.address) {
      return Promise.reject(new Error("bad-contact"));
    }
    return openDb().then(function (db) {
      return tx(db, CONTACTS, "readwrite", function (store) {
        return store.add(row);
      });
    });
  }

  function removeContact(id) {
    return openDb().then(function (db) {
      return tx(db, CONTACTS, "readwrite", function (store) {
        return store.delete(Number(id));
      });
    });
  }

  function listRecentRecipients(limit) {
    var max = limit == null ? 3 : Number(limit);
    if (!Number.isFinite(max) || max < 0) {
      max = 3;
    }
    max = Math.min(max, 3);
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(RECENT, "readonly");
        var req = t.objectStore(RECENT).getAll();
        req.onsuccess = function () {
          var rows = Array.isArray(req.result) ? req.result.slice() : [];
          rows.sort(function (a, b) {
            return Number(b.last_used_at || 0) - Number(a.last_used_at || 0);
          });
          resolve(rows.slice(0, max));
        };
        req.onerror = function () {
          reject(req.error || new Error("indexeddb-failed"));
        };
      });
    });
  }

  function rememberRecipient(address) {
    var addr = String(address || "").trim();
    if (!addr) {
      return Promise.resolve(null);
    }
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(RECENT, "readwrite");
        var store = t.objectStore(RECENT);
        var getReq = store.get(addr);
        getReq.onsuccess = function () {
          var prev = getReq.result || { address: addr };
          prev.last_used_at = Date.now();
          var putReq = store.put(prev);
          putReq.onsuccess = function () {
            resolve(prev);
          };
          putReq.onerror = function () {
            reject(putReq.error || new Error("indexeddb-failed"));
          };
        };
        getReq.onerror = function () {
          reject(getReq.error || new Error("indexeddb-failed"));
        };
      });
    });
  }

  var api = {
    saveVault: saveVault,
    loadVault: loadVault,
    clearVault: clearVault,
    listContacts: listContacts,
    addContact: addContact,
    removeContact: removeContact,
    listRecentRecipients: listRecentRecipients,
    rememberRecipient: rememberRecipient,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.tkrStore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
