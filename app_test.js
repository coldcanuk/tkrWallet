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
const SHIPPED = ["index.html", "ui.js", "wallet.js", "crypto.js", "store.js", "sw.js", "manifest.json", "manifest.webmanifest", "README.md"];
/* Browser-loaded artifacts only. README/CHANGELOG/deploy/tools are not this list. */
const CLIENT_SHIPPED = [
  "index.html",
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
  assert.deepStrictEqual(ui.SCREENS, ["home", "swap", "activity", "search", "settings", "detail"]);
  assert.strictEqual(typeof ui.renderTokens, "function");
  assert.strictEqual(typeof ui.setWalletValue, "function");
  assert.strictEqual(typeof ui.renderDetail, "function");
  assert.strictEqual(typeof ui.goToken, "function");
});

test("route parsing is strict and never throws", function () {
  const ui = require("./ui.js");
  assert.strictEqual(ui.parseRoute("#/swap"), "swap");
  assert.strictEqual(ui.parseRoute(""), "home");
  assert.strictEqual(ui.parseRoute("#/nope"), "home");
  assert.strictEqual(ui.parseRoute(null), "home");
  assert.strictEqual(ui.parseRoute("#/ACTIVITY?x=1"), "activity");
  assert.strictEqual(ui.parseRoute("#/settings"), "settings");
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
  assert.strictEqual(ui.parseCurrency("eur"), "usd");
  assert.strictEqual(ui.parseCurrency(null), "usd");
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
});

test("reload keeps the viewing session; lock and expiry do not; keys never land in it", function () {
  const ui = readFile("ui.js");
  assert.ok(ui.indexOf("tkrwallet.view-session") !== -1, "viewing session has a dedicated key");
  assert.ok(ui.indexOf("sessionStorage") !== -1, "reload must use sessionStorage, not a second IndexedDB vault");
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
  assert.ok(save[0].indexOf("sessionStorage") !== -1 && save[0].indexOf("localStorage") === -1, "tab-scoped, not durable across close");
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

test("shell structure: five screens, four nav entries, and a settings gear", function () {
  const html = readFile("index.html");
  assert.ok(html.indexOf('id="main"') !== -1, "missing main region");
  ["home", "swap", "activity", "search", "settings"].forEach(function (screen) {
    assert.ok(html.indexOf('data-screen="' + screen + '"') !== -1, "missing screen " + screen);
  });
  ["home", "swap", "activity", "search"].forEach(function (screen) {
    assert.ok(html.indexOf('data-nav="' + screen + '"') !== -1, "missing nav entry " + screen);
  });
  // Settings lives behind the header gear, not the bottom nav.
  assert.ok(html.indexOf('id="header-settings"') !== -1, "missing settings gear");
});

test("auto-lock settings: fixed options only, never off, longest is 1 hour", function () {
  const html = readFile("index.html");
  const options = Array.from(html.matchAll(/data-autolock="(\d+)"/g)).map((m) => Number(m[1]));
  assert.deepStrictEqual(options, [1, 5, 15, 30, 60], "exactly the five offered options");
  assert.ok(options.every((m) => m >= 1 && m <= 60), "no off option, nothing past an hour");
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
  assert.ok(html.indexOf("connect-src 'self'") !== -1, "connect-src must be 'self'");
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
  assert.ok(sw.indexOf('"tkrwallet-v7"') !== -1, "cache version must bump so the new worker activates");
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
    ["1", "4663", "8453", "900001"]
  );
});

test("getPrices() surfaces the edge contract and never invents a price", function () {
  const wallet = require("./wallet.js");
  return wallet
    .getPrices(["1:native", "1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"], ["usd", "cad"], function (url) {
      assert.ok(String(url).indexOf("/api/wallet/prices?assets=") === 0, url);
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
    assert.ok(got.reason, "an unknown carries the reason it is unknown");
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
  assert.ok(!wallet.searchCatalog("eth").some((r) => r.chain_id === 4663), "Robinhood must not appear in search");
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
  assert.ok(html.indexOf('data-add-account') !== -1, "settings must offer add-account for HD index i");
  const ui = require("./ui.js");
  assert.strictEqual(typeof ui.typedCreateConfirm, "function");
  assert.strictEqual(ui.CREATE_CONFIRM, "I saved my recovery phrase");
  assert.ok(ui.typedCreateConfirm("I saved my recovery phrase"));
  assert.ok(ui.typedCreateConfirm("  I saved my recovery phrase  "));
  assert.ok(!ui.typedCreateConfirm("ok"));
  assert.ok(!ui.typedCreateConfirm(""));
  assert.ok(!ui.typedCreateConfirm("i saved my recovery phrase"), "confirm is exact, not case-folded");
  const src = readFile("ui.js");
  ["onCreateStart", "onCreateConfirm", "wipeSecrets", "generateWallet", "onAddAccount"].forEach(function (fn) {
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
  ["id=\"holdings-scope\"", "id=\"add-token-btn\"", "id=\"add-token-form\"", "id=\"add-token-address\""].forEach(function (n) {
    assert.ok(html.indexOf(n) !== -1, "index.html must include " + n);
  });
  const ui = readFile("ui.js");
  assert.ok(ui.indexOf("holdingsScopeText") !== -1, "the scope of the list must be stated");
  assert.ok(ui.indexOf("getTokenMeta") !== -1, "adding a token must read its metadata from the edge");
  assert.ok(ui.indexOf("TOKENS_KEY") !== -1, "added tokens must persist");
  const wallet = readFile("wallet.js");
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
    /getBalances\(session\.address, \[1, 8453\]/.test(ui),
    "unlock must fetch Mainnet + Base balances"
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
      assert.ok(/^0x[0-9a-fA-F]{40}$/.test(t.address), "malformed address on chain " + chainId + ": " + t.address);
      assert.ok(!seen[t.address.toLowerCase()], "duplicate address on chain " + chainId + ": " + t.address);
      seen[t.address.toLowerCase()] = true;
      assert.ok(t.symbol && t.name, "every token needs a symbol and a name");
      assert.ok(Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 36, "bad decimals for " + t.symbol);
    });
  });
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
