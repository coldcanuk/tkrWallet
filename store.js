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
  var DB_VERSION = 3;
  var STORE = "vault";
  var META = "meta";
  var DEFAULT_VAULT_ID = "default";
  var ACTIVE_KEY = "activeId";
  var MAX_WALLETS = 20;
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
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META);
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

  function newVaultId() {
    var b = new Uint8Array(8);
    if (root.crypto && root.crypto.getRandomValues) {
      root.crypto.getRandomValues(b);
    } else if (typeof require === "function") {
      require("crypto").randomFillSync(b);
    } else {
      throw new Error("no-entropy");
    }
    var hex = "";
    var i;
    for (i = 0; i < b.length; i++) {
      hex += ("0" + b[i].toString(16)).slice(-2);
    }
    return "w-" + hex;
  }

  function assignVaultId(vault, existingIds) {
    if (vault && vault.id) {
      return String(vault.id);
    }
    var ids = existingIds || [];
    if (!ids.length) {
      return DEFAULT_VAULT_ID;
    }
    var id = newVaultId();
    while (ids.indexOf(id) !== -1) {
      id = newVaultId();
    }
    return id;
  }

  function vaultPublicRow(vault, key) {
    var id = String((vault && vault.id) || key || DEFAULT_VAULT_ID);
    var accounts = (vault && vault.accounts) || [];
    var addr = "";
    var i;
    for (i = 0; i < accounts.length; i++) {
      if (accounts[i] && accounts[i].evmAddress) {
        addr = String(accounts[i].evmAddress);
        break;
      }
    }
    return { id: id, evmAddress: addr, accountCount: accounts.length };
  }

  function stampVaultId(vault, key) {
    if (!vault) {
      return null;
    }
    if (!vault.id) {
      vault.id = key || DEFAULT_VAULT_ID;
    }
    return vault;
  }

  function getActiveId() {
    return openDb().then(function (db) {
      if (!db.objectStoreNames.contains(META)) {
        return DEFAULT_VAULT_ID;
      }
      return tx(db, META, "readonly", function (store) {
        return store.get(ACTIVE_KEY);
      });
    });
  }

  function setActiveVault(id) {
    var key = id == null ? "" : String(id);
    return openDb().then(function (db) {
      if (!db.objectStoreNames.contains(META)) {
        return key;
      }
      return tx(db, META, "readwrite", function (store) {
        return store.put(key, ACTIVE_KEY);
      }).then(function () {
        return key;
      });
    });
  }

  function listVaultIds() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, "readonly");
        var req = t.objectStore(STORE).getAllKeys();
        req.onsuccess = function () {
          var keys = Array.isArray(req.result) ? req.result.slice() : [];
          resolve(keys.map(function (k) { return String(k); }));
        };
        req.onerror = function () {
          reject(req.error || new Error("indexeddb-failed"));
        };
      });
    });
  }

  function listVaults() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, "readonly");
        var store = t.objectStore(STORE);
        var keysReq = store.getAllKeys();
        var valsReq = store.getAll();
        var keys;
        var vals;
        function done() {
          if (!keys || !vals) {
            return;
          }
          var rows = [];
          var i;
          for (i = 0; i < vals.length; i++) {
            rows.push(vaultPublicRow(vals[i], keys[i]));
          }
          resolve(rows);
        }
        keysReq.onsuccess = function () {
          keys = Array.isArray(keysReq.result) ? keysReq.result : [];
          done();
        };
        valsReq.onsuccess = function () {
          vals = Array.isArray(valsReq.result) ? valsReq.result : [];
          done();
        };
        keysReq.onerror = function () {
          reject(keysReq.error || new Error("indexeddb-failed"));
        };
        valsReq.onerror = function () {
          reject(valsReq.error || new Error("indexeddb-failed"));
        };
      });
    });
  }

  function saveVault(vault) {
    if (!vault || typeof vault !== "object") {
      return Promise.reject(new Error("bad-vault"));
    }
    return listVaultIds().then(function (ids) {
      var id = assignVaultId(vault, ids);
      vault.id = id;
      if (ids.indexOf(id) === -1 && ids.length >= MAX_WALLETS) {
        throw new Error("wallet-cap");
      }
      return openDb().then(function (db) {
        return tx(db, STORE, "readwrite", function (store) {
          return store.put(vault, id);
        }).then(function () {
          return setActiveVault(id).then(function () {
            return vault;
          });
        });
      });
    });
  }

  function loadVault(id) {
    return Promise.resolve(id == null || id === "" ? getActiveId() : String(id)).then(function (want) {
      return openDb().then(function (db) {
        function get(key) {
          if (!key) {
            return Promise.resolve(null);
          }
          return tx(db, STORE, "readonly", function (store) {
            return store.get(key);
          }).then(function (vault) {
            return stampVaultId(vault, key);
          });
        }
        return get(want).then(function (vault) {
          if (vault) {
            return vault;
          }
          if (want && want !== DEFAULT_VAULT_ID) {
            return get(DEFAULT_VAULT_ID);
          }
          return listVaultIds().then(function (ids) {
            if (!ids.length) {
              return null;
            }
            return get(ids[0]);
          });
        });
      });
    });
  }

  function clearVault(id) {
    return Promise.resolve(id == null || id === "" ? getActiveId() : String(id)).then(function (want) {
      var key = want || DEFAULT_VAULT_ID;
      return openDb().then(function (db) {
        return tx(db, STORE, "readwrite", function (store) {
          return store.delete(key);
        }).then(function () {
          return getActiveId().then(function (active) {
            if (active && active !== key) {
              return;
            }
            return listVaultIds().then(function (ids) {
              return setActiveVault(ids[0] || "");
            });
          });
        });
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
    DB_VERSION: DB_VERSION,
    DEFAULT_VAULT_ID: DEFAULT_VAULT_ID,
    MAX_WALLETS: MAX_WALLETS,
    newVaultId: newVaultId,
    assignVaultId: assignVaultId,
    vaultPublicRow: vaultPublicRow,
    listVaults: listVaults,
    setActiveVault: setActiveVault,
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
