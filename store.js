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
  var DB_VERSION = 4;
  var STORE = "vault";
  var META = "meta";
  var DEFAULT_VAULT_ID = "default";
  var ACTIVE_KEY = "activeId";
  var GROUPS_KEY = "groups";
  var MAX_WALLETS = 20;
  var MAX_GROUPS = 20;
  var LABEL_MAX = 64;
  var UNASSIGNED_GROUP_ID = "unassigned";
  var CONTACTS = "contacts";
  var RECENT = "recent_recipients";
  var ACTIVITY = "activity";

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
        if (!db.objectStoreNames.contains(ACTIVITY)) {
          var act = db.createObjectStore(ACTIVITY, { keyPath: "id", autoIncrement: true });
          act.createIndex("wallet_id", "wallet_id", { unique: false });
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

  function normalizeLabel(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, LABEL_MAX);
  }

  function displayAccountLabel(row, index) {
    var label = normalizeLabel(row && row.label);
    if (label) {
      return label;
    }
    var n = Number(index);
    if (!isFinite(n) || n < 0) {
      n = 0;
    }
    return "Account " + String(n + 1);
  }

  function unassignedGroup() {
    return { id: UNASSIGNED_GROUP_ID, label: UNASSIGNED_GROUP_ID };
  }

  function normalizeGroupId(id) {
    var s = String(id == null ? "" : id).trim();
    return s || UNASSIGNED_GROUP_ID;
  }

  function ensureGroups(groups) {
    var src = Array.isArray(groups) ? groups : [];
    var out = [];
    var seen = {};
    var i;
    var row;
    var id;
    out.push(unassignedGroup());
    seen[UNASSIGNED_GROUP_ID] = true;
    for (i = 0; i < src.length; i++) {
      row = src[i];
      if (!row) {
        continue;
      }
      id = String(row.id || "").trim();
      if (!id || seen[id]) {
        continue;
      }
      if (id === UNASSIGNED_GROUP_ID) {
        continue;
      }
      seen[id] = true;
      out.push({
        id: id,
        label: normalizeLabel(row.label) || id,
      });
    }
    return out;
  }

  function newGroupId() {
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
    return "g-" + hex;
  }

  function createGroup(groups, label) {
    var name = normalizeLabel(label);
    if (!name) {
      throw new Error("bad-group-label");
    }
    if (name.toLowerCase() === UNASSIGNED_GROUP_ID) {
      throw new Error("reserved-group");
    }
    var list = ensureGroups(groups);
    if (list.length >= MAX_GROUPS) {
      throw new Error("group-cap");
    }
    var id = newGroupId();
    var ids = {};
    var i;
    for (i = 0; i < list.length; i++) {
      ids[list[i].id] = true;
    }
    while (ids[id]) {
      id = newGroupId();
    }
    list.push({ id: id, label: name });
    return list;
  }

  function deleteGroup(groups, groupId) {
    var id = String(groupId || "");
    if (!id || id === UNASSIGNED_GROUP_ID) {
      throw new Error("reserved-group");
    }
    return ensureGroups(groups).filter(function (g) {
      return g.id !== id;
    });
  }

  function assignAccountGroup(groupId, groups) {
    var id = normalizeGroupId(groupId);
    var list = ensureGroups(groups);
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        return id;
      }
    }
    return UNASSIGNED_GROUP_ID;
  }

  function reassignGroupMembers(rows, fromId) {
    var from = String(fromId || "");
    var src = Array.isArray(rows) ? rows : [];
    return src.map(function (row) {
      var next = {};
      var key;
      if (!row || typeof row !== "object") {
        return row;
      }
      for (key in row) {
        if (Object.prototype.hasOwnProperty.call(row, key)) {
          next[key] = row[key];
        }
      }
      if (normalizeGroupId(row.groupId) === from) {
        next.groupId = UNASSIGNED_GROUP_ID;
      } else {
        next.groupId = normalizeGroupId(row.groupId);
      }
      return next;
    });
  }

  function filterAccountsByGroup(rows, groupId) {
    var want = normalizeGroupId(groupId);
    var src = Array.isArray(rows) ? rows : [];
    return src.filter(function (row) {
      return normalizeGroupId(row && row.groupId) === want;
    });
  }

  function yamlString(value) {
    var s = String(value == null ? "" : value);
    if (s === "") {
      return '""';
    }
    if (
      /^(?:true|false|null|yes|no|on|off)$/i.test(s) ||
      /[:#\n\r\t,[\]{}&*!|>%@`'"]/.test(s) ||
      /^-/.test(s) ||
      /\s/.test(s) ||
      /^[0-9]/.test(s)
    ) {
      return JSON.stringify(s);
    }
    return s;
  }

  function isWatchAccountRow(acc) {
    return Boolean(acc && acc.kind === "watch");
  }

  function configAccountsFromVaults(vaults) {
    var src = Array.isArray(vaults) ? vaults : [];
    var out = [];
    var i;
    var vault;
    var accounts;
    var j;
    var acc;
    var watches;
    for (i = 0; i < src.length; i++) {
      vault = src[i] || {};
      accounts = Array.isArray(vault.accounts) ? vault.accounts : [];
      watches = [];
      for (j = 0; j < accounts.length; j++) {
        acc = accounts[j];
        if (!acc || !isWatchAccountRow(acc)) {
          continue;
        }
        watches.push({
          label: normalizeLabel(acc.label),
          evmAddress: String(acc.evmAddress || ""),
        });
      }
      out.push({
        id: String(vault.id || ""),
        label: normalizeLabel(vault.label),
        groupId: normalizeGroupId(vault.groupId),
        evmAddress: String(vault.evmAddress || (accounts[0] && accounts[0].evmAddress) || ""),
        watches: watches,
      });
    }
    return out;
  }

  function buildConfigBackup(cfg) {
    var input = cfg || {};
    var prefs = input.preferences || {};
    var groups = ensureGroups(input.groups);
    var accounts = Array.isArray(input.accounts) ? input.accounts : [];
    var exportedAt = input.exportedAt ? String(input.exportedAt) : new Date().toISOString();
    var lines = [];
    var i;
    var g;
    var acc;
    var w;
    var watch;
    lines.push("tkrwallet_config: 1");
    lines.push("exported_at: " + yamlString(exportedAt));
    lines.push("preferences:");
    lines.push(
      "  autolock_minutes: " +
        (Number.isFinite(Number(prefs.autolock_minutes)) ? String(Number(prefs.autolock_minutes)) : "5")
    );
    lines.push("  connect_at_launch: " + (prefs.connect_at_launch ? "true" : "false"));
    lines.push("  currency: " + yamlString(prefs.currency || "usd"));
    lines.push("  leave_gas_buffer: " + (prefs.leave_gas_buffer === false ? "false" : "true"));
    lines.push("groups:");
    for (i = 0; i < groups.length; i++) {
      g = groups[i];
      lines.push("  - id: " + yamlString(g.id));
      lines.push("    label: " + yamlString(g.label));
    }
    lines.push("accounts:");
    if (!accounts.length) {
      lines.push("  []");
    }
    for (i = 0; i < accounts.length; i++) {
      acc = accounts[i] || {};
      lines.push("  - id: " + yamlString(acc.id || ""));
      lines.push("    label: " + yamlString(normalizeLabel(acc.label)));
      lines.push("    group: " + yamlString(normalizeGroupId(acc.groupId)));
      lines.push("    evm: " + yamlString(acc.evmAddress || ""));
      if (acc.watches && acc.watches.length) {
        lines.push("    watches:");
        for (w = 0; w < acc.watches.length; w++) {
          watch = acc.watches[w] || {};
          lines.push("      - label: " + yamlString(normalizeLabel(watch.label)));
          lines.push("        evm: " + yamlString(watch.evmAddress || ""));
        }
      } else {
        lines.push("    watches: []");
      }
    }
    return lines.join("\n") + "\n";
  }

  function vaultPublicRow(vault, key) {
    var id = String((vault && vault.id) || key || DEFAULT_VAULT_ID);
    var accounts = (vault && vault.accounts) || [];
    var addr = "";
    var i;
    for (i = 0; i < accounts.length; i++) {
      if (accounts[i] && accounts[i].evmAddress && !isWatchAccountRow(accounts[i])) {
        addr = String(accounts[i].evmAddress);
        break;
      }
    }
    if (!addr) {
      for (i = 0; i < accounts.length; i++) {
        if (accounts[i] && accounts[i].evmAddress) {
          addr = String(accounts[i].evmAddress);
          break;
        }
      }
    }
    return {
      id: id,
      evmAddress: addr,
      accountCount: accounts.length,
      label: normalizeLabel(vault && vault.label),
      groupId: normalizeGroupId(vault && vault.groupId),
      accounts: accounts.map(function (acc) {
        return {
          kind: isWatchAccountRow(acc) ? "watch" : "hd",
          label: normalizeLabel(acc && acc.label),
          evmAddress: acc && acc.evmAddress ? String(acc.evmAddress) : "",
        };
      }),
    };
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

  function listGroups() {
    return openDb().then(function (db) {
      if (!db.objectStoreNames.contains(META)) {
        return ensureGroups([]);
      }
      return tx(db, META, "readonly", function (store) {
        return store.get(GROUPS_KEY);
      }).then(function (rows) {
        return ensureGroups(rows);
      });
    });
  }

  function saveGroups(groups) {
    var list = ensureGroups(groups);
    return openDb().then(function (db) {
      if (!db.objectStoreNames.contains(META)) {
        return list;
      }
      return tx(db, META, "readwrite", function (store) {
        return store.put(list, GROUPS_KEY);
      }).then(function () {
        return list;
      });
    });
  }

  function patchVaultMeta(id, patch) {
    return loadVault(id).then(function (vault) {
      if (!vault) {
        throw new Error("no vault");
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, "label")) {
        vault.label = normalizeLabel(patch.label);
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, "groupId")) {
        vault.groupId = normalizeGroupId(patch.groupId);
      }
      return writeVault(vault, { activate: false });
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

  function writeVault(vault, opts) {
    if (!vault || typeof vault !== "object") {
      return Promise.reject(new Error("bad-vault"));
    }
    var activate = !opts || opts.activate !== false;
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
          if (!activate) {
            return vault;
          }
          return setActiveVault(id).then(function () {
            return vault;
          });
        });
      });
    });
  }

  function saveVault(vault) {
    return writeVault(vault, { activate: true });
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
          return clearActivity(key);
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

  function recordActivity(row) {
    var rec = {
      wallet_id: String((row && row.wallet_id) || ""),
      chain_id: Number(row && row.chain_id),
      tx_hash: String((row && row.tx_hash) || "").trim(),
      kind: String((row && row.kind) || "swap"),
      symbol: String((row && row.symbol) || ""),
      amount: String((row && row.amount) || ""),
      at: Number(row && row.at) || Date.now(),
    };
    if (!rec.wallet_id || !rec.tx_hash || !Number.isFinite(rec.chain_id)) {
      return Promise.resolve(null);
    }
    return openDb().then(function (db) {
      return tx(db, ACTIVITY, "readwrite", function (store) {
        return store.add(rec);
      });
    });
  }

  function listActivity(walletId) {
    var id = String(walletId || "");
    if (!id) {
      return Promise.resolve([]);
    }
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(ACTIVITY, "readonly");
        var idx = t.objectStore(ACTIVITY).index("wallet_id");
        var req = idx.getAll(id);
        req.onsuccess = function () {
          var rows = Array.isArray(req.result) ? req.result.slice() : [];
          rows.sort(function (a, b) {
            return Number(b.at || 0) - Number(a.at || 0);
          });
          resolve(rows);
        };
        req.onerror = function () {
          reject(req.error || new Error("indexeddb-failed"));
        };
      });
    });
  }

  function clearActivity(walletId) {
    var id = String(walletId || "");
    if (!id) {
      return Promise.resolve(null);
    }
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(ACTIVITY, "readwrite");
        var store = t.objectStore(ACTIVITY);
        var idx = store.index("wallet_id");
        var req = idx.openCursor(IDBKeyRange.only(id));
        req.onsuccess = function () {
          var cursor = req.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
            return;
          }
          resolve(null);
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
    MAX_GROUPS: MAX_GROUPS,
    LABEL_MAX: LABEL_MAX,
    UNASSIGNED_GROUP_ID: UNASSIGNED_GROUP_ID,
    normalizeLabel: normalizeLabel,
    displayAccountLabel: displayAccountLabel,
    normalizeGroupId: normalizeGroupId,
    ensureGroups: ensureGroups,
    newGroupId: newGroupId,
    createGroup: createGroup,
    deleteGroup: deleteGroup,
    assignAccountGroup: assignAccountGroup,
    reassignGroupMembers: reassignGroupMembers,
    filterAccountsByGroup: filterAccountsByGroup,
    configAccountsFromVaults: configAccountsFromVaults,
    buildConfigBackup: buildConfigBackup,
    newVaultId: newVaultId,
    assignVaultId: assignVaultId,
    vaultPublicRow: vaultPublicRow,
    listVaults: listVaults,
    listGroups: listGroups,
    saveGroups: saveGroups,
    patchVaultMeta: patchVaultMeta,
    setActiveVault: setActiveVault,
    saveVault: saveVault,
    loadVault: loadVault,
    clearVault: clearVault,
    listContacts: listContacts,
    addContact: addContact,
    removeContact: removeContact,
    listRecentRecipients: listRecentRecipients,
    rememberRecipient: rememberRecipient,
    recordActivity: recordActivity,
    listActivity: listActivity,
    clearActivity: clearActivity,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.tkrStore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
