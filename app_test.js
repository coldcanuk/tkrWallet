// tkrWallet — test suite (named harness).
//
// Run: node app_test.js   (or npm test)
//
// The harness aggregates failures so one regression does not hide the rest.
// Every group is a named test; the run ends with "N tests, 0 failures" or a
// list of every failure and a non-zero exit.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const ALLOWED_ORIGIN = "https://tkrwallet.scratchpost.ai";
const SHIPPED = ["index.html", "shell.js", "ui.js", "wallet.js", "crypto.js", "store.js", "sw.js", "manifest.json", "manifest.webmanifest", "README.md"];
/* Browser-loaded artifacts only. README/CHANGELOG/deploy/tools are not this list. */
const CLIENT_SHIPPED = [
  "index.html",
  "shell.js",
  "ui.js",
  "wallet.js",
  "crypto.js",
  "store.js",
  "sw.js",
  "manifest.json",
  "manifest.webmanifest",
];
const RFC1918 =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/;
const DOT_LOCAL = /\b[a-z0-9-]+\.local\b/i;
const INTERNAL_HOST = /\b(?:eva|caesar|icehut|athena|kiff|rathole)\b/i;

let failures = [];
let count = 0;
let queue = [];

function test(name, fn) {
  queue.push({ name: name, fn: fn });
}

function end() {
  if (failures.length) {
    console.error("\n" + failures.length + " of " + count + " tests failed.");
    process.exit(1);
  }
  console.log("\n" + count + " tests, 0 failures");
}

/* Sequential async runner: each test may return a promise. A sync throw inside
 * a test's fn becomes a rejection here, so every failure is caught and reported
 * and the suite always runs to completion. */
function run() {
  let chain = Promise.resolve();
  queue.forEach(function (t) {
    chain = chain.then(function () {
      return Promise.resolve()
        .then(t.fn)
        .then(
          function () {
            count++;
            console.log("ok   " + t.name);
          },
          function (e) {
            failures.push("FAIL " + t.name + " — " + (e && e.message ? e.message : e));
            console.error("FAIL " + t.name + " — " + (e && e.message ? e.message : e));
          }
        );
    });
  });
  chain.then(end);
}

function readFile(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

/* ── ui.js: shell controller ───────────────────────────────────────────── */

test("ui.js exports the shell API", function () {
  const ui = require("./ui.js");
  assert.deepStrictEqual(ui.SCREENS, ["home", "swap", "activity", "search", "settings", "accounts", "detail", "send", "receive", "airdrops"]);
  assert.strictEqual(typeof ui.renderTokens, "function");
  assert.strictEqual(typeof ui.setWalletValue, "function");
  assert.strictEqual(typeof ui.renderDetail, "function");
  assert.strictEqual(typeof ui.goToken, "function");
});

test("route parsing is strict and never throws", function () {
  const ui = require("./ui.js");
  assert.strictEqual(ui.parseRoute("#/swap"), "swap");
  assert.strictEqual(ui.parseRoute("#/send"), "send");
  assert.strictEqual(ui.parseRoute("#/receive"), "receive");
  assert.strictEqual(ui.parseRoute("#/airdrops"), "airdrops");
  assert.strictEqual(ui.parseRoute(""), "home");
  assert.strictEqual(ui.parseRoute("#/nope"), "home");
  assert.strictEqual(ui.parseRoute(null), "home");
  assert.strictEqual(ui.parseRoute("#/ACTIVITY?x=1"), "activity");
  assert.strictEqual(ui.parseRoute("#/settings"), "settings");
  assert.strictEqual(ui.parseRoute("#/accounts"), "accounts");
});

test("account drawer labels and selectedIndex restore the last HD account", function () {
  const ui = require("./ui.js");
  assert.strictEqual(ui.accountDotLabel(0), "A1");
  assert.strictEqual(ui.accountDotLabel(2), "A3");
  assert.strictEqual(
    ui.selectedIndexFromVault({
      accounts: [
        { i: 0, evmAddress: "0x1111111111111111111111111111111111111111" },
        { i: 1, evmAddress: "0x2222222222222222222222222222222222222222" },
      ],
      selectedIndex: 1,
    }),
    1
  );
  assert.strictEqual(
    ui.selectedIndexFromVault({
      accounts: [{ i: 0, evmAddress: "0x1111111111111111111111111111111111111111" }],
      selectedIndex: 9,
    }),
    0,
    "unknown selectedIndex falls back to the first published account"
  );
});

test("index.html ships the account drawer and receive/send screens", function () {
  const html = readFile("index.html");
  assert.match(html, /id="account-drawer"/);
  assert.match(html, /id="account-list"/);
  assert.match(html, /w-20/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /data-screen="receive"/);
  assert.match(html, /data-screen="send"/);
  assert.match(html, /id="receive-copy"/);
  assert.match(html, /id="send-chain"/);
  assert.match(html, /id="receive-chain"/);
});

test("wallets screen reuses create/import and has no Derive", function () {
  const html = readFile("index.html");
  const section = function (name) {
    const re = new RegExp('<section[^>]*data-screen="' + name + '"[\\s\\S]*?<\\/section>');
    const m = html.match(re);
    assert.ok(m, "missing data-screen=" + name);
    return m[0];
  };
  const accounts = section("accounts");
  const home = section("home");
  const settings = section("settings");
  assert.ok(accounts.indexOf('id="wallet-new"') !== -1, "Wallets must offer New Wallet");
  assert.ok(accounts.indexOf("+ New Wallet") !== -1, "New Wallet label");
  assert.ok(accounts.indexOf('id="wallet-remove"') !== -1, "Wallets must offer Remove Wallet");
  assert.ok(accounts.indexOf("Remove Wallet") !== -1, "Remove Wallet label");
  assert.ok(accounts.indexOf('id="wallet-import"') !== -1, "Wallets must offer Import Wallet");
  assert.ok(accounts.indexOf("Import Wallet") !== -1, "Import Wallet label");
  assert.ok(accounts.indexOf("Derive") === -1, "Derive must be gone from Wallets");
  assert.ok(accounts.indexOf('id="add-account-form"') === -1, "derive form must be gone");
  assert.ok(accounts.indexOf("data-add-account") === -1, "derive submit must be gone");
  assert.ok(home.indexOf('id="wallet-new"') === -1, "Home must not host wallet manager");
  assert.ok(settings.indexOf('id="wallet-new"') === -1, "Settings must not host wallet manager");
  const ui = readFile("ui.js");
  assert.ok(ui.indexOf("function onAddAccount") === -1, "onAddAccount must be gone");
  assert.ok(ui.indexOf("function onWalletNew") !== -1, "ui.js must wire New Wallet");
  assert.ok(ui.indexOf("function onWalletRemove") !== -1, "ui.js must wire Remove Wallet");
  assert.ok(ui.indexOf("function onWalletImport") !== -1, "ui.js must wire Import Wallet");
  const newStart = ui.indexOf("function onWalletNew");
  const newChunk = ui.slice(newStart, newStart + 250);
  assert.ok(newChunk.indexOf('openGate("create")') !== -1, "New Wallet reuses the create gate");
  const importStart = ui.indexOf("function onWalletImport");
  const importChunk = ui.slice(importStart, importStart + 250);
  assert.ok(importChunk.indexOf('openGate("import")') !== -1, "Import Wallet reuses the import gate");
  assert.ok(ui.indexOf("clearVault") !== -1, "Remove Wallet must wipe the local vault");
  assert.ok(ui.indexOf("listVaults") !== -1, "Wallets must list every vault on this device");
  assert.ok(ui.indexOf("function switchWallet") !== -1, "tapping a listed wallet must switch to it");
  assert.ok(ui.indexOf("Remove it first") === -1, "New/Import must not refuse because one wallet exists");
  assert.ok(ui.indexOf("wallet-duplicate") !== -1, "import must not duplicate an address already on device");
  const storeSrc = readFile("store.js");
  assert.ok(storeSrc.indexOf("DEFAULT_VAULT_ID") !== -1, "legacy default vault must still load");
  assert.ok(storeSrc.indexOf("MAX_WALLETS") !== -1, "wallet cap must exist");
  assert.ok(/store\.put\(vault,\s*id\)/.test(storeSrc) || storeSrc.indexOf("store.put(vault, id)") !== -1, "each wallet is its own IndexedDB key");
  const addStart = ui.indexOf('el("account-drawer-add")');
  assert.ok(addStart !== -1, "drawer + must be bound");
  const addChunk = ui.slice(addStart, addStart + 400);
  assert.ok(addChunk.indexOf('go("accounts")') !== -1, "drawer + opens Wallets");
  assert.ok(addChunk.indexOf('go("settings")') === -1, "drawer + must not dump wallets into Settings");
  const uiMod = require("./ui.js");
  assert.strictEqual(uiMod.REMOVE_WALLET_CONFIRM, "remove this wallet");
  assert.ok(uiMod.typedRemoveWallet("remove this wallet"));
  assert.ok(uiMod.typedRemoveWallet("  remove this wallet  "));
  assert.ok(!uiMod.typedRemoveWallet("Remove this wallet"), "confirm is exact, not case-folded");
});

test("Extra accounts Watch is one word with a 2s help bubble", function () {
  const html = readFile("index.html");
  const section = function (name) {
    const re = new RegExp('<section[^>]*data-screen="' + name + '"[\\s\\S]*?<\\/section>');
    const m = html.match(re);
    assert.ok(m, "missing data-screen=" + name);
    return m[0];
  };
  const accounts = section("accounts");
  const home = section("home");
  const settings = section("settings");
  assert.ok(accounts.indexOf('id="watch-account-open"') !== -1, "Watch lives on Extra accounts");
  assert.ok(
    /id="watch-account-open"[^>]*>\s*Watch\s*</.test(accounts),
    "visible label must be the single word Watch"
  );
  assert.ok(accounts.indexOf('id="watch-account-tip"') !== -1, "missing 2s help bubble");
  assert.ok(accounts.indexOf('role="tooltip"') !== -1, "help bubble must be a tooltip");
  assert.ok(
    accounts.indexOf("wallet address") !== -1 && accounts.indexOf("cannot send") !== -1,
    "bubble must explain paste-an-address and that it cannot send"
  );
  assert.ok(accounts.indexOf('id="watch-account-form"') !== -1, "Watch must reveal an address form");
  assert.ok(accounts.indexOf('id="watch-account-address"') !== -1, "missing address field");
  assert.ok(home.indexOf("watch-account-open") === -1, "Home must not host Watch");
  assert.ok(settings.indexOf("watch-account-open") === -1, "Settings must not host Watch");
  const uiMod = require("./ui.js");
  assert.strictEqual(uiMod.WATCH_HELP_MS, 2000, "hover help waits 2 seconds");
  assert.strictEqual(typeof uiMod.sessionCanSign, "function");
  const prev = {
    phrase: uiMod.session.phrase,
    watch: uiMod.session.watch,
    index: uiMod.session.index,
  };
  try {
    uiMod.session.phrase = "x";
    uiMod.session.watch = true;
    uiMod.session.index = 0;
    assert.strictEqual(uiMod.sessionCanSign(), false, "watch address must not sign");
    uiMod.session.watch = false;
    uiMod.session.index = 0;
    assert.strictEqual(uiMod.sessionCanSign(), true, "HD account with a phrase may sign");
    uiMod.session.phrase = null;
    assert.strictEqual(uiMod.sessionCanSign(), false, "locked session must not sign");
  } finally {
    uiMod.session.phrase = prev.phrase;
    uiMod.session.watch = prev.watch;
    uiMod.session.index = prev.index;
  }
  const ui = readFile("ui.js");
  assert.ok(ui.indexOf("function onAddWatchAccount") !== -1, "ui.js must wire watch add");
  assert.ok(ui.indexOf("function bindWatchHelp") !== -1, "ui.js must delay the help bubble");
  assert.ok(ui.indexOf("WATCH_HELP_MS") !== -1);
  ["onSendSubmit", "onSwapSubmit", "onConnect", "onConfirmSign", "signBuiltTx"].forEach(function (name) {
    const start = ui.indexOf("function " + name + "(");
    assert.ok(start !== -1, "missing " + name);
    const next = ui.indexOf("\n  function ", start + 10);
    const body = ui.slice(start, next === -1 ? start + 2500 : next);
    assert.ok(body.indexOf("sessionCanSign") !== -1, name + " must refuse a watch address");
  });
});

test("token routes parse to a detail screen, and malformed ones fall home", function () {
  const ui = require("./ui.js");
  assert.strictEqual(ui.parseRoute("#/token/1:native"), "detail");
  assert.deepStrictEqual(ui.parseTokenRoute("#/token/1:native"), { chainId: 1, asset: null });
  assert.deepStrictEqual(ui.parseTokenRoute("#/token/8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), {
    chainId: 8453,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  });
  // Half a route is not a route: never render an empty detail shell.
  ["#/token/1", "#/token/1:", "#/token/abc:native", "#/token/1:0xnope", "#/token/"].forEach(function (h) {
    assert.strictEqual(ui.parseRoute(h), "home", "must not treat " + h + " as a detail route");
    assert.strictEqual(ui.parseTokenRoute(h), null);
  });
});

test("currency parsing falls back to USD", function () {
  const ui = require("./ui.js");
  assert.strictEqual(ui.parseCurrency("CAD"), "cad");
  assert.strictEqual(ui.parseCurrency("mxn"), "mxn");
  assert.strictEqual(ui.parseCurrency("mxd"), "mxn");
  assert.strictEqual(ui.parseCurrency("eur"), "usd");
  assert.strictEqual(ui.parseCurrency(null), "usd");
  assert.strictEqual(ui.formatHeld(3), "3");
  assert.strictEqual(ui.formatHeld(0), "0");
  assert.strictEqual(ui.formatHeld(null), "—");
});

test("Wallet value live FX, MXN, labeled token rows, and Buy Now", function () {
  const html = readFile("index.html");
  assert.ok(html.indexOf('id="fx-live"') !== -1, "arrow-path live FX control");
  assert.ok(html.indexOf("M4.755 10.059") !== -1, "Heroicons arrow-path");
  assert.ok(html.indexOf('data-currency="mxn"') !== -1, "MXN selector");
  assert.ok(html.indexOf("Held:") !== -1, "token rows label Held");
  assert.ok(html.indexOf("data-token-price") !== -1, "token rows show unit price");
  assert.ok(html.indexOf("data-token-asof") !== -1, "token rows show last update");
  assert.ok(html.indexOf('id="detail-buy"') !== -1, "detail Buy");
  assert.ok(html.indexOf('id="detail-send"') !== -1, "detail Send");
  assert.ok(html.indexOf('id="detail-swap"') !== -1, "detail Swap");
  assert.ok(html.indexOf("Buy Now") === -1, "Buy Now was replaced by Buy/Send/Swap");
  const uiSrc = readFile("ui.js");
  assert.ok(uiSrc.indexOf('state.screen === "detail"') !== -1, "currency refresh must repaint the token card");
  assert.ok(uiSrc.indexOf("openSendFor") !== -1, "Send from the card pre-fills chain and token");
  assert.ok(uiSrc.indexOf('openSwapFor(chainId, asset, side)') !== -1 || uiSrc.indexOf('side === "to"') !== -1, "Buy pre-fills swap To");
  assert.ok(html.indexOf("lesou coming soon") !== -1, "lesou is disclosed as coming soon");
  assert.ok(html.indexOf('id="detail-eth-main"') !== -1, "ETH mainnet equivalent");
  const wallet = require("./wallet.js");
  assert.ok(String(wallet.tokenIconUrl(1, null)).indexOf("address=native") !== -1, "native ETH requests native art");
  return wallet
    .getPrices(["1:native"], ["usd", "mxn"], function (url) {
      assert.ok(String(url).indexOf("fx=live") !== -1, url);
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve({ as_of: 1, prices: { "1:native": { usd: 1, mxn: 17 } } });
        },
      });
    }, "live")
    .then(function (got) {
      assert.strictEqual(got.state, "ok");
      assert.strictEqual(got.prices["1:native"].mxn, 17);
    });
});

test("auto-lock minutes: clamped, snapped, never off, never past an hour", function () {
  const ui = require("./ui.js");
  assert.strictEqual(ui.parseAutolockMinutes(5), 5);
  assert.strictEqual(ui.parseAutolockMinutes(15), 15);
  assert.strictEqual(ui.parseAutolockMinutes(60), 60, "1 hour is the longest session");
  assert.strictEqual(ui.parseAutolockMinutes(90), 60, "over an hour clamps to 60");
  assert.strictEqual(ui.parseAutolockMinutes(120), 60);
  assert.strictEqual(ui.parseAutolockMinutes(0), 1, "zero means off — forbidden; clamps up");
  assert.strictEqual(ui.parseAutolockMinutes(-3), 1);
  assert.strictEqual(ui.parseAutolockMinutes(null), 5, "missing value falls back to the default");
  assert.strictEqual(ui.parseAutolockMinutes("nonsense"), 5);
  assert.strictEqual(ui.parseAutolockMinutes(7), 5, "snaps to the nearest offered option");
  assert.deepStrictEqual(ui.AUTOLOCK_OPTIONS, [1, 5, 15, 30, 60]);
  assert.ok(ui.AUTOLOCK_OPTIONS.every((m) => m >= 1 && m <= 60), "no off option, nothing over an hour");
});

test("parseViewSession restores a fresh viewing session and rejects an expired one", function () {
  const ui = require("./ui.js");
  const addr = "0x71562b71999873DB5b286dF957af199Ec94617F7";
  const now = 1_700_000_000_000;
  const fresh = ui.parseViewSession(
    JSON.stringify({ address: addr, lastActivity: now - 60_000, autolockMinutes: 5 }),
    now
  );
  assert.ok(fresh, "a session inside the auto-lock window must restore");
  assert.strictEqual(fresh.address, addr);
  assert.strictEqual(fresh.autolockMinutes, 5);
  assert.strictEqual(fresh.lastActivity, now - 60_000);
  assert.strictEqual(fresh.walletId, null);
  const withWallet = ui.parseViewSession(
    JSON.stringify({ address: addr, lastActivity: now - 60_000, autolockMinutes: 5, walletId: "w-abc" }),
    now
  );
  assert.strictEqual(withWallet.walletId, "w-abc");

  const expired = ui.parseViewSession(
    JSON.stringify({ address: addr, lastActivity: now - 6 * 60_000, autolockMinutes: 5 }),
    now
  );
  assert.strictEqual(expired, null, "past the auto-lock window must not restore");

  assert.strictEqual(ui.parseViewSession(null, now), null);
  assert.strictEqual(ui.parseViewSession("{", now), null);
  assert.strictEqual(ui.parseViewSession(JSON.stringify({ lastActivity: now }), now), null);
  assert.strictEqual(
    ui.parseViewSession(JSON.stringify({ address: "not-an-address", lastActivity: now, autolockMinutes: 5 }), now),
    null
  );
  const snapped = ui.parseViewSession(
    JSON.stringify({ address: addr, lastActivity: now, autolockMinutes: 7 }),
    now
  );
  assert.strictEqual(snapped.autolockMinutes, 5, "viewing session snaps auto-lock the same way Settings does");
  const withSol = ui.parseViewSession(
    JSON.stringify({
      address: addr,
      solAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      lastActivity: now,
      autolockMinutes: 15,
    }),
    now
  );
  assert.strictEqual(withSol.solAddress, "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  const badSol = ui.parseViewSession(
    JSON.stringify({ address: addr, solAddress: "not-sol", lastActivity: now, autolockMinutes: 15 }),
    now
  );
  assert.strictEqual(badSol.solAddress, null, "a junk Solana field must be dropped, not the whole session");
  const withTron = ui.parseViewSession(
    JSON.stringify({
      address: addr,
      tronAddress: "TXYZopYRdj2D9XRtbG411XZZWxU8kC5xwF",
      lastActivity: now,
      autolockMinutes: 15,
    }),
    now
  );
  assert.strictEqual(withTron.tronAddress, "TXYZopYRdj2D9XRtbG411XZZWxU8kC5xwF");
});

test("reload keeps the viewing session; lock and expiry do not; keys never land in it", function () {
  const ui = readFile("ui.js");
  assert.ok(ui.indexOf("tkrwallet.view-session") !== -1, "viewing session has a dedicated key");
  assert.ok(ui.indexOf("sessionStorage") !== -1, "PWA reload still uses sessionStorage, not a second IndexedDB vault");
  assert.ok(ui.indexOf("function viewSessionStore") !== -1, "MV3 popup vs PWA must pick different stores");
  assert.ok(ui.indexOf("chromeExtensionDocument") !== -1, "chrome-extension pages must not rely on popup sessionStorage");
  assert.ok(/function parseViewSession\(/.test(ui), "parseViewSession is the pure helper tests call");
  assert.ok(/function saveViewSession\(/.test(ui), "unlock must persist a viewing session");
  assert.ok(/function clearViewSession\(/.test(ui), "lock must drop the viewing session");
  assert.ok(/function restoreViewSession\(/.test(ui), "boot must try to restore before prompting");

  const reveal = ui.match(/function revealAccount\(phrase(?:, index)?\) \{[\s\S]*?\n  \}/);
  assert.ok(reveal && reveal[0].indexOf("saveViewSession()") !== -1, "unlock/import must save the viewing session");

  const lock = ui.match(/function lockNow\(reason\) \{[\s\S]*?\n  \}/);
  assert.ok(lock && lock[0].indexOf("clearViewSession()") !== -1, "lockNow must clear the viewing session");

  const reset = ui.match(/function resetActivity\(\) \{[\s\S]*?\n  \}/);
  assert.ok(reset && reset[0].indexOf("saveViewSession()") !== -1, "activity must refresh the viewing-session timestamp");

  const bindStart = ui.indexOf("function bind(");
  assert.ok(bindStart !== -1, "bind must exist");
  const bind = ui.slice(bindStart);
  const restoreAt = bind.indexOf("restoreViewSession()");
  const gateAt = bind.indexOf('openGate("unlock")');
  assert.ok(restoreAt !== -1, "boot must restore a viewing session");
  assert.ok(gateAt !== -1, "boot still prompts when there is no viewing session");
  assert.ok(restoreAt < gateAt, "restore must run before the unlock gate, or refresh always re-prompts");

  const save = ui.match(/function saveViewSession\(\) \{[\s\S]*?\n  \}/);
  assert.ok(save, "saveViewSession must exist");
  assert.ok(save[0].indexOf("mnemonic") === -1, "the viewing session must never mention the recovery phrase");
  assert.ok(save[0].indexOf("privateKey") === -1, "the viewing session must never mention a private key");
  assert.ok(save[0].indexOf("session.address") !== -1, "only the public address is needed to re-read balances");
  assert.ok(save[0].indexOf("viewSessionStore") !== -1, "save goes through the store picker");
  assert.ok(save[0].indexOf("mnemonic") === -1 && save[0].indexOf("phrase") === -1, "still no key material");
});

test("address shortening", function () {
  const ui = require("./ui.js");
  assert.strictEqual(ui.shortAddress("0x2222222222222222222222222222222222222222"), "0x2222\u20262222");
  assert.strictEqual(ui.shortAddress(""), "");
});

test("fiat honesty: unknown renders an em dash, never $0.00", function () {
  const ui = require("./ui.js");
  assert.strictEqual(ui.formatFiat(null), "\u2014");
  assert.strictEqual(ui.formatFiat(undefined), "\u2014");
  assert.strictEqual(ui.formatFiat("nonsense"), "\u2014");
  assert.notStrictEqual(ui.formatFiat(0, "usd"), "\u2014");
});

test("amount formatting: unknown renders an em dash, zero renders 0", function () {
  const ui = require("./ui.js");
  assert.strictEqual(ui.formatAmount(null), "\u2014");
  assert.strictEqual(ui.formatAmount(0), "0");
});

/* ── index.html: the shell ──────────────────────────────────────────────── */

test("shell structure: five screens, four nav entries, and drawer settings", function () {
  const html = readFile("index.html");
  assert.ok(html.indexOf('id="main"') !== -1, "missing main region");
  ["home", "swap", "activity", "search", "settings", "accounts"].forEach(function (screen) {
    assert.ok(html.indexOf('data-screen="' + screen + '"') !== -1, "missing screen " + screen);
  });
  ["home", "swap", "activity", "search"].forEach(function (screen) {
    assert.ok(html.indexOf('data-nav="' + screen + '"') !== -1, "missing nav entry " + screen);
  });
  // Settings lives in the account drawer, not the header trio or bottom nav.
  assert.ok(html.indexOf('id="account-drawer-settings"') !== -1, "missing drawer settings");
  assert.ok(html.indexOf('id="gate-settings"') !== -1, "locked gate must still reach settings");
  assert.ok(html.indexOf('id="header-settings"') === -1, "settings gear must leave the header");
});

test("auto-lock settings: fixed options only, never off, longest is 1 hour", function () {
  const html = readFile("index.html");
  const options = Array.from(html.matchAll(/data-autolock="(\d+)"/g)).map((m) => Number(m[1]));
  assert.deepStrictEqual(options, [1, 5, 15, 30, 60], "exactly the five offered options");
  assert.ok(options.every((m) => m >= 1 && m <= 60), "no off option, nothing past an hour");
  assert.ok(html.indexOf('id="autolock-feedback"') !== -1, "auto-lock must show visible save feedback");
  assert.ok(html.indexOf('id="app-version"') !== -1, "settings must show the running client version");
  assert.ok(html.indexOf("cannot be turned off") !== -1, "settings must say auto-lock cannot be disabled");
  assert.ok(html.indexOf("1 hour") !== -1, "settings must state the one-hour cap");
  assert.ok(html.indexOf('data-action="lock"') !== -1, "settings must offer Lock now");
  const ui = readFile("ui.js");
  ["lockNow", "scheduleLock", "resetActivity", "visibilitychange", "readStoredAutolock"].forEach(function (fn) {
    assert.ok(ui.indexOf(fn) !== -1, "ui.js must implement " + fn);
  });
  assert.ok(ui.indexOf("60000") !== -1, "the timer must run in minutes");
});

test("shell loads the committed CSS and boots from ui.js", function () {
  const html = readFile("index.html");
  assert.ok(html.indexOf('href="./app.css"') !== -1, "missing committed CSS");
  assert.ok(html.indexOf('src="./ui.js"') !== -1, "missing ui.js boot");
});

test("extension popup keeps scrolling inside the shell, never on the document", function () {
  const css = readFile("tools/src/app.css");
  assert.ok(
    /html\.extension-popup,\s*html\.extension-popup body\s*\{[^}]*overflow:\s*hidden;/s.test(css),
    "extension html/body must not create an outer scrollbar"
  );
  assert.ok(!/660px/.test(css), "a 660px popup document overflows Chromium's clamp");
  assert.ok(!/100vh/.test(css), "100vh in a toolbar popup is the monitor and creates the outer scrollbar");
  const htmlBoot = readFile("index.html");
  assert.ok(htmlBoot.indexOf('src="./shell.js"') !== -1, "popup class must land before CSS");
  assert.ok(htmlBoot.indexOf("./shell.js") < htmlBoot.indexOf("./app.css"), "shell.js must precede app.css");
  assert.ok(/<html[^>]*class="[^"]*extension-popup/.test(htmlBoot), "popup size must be in the HTML, not after JS");
  assert.ok(htmlBoot.indexOf("tkrWallet 0.10.22") !== -1, "home/settings must show the running build");
  assert.ok(/height:\s*580px/.test(css), "popup document must stay under Chromium's 600 clamp");
  assert.ok(
    /html,\s*body\s*\{[^}]*overflow:\s*hidden;/s.test(css),
    "PWA/tab document must not scroll under #main"
  );
  const html = readFile("index.html");
  assert.ok(/id="main"[^>]*min-h-0/.test(html), "main must be allowed to shrink in the flex shell");
  assert.ok(/id="main"[^>]*overflow-y-auto/.test(html), "main keeps the only page scroller");
  assert.ok(html.indexOf("pb-28") === -1, "fixed-nav spacer is gone; nav is in flow");
  assert.ok(!/class="safe-b fixed inset-x-0 bottom-0/.test(html), "bottom nav must not be position fixed");
  assert.ok(
    /id="wallet-gate"[^>]*overflow-y-auto/.test(html),
    "the gate keeps its intentional inner scroller"
  );
});

test("navigation uses real links, not an invalid tab pattern", function () {
  const html = readFile("index.html");
  assert.ok(html.indexOf('role="tab"') === -1, "role=tab without tabpanels is invalid ARIA");
  assert.ok(html.indexOf('href="#/home"') !== -1, "missing home link");
  assert.ok(html.indexOf('id="wallet-status"') !== -1, "missing second live region for balance updates");
  // The active state must actually match: aria-current is set to "page", so the
  // selector has to be aria-[current=page]:, not aria-current: (which only
  // matches aria-current="true" — a bug the vision review caught).
  assert.ok(html.indexOf("aria-[current=page]:text-ember-400") !== -1, "active tab styling never matches");
});

test("header chrome is Terminal, Search, Dock with Heroicons", function () {
  const html = readFile("index.html");
  ["header-terminal", "header-search", "header-dock"].forEach(function (id) {
    assert.ok(html.indexOf('id="' + id + '"') !== -1, "missing #" + id);
  });
  assert.ok(html.indexOf("m6.75 7.5 3 2.25-3 2.25") !== -1, "Terminal must use Heroicons CommandLine");
  assert.ok(html.indexOf("m21 21-5.197-5.197") !== -1, "Search must use Heroicons MagnifyingGlass");
  assert.ok(html.indexOf("M15.75 3.75v16.5") !== -1, "Dock must use the right-rail mark");
  assert.ok(html.indexOf('id="wallet-terminal"') !== -1, "missing CLI overlay");
  assert.ok(html.indexOf('id="terminal-input"') !== -1, "missing CLI input");
});

test("extension docks through the Side Panel API", function () {
  const manifest = JSON.parse(readFile("manifest.json"));
  assert.deepStrictEqual(manifest.permissions, ["sidePanel"]);
  assert.strictEqual(manifest.side_panel && manifest.side_panel.default_path, "index.html?mode=panel");
  const ui = require("./ui.js");
  assert.strictEqual(ui.parseShellMode("?mode=panel", "chrome-extension:"), "panel");
  assert.strictEqual(ui.parseShellMode("", "chrome-extension:"), "popup");
  assert.strictEqual(ui.parseShellMode("", "https:"), "page");
  const src = readFile("ui.js");
  assert.ok(src.indexOf("sidePanel.open") !== -1, "dock must call chrome.sidePanel.open");
  assert.ok(src.indexOf("applyShellClass") !== -1, "boot must distinguish popup from panel");
});

test("wallet CLI routes commands and refuses secrets", function () {
  const ui = require("./ui.js");
  const help = ui.runCliCommand("help");
  assert.ok(help.lines.some(function (line) { return /status/.test(line); }));
  assert.ok(help.lines.some(function (line) { return /Secrets are never printed/.test(line); }));
  assert.strictEqual(help.refuse, false);
  const q = ui.runCliCommand("?");
  assert.deepStrictEqual(q.lines, help.lines);
  assert.deepStrictEqual(ui.runCliCommand("").lines, []);
  const locked = ui.runCliCommand("status", { unlocked: false, address: "" });
  assert.deepStrictEqual(locked.lines, ["locked.", "no account."]);
  const open = ui.runCliCommand("status", {
    unlocked: true,
    address: "0x2222222222222222222222222222222222222222",
  });
  assert.strictEqual(open.lines[0], "unlocked.");
  assert.ok(open.lines[1].indexOf("0x2222") === 0);
  assert.ok(open.lines.join(" ").indexOf("22222222222222222222222222222222") === -1);
  ["home", "settings", "accounts", "swap", "activity"].forEach(function (screen) {
    const go = ui.runCliCommand(screen);
    assert.deepStrictEqual(go.action, { type: "go", screen: screen });
    assert.strictEqual(go.lines[0], "opening " + screen + ".");
  });
  assert.deepStrictEqual(ui.runCliCommand("search usdc").action, { type: "search", query: "usdc" });
  assert.strictEqual(ui.runCliCommand("search").action.query, "");
  assert.deepStrictEqual(ui.runCliCommand("lock").action, { type: "lock" });
  assert.deepStrictEqual(ui.runCliCommand("dock").action, { type: "dock" });
  assert.deepStrictEqual(ui.runCliCommand("clear").action, { type: "clear" });
  assert.deepStrictEqual(ui.runCliCommand("close").action, { type: "close" });
  assert.deepStrictEqual(ui.runCliCommand("exit").action, { type: "close" });
  ["seed", "mnemonic", "phrase", "secret", "private", "privkey", "password", "passwd", "export", "backup"].forEach(function (cmd) {
    const refused = ui.runCliCommand(cmd);
    assert.strictEqual(refused.refuse, true, cmd + " must be refused");
    assert.ok(!/0x/.test(refused.lines.join(" ")));
    assert.ok(/never prints keys/.test(refused.lines.join(" ")));
  });
  assert.strictEqual(ui.runCliCommand("nonsense").lines[0], "unknown command. type help.");
});

test("Prime Directive lives in AGENTS.md", function () {
  const agents = readFile("AGENTS.md");
  assert.ok(/Prime Directive/.test(agents));
  assert.ok(/strictly prohibited to write and\/or commit directly to `main`/.test(agents));
  assert.ok(/git worktree add -b/.test(agents));
  assert.ok(/gh pr create --base main/.test(agents));
  assert.ok(/Do not `git commit` while `git branch --show-current` is `main`/.test(agents));
});

test("safe-area padding uses classes, never inline styles", function () {
  // Our own CSP (style-src 'self') blocks style="" attributes — a real bug the
  // console caught. The paddings must live in app.css classes.
  const html = readFile("index.html");
  assert.ok(html.indexOf('class="safe-t') !== -1, "header must use .safe-t");
  assert.ok(html.indexOf('class="safe-b') !== -1, "nav must use .safe-b");
  assert.ok(!/style="[^"]*safe-area/.test(html), "no inline safe-area styles");
  const css = readFile("app.css");
  assert.ok(css.indexOf(".safe-t") !== -1 && css.indexOf(".safe-b") !== -1, "classes must exist in app.css");
});

test("no developer instructions leak into the user-facing shell", function () {
  const html = readFile("index.html");
  assert.ok(html.indexOf("?preview=1") === -1, "preview instructions belong in README, not the UI");
});

test("brand ramp is warm — no Phantom violet in the token palette", function () {
  const wallet = require("./wallet.js");
  assert.ok(wallet.TOKEN_COLORS.SOL !== "#8a5cf6", "SOL badge must stay on the warm ramp");
});

test("iOS safe areas and dark theme", function () {
  const html = readFile("index.html");
  assert.ok(html.indexOf("viewport-fit=cover") !== -1, "viewport-fit=cover required");
  assert.ok(html.indexOf('content="#12100e"') !== -1, "theme-color must match the dark base");
});

test("no inline <script>: MV3 blocks it and cannot be relaxed", function () {
  const html = readFile("index.html");
  const inline = /<script(?![^>]*\bsrc=)[^>]*>/i;
  assert.ok(!inline.test(html), "found an inline script tag");
});

test("CSP meta tag is present and forbids foreign origins", function () {
  const html = readFile("index.html");
  assert.ok(html.indexOf("Content-Security-Policy") !== -1, "missing CSP meta tag");
  assert.ok(html.indexOf("connect-src 'self' " + ALLOWED_ORIGIN) !== -1, "meta CSP must allow the wallet origin; 'self' alone is chrome-extension:// and blocks the edge");
});

test("Beaver Nickels stay removed from the shell", function () {
  assert.ok(readFile("index.html").toLowerCase().indexOf("beaver") === -1);
});

/* ── ui.js source invariants ────────────────────────────────────────────── */

test("ui.js has no markup-string sinks", function () {
  const src = readFile("ui.js");
  [".innerHTML", ".outerHTML", ".insertAdjacentHTML", "document.write", "eval("].forEach(function (sink) {
    assert.ok(src.indexOf(sink) === -1, "ui.js must not use " + sink);
  });
});

test("ui.js makes no network calls — the shell never fetches", function () {
  const src = readFile("ui.js");
  ["fetch(", "XMLHttpRequest", "WebSocket(", "EventSource", "sendBeacon"].forEach(function (call) {
    assert.ok(src.indexOf(call) === -1, "ui.js must not use " + call);
  });
});

/* ── Single-origin invariant (the audit's headline check) ───────────────── */

test("shipped files reference only the wallet origin", function () {
  const re = /https?:\/\/[a-zA-Z0-9._-]+/g;
  // Loopback dev URLs are not foreign origins: the invariant is "no other
  // public host", not "no localhost". README documents the dev server.
  const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/;
  SHIPPED.forEach(function (file) {
    const src = readFile(file);
    let m;
    while ((m = re.exec(src)) !== null) {
      if (LOCAL.test(m[0])) {
        continue;
      }
      assert.strictEqual(m[0], ALLOWED_ORIGIN, file + " references a foreign origin: " + m[0]);
    }
  });
});

test("shipped client files contain no lab IPs, internal hostnames, or extra origins", function () {
  const urlRe = /https?:\/\/[a-zA-Z0-9._-]+/g;
  CLIENT_SHIPPED.forEach(function (file) {
    const src = readFile(file);
    assert.ok(src.length > 0, file + " must exist and be readable");
    const ip = src.match(RFC1918);
    assert.strictEqual(ip, null, file + " contains a private IPv4: " + (ip && ip[0]));
    const local = src.match(DOT_LOCAL);
    assert.strictEqual(local, null, file + " contains a .local hostname: " + (local && local[0]));
    const internal = src.match(INTERNAL_HOST);
    assert.strictEqual(internal, null, file + " names an internal host: " + (internal && internal[0]));
    let m;
    urlRe.lastIndex = 0;
    while ((m = urlRe.exec(src)) !== null) {
      assert.strictEqual(m[0], ALLOWED_ORIGIN, file + " references a foreign origin: " + m[0]);
    }
  });
  assert.ok(readFile("wallet.js").indexOf("/api/wallet/balances") !== -1);
  assert.ok(readFile("wallet.js").indexOf("/api/wallet/prices") !== -1);
  assert.ok(readFile("wallet.js").indexOf("/api/wallet/token") !== -1);
});

/* ── manifest.json: the extension ───────────────────────────────────────── */

test("host_permissions is exactly the wallet origin", function () {
  const manifest = JSON.parse(readFile("manifest.json"));
  assert.deepStrictEqual(manifest.host_permissions, [ALLOWED_ORIGIN + "/*"]);
  assert.deepStrictEqual(manifest.optional_host_permissions, [ALLOWED_ORIGIN + "/*"]);
});

test("extension CSP is tightened, not relaxed", function () {
  const manifest = JSON.parse(readFile("manifest.json"));
  const csp = manifest.content_security_policy && manifest.content_security_policy.extension_pages;
  assert.ok(csp, "missing content_security_policy.extension_pages");
  assert.ok(csp.indexOf("script-src 'self'") !== -1, "script-src must stay 'self'");
  assert.ok(csp.indexOf("'unsafe-eval'") === -1, "MV3 forbids unsafe-eval");
  assert.ok(csp.indexOf(ALLOWED_ORIGIN) !== -1, "the wallet origin must be allow-listed for connect-src");
});

test("extension description names Scratchpost, not the v1 funnel", function () {
  const manifest = JSON.parse(readFile("manifest.json"));
  assert.ok(manifest.description.toLowerCase().indexOf("beaver") === -1);
  assert.ok(manifest.description.toLowerCase().indexOf("tkrshell") === -1);
});

test("extension ships PNG icons and a pinned key", function () {
  const manifest = JSON.parse(readFile("manifest.json"));
  ["16", "32", "48", "128"].forEach(function (size) {
    const p = manifest.icons[size];
    assert.ok(p && p.indexOf(".svg") === -1, "icons." + size + " must be PNG (Chrome rejects SVG)");
    assert.ok(fs.existsSync(path.join(ROOT, p)), "missing icon file " + p);
  });
  assert.ok(manifest.action.default_icon, "missing action.default_icon");
  assert.ok(/^[A-Za-z0-9+/=]{300,}$/.test(manifest.key || ""), "missing or malformed key");
});

test("the CRX private key is ignored and never tracked", function () {
  const cp = require("child_process");
  assert.ok(readFile(".gitignore").indexOf("key.pem") !== -1, "key.pem must be gitignored");
  const tracked = cp.execSync("git ls-files key.pem", { cwd: ROOT }).toString().trim();
  assert.strictEqual(tracked, "", "key.pem must never be committed");
});

test("kiff pack stays in HOME and never uses Flatpak as the packer", function () {
  const sh = readFile("scripts/pack-crx.sh");
  assert.ok(sh.indexOf("tkrWallet-unpacked") !== -1, "Flatpak path must stage $HOME/tkrWallet-unpacked");
  assert.ok(sh.indexOf("HOME_CRX") !== -1, "a CRX must land in $HOME");
  assert.ok(sh.indexOf("REPO_CRX") === -1, "do not write a CRX into /opt/repo");
  assert.ok(sh.indexOf("flatpak run") === -1, "Flatpak --pack-extension dies in the document portal");
  const staged = readFile("scripts/stage-unpacked.sh");
  assert.ok(staged.indexOf("${HOME}/tkrWallet-unpacked") !== -1);
});

/* ── manifest.webmanifest: the PWA ──────────────────────────────────────── */

test("PWA manifest colours match the dark theme", function () {
  const wm = JSON.parse(readFile("manifest.webmanifest"));
  assert.strictEqual(wm.background_color, "#12100e");
  assert.strictEqual(wm.theme_color, "#12100e");
});

test("PWA description is clean", function () {
  const wm = JSON.parse(readFile("manifest.webmanifest"));
  assert.ok(wm.description.toLowerCase().indexOf("beaver") === -1);
  assert.ok(wm.description.toLowerCase().indexOf("tkrswap") === -1);
});

/* ── sw.js ──────────────────────────────────────────────────────────────── */

test("service worker precaches the shell and not the deleted v1", function () {
  const sw = readFile("sw.js");
  assert.ok(sw.indexOf('"./app.js"') === -1, "sw.js still precaches app.js");
  assert.ok(sw.indexOf("./ui.js") !== -1, "sw.js must precache the shell");
  assert.ok(sw.indexOf("./app.css") !== -1, "sw.js must precache the styles");
});

test("service worker has a correct lifecycle", function () {
  const sw = readFile("sw.js");
  assert.ok(sw.indexOf("skipWaiting") !== -1, "missing skipWaiting");
  assert.ok(sw.indexOf("clients.claim") !== -1, "missing clients.claim");
  assert.ok(sw.indexOf('"activate"') !== -1, "missing activate handler");
  assert.ok(/caches\.delete\(/.test(sw), "activate must delete stale caches");
});

test("service worker refuses cross-origin and non-GET requests", function () {
  const sw = readFile("sw.js");
  assert.ok(sw.indexOf("event.request.method !== \"GET\"") !== -1, "missing method guard");
  assert.ok(sw.indexOf("url.origin !== self.location.origin") !== -1, "missing origin guard");
});

test("service worker is network-first for the shell", function () {
  const sw = readFile("sw.js");
  assert.ok(sw.indexOf("fetch(event.request") !== -1, "missing network fetch");
  assert.ok(sw.indexOf("caches.match(event.request)") !== -1, "missing cache fallback");
});

test("service worker never caches API responses", function () {
  const sw = readFile("sw.js");
  // Balances/prices must never come out of a cache — a stale balance is a lie.
  assert.ok(sw.indexOf('url.pathname.indexOf("/api/") === 0') !== -1, "missing /api/ bypass");
  assert.ok(sw.indexOf('"tkrwallet-v19"') !== -1, "cache version must bump so the new worker activates");
  assert.ok(sw.indexOf("./shell.js") !== -1, "sw must precache shell.js");
});

test("service worker bypasses the HTTP cache and sweeps legacy caches", function () {
  const sw = readFile("sw.js");
  assert.ok(sw.indexOf('cache: "no-store"') !== -1, "must bypass the HTTP cache");
  // Full sweep on activate (no `filter(k !== CACHE)`): purges cache-first
  // leftovers from older workers in one activation.
  assert.ok(sw.indexOf("keys.map((k) => caches.delete(k))") !== -1, "activate must delete every cache");
});

test("shell loads the data layer before the shell controller", function () {
  const html = readFile("index.html");
  const w = html.indexOf('src="./wallet.js"');
  const u = html.indexOf('src="./ui.js"');
  assert.ok(w !== -1, "missing wallet.js script tag");
  assert.ok(u !== -1 && w < u, "wallet.js must load before ui.js");
});

test("service worker precaches the data layer", function () {
  assert.ok(readFile("sw.js").indexOf('"./wallet.js"') !== -1, "sw.js must precache wallet.js");
});

test("shell controller talks to the data layer, and still never fetches", function () {
  const src = readFile("ui.js");
  assert.ok(src.indexOf("tkrWalletData") !== -1, "ui.js must route through the data layer");
});

test("the injected-provider connect path is gone — self-custody only", function () {
  // Import (recovery phrase) + unlock (password) are the only entry points.
  // No MetaMask/Uniswap/Brave connect, no window.ethereum, no EIP-1193.
  const ui = readFile("ui.js");
  const wallet = readFile("wallet.js");
  ["connectWallet", "isExtension", "window.ethereum", "provider"].forEach(function (s) {
    assert.ok(ui.indexOf(s) === -1, "ui.js must not reference " + s);
  });
  ["connect", "listHoldings", "findProvider", "hexToAmount", "padAddress", "BALANCE_SELECTOR", "eth_requestAccounts", "eth_getBalance"].forEach(function (s) {
    assert.ok(wallet.indexOf(s) === -1, "wallet.js must not reference " + s);
  });
  const html = readFile("index.html");
  assert.ok(html.indexOf("Connect a wallet") === -1, "index.html must not ask to connect a wallet");
  assert.ok(html.indexOf("Not connected") === -1, "index.html must not show 'Not connected'");
});

/* ── wallet.js: the data layer ──────────────────────────────────────────── */

test("wallet.js declares the single origin and a chain catalogue", function () {
  const wallet = require("./wallet.js");
  assert.strictEqual(wallet.BASE_URL, ALLOWED_ORIGIN);
  // Integer-like object keys enumerate in numeric order regardless of insertion.
  assert.deepStrictEqual(
    Object.keys(wallet.CHAINS).sort((a, b) => a - b),
    ["1", "4663", "8453", "900001", "728126428"]
  );
});

test("getPrices() surfaces the edge contract and never invents a price", function () {
  const wallet = require("./wallet.js");
  return wallet
    .getPrices(["1:native", "1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"], ["usd", "cad"], function (url) {
      assert.ok(String(url).indexOf("/api/wallet/prices?assets=") === 0, url);
      assert.ok(String(url).indexOf("fx=boc") !== -1, "default FX is Bank of Canada cache");
      assert.ok(String(url).indexOf("1%3Anative") !== -1, "assets must be encoded");
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve({
            as_of: 1737000000,
            prices: { "1:native": { usd: 3120.55, cad: 4291.2 } }, // USDC omitted = unpriced
          });
        },
      });
    })
    .then(function (got) {
      assert.strictEqual(got.state, "ok");
      assert.ok(!got.prices["1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"], "absent asset stays absent");
    });
});

test("getPrices() failure is unknown, not empty prices", function () {
  const wallet = require("./wallet.js");
  return wallet.getPrices(["1:native"], ["usd"], function () {
    return Promise.reject(new Error("edge down"));
  }).then(function (got) {
    assert.strictEqual(got.state, "unknown");
  });
});

test("getBalances() surfaces the edge contract and converts amounts", function () {
  const wallet = require("./wallet.js");
  return wallet
    .getBalances("0x2222222222222222222222222222222222222222", [1, 8453], function (url) {
      assert.ok(String(url).indexOf("/api/wallet/balances?address=") === 0, url);
      assert.ok(String(url).indexOf("chains=1%2C8453") !== -1, "chains must be encoded");
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve({
            as_of: 1737000000,
            balances: [
              { chain_id: 1, symbol: "ETH", address: null, amount: "1.25", decimals: 18 },
              { chain_id: 8453, symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "42.5", decimals: 6 },
            ],
            chains: [
              { chain_id: 1, state: "ok" },
              { chain_id: 8453, state: "ok" },
            ],
          });
        },
      });
    })
    .then(function (got) {
      assert.strictEqual(got.state, "ok");
      assert.ok(Array.isArray(got.chains) && got.chains.length === 2, "the read report is surfaced");
      assert.strictEqual(got.balances.length, 2);
      assert.ok(Math.abs(got.balances[0].amount - 1.25) < 1e-9, "native amount converted to a number");
      assert.strictEqual(got.balances[0].chain_name, "Ethereum");
      assert.strictEqual(got.balances[0].address, null);
      assert.ok(Math.abs(got.balances[1].amount - 42.5) < 1e-9, "USDC amount converted to a number");
    });
});

test("getBalances() failure is unknown — balances are never invented", function () {
  const wallet = require("./wallet.js");
  return wallet.getBalances("0x2222222222222222222222222222222222222222", [1], function () {
    return Promise.reject(new Error("edge down"));
  }).then(function (got) {
    assert.strictEqual(got.state, "unknown");
    assert.strictEqual(got.reason, "edge-unreachable");
  });
});

test("getBalances() does not send cookies — public reads must not require CORS credentials", function () {
  const src = readFile("wallet.js");
  const fn = src.match(/function getBalances\([\s\S]*?\n  \}/);
  assert.ok(fn, "getBalances must exist");
  assert.ok(fn[0].indexOf('credentials: "include"') === -1, "credentialed GET balances dies when the CRX id is not pinned");
});

test("getBalances() keeps a 502 body that still reports chains", function () {
  const wallet = require("./wallet.js");
  return wallet
    .getBalances("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", [900001], function () {
      return Promise.resolve({
        ok: false,
        status: 502,
        json: function () {
          return Promise.resolve({
            balances: [],
            chains: [{ chain_id: 900001, state: "unknown", error: "vendor_native_unavailable" }],
          });
        },
      });
    })
    .then(function (got) {
      assert.strictEqual(got.state, "unknown");
      assert.strictEqual(got.chains[0].chain_id, 900001);
      assert.strictEqual(got.reason, "all-chains-failed");
    });
});

test("mergeBalanceReads names Solana when the SOL HTTP call has no chains[]", function () {
  global.tkrWalletData = require("./wallet.js");
  const ui = require("./ui.js");
  const merged = ui.mergeBalanceReads(
    {
      state: "ok",
      balances: [{ symbol: "ETH", chain_id: 1, amount: 0.01 }],
      chains: [
        { chain_id: 1, state: "ok" },
        { chain_id: 8453, state: "ok" },
      ],
    },
    { state: "unknown", reason: "edge-http", detail: "HTTP 400" }
  );
  assert.strictEqual(merged.state, "partial");
  assert.ok(
    merged.chains.some(function (c) {
      return c.chain_id === 900001 && c.state === "unknown";
    }),
    "Solana must appear in the read report"
  );
  assert.match(ui.chainProblems(merged), /Solana could not be read/);
});

test("getBalances() HTTP errors are edge-http, not unreachable", function () {
  const wallet = require("./wallet.js");
  return wallet
    .getBalances("0x2222222222222222222222222222222222222222", [1], function () {
      return Promise.resolve({
        ok: false,
        status: 502,
        json: function () {
          return Promise.resolve({ error: "upstream" });
        },
      });
    })
    .then(function (got) {
      assert.strictEqual(got.state, "unknown");
      assert.strictEqual(got.reason, "edge-http");
    });
});

test("getBalances() never calls an unreadable chain an empty wallet", function () {
  const wallet = require("./wallet.js");
  // The edge read one chain and could not read the other. The holdings list is
  // empty, but "you own nothing" would be a lie: it must be partial.
  return wallet
    .getBalances("0x2222222222222222222222222222222222222222", [1, 8453], function () {
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve({
            balances: [],
            chains: [
              { chain_id: 1, state: "ok" },
              { chain_id: 8453, state: "unknown", error: "rpc timeout" },
            ],
          });
        },
      });
    })
    .then(function (got) {
      assert.strictEqual(got.state, "partial", "an unread chain must not read as 'you own nothing'");
      assert.strictEqual(got.balances.length, 0);
      assert.strictEqual(got.chains[1].state, "unknown");
      assert.ok(got.reason);
    });
});

test("getBalances() treats a missing read report as partial, never as empty", function () {
  const wallet = require("./wallet.js");
  // Against an edge that does not report which chains it read, an empty list is
  // unverifiable. Honest answer: partial, with the reason stated.
  return wallet
    .getBalances("0x2222222222222222222222222222222222222222", [1], function () {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ balances: [] }); } });
    })
    .then(function (got) {
      assert.strictEqual(got.state, "partial");
      assert.strictEqual(got.reason, "edge-no-read-status");
    });
});

test("getBalances() sends user-added tokens as chain:address pairs", function () {
  const wallet = require("./wallet.js");
  const extra = "1:0x" + "Ab".repeat(20);
  return wallet
    .getBalances("0x2222222222222222222222222222222222222222", [1], function (url) {
      assert.ok(String(url).indexOf("tokens=") !== -1, "added tokens must be requested: " + url);
      assert.ok(String(url).indexOf(encodeURIComponent(extra)) !== -1, "the pair must be encoded");
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve({ balances: [], chains: [{ chain_id: 1, state: "ok" }] });
        },
      });
    }, [extra])
    .then(function (got) {
      assert.strictEqual(got.state, "ok", "with every chain read, empty really is empty");
    });
});

test("getTokenMeta() returns edge metadata, or a reason — never invented values", function () {
  const wallet = require("./wallet.js");
  return wallet
    .getTokenMeta(8453, "0x" + "Ab".repeat(20), function (url) {
      assert.ok(String(url).indexOf("/api/wallet/token?chain=8453&address=") === 0, url);
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve({
            token: { chain_id: 8453, address: "0x" + "Ab".repeat(20), symbol: "USDC", name: "USD Coin", decimals: 6 },
          });
        },
      });
    })
    .then(function (got) {
      assert.strictEqual(got.state, "ok");
      assert.strictEqual(got.token.symbol, "USDC");
      assert.strictEqual(got.token.decimals, 6);
      return wallet.getTokenMeta(8453, "0x" + "Ab".repeat(20), function () {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: function () {
            return Promise.resolve({ ok: false, error: "not-a-token" });
          },
        });
      });
    })
    .then(function (got) {
      assert.strictEqual(got.state, "unknown");
      assert.strictEqual(got.reason, "not-a-token");
    });
});

test("API calls are same-origin for the PWA and absolute for the extension", function () {
  const wallet = require("./wallet.js");
  return wallet
    .getPrices(["1:native"], ["usd"], function (url) {
      // The PWA is served FROM the edge, so paths are relative: same origin,
      // no CORS, and the CSP holds in local dev on the dev-edge too.
      assert.ok(String(url).indexOf("/api/wallet/prices?") === 0, "PWA must call its own origin: " + url);
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ prices: {} }); } });
    })
    .then(function () {
      const prev = global.location;
      global.location = { protocol: "chrome-extension:" };
      return wallet
        .getPrices(["1:native"], ["usd"], function (url) {
          // Extension pages have origin chrome-extension://, so they call the
          // edge origin explicitly (the extension CSP allow-lists exactly it).
          assert.ok(String(url).indexOf(ALLOWED_ORIGIN + "/api/wallet/prices?") === 0, "extension must call the edge origin: " + url);
          return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ prices: {} }); } });
        })
        .then(
          function (res) {
            if (prev === undefined) { delete global.location; } else { global.location = prev; }
            return res;
          },
          function (err) {
            if (prev === undefined) { delete global.location; } else { global.location = prev; }
            throw err;
          }
        );
    });
});

test("estimateValue() reports ok/partial/unknown honestly", function () {
  const wallet = require("./wallet.js");
  const holdings = [
    { symbol: "ETH", address: null, chain_id: 1, amount: 1, state: "ok" },
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", chain_id: 1, amount: 2, state: "ok" },
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", chain_id: 1, amount: 5, state: "unknown" },
  ];
  const prices = {
    state: "ok",
    prices: {
      "1:native": { usd: 1000, cad: 1375 },
      "1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": { usd: 1, cad: 1.375 },
    },
  };
  const full = wallet.estimateValue(holdings, prices, "usd");
  assert.strictEqual(full.state, "ok");
  assert.ok(Math.abs(full.value - 1002) < 1e-9, "1 ETH @1000 + 2 USDC @1");
  assert.strictEqual(full.priced, 2);
  assert.strictEqual(full.total, 2, "unknown balances are excluded, not counted");
  const noPrices = wallet.estimateValue(holdings, null, "usd");
  assert.strictEqual(noPrices.state, "unknown");
  const noCad = wallet.estimateValue(holdings, prices, "cad");
  assert.strictEqual(noCad.state, "ok", "cad values exist in the fixture");
});

test("splitHoldings keeps desk tokens on home and hides unpriced airdrops", function () {
  const wallet = require("./wallet.js");
  const spam = {
    symbol: "AIR",
    address: "0x1111111111111111111111111111111111111111",
    chain_id: 1,
    amount: 99,
    state: "ok",
  };
  const rhSpam = {
    symbol: "RHJUNK",
    address: "0x2222222222222222222222222222222222222222",
    chain_id: 4663,
    amount: 1,
    state: "ok",
  };
  const usdc = {
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    chain_id: 1,
    amount: 2,
    state: "ok",
  };
  const eth = { symbol: "ETH", address: null, chain_id: 1, amount: 1, state: "ok" };
  const sol = { symbol: "SOL", address: null, chain_id: 900001, amount: 1, state: "ok" };
  const prices = {
    state: "ok",
    prices: {
      "1:native": { usd: 1000 },
    },
  };
  const ready = wallet.splitHoldings([eth, usdc, spam, rhSpam, sol], prices, [], "usd");
  assert.deepStrictEqual(
    ready.desk.map((h) => h.symbol),
    ["ETH", "USDC", "SOL"],
    "native, catalogue, and SOL stay on the home list"
  );
  assert.deepStrictEqual(
    ready.airdrops.map((h) => h.symbol),
    ["AIR", "RHJUNK"],
    "unpriced discovered contracts, including Robinhood, wait behind Airdrops"
  );
  const loading = wallet.splitHoldings([eth, spam], null, [], "usd");
  assert.strictEqual(loading.airdrops.length, 0, "nothing is hidden until prices return");
  assert.strictEqual(loading.desk.length, 2);
  const priced = wallet.splitHoldings(
    [spam],
    { state: "ok", prices: { "1:0x1111111111111111111111111111111111111111": { usd: 0.01 } } },
    [],
    "usd"
  );
  assert.strictEqual(priced.desk.length, 1, "a priced discovered token stays on the desk");
  assert.strictEqual(priced.airdrops.length, 0);
  const pinned = wallet.splitHoldings(
    [spam],
    prices,
    [{ chain_id: 1, address: "0x1111111111111111111111111111111111111111" }],
    "usd"
  );
  assert.strictEqual(pinned.desk.length, 1, "add-by-address pins an airdrop to the home list");
  assert.strictEqual(pinned.airdrops.length, 0);
});

test("mineHoldings drops zeros; tokenListRows fills Mainnet/Base zeros only when the chain read is ok", function () {
  const wallet = require("./wallet.js");
  const ethRh = { symbol: "ETH", address: null, chain_id: 4663, amount: 0.071, state: "ok" };
  const usdc = {
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    chain_id: 1,
    amount: 2,
    state: "ok",
  };
  const zeroNative = { symbol: "ETH", address: null, chain_id: 1, amount: 0, state: "ok" };
  const mine = wallet.mineHoldings([ethRh, usdc, zeroNative]);
  assert.deepStrictEqual(
    mine.map((h) => h.symbol + "@" + h.chain_id),
    ["ETH@4663", "USDC@1"],
    "Mine is held amounts only"
  );
  const okChains = [
    { chain_id: 1, state: "ok" },
    { chain_id: 8453, state: "ok" },
  ];
  const tokens = wallet.tokenListRows([ethRh, usdc], okChains, []);
  assert.ok(tokens.length > 10, "Tokens lists the Mainnet + Base catalogue");
  assert.strictEqual(tokens[0].amount, 0, "verified zeros sort first");
  assert.ok(
    tokens.every((h) => h.chain_id === 1 || h.chain_id === 8453),
    "Tokens is Mainnet and Base only"
  );
  assert.ok(
    tokens.some((h) => h.symbol === "USDC" && h.chain_id === 1 && h.amount === 2),
    "held Mainnet USDC stays on Tokens after the zeros"
  );
  assert.ok(
    !tokens.some((h) => h.chain_id === 4663),
    "Robinhood holdings do not belong on the Tokens list"
  );
  const unknown = wallet.tokenListRows([], [{ chain_id: 1, state: "unknown" }, { chain_id: 8453, state: "ok" }], []);
  const mainnet = unknown.filter((h) => h.chain_id === 1);
  assert.ok(mainnet.length, "Mainnet catalogue still lists when unread");
  assert.ok(
    mainnet.every((h) => h.amount === null && h.state === "unknown"),
    "unread Mainnet must not be painted as zero"
  );
  const baseZero = unknown.filter((h) => h.chain_id === 8453 && h.amount === 0);
  assert.ok(baseZero.length, "ok Base rows may be filled as zero");
});

test("preview mode ships the mockup numbers and is opt-in only", function () {
  const wallet = require("./wallet.js");
  assert.strictEqual(wallet.PREVIEW_HOLDINGS.length, 4);
  const symbols = wallet.PREVIEW_HOLDINGS.map((h) => h.symbol + "@" + h.chain_id);
  assert.deepStrictEqual(symbols, ["SOL@900001", "ETH@1", "ETH@8453", "ETH@4663"]);
  assert.strictEqual(wallet.PREVIEW_HOLDINGS[0].amount, 0.12345);
  assert.strictEqual(wallet.PREVIEW_HOLDINGS[3].amount, 0.45678);
  assert.strictEqual(wallet.PREVIEW_PRICES.state, "ok");
  const ui = readFile("ui.js");
  assert.ok(ui.indexOf("maybePreview") !== -1, "ui.js must gate preview mode");
  assert.ok(ui.indexOf("preview=1") !== -1, "preview must require the query flag");
});

test("searchCatalog filters by symbol, name and address, offline", function () {
  const wallet = require("./wallet.js");
  assert.deepStrictEqual(wallet.searchCatalog(""), [], "an empty query returns nothing");
  const usdc = wallet.searchCatalog("usdc");
  assert.ok(usdc.length >= 2, "USDC exists on more than one chain");
  assert.ok(
    usdc.every((t) => t.symbol.toLowerCase().indexOf("usdc") !== -1 || t.name.toLowerCase().indexOf("usdc") !== -1),
    "only USDC-family tokens match"
  );
  const byAddr = wallet.searchCatalog("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.strictEqual(byAddr.length, 1, "address search finds exactly one token");
  assert.strictEqual(byAddr[0].chain_id, 8453, "and it is the Base entry");
  assert.strictEqual(byAddr[0].chain_name, "Base");
  assert.deepStrictEqual(wallet.searchCatalog("no-such-token"), []);
  assert.ok(wallet.searchCatalog("eth").length >= 1);
  // Names, not just symbols: a user typing what the asset is called must hit.
  assert.ok(wallet.searchCatalog("tether").every((t) => t.symbol === "USDT"), "tether finds USDT");
  assert.ok(wallet.searchCatalog("bitcoin").some((t) => t.symbol === "WBTC"), "bitcoin finds WBTC");
  assert.ok(wallet.searchCatalog("bitcoin").some((t) => t.symbol === "cbBTC"), "bitcoin finds cbBTC");
  assert.ok(wallet.searchCatalog("chainlink").every((t) => t.symbol === "LINK"), "chainlink finds LINK");
  assert.ok(wallet.searchCatalog("aave").some((t) => t.symbol === "AAVE"), "aave finds AAVE");
});

test("searchCatalog is Mainnet + Base only — never Robinhood or Solana", function () {
  const wallet = require("./wallet.js");
  ["eth", "usdc", "usdt", "weth"].forEach(function (q) {
    wallet.searchCatalog(q).forEach(function (r) {
      assert.ok(r.chain_id === 1 || r.chain_id === 8453, q + " must only return Mainnet/Base, got " + r.chain_id);
    });
  });
  // Robinhood is in the holdings catalogue but must not be searchable.
  assert.ok(wallet.TOKENS[4663], "Robinhood stays in the holdings catalogue");
  assert.ok(
    wallet.TOKENS[4663].some((t) => t.symbol === "USDG" && t.decimals === 6 && t.address),
    "catalogue USDG is Global Dollar, 6 decimals",
  );
  assert.ok(
    wallet.TOKENS[4663].some((t) => t.symbol === "WETH" && t.decimals === 18),
    "catalogue WETH is the Robinhood wrap",
  );
  assert.ok(!wallet.searchCatalog("eth").some((r) => r.chain_id === 4663), "Robinhood must not appear in search");
  assert.ok(!wallet.searchCatalog("usdg").length, "USDG is holdings/swap only, not search");
});

test("search is wired to the input and documented as catalogue-scoped", function () {
  const ui = readFile("ui.js");
  assert.ok(ui.indexOf("searchResults") !== -1, "ui.js must implement search");
  assert.ok(ui.indexOf('el("search-input")') !== -1, "search input must be bound");
  const html = readFile("index.html");
  assert.ok(html.indexOf('id="tpl-search-row"') !== -1, "missing search row template");
  assert.ok(html.indexOf("Type to search the token catalog") === -1, "the placeholder lie must be gone");
});

/* ── crypto.js: wallet import / vault (audited primitives) ──────────────── */

test("crypto: BIP-39/44 vector derives the canonical EVM address", function () {
  const c = require("./crypto.js");
  const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const w = c.importMnemonic(phrase);
  assert.strictEqual(w.evmAddress, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  assert.strictEqual(w.solAddress.length, 44, "Solana address is base58");
  assert.ok(/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(w.tronAddress), "TRON address is base58check");
});

test("crypto: invalid mnemonic is rejected before any key material is derived", function () {
  const c = require("./crypto.js");
  assert.throws(function () { c.importMnemonic("foo bar baz"); }, /invalid-mnemonic/);
  assert.throws(function () { c.importMnemonic(""); }, /invalid-mnemonic/);
});

test("crypto: generateWallet returns a valid 12-word wallet, idempotent", function () {
  const c = require("./crypto.js");
  const w = c.generateWallet();
  assert.strictEqual(w.mnemonic.split(" ").length, 12);
  assert.ok(/^0x[0-9a-fA-F]{40}$/.test(w.evmAddress));
  assert.strictEqual(c.importMnemonic(w.mnemonic).evmAddress, w.evmAddress);
});

test("crypto: HD address index i derives m/44'/60'/0'/0/{i} in the same seed", function () {
  const c = require("./crypto.js");
  const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const w0 = c.importMnemonic(phrase, 0);
  const w1 = c.importMnemonic(phrase, 1);
  assert.strictEqual(w0.evmAddress, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  assert.strictEqual(w0.path, "m/44'/60'/0'/0/0");
  assert.strictEqual(w0.index, 0);
  assert.strictEqual(w1.evmAddress, "0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0");
  assert.strictEqual(w1.path, "m/44'/60'/0'/0/1");
  assert.strictEqual(w1.index, 1);
  assert.notStrictEqual(w0.evmAddress, w1.evmAddress);
  assert.throws(function () { c.importMnemonic(phrase, -1); }, /invalid-index/);
  assert.throws(function () { c.importMnemonic(phrase, 1.5); }, /invalid-index/);
});

test("store: multiple wallet ids; first stays default; later ones get a new id", function () {
  const s = require("./store.js");
  assert.strictEqual(s.DEFAULT_VAULT_ID, "default");
  assert.strictEqual(s.MAX_WALLETS, 20);
  assert.ok(/^w-[0-9a-f]{16}$/.test(s.newVaultId()));
  assert.notStrictEqual(s.newVaultId(), s.newVaultId());
  assert.strictEqual(s.assignVaultId({}, []), "default");
  assert.strictEqual(s.assignVaultId({ id: "w-keep" }, ["default"]), "w-keep");
  const second = s.assignVaultId({}, ["default"]);
  assert.ok(second !== "default");
  assert.ok(/^w-/.test(second));
  const row = s.vaultPublicRow(
    { accounts: [{ i: 0, evmAddress: "0xAbc" }] },
    "default"
  );
  assert.strictEqual(row.id, "default");
  assert.strictEqual(row.evmAddress, "0xAbc");
  assert.strictEqual(row.accountCount, 1);
});

test("crypto: accountsFromMnemonic lists public addresses only", function () {
  const c = require("./crypto.js");
  const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const acc = c.accountsFromMnemonic(phrase, 3);
  assert.strictEqual(acc.length, 3);
  assert.strictEqual(acc[0].evmAddress, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  assert.strictEqual(acc[1].evmAddress, "0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0");
  assert.strictEqual(acc[2].i, 2);
  assert.strictEqual(acc[2].path, "m/44'/60'/0'/0/2");
  const blob = JSON.stringify(acc);
  assert.ok(blob.indexOf(phrase) === -1, "account list must not include the recovery phrase");
  assert.ok(blob.indexOf("privateKey") === -1, "account list must not include a private key");
  assert.strictEqual(c.nextAccountIndex(acc), 3);
  assert.strictEqual(c.nextAccountIndex(null), 0);
  assert.strictEqual(c.nextAccountIndex([]), 0);
  assert.strictEqual(c.MAX_ACCOUNTS, 20);
  assert.throws(function () { c.accountsFromMnemonic(phrase, 21); }, /invalid-count/);
});

test("crypto: parseEvmAddress checksums; watch rows are public and skipped by next index", function () {
  const c = require("./crypto.js");
  const hd0 = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
  const hd1 = "0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0";
  const other = "0x1111111111111111111111111111111111111111";
  assert.strictEqual(c.parseEvmAddress(hd0.toLowerCase()), hd0);
  assert.strictEqual(c.parseEvmAddress(hd0), hd0);
  assert.throws(function () { c.parseEvmAddress("not-an-address"); }, /invalid-address/);
  assert.throws(function () { c.parseEvmAddress("0x123"); }, /invalid-address/);
  assert.throws(function () {
    c.parseEvmAddress("0x9858EFFD232B4033E47d90003D41EC34EcaEda94");
  }, /invalid-checksum/);
  const watch = c.watchAccount(other.toLowerCase());
  assert.strictEqual(watch.kind, "watch");
  assert.strictEqual(watch.evmAddress, c.parseEvmAddress(other));
  assert.strictEqual("i" in watch, false, "watch rows must not carry an HD index");
  assert.strictEqual("path" in watch, false);
  assert.ok(c.isWatchAccount(watch));
  assert.ok(!c.isWatchAccount({ i: 0, path: "m/44'/60'/0'/0/0", evmAddress: hd0 }));
  const mixed = [
    { i: 0, path: "m/44'/60'/0'/0/0", evmAddress: hd0 },
    watch,
    { i: 2, path: "m/44'/60'/0'/0/2", evmAddress: hd1 },
  ];
  assert.strictEqual(c.nextAccountIndex(mixed), 3, "watch rows must not steal the next HD index");
  assert.strictEqual(c.findAccountByAddress(mixed, other).kind, "watch");
  assert.strictEqual(c.findAccountByAddress(mixed, hd0).i, 0);
  assert.strictEqual(c.findAccountByAddress(mixed, "0x2222222222222222222222222222222222222222"), null);
  assert.strictEqual(c.MAX_WATCH_ACCOUNTS, 20);
  const blob = JSON.stringify(watch);
  assert.ok(blob.indexOf("privateKey") === -1);
  assert.ok(blob.indexOf("mnemonic") === -1);
});

test("crypto: wipeBytes zeros key material in place", function () {
  const c = require("./crypto.js");
  const buf = new Uint8Array([1, 2, 3, 4]);
  c.wipeBytes(buf);
  assert.deepStrictEqual(Array.from(buf), [0, 0, 0, 0]);
});

test("crypto: revealEvmSecret is hex and does not keep the phrase", function () {
  const c = require("./crypto.js");
  const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const secret = c.revealEvmSecret(phrase, 0);
  assert.strictEqual(secret.evmAddress, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  assert.ok(/^0x[0-9a-f]{64}$/.test(secret.privateKeyHex), "EVM priv shown once as 0x-hex");
  assert.strictEqual("mnemonic" in secret, false, "the one-time reveal is the key, not the phrase again");
});

test("crypto: vault accounts metadata is public and never the mnemonic", function () {
  const c = require("./crypto.js");
  const phrase = "legal winner thank year wave sausage worth useful legal winner thank yellow";
  return c.encryptVault(phrase, "correct horse battery staple").then(function (vault) {
    vault.accounts = c.accountsFromMnemonic(phrase, 2);
    const blob = JSON.stringify(vault);
    assert.ok(blob.indexOf(phrase) === -1, "plaintext must not be in the vault even with accounts");
    assert.ok(blob.indexOf("privateKey") === -1);
    assert.strictEqual(vault.accounts[1].evmAddress, c.importMnemonic(phrase, 1).evmAddress);
  });
});

test("crypto: vault round-trips and rejects a wrong password", function () {
  const c = require("./crypto.js");
  const phrase = "legal winner thank year wave sausage worth useful legal winner thank yellow";
  return c.encryptVault(phrase, "correct horse battery staple").then(function (vault) {
    assert.strictEqual(vault.v, 1);
    assert.strictEqual(vault.kdf, "pbkdf2-sha256");
    assert.strictEqual(vault.iterations, 600000, "KDF must stay at 600k");
    assert.ok(JSON.stringify(vault).indexOf(phrase) === -1, "plaintext must not be in the vault");
    return c.decryptVault(vault, "correct horse battery staple").then(function (back) {
      assert.strictEqual(back, phrase);
      return c.decryptVault(vault, "wrong").then(
        function () { throw new Error("wrong password should reject"); },
        function (e) { assert.strictEqual(e.message, "wrong-password"); }
      );
    });
  });
});

test("crypto: the bundle has no eval and no remote code", function () {
  const bundle = readFile("vendor/noble.js");
  assert.ok(bundle.length > 50000, "bundle must be the real thing");
  assert.ok(/eval\(|new Function/.test(bundle) === false, "bundle must not use eval");
  ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "import("].forEach(function (call) {
    assert.ok(bundle.indexOf(call) === -1, "bundle must not make network calls: " + call);
  });
});

test("import/unlock gate is present and wired", function () {
  const html = readFile("index.html");
  assert.ok(html.indexOf('id="wallet-gate"') !== -1, "missing gate overlay");
  assert.ok(html.indexOf('id="gate-unlock"') !== -1 && html.indexOf('id="gate-import"') !== -1, "missing gate forms");
  const ui = readFile("ui.js");
  ["openGate", "onUnlock", "onImport", "revealAccount", "loadVault", "decryptVault", "encryptVault"].forEach(function (fn) {
    assert.ok(ui.indexOf(fn) !== -1, "ui.js must wire " + fn);
  });
  assert.ok(ui.indexOf("600000") !== -1 || readFile("crypto.js").indexOf("600000") !== -1, "KDF iterations pinned");
});

test("create gate: generate, typed confirm, wipe; empty state offers Create", function () {
  const html = readFile("index.html");
  assert.ok(html.indexOf('id="gate-create"') !== -1, "missing create form");
  assert.ok(html.indexOf('id="create-mnemonic"') !== -1, "must show the recovery phrase once");
  assert.ok(html.indexOf('id="create-priv"') !== -1, "Phantom-parity: EVM priv shown once");
  assert.ok(html.indexOf('id="create-confirm"') !== -1, "typed confirm input");
  assert.ok(html.indexOf("data-create") !== -1, "empty state must offer Create wallet");
  assert.ok(html.indexOf('id="wallet-new"') !== -1, "Wallets must offer New Wallet");
  const ui = require("./ui.js");
  assert.strictEqual(typeof ui.typedCreateConfirm, "function");
  assert.strictEqual(ui.CREATE_CONFIRM, "I saved my recovery phrase");
  assert.ok(ui.typedCreateConfirm("I saved my recovery phrase"));
  assert.ok(ui.typedCreateConfirm("  I saved my recovery phrase  "));
  assert.ok(!ui.typedCreateConfirm("ok"));
  assert.ok(!ui.typedCreateConfirm(""));
  assert.ok(!ui.typedCreateConfirm("i saved my recovery phrase"), "confirm is exact, not case-folded");
  const src = readFile("ui.js");
  ["onCreateStart", "onCreateConfirm", "wipeSecrets", "generateWallet", "onWalletNew"].forEach(function (fn) {
    assert.ok(src.indexOf(fn) !== -1, "ui.js must wire " + fn);
  });
  const wipe = src.match(/function wipeSecrets\(\) \{[\s\S]*?\n  \}/);
  assert.ok(wipe, "wipeSecrets must exist");
  ["create-mnemonic", "create-priv", "create-confirm", "create-password"].forEach(function (id) {
    assert.ok(wipe[0].indexOf(id) !== -1, "wipeSecrets must clear " + id);
  });
  const close = src.match(/function closeGate\(\) \{[\s\S]*?\n  \}/);
  assert.ok(close && close[0].indexOf("wipeSecrets()") !== -1, "closing the gate must wipe create buffers");
});

test("connect/sign: unlocked RAM holds the phrase; viewing session and IndexedDB do not", function () {
  const ui = readFile("ui.js");
  const reveal = ui.match(/function revealAccount\(phrase(?:, index)?\) \{[\s\S]*?\n  \}/);
  assert.ok(reveal, "revealAccount must exist");
  assert.ok(reveal[0].indexOf("session.phrase") !== -1, "unlock keeps the phrase in RAM for signing");
  const lock = ui.match(/function lockNow\(reason\) \{[\s\S]*?\n  \}/);
  assert.ok(lock[0].indexOf("session.phrase = null") !== -1, "lock wipes the in-memory phrase");
  const save = ui.match(/function saveViewSession\(\) \{[\s\S]*?\n  \}/);
  assert.ok(save[0].indexOf("phrase") === -1, "viewing session must not mention the phrase");
  const html = readFile("index.html");
  assert.ok(html.indexOf("data-connect") !== -1, "settings must offer Connect");
  assert.ok(html.indexOf("data-confirm-sign") !== -1, "settings must offer Sign pending request");
  assert.ok(ui.indexOf("onConfirmSign") !== -1, "ui.js must wire onConfirmSign");
  assert.ok(ui.indexOf("signAndBroadcastPayload") !== -1);
  assert.ok(ui.indexOf("onConnect") !== -1, "ui.js must wire onConnect");
  assert.ok(ui.indexOf("signPersonal") !== -1, "connect signs locally");
  const wallet = readFile("wallet.js");
  assert.ok(wallet.indexOf("/api/wallet/nonce") !== -1, "wallet.js requests a nonce from the same origin");
  assert.ok(wallet.indexOf("/api/wallet/session") !== -1, "wallet.js posts the signature to the same origin");
  assert.ok(wallet.indexOf("/api/wallet/broadcast") !== -1, "wallet.js broadcasts raw to the same origin");
  assert.ok(wallet.indexOf("/api/wallet/pending-signs") !== -1, "wallet.js polls IcePike-requested unsigned txs");
  assert.ok(wallet.indexOf("tkrwallet.scratchpost.ai") !== -1);
  assert.ok(wallet.indexOf("18899") === -1, "client never dials the origin loopback");
});

test("dev-edge nonce is single-use and session recovers the signer", function () {
  const edge = require("./tools/dev-edge.js");
  const c = require("./crypto.js");
  const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  return Promise.resolve(edge.nonceHandler({ method: "POST" }))
    .then(function (issued) {
      assert.strictEqual(issued.code, 200);
      const body = JSON.parse(issued.body);
      assert.ok(body.nonce && body.statement.indexOf(body.nonce) !== -1);
      const signed = c.signPersonal(phrase, 0, body.statement);
      const sess = edge.sessionHandler({
        method: "POST",
        body: JSON.stringify({
          address: signed.address,
          chain_id: 1,
          nonce: body.nonce,
          signature: signed.signature,
        }),
      });
      assert.strictEqual(sess.code, 200);
      const out = JSON.parse(sess.body);
      assert.strictEqual(out.address.toLowerCase(), signed.address.toLowerCase());
      assert.ok(String(sess.setCookie || "").indexOf("tkrw_session=") !== -1);
      const replay = edge.sessionHandler({
        method: "POST",
        body: JSON.stringify({
          address: signed.address,
          chain_id: 1,
          nonce: body.nonce,
          signature: signed.signature,
        }),
      });
      assert.strictEqual(replay.code, 410);
    });
});

test("plaintext mnemonic is never written to IndexedDB or sessionStorage", function () {
  const storeSave = readFile("store.js").match(/function saveVault\(vault\) \{[\s\S]*?\n  \}/);
  assert.ok(storeSave, "saveVault must exist");
  assert.ok(storeSave[0].indexOf("store.put(vault") !== -1, "IndexedDB holds the vault blob only");
  assert.ok(storeSave[0].indexOf("mnemonic") === -1, "saveVault must not mention the recovery phrase");
  const save = readFile("ui.js").match(/function saveViewSession\(\) \{[\s\S]*?\n  \}/);
  assert.ok(save[0].indexOf("mnemonic") === -1, "viewing session must never mention the recovery phrase");
  assert.ok(save[0].indexOf("privateKey") === -1, "viewing session must never mention a private key");
  const persist = readFile("ui.js").match(/function onCreateConfirm\(\) \{[\s\S]*?\n  \}/);
  assert.ok(persist, "onCreateConfirm must exist");
  assert.ok(persist[0].indexOf("encryptVault") !== -1, "create persists ciphertext");
  assert.ok(persist[0].indexOf("saveVault") !== -1, "create writes the vault blob");
  assert.ok(persist[0].indexOf("wipeSecrets") !== -1, "create wipes after persist");
  assert.ok(persist[0].indexOf("sessionStorage") === -1, "create must not write secrets to sessionStorage");
});

test("unlocking with no vault on device explains itself, never bounces silently", function () {
  const ui = readFile("ui.js");
  assert.ok(
    ui.indexOf("No wallet on this device yet") !== -1,
    "a no-vault unlock must show a message, not silently switch forms"
  );
});

test("gate errors hide via the hidden attribute, never the hidden class", function () {
  // showGateError() reveals a message with removeAttribute("hidden"). If the
  // node were hidden by the Tailwind `hidden` CLASS instead, the attribute
  // toggle would do nothing and every unlock/import error would stay invisible
  // (the root cause of the silent unlock bounce).
  const html = readFile("index.html");
  ["gate-error", "gate-import-error", "gate-create-error"].forEach(function (id) {
    const m = html.match(new RegExp('<p id="' + id + '"[^>]*>'));
    assert.ok(m, "missing " + id);
    const tag = m[0];
    const cls = (tag.match(/class="([^"]*)"/) || [])[1] || "";
    assert.ok(!/\bhidden\b/.test(cls), id + " must not hide via the hidden class");
    assert.ok(/\shidden(\s|>)/.test(tag), id + " must carry the hidden attribute");
  });
});

test("an unlocked wallet never shows the boot-time 'No wallet yet' card", function () {
  // The empty list is now chosen by WHY it is empty: no wallet, locked, a
  // complete read that found nothing, an incomplete read, or no read at all.
  // Collapsing any of those into "No balances yet" is the bug this guards.
  const html = readFile("index.html");
  assert.ok(html.indexOf("data-empty-title") !== -1, "empty-state title must be addressable");
  const ui = readFile("ui.js");
  const rt = ui.match(/function renderTokens\(holdings, prices\) \{[\s\S]*?\n  \}/);
  assert.ok(rt, "renderTokens must exist");
  assert.ok(rt[0].indexOf("emptyStateFor()") !== -1, "the empty list must be chosen by reason");
  const empty = ui.match(/function emptyStateFor\(\) \{[\s\S]*?\n  \}/);
  assert.ok(empty, "emptyStateFor must exist");
  assert.ok(/session\.address/.test(empty[0]), "it must branch on the unlocked wallet");
  assert.ok(/session\.locked/.test(empty[0]), "it must branch on the locked session");
  assert.ok(empty[0].indexOf("Wallet locked") !== -1, "the locked state offers Unlock");
  assert.ok(empty[0].indexOf("No balances yet") !== -1, "a complete read that found nothing says so");
  assert.ok(
    empty[0].indexOf("Balances unavailable") !== -1,
    "an unknown read must say unknown, never 'No balances yet'"
  );
  assert.ok(empty[0].indexOf("Balances incomplete") !== -1, "a partial read must disclose the gap");
  assert.ok(empty[0].indexOf("No wallet yet") !== -1, "only the no-wallet case offers import");
  const reveal = ui.match(/function revealAccount\(phrase(?:, index)?\) \{[\s\S]*?\n  \}/);
  assert.ok(reveal && reveal[0].indexOf("renderTokens(null)") !== -1, "revealAccount must repaint the token list");
});

test("tapping a coin opens the detail screen instead of a dead click", function () {
  const ui = readFile("ui.js");
  // Both entry points navigate now; neither merely writes a status string.
  assert.ok(
    /goToken\(holding\.chain_id, holding\.address\)/.test(ui),
    "a holding row must open its detail screen"
  );
  assert.ok(/goToken\(tok\.chain_id, tok\.address\)/.test(ui), "a search row must open its detail screen");
  assert.ok(
    ui.indexOf("Token details are not built yet") === -1,
    "the old dead-click status string must be gone"
  );
  const html = readFile("index.html");
  ["data-screen=\"detail\"", 'id="detail-back"', 'id="detail-copy"', 'id="detail-amount"', 'id="detail-contract"'].forEach(
    function (needle) {
      assert.ok(html.indexOf(needle) !== -1, "detail screen must include " + needle);
    }
  );
  const detail = ui.match(/function renderDetail\(\) \{[\s\S]*?\n  \}/);
  assert.ok(detail, "renderDetail must exist");
  assert.ok(detail[0].indexOf("go(") !== -1, "an invalid detail route must not render an empty shell");
  // The native gas token has no contract: do not offer to copy one.
  assert.ok(detail[0].indexOf("detail-copy") !== -1, "the detail screen owns the copy button");
  assert.ok(/route\.asset/.test(detail[0]), "contract handling must depend on whether there is an address");
});

test("a failed read is retryable and never rendered as an empty wallet", function () {
  const ui = readFile("ui.js");
  const rb = ui.match(/function refreshBalances\(\) \{[\s\S]*?\n  \}/);
  assert.ok(rb, "refreshBalances must exist");
  assert.ok(/res\.state === "ok"/.test(rb[0]), "the ok state is handled");
  assert.ok(/res\.state === "partial"/.test(rb[0]), "the partial state keeps its rows and discloses the gap");
  assert.ok(rb[0].indexOf("Balances unknown") !== -1, "the unknown state says unknown");
  assert.ok(rb[0].indexOf("uiData.lastBalances = res") !== -1, "the read report is retained for rendering");
  assert.ok(ui.indexOf("renderBalancesNotice") !== -1, "an incomplete read must be visible, not silent");
  const html = readFile("index.html");
  assert.ok(html.indexOf('id="balances-retry"') !== -1, "the notice must offer Retry");
  assert.ok(html.indexOf('id="balances-notice"') !== -1, "the notice container must exist");
});

test("holdings coverage is disclosed and a token can be added by address", function () {
  const html = readFile("index.html");
  [
    "id=\"holdings-scope\"",
    "id=\"add-token-btn\"",
    "id=\"add-token-form\"",
    "id=\"add-token-address\"",
    "id=\"airdrops-open\"",
    "data-desk-tab=\"mine\"",
    "data-desk-tab=\"tokens\"",
    "data-desk-tab=\"airdrop\"",
    "data-desk-tab=\"pools\"",
    "id=\"pools-panel\"",
    "id=\"send-chain\"",
    "id=\"receive-chain\"",
    "id=\"airdrop-list\"",
  ].forEach(function (n) {
    assert.ok(html.indexOf(n) !== -1, "index.html must include " + n);
  });
  assert.ok(html.indexOf('data-screen="airdrops"') !== -1, "Airdrops is a submenu screen");
  assert.ok(html.indexOf('data-nav="airdrops"') === -1, "Airdrops is not a fifth nav tab");
  const ui = readFile("ui.js");
  const wallet = readFile("wallet.js");
  assert.ok(ui.indexOf("holdingsScopeText") !== -1, "the scope of the list must be stated");
  assert.ok(ui.indexOf("built-in tokens") === -1, "holdings must not advertise a 40-token catalogue cap");
  assert.ok(ui.indexOf("renderAirdrops") !== -1, "unpriced airdrops must be reachable from home");
  assert.ok(ui.indexOf("setDeskTab") !== -1, "Mine/Tokens/Airdrop/Pools must switch in place");
  assert.ok(ui.indexOf("onPoolAdd") !== -1, "pools can add liquidity");
  assert.ok(ui.indexOf("onSendSubmit") !== -1, "send builds unsigned calldata");
  assert.ok(wallet.indexOf("buildPool") !== -1, "wallet.js talks to pool build");
  assert.ok(wallet.indexOf("buildSend") !== -1, "wallet.js talks to send build");
  assert.ok(html.indexOf("Under construction") === -1, "send is no longer a stub");
  assert.ok(wallet.indexOf("splitHoldings: splitHoldings") !== -1, "wallet.js must export splitHoldings");
  assert.ok(wallet.indexOf("mineHoldings: mineHoldings") !== -1, "wallet.js must export mineHoldings");
  assert.ok(wallet.indexOf("tokenListRows: tokenListRows") !== -1, "wallet.js must export tokenListRows");
  assert.ok(ui.indexOf("paintTokenBadge") !== -1, "rows must paint Scratchpost icons with a letter fallback");
  assert.ok(wallet.indexOf("tokenIconUrl") !== -1, "icon URLs stay on the wallet edge");
  assert.ok(ui.indexOf("getTokenMeta") !== -1, "adding a token must read its metadata from the edge");
  assert.ok(ui.indexOf("TOKENS_KEY") !== -1, "added tokens must persist");
  assert.ok(wallet.indexOf("getTokenMeta: getTokenMeta") !== -1, "wallet.js must export getTokenMeta");
  // Only public metadata is stored — never anything from the vault.
  const store = ui.match(/function storeTokens\(list\) \{[\s\S]*?\n  \}/);
  assert.ok(store && store[0].indexOf("JSON.stringify(list)") !== -1, "stored tokens are the metadata list");
});

test("the value note never claims the wallet edge has not shipped", function () {
  const ui = readFile("ui.js");
  assert.ok(
    ui.indexOf("until the wallet edge ships") === -1,
    "live origin is the edge; a missing price or a partial read must not say it is unshipped"
  );
});

test("unlock fetches real balances from the edge and locks on expiry", function () {
  const ui = readFile("ui.js");
  // Unlock -> getBalances -> render -> prices: the actual data path.
  assert.ok(
    /getBalances\(session\.address, \[1, 8453, 4663\]/.test(ui),
    "unlock must fetch Mainnet + Base + Robinhood balances"
  );
  const reveal = ui.match(/function revealAccount\(phrase(?:, index)?\) \{[\s\S]*?\n  \}/);
  assert.ok(reveal && reveal[0].indexOf("refreshBalances()") !== -1, "revealAccount must start the balance fetch");
  assert.ok(reveal && reveal[0].indexOf("scheduleLock()") !== -1, "revealAccount must arm the auto-lock timer");
  // A locked wallet must clear key material, holdings, and the read report.
  const lock = ui.match(/function lockNow\(reason\) \{[\s\S]*?\n  \}/);
  assert.ok(lock, "lockNow must exist");
  ["session.address = null", "uiData.lastHoldings = null", "uiData.lastBalances = null", "renderTokens(null)"].forEach(
    function (s) {
      assert.ok(lock[0].indexOf(s) !== -1, "lockNow must " + s);
    }
  );
  const wallet = readFile("wallet.js");
  assert.ok(wallet.indexOf("getBalances: getBalances") !== -1, "wallet.js must export getBalances");
});

test("shipped files still reference only the wallet origin", function () {
  // crypto.js + store.js are now in SHIPPED; confirm the scan covers them.
  assert.ok(SHIPPED.indexOf("crypto.js") !== -1 && SHIPPED.indexOf("store.js") !== -1);
});

test("crypto: signAndBroadcastPayload signs an unsigned tx and recovers the signer", function () {
  const c = require("./crypto.js");
  const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const signed = c.signAndBroadcastPayload(phrase, 0, {
    nonce: "1",
    gasPrice: "1000000000",
    gasLimit: "21000",
    to: "0x0000000000000000000000000000000000000001",
    value: "1",
    data: "0x",
    chainId: 1,
  });
  assert.ok(/^0x[0-9a-f]+$/.test(signed.raw));
  assert.strictEqual(c.recoverTxSigner(signed.raw, 1), signed.address);
  assert.strictEqual(signed.address, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
});

test("crypto: signSolanaVersionedTx overlays ed25519 on message bytes", function () {
  const c = require("./crypto.js");
  const noble = require("./vendor/noble.js");
  const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const w = c.importMnemonic(phrase);
  const message = Buffer.from("sol-native-swap-message");
  const unsigned = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), message]);
  const signed = c.signSolanaVersionedTx(phrase, unsigned.toString("base64"));
  assert.strictEqual(signed.chainId, 900001);
  assert.strictEqual(signed.address, w.solAddress);
  const raw = Buffer.from(signed.raw, "base64");
  const sig = raw.subarray(1, 65);
  const seed = noble.HDKey.fromMasterSeed(noble.mnemonicToSeedSync(phrase)).derive("m/44'/501'/0'/0'").privateKey;
  const pub = noble.ed25519.getPublicKey(seed);
  assert.ok(noble.ed25519.verify(sig, message, pub));
  assert.ok(!/^0x/.test(signed.raw));
  assert.strictEqual(c.base58Encode(Buffer.alloc(32)), "1".repeat(32));
});

test("crypto: signTronTransaction attaches a secp256k1 signature to txID", function () {
  const c = require("./crypto.js");
  const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const w = c.importMnemonic(phrase);
  const unsigned = {
    txID: "ab".repeat(32),
    raw_data: { contract: [{ parameter: { value: { owner_address: w.tronAddress } } }] },
  };
  const signed = c.signTronTransaction(phrase, unsigned);
  assert.strictEqual(signed.chainId, 728126428);
  assert.strictEqual(signed.address, w.tronAddress);
  const body = JSON.parse(signed.raw);
  assert.strictEqual(body.txID, unsigned.txID);
  assert.ok(Array.isArray(body.signature) && /^[0-9a-f]{130}$/.test(body.signature[0]));
});

test("SOL catalogue supports native in and out; search stays Mainnet/Base", function () {
  const wallet = require("./wallet.js");
  const sol = wallet.TOKENS[900001];
  assert.ok(sol, "Solana catalogue must exist");
  assert.ok(sol.some((t) => t.symbol === "SOL" && !t.address));
  assert.ok(sol.some((t) => t.symbol === "USDC" && t.address));
  assert.ok(sol.some((t) => t.symbol === "USDT" && t.address));
  assert.strictEqual(wallet.toAtomicAmount("1.5", 9), "1500000000");
  assert.strictEqual(wallet.toAtomicAmount("0", 9), null);
  wallet.searchCatalog("usdc").forEach(function (r) {
    assert.ok(r.chain_id === 1 || r.chain_id === 8453);
  });
});

test("swap screen quotes same-chain swaps through the wallet edge, never a vendor host", function () {
  const html = readFile("index.html");
  assert.match(html, /id="swap-from"/);
  assert.match(html, /id="swap-quote"/);
  assert.match(html, /id="swap-submit"/);
  assert.ok(html.indexOf("Under construction") === -1 || html.indexOf("data-screen=\"swap\"") < html.indexOf("Under construction"));
  const swapSection = html.split('data-screen="swap"')[1].split('data-screen="receive"')[0];
  assert.ok(swapSection.indexOf("Under construction") === -1, "swap is no longer a placeholder");
  assert.match(swapSection, /Ethereum, Base, Robinhood, Solana, and TRON/);
  const ui = readFile("ui.js");
  assert.ok(ui.indexOf("quoteSwap") !== -1);
  assert.ok(ui.indexOf("[1, 8453, 4663, 900001, 728126428]") !== -1, "swap pairs include Robinhood");
  assert.ok(ui.indexOf("signSolanaVersionedTx") !== -1);
  assert.ok(ui.indexOf("signTronTransaction") !== -1);
  assert.ok(ui.indexOf("signAndBroadcastPayload") !== -1);
  assert.ok(ui.indexOf("sol_address") !== -1);
  assert.ok(ui.indexOf("tron_address") !== -1);
  const wallet = readFile("wallet.js");
  assert.ok(wallet.indexOf("/api/wallet/swap/quote") !== -1);
  assert.ok(wallet.indexOf("/api/wallet/swap/build") !== -1);
  CLIENT_SHIPPED.forEach(function (file) {
    const src = readFile(file);
    assert.ok(!/helius|jupiter|lite-api\.jup|mainnet\.helius|trongrid|sunswap|alchemy/i.test(src), file + " must not name swap vendors");
  });
});

test("quoteSwap and buildSwap POST the real edge paths and return the quote body", async function () {
  const wallet = require("./wallet.js");
  const quotePayload = {
    chain_id: 1,
    input_mint: "native",
    output_mint: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    amount: "1000000000000000000",
  };
  const quoteBody = {
    ok: true,
    out_amount: "2500000000",
    other_amount_threshold: "2475000000",
    expires_at: 1737000000000,
    quote: { id: "q-live-1", chain_id: 1 },
  };
  const builtBody = {
    ok: true,
    tx: {
      kind: "evm",
      chain_id: 1,
      to: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      data: "0x",
      value: "0x0",
    },
  };
  const calls = [];
  function fetchFn(url, opts) {
    calls.push({ url: url, method: opts.method, body: JSON.parse(opts.body), credentials: opts.credentials });
    const path = String(url);
    const body = path.indexOf("/api/wallet/swap/build") !== -1 ? builtBody : quoteBody;
    return Promise.resolve({
      ok: true,
      json: function () {
        return Promise.resolve(body);
      },
    });
  }
  const quoted = await wallet.quoteSwap(quotePayload, fetchFn);
  assert.strictEqual(calls[0].method, "POST");
  assert.ok(String(calls[0].url).indexOf("/api/wallet/swap/quote") !== -1);
  assert.strictEqual(calls[0].credentials, "include");
  assert.deepStrictEqual(calls[0].body, quotePayload);
  assert.strictEqual(quoted.ok, true);
  assert.strictEqual(quoted.out_amount, "2500000000");
  assert.deepStrictEqual(quoted.quote, quoteBody.quote);
  const built = await wallet.buildSwap({ chain_id: 1, quote: quoted.quote }, fetchFn);
  assert.strictEqual(calls[1].method, "POST");
  assert.ok(String(calls[1].url).indexOf("/api/wallet/swap/build") !== -1);
  assert.deepStrictEqual(calls[1].body, { chain_id: 1, quote: quoteBody.quote });
  assert.strictEqual(built.ok, true);
  assert.strictEqual(built.tx.chain_id, 1);
  const failed = await wallet.quoteSwap(quotePayload, function (url, opts) {
    calls.push({ url: url, method: opts.method });
    return Promise.resolve({
      ok: false,
      json: function () {
        return Promise.resolve({ error: "quote-expired" });
      },
    });
  });
  assert.deepStrictEqual(failed, { ok: false, error: "quote-expired" });
});

test("crypto: signPersonal signs a connect statement and recovers the HD address", function () {
  const c = require("./crypto.js");
  const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const statement = "Sign in to tkrWallet.\nNonce: aabbcc";
  const signed = c.signPersonal(phrase, 0, statement);
  assert.strictEqual(signed.address, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  assert.ok(/^0x[0-9a-f]{130}$/.test(signed.signature));
  assert.strictEqual(c.recoverSigner(signed.signature.slice(2), statement), signed.address);
  const i1 = c.signPersonal(phrase, 1, statement);
  assert.strictEqual(i1.address, "0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0");
  assert.notStrictEqual(i1.signature, signed.signature);
});

test("crypto: personal_sign round-trips to the derived address", function () {
  const c = require("./crypto.js");
  const noble = require("./vendor/noble.js");
  const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const w = c.importMnemonic(phrase);
  const priv = noble.HDKey.fromMasterSeed(noble.mnemonicToSeedSync(phrase)).derive("m/44'/60'/0'/0/0").privateKey;
  const sig = c.signMessage(priv, "hello tkr");
  assert.ok(/^[0-9a-f]{130}$/.test(sig), "65-byte r||s||v hex");
  assert.strictEqual(c.recoverSigner(sig, "hello tkr"), w.evmAddress);
  assert.strictEqual(c.signMessage(priv, "hello tkr"), sig, "RFC6979 deterministic");
});

test("crypto: signTransaction recovers the signer on Ethereum and Base", function () {
  const c = require("./crypto.js");
  const noble = require("./vendor/noble.js");
  const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const w = c.importMnemonic(phrase);
  const priv = noble.HDKey.fromMasterSeed(noble.mnemonicToSeedSync(phrase)).derive("m/44'/60'/0'/0/0").privateKey;
  const tx = { nonce: 0, gasPrice: 20000000000n, gasLimit: 21000n, to: "0x" + "0".repeat(40), value: 0, data: "", chainId: 1 };
  assert.strictEqual(c.recoverTxSigner(c.signTransaction(priv, tx), 1), w.evmAddress);
  const base = Object.assign({}, tx, { nonce: 5, gasPrice: 1000000000n, gasLimit: 30000n, to: "0x" + "1".repeat(40), value: "1000000000000000000", chainId: 8453 });
  assert.strictEqual(c.recoverTxSigner(c.signTransaction(priv, base), 8453), w.evmAddress);
  const rh = Object.assign({}, tx, { nonce: 2, gasPrice: 1000000000n, gasLimit: 30000n, to: "0x" + "2".repeat(40), value: "10000000000000000", chainId: 4663 });
  assert.strictEqual(c.recoverTxSigner(c.signTransaction(priv, rh), 4663), w.evmAddress);
});

/* ---------------------------------------------------------------------------
 * M3.1 — the dev edge must never report a read failure as "you own nothing".
 * docs/research/balances-empty-state.md; docs/specs/edge-server.md §3.3.
 * ------------------------------------------------------------------------- */

const edge = require("./tools/dev-edge.js");

const ADDR = "0x" + "11".repeat(20);
const EXTRA = "0x" + "Ab".repeat(20);

function rpcReply(result) {
  return {
    json: function () {
      return Promise.resolve({ jsonrpc: "2.0", id: 1, result: result });
    },
  };
}

function balancesUrl(query) {
  return new URL("http://127.0.0.1:8899/api/wallet/balances?" + query);
}

/* Fake RPC transport. `plan(method, params, url)` returns a result string,
 * throws/rejects to simulate a failure. */
function fakeRpc(plan) {
  return function (u, opts) {
    const req = JSON.parse(opts.body);
    return Promise.resolve()
      .then(function () {
        return plan(req.method, req.params, u);
      })
      .then(rpcReply);
  };
}

function chainOf(u) {
  return String(u).indexOf("base") !== -1 ? 8453 : 1;
}

function abiEncodeString(s) {
  const hex = Buffer.from(s, "utf8").toString("hex");
  const len = (hex.length / 2).toString(16).padStart(64, "0");
  const data = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
  return "0x" + "20".padStart(64, "0") + len + data;
}

test("dev edge: when no chain can be read the answer is 502, never an empty 200", function () {
  return edge
    .balancesHandler(balancesUrl("address=" + ADDR + "&chains=1,8453"), function () {
      return Promise.reject(new Error("rpc down"));
    })
    .then(function (res) {
      assert.strictEqual(res.code, 502, "a total read failure must not be a success status");
      const body = JSON.parse(res.body);
      assert.strictEqual(body.ok, false, "errors use the §3 envelope");
      assert.strictEqual(body.error, "chain-read-failed");
      assert.ok(body.detail, "the envelope carries human-readable detail");
      assert.strictEqual(body.balances, undefined, "never an empty wallet in success shape");
    });
});

test("dev edge: a failed chain is disclosed as unknown while partial success survives", function () {
  const fetchFn = fakeRpc(function (method, params, u) {
    if (chainOf(u) === 1) {
      throw new Error("ethereum rpc timeout");
    }
    return method === "eth_getBalance" ? "0xde0b6b3a7640000" : "0x0"; // 1 ETH on Base, no tokens
  });
  return edge.balancesHandler(balancesUrl("address=" + ADDR + "&chains=1,8453"), fetchFn).then(function (res) {
    assert.strictEqual(res.code, 200, "partial success is still a success");
    const body = JSON.parse(res.body);
    assert.strictEqual(body.balances.length, 1, "the readable chain's holding is shown");
    assert.strictEqual(body.balances[0].chain_id, 8453);
    const status = {};
    body.chains.forEach(function (c) {
      status[c.chain_id] = c;
    });
    assert.strictEqual(status[1].state, "unknown", "the unreadable chain must say unknown");
    assert.ok(status[1].error, "and carry the real reason");
    assert.strictEqual(status[8453].state, "ok");
  });
});

test("dev edge: an empty list means 'you own none' ONLY when every chain was read", function () {
  const emptyButRead = fakeRpc(function (method) {
    return "0x0";
  });
  return edge.balancesHandler(balancesUrl("address=" + ADDR + "&chains=1,8453"), emptyButRead).then(function (res) {
    assert.strictEqual(res.code, 200);
    const body = JSON.parse(res.body);
    assert.deepStrictEqual(body.balances, [], "a genuinely empty wallet is an empty list");
    assert.strictEqual(body.chains.length, 2);
    body.chains.forEach(function (c) {
      assert.strictEqual(c.state, "ok", "and every chain is reported read");
    });
  });
});

test("dev edge: a partially readable chain is reported as partial", function () {
  // Native read works; every token read fails -> we know the gas balance but not
  // the token set, and the response says so instead of implying "no tokens".
  const fetchFn = fakeRpc(function (method, params) {
    if (method === "eth_getBalance") {
      return "0x0";
    }
    throw new Error("token read failed");
  });
  return edge.balancesHandler(balancesUrl("address=" + ADDR + "&chains=1"), fetchFn).then(function (res) {
    assert.strictEqual(res.code, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.chains[0].state, "partial");
    assert.ok(/token read/.test(body.chains[0].error), "the failure count is disclosed");
  });
});

test("dev edge: validation errors use the documented envelope", function () {
  return edge.balancesHandler(balancesUrl("address=not-an-address&chains=1"), fakeRpc(function () { return "0x0"; })).then(function (res) {
    assert.strictEqual(res.code, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error, "bad-address");
    assert.ok(body.detail);
  });
});

test("dev edge: over-cap requests are rejected, not silently truncated", function () {
  const nine = "1,2,3,4,5,6,7,8,9";
  return edge.balancesHandler(balancesUrl("address=" + ADDR + "&chains=" + nine), fakeRpc(function () { return "0x0"; })).then(function (res) {
    assert.strictEqual(res.code, 400, "the spec's cap must be enforced");
    assert.strictEqual(JSON.parse(res.body).error, "too-many-chains");
  });
});

test("dev edge: user-added tokens are read, malformed ones are ignored", function () {
  const fetchFn = fakeRpc(function (method, params) {
    const to = params[0] && params[0].to;
    const data = params[0] && params[0].data;
    if (method === "eth_getBalance") {
      return "0x0";
    }
    if (data === "0x313ce567") {
      return "0x" + "12"; // decimals() = 18
    }
    if (to && to.toLowerCase() === EXTRA.toLowerCase() && data.indexOf("0x70a08231") === 0) {
      return "0x4563918244f40000"; // 5e18
    }
    return "0x0";
  });
  return edge
    .balancesHandler(balancesUrl("address=" + ADDR + "&chains=1&tokens=1:" + EXTRA + ",1:nothex,9:0xdead"), fetchFn)
    .then(function (res) {
      assert.strictEqual(res.code, 200);
      const body = JSON.parse(res.body);
      const extra = body.balances.filter(function (b) {
        return b.address && b.address.toLowerCase() === EXTRA.toLowerCase();
      });
      assert.strictEqual(extra.length, 1, "the added token is queried and reported");
      assert.strictEqual(extra[0].amount, "5", "with its real decimals");
      assert.strictEqual(body.balances.length, 1, "malformed and unrequested-chain tokens are ignored");
    });
});

test("dev edge: token metadata endpoint labels an arbitrary ERC-20", function () {
  const fetchFn = fakeRpc(function (method, params) {
    const data = params[0] && params[0].data;
    if (data === "0x313ce567") {
      return "0x" + "6"; // decimals() = 6
    }
    if (data === "0x95d89b41") {
      return abiEncodeString("USDC");
    }
    if (data === "0x06fdde03") {
      return abiEncodeString("USD Coin");
    }
    return "0x0";
  });
  const u = new URL("http://127.0.0.1:8899/api/wallet/token?chain=8453&address=" + EXTRA);
  return edge.tokenHandler(u, fetchFn).then(function (res) {
    assert.strictEqual(res.code, 200);
    const tok = JSON.parse(res.body).token;
    assert.strictEqual(tok.symbol, "USDC");
    assert.strictEqual(tok.name, "USD Coin");
    assert.strictEqual(tok.decimals, 6);
    assert.strictEqual(tok.chain_id, 8453);
  });
});

test("dev edge: an address that is not a token is a 404, not invented metadata", function () {
  const fetchFn = fakeRpc(function () {
    throw new Error("execution reverted");
  });
  const u = new URL("http://127.0.0.1:8899/api/wallet/token?chain=8453&address=" + EXTRA);
  return edge.tokenHandler(u, fetchFn).then(function (res) {
    assert.strictEqual(res.code, 404);
    assert.strictEqual(JSON.parse(res.body).error, "not-a-token");
  });
});

test("dev edge: a price-source failure is 502 with the envelope, never empty prices", function () {
  const fetchFn = function () {
    return Promise.reject(new Error("coingecko down"));
  };
  const u = new URL("http://127.0.0.1:8899/api/wallet/prices?assets=1:native&vs=usd");
  return edge.pricesHandler(u, fetchFn).then(function (res) {
    assert.strictEqual(res.code, 502);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error, "price-source-failed");
    assert.strictEqual(body.prices, undefined, "a failure must not look like an empty price set");
  });
});

/* ---------------------------------------------------------------------------
 * Catalogue integrity. These are the offline structural half; the on-chain
 * proof (bytecode + symbol + decimals for every address) is
 * `npm run verify:catalogue`.
 * ------------------------------------------------------------------------- */

test("catalogue: every token address is well-formed and unique within its chain", function () {
  const wallet = require("./wallet.js");
  Object.keys(wallet.TOKENS).forEach(function (chainId) {
    const seen = {};
    wallet.TOKENS[chainId].forEach(function (t) {
      if (!t.address) {
        return; // native gas token
      }
      if (Number(chainId) === 900001) {
        assert.ok(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t.address), "malformed address on chain " + chainId + ": " + t.address);
        assert.ok(!seen[t.address], "duplicate address on chain " + chainId + ": " + t.address);
        seen[t.address] = true;
      } else if (Number(chainId) === 728126428) {
        assert.ok(/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(t.address), "malformed TRON address on chain " + chainId + ": " + t.address);
        assert.ok(!seen[t.address], "duplicate address on chain " + chainId + ": " + t.address);
        seen[t.address] = true;
      } else {
        assert.ok(/^0x[0-9a-fA-F]{40}$/.test(t.address), "malformed address on chain " + chainId + ": " + t.address);
        assert.ok(!seen[t.address.toLowerCase()], "duplicate address on chain " + chainId + ": " + t.address);
        seen[t.address.toLowerCase()] = true;
      }
      assert.ok(t.symbol && t.name, "every token needs a symbol and a name");
      assert.ok(Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 36, "bad decimals for " + t.symbol);
    });
  });
});

test("fromAtomicAmount converts quoted raw amounts to human units", function () {
  const wallet = require("./wallet.js");
  assert.strictEqual(wallet.fromAtomicAmount("2467250184", 6), "2467.250184");
  assert.strictEqual(wallet.fromAtomicAmount("1000000000000000000", 18), "1");
  assert.strictEqual(wallet.fromAtomicAmount("1500000000", 9), "1.5");
  assert.strictEqual(wallet.fromAtomicAmount("1", 6), "0.000001");
});

test("vendored QR encoder returns a module matrix without innerHTML", function () {
  const qr = require("./vendor/qr.js");
  assert.strictEqual(typeof qr.encode, "function");
  const out = qr.encode("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  assert.ok(out && Array.isArray(out.data) && out.data.length > 10);
  assert.ok(out.data.some(function (row) { return row.some(Boolean); }));
  const src = readFile("vendor/qr.js");
  assert.ok(src.indexOf(".innerHTML") === -1);
  assert.ok(readFile("ui.js").indexOf("toDataURL") !== -1, "QR must paint via canvas PNG");
  assert.ok(readFile("sw.js").indexOf('"./vendor/qr.js"') !== -1, "sw must precache qr.js");
  assert.ok(readFile("index.html").indexOf('src="./vendor/qr.js"') !== -1);
});

test("desk UX: airdrops submenu, receive QR, send contacts, live quote estimate", function () {
  const html = readFile("index.html");
  const ui = readFile("ui.js");
  const wallet = readFile("wallet.js");
  const storeSrc = readFile("store.js");
  [
    "id=\"airdrops-open\"",
    "data-desk-tab=\"mine\"",
    "data-screen=\"airdrops\"",
    "id=\"receive-qr\"",
    "id=\"send-recent\"",
    "id=\"send-scan\"",
    "id=\"send-camera\"",
    "id=\"send-contacts\"",
    "id=\"send-contact-label\"",
    "id=\"swap-estimate\"",
    "id=\"swap-estimate-timer\"",
    "id=\"swap-quote-dialog\"",
    "id=\"swap-quote-timer\"",
  ].forEach(function (n) {
    assert.ok(html.indexOf(n) !== -1, "index.html must include " + n);
  });
  assert.ok(html.indexOf("Swap Now") !== -1);
  assert.ok(html.indexOf("This is an estimate from Scratchpost") !== -1);
  assert.ok(html.indexOf("Tap the number for details and Swap Now") !== -1);
  assert.ok(ui.indexOf("openQuoteDialog") !== -1);
  assert.ok(/startQuoteTimer\(\);\s*openQuoteDialog\(\);/.test(ui), "a live quote must open the Swap Now modal");
  assert.ok(ui.indexOf("quoteStillLive") !== -1);
  assert.ok(html.indexOf("media-src 'self' blob:") !== -1, "camera needs media-src");
  const nginx = readFile("deploy/nginx/tkrwallet-edge.conf.template");
  assert.ok(nginx.indexOf("media-src 'self' blob:") !== -1, "edge nginx must allow camera blobs");
  assert.ok(nginx.indexOf("camera=(self)") !== -1, "edge nginx must allow same-origin camera");
  assert.ok(ui.indexOf("paintReceiveQr") !== -1);
  assert.ok(ui.indexOf("paintSendRecent") !== -1);
  assert.ok(ui.indexOf("startSendCamera") !== -1);
  assert.ok(ui.indexOf("showSwapEstimate") !== -1);
  assert.ok(ui.indexOf("quoteStillLive") !== -1);
  assert.ok(ui.indexOf("/api/wallet/tokens/search") === -1, "ui.js must not fetch the catalogue itself");
  assert.ok(wallet.indexOf("/api/wallet/tokens/search") !== -1);
  assert.ok(wallet.indexOf("searchTokens: searchTokens") !== -1);
  assert.ok(storeSrc.indexOf("listContacts") !== -1);
  assert.ok(storeSrc.indexOf("listRecentRecipients") !== -1);
  assert.ok(storeSrc.indexOf("rememberRecipient") !== -1);
  assert.ok(storeSrc.indexOf("DB_VERSION = 3") !== -1, "IndexedDB v3 adds meta + several vault keys");
});

test("Send QR camera: popup cannot prompt; errors stay honest", function () {
  const src = readFile("ui.js");
  const ui = require("./ui.js");
  assert.strictEqual(
    src.indexOf("Camera permission was denied. Nothing was signed."),
    -1,
    "camera failures must not pretend a signature was involved"
  );
  assert.ok(src.indexOf("facingMode") === -1, "desk webcam must not demand a rear camera");
  assert.ok(src.indexOf("getUserMedia({ video: true, audio: false })") !== -1);
  assert.ok(src.indexOf("chrome.tabs.create") !== -1, "toolbar popup must open a tab to request camera");
  assert.strictEqual(ui.cameraShellCannotPrompt("", "chrome-extension:", 432), true);
  assert.strictEqual(ui.cameraShellCannotPrompt("", "chrome-extension:", 1200), false);
  assert.strictEqual(ui.cameraShellCannotPrompt("?mode=panel", "chrome-extension:", 1200), true);
  assert.strictEqual(ui.cameraShellCannotPrompt("", "https:", 432), false);
  assert.strictEqual(ui.wantsAutoScan("?scan=1"), true);
  assert.strictEqual(ui.wantsAutoScan("?preview=1"), false);
  assert.ok(/Allow the camera/.test(ui.sendCameraErrorText({ name: "NotAllowedError" })));
  assert.ok(/No camera/.test(ui.sendCameraErrorText({ name: "NotFoundError" })));
  assert.ok(!/Nothing was signed/.test(ui.sendCameraErrorText({ name: "NotAllowedError" })));
  assert.ok(/could not be opened/.test(ui.sendCameraErrorText({ name: "AbortError" })));
});

test("catalogue: a token is never listed on a chain it is not deployed on (the OP bug)", function () {
  const wallet = require("./wallet.js");
  const mainnet = (wallet.TOKENS[1] || []).map(function (t) {
    return t.address && t.address.toLowerCase();
  });
  // 0x4200…0042 is the GovernanceToken predeploy on OP Mainnet (chain 10); it has
  // no bytecode on Ethereum. Cataloguing it as a mainnet token made every
  // mainnet balance read silently drop a token. Verified against chain state and
  // CoinGecko; guarded structurally here and on-chain by verify-catalogue.
  assert.ok(
    mainnet.indexOf("0x4200000000000000000000000000000000000042") === -1,
    "the OP Mainnet predeploy must not be catalogued on Ethereum mainnet"
  );
  assert.strictEqual(
    (wallet.TOKENS[1] || []).filter(function (t) {
      return t.symbol === "OP";
    }).length,
    0,
    "OP has no Ethereum mainnet deployment"
  );
});

test("Scratchpost waits show a busy strip and disable hammer buttons", function () {
  const html = readFile("index.html");
  const src = readFile("tools/src/app.css");
  const uiSrc = readFile("ui.js");
  const ui = require("./ui.js");
  ["scratchpost-busy", "scratchpost-busy-label", "wallet-value-card"].forEach(function (id) {
    assert.ok(html.indexOf('id="' + id + '"') !== -1, "missing #" + id);
  });
  assert.ok(/Talking to Scratchpost/.test(html), "busy strip must tell the operator we are waiting");
  assert.ok(src.indexOf("@keyframes tkr-spin") !== -1, "spinner keyframes");
  assert.ok(src.indexOf("@keyframes tkr-pulse") !== -1, "card pulse keyframes");
  assert.ok(src.indexOf("prefers-reduced-motion") !== -1, "reduced motion must still show the strip");
  assert.ok(src.indexOf("html.tkr-busy #swap-quote") !== -1, "Quote must not be clickable while busy");
  assert.ok(uiSrc.indexOf("function withBusy") !== -1, "refcount wrapper");
  [
    "refreshBalances",
    "refreshPrices",
    "onSwapQuote",
    "onSwapSubmit",
    "onSendSubmit",
    "onPoolBuild",
    "onPoolSearch",
    "addToken",
  ].forEach(function (name) {
    const idx = uiSrc.indexOf("function " + name + "(");
    assert.ok(idx !== -1, "missing " + name);
    const next = uiSrc.indexOf("\n  function ", idx + 10);
    const slice = uiSrc.slice(idx, next === -1 ? idx + 5000 : next);
    assert.ok(slice.indexOf("withBusy") !== -1, name + " must wrap the Scratchpost wait");
  });
  ui.BUSY_BUTTONS.forEach(function (id) {
    assert.ok(html.indexOf('id="' + id + '"') !== -1, "busy target #" + id + " missing from the shell");
  });
});

test("busy refcount stays on until overlapping Scratchpost waits finish", function () {
  const ui = require("./ui.js");
  const nodes = Object.create(null);
  function makeNode() {
    const attrs = { hidden: "" };
    const classes = new Set();
    return {
      disabled: false,
      textContent: "",
      classList: {
        add: function (c) { classes.add(c); },
        remove: function (c) { classes.delete(c); },
        contains: function (c) { return classes.has(c); },
      },
      setAttribute: function (k, v) { attrs[k] = String(v); },
      removeAttribute: function (k) { delete attrs[k]; },
      hasAttribute: function (k) { return Object.prototype.hasOwnProperty.call(attrs, k); },
      getAttribute: function (k) {
        return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
      },
    };
  }
  const htmlClasses = new Set();
  const prev = global.document;
  global.document = {
    getElementById: function (id) {
      if (!nodes[id]) {
        nodes[id] = makeNode();
      }
      return nodes[id];
    },
    querySelectorAll: function () { return []; },
    documentElement: {
      classList: {
        add: function (c) { htmlClasses.add(c); },
        remove: function (c) { htmlClasses.delete(c); },
        contains: function (c) { return htmlClasses.has(c); },
        toggle: function (c, force) {
          if (force === true) htmlClasses.add(c);
          else if (force === false) htmlClasses.delete(c);
          else if (htmlClasses.has(c)) htmlClasses.delete(c);
          else htmlClasses.add(c);
        },
      },
    },
  };
  assert.strictEqual(ui.isBusy(), false);
  let resolveA;
  let resolveB;
  const a = ui.withBusy(new Promise(function (resolve) { resolveA = resolve; }), "one");
  assert.strictEqual(ui.isBusy(), true);
  assert.ok(htmlClasses.has("tkr-busy"));
  assert.strictEqual(nodes.app.getAttribute("aria-busy"), "true");
  assert.strictEqual(nodes["scratchpost-busy"].hasAttribute("hidden"), false);
  assert.ok(nodes["wallet-value-card"].classList.contains("tkr-busy-pulse"));
  assert.strictEqual(nodes["swap-quote"].disabled, true);
  const b = ui.withBusy(new Promise(function (resolve) { resolveB = resolve; }), "two");
  resolveA(1);
  return a.then(function () {
    assert.strictEqual(ui.isBusy(), true, "second wait still in flight");
    assert.strictEqual(nodes["swap-quote"].disabled, true);
    resolveB(2);
    return b;
  }).then(function () {
    assert.strictEqual(ui.isBusy(), false);
    assert.strictEqual(htmlClasses.has("tkr-busy"), false);
    assert.strictEqual(nodes.app.hasAttribute("aria-busy"), false);
    assert.strictEqual(nodes["scratchpost-busy"].hasAttribute("hidden"), true);
    assert.strictEqual(nodes["swap-quote"].disabled, false);
  }).then(function () {
    return ui.withBusy(Promise.reject(new Error("nope")), "fail").then(
      function () { throw new Error("withBusy must rethrow"); },
      function () {
        assert.strictEqual(ui.isBusy(), false, "a rejected wait still clears busy");
      }
    );
  }).finally(function () {
    global.document = prev;
  });
});

test("every element ui.js reaches for actually exists in index.html", function () {
  // A typo here is invisible in unit tests and shows up as a blank field in the
  // browser (it shipped once: the detail screen wrote the symbol into an id that
  // did not exist, so the heading rendered empty).
  const ui = readFile("ui.js");
  const html = readFile("index.html");
  const ids = Array.from(new Set(Array.from(ui.matchAll(/\bel\("([^"]+)"\)/g)).map(function (m) { return m[1]; })));
  assert.ok(ids.length > 20, "expected the shell to reach for many ids, found " + ids.length);
  const missing = ids.filter(function (id) {
    return html.indexOf('id="' + id + '"') === -1;
  });
  assert.deepStrictEqual(missing, [], "ui.js references ids that index.html does not define");
});

run();
