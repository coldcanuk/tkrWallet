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
  assert.deepStrictEqual(ui.SCREENS, ["home", "swap", "activity", "search"]);
  assert.strictEqual(typeof ui.renderTokens, "function");
  assert.strictEqual(typeof ui.setWalletValue, "function");
});

test("route parsing is strict and never throws", function () {
  const ui = require("./ui.js");
  assert.strictEqual(ui.parseRoute("#/swap"), "swap");
  assert.strictEqual(ui.parseRoute(""), "home");
  assert.strictEqual(ui.parseRoute("#/nope"), "home");
  assert.strictEqual(ui.parseRoute(null), "home");
  assert.strictEqual(ui.parseRoute("#/ACTIVITY?x=1"), "activity");
});

test("currency parsing falls back to USD", function () {
  const ui = require("./ui.js");
  assert.strictEqual(ui.parseCurrency("CAD"), "cad");
  assert.strictEqual(ui.parseCurrency("eur"), "usd");
  assert.strictEqual(ui.parseCurrency(null), "usd");
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

test("shell structure: four screens and four nav entries", function () {
  const html = readFile("index.html");
  assert.ok(html.indexOf('id="main"') !== -1, "missing main region");
  ["home", "swap", "activity", "search"].forEach(function (screen) {
    assert.ok(html.indexOf('data-screen="' + screen + '"') !== -1, "missing screen " + screen);
    assert.ok(html.indexOf('data-nav="' + screen + '"') !== -1, "missing nav entry " + screen);
  });
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
  SHIPPED.forEach(function (file) {
    const src = readFile(file);
    let m;
    while ((m = re.exec(src)) !== null) {
      assert.strictEqual(m[0], ALLOWED_ORIGIN, file + " references a foreign origin: " + m[0]);
    }
  });
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
      assert.ok(String(url).indexOf(ALLOWED_ORIGIN + "/api/wallet/prices?assets=") === 0, url);
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

test("searchCatalog filters by symbol and address, offline", function () {
  const wallet = require("./wallet.js");
  assert.deepStrictEqual(wallet.searchCatalog(""), [], "an empty query returns nothing");
  const usdc = wallet.searchCatalog("usdc");
  assert.ok(usdc.length >= 2, "USDC exists on more than one chain");
  assert.ok(usdc.every((t) => t.symbol === "USDC"), "only USDC matches");
  const byAddr = wallet.searchCatalog("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.strictEqual(byAddr.length, 1, "address search finds exactly one token");
  assert.strictEqual(byAddr[0].chain_id, 8453, "and it is the Base entry");
  assert.strictEqual(byAddr[0].chain_name, "Base");
  assert.deepStrictEqual(wallet.searchCatalog("no-such-token"), []);
  assert.ok(wallet.searchCatalog("eth").length >= 1);
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
  ["gate-error", "gate-import-error"].forEach(function (id) {
    const m = html.match(new RegExp('<p id="' + id + '"[^>]*>'));
    assert.ok(m, "missing " + id);
    const tag = m[0];
    const cls = (tag.match(/class="([^"]*)"/) || [])[1] || "";
    assert.ok(!/\bhidden\b/.test(cls), id + " must not hide via the hidden class");
    assert.ok(/\shidden(\s|>)/.test(tag), id + " must carry the hidden attribute");
  });
});

test("shipped files still reference only the wallet origin", function () {
  // crypto.js + store.js are now in SHIPPED; confirm the scan covers them.
  assert.ok(SHIPPED.indexOf("crypto.js") !== -1 && SHIPPED.indexOf("store.js") !== -1);
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

run();
