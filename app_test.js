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
const SHIPPED = ["index.html", "ui.js", "wallet.js", "sw.js", "manifest.json", "manifest.webmanifest", "README.md"];

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
  assert.ok(sw.indexOf("fetch(event.request)") !== -1, "missing network fetch");
  assert.ok(sw.indexOf("caches.match(event.request)") !== -1, "missing cache fallback");
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
  assert.ok(src.indexOf("connectWallet") !== -1, "missing connectWallet entry point");
});

/* ── wallet.js: the data layer ──────────────────────────────────────────── */

function fakeProvider(opts) {
  opts = opts || {};
  return {
    request: function (args) {
      if (args.method === "eth_requestAccounts") {
        return Promise.resolve(["0x2222222222222222222222222222222222222222"]);
      }
      if (args.method === "eth_chainId") {
        return Promise.resolve("0x1");
      }
      if (args.method === "eth_getBalance") {
        if (opts.failBalance) {
          return Promise.reject(new Error("rpc down"));
        }
        return Promise.resolve("0xde0b6b3a7640000"); // 1 ETH
      }
      if (args.method === "eth_call") {
        if (opts.failCall) {
          return Promise.reject(new Error("rpc down"));
        }
        const target = String(((args.params || [])[0] || {}).to || "").toLowerCase();
        const data = ((args.params || [])[0] || {}).data || "";
        // Only the USDC contract holds a balance in the fixture; the rest are 0.
        if (data.indexOf("0x70a08231") === 0 && target === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") {
          return Promise.resolve("0xf4240"); // 1 USDC
        }
        return Promise.resolve("0x0");
      }
      return Promise.reject(new Error("unexpected " + args.method));
    },
  };
}

test("wallet.js declares the single origin and a chain catalogue", function () {
  const wallet = require("./wallet.js");
  assert.strictEqual(wallet.BASE_URL, ALLOWED_ORIGIN);
  // Integer-like object keys enumerate in numeric order regardless of insertion.
  assert.deepStrictEqual(
    Object.keys(wallet.CHAINS).sort((a, b) => a - b),
    ["1", "4663", "8453", "900001"]
  );
});

test("connect() returns the account and parsed chain id", function () {
  const wallet = require("./wallet.js");
  return wallet.connect(fakeProvider()).then(function (account) {
    assert.strictEqual(account.address, "0x2222222222222222222222222222222222222222");
    assert.strictEqual(account.chain_id, 1);
  });
});

test("connect() rejects without a provider", function () {
  const wallet = require("./wallet.js");
  return wallet.connect(null).then(
    function () {
      throw new Error("should have rejected");
    },
    function (e) {
      assert.ok(/provider/.test(e.message), e.message);
    }
  );
});

test("listHoldings() reads native and ERC-20 balances", function () {
  const wallet = require("./wallet.js");
  return wallet.listHoldings(fakeProvider(), "0x2222222222222222222222222222222222222222", 1).then(function (rows) {
    const eth = rows.filter((r) => r.symbol === "ETH")[0];
    const usdc = rows.filter((r) => r.symbol === "USDC")[0];
    assert.strictEqual(eth.state, "ok");
    assert.ok(Math.abs(eth.amount - 1) < 1e-9, "1 ETH");
    assert.strictEqual(eth.chain_name, "Ethereum");
    assert.strictEqual(usdc.state, "ok");
    assert.ok(Math.abs(usdc.amount - 1) < 1e-9, "1 USDC");
    assert.ok(!rows.some((r) => r.symbol === "WETH" || r.symbol === "USDT"), "zero balances are filtered");
  });
});

test("listHoldings() failures are unknown, never zero", function () {
  const wallet = require("./wallet.js");
  return wallet
    .listHoldings(fakeProvider({ failBalance: true, failCall: true }), "0x2222222222222222222222222222222222222222", 1)
    .then(function (rows) {
      assert.ok(rows.length >= 2, "unknown rows must still be listed");
      rows.forEach(function (r) {
        assert.strictEqual(r.state, "unknown", r.symbol + " must be unknown");
        assert.strictEqual(r.amount, null, r.symbol + " amount must be null, not 0");
      });
    });
});

test("listHoldings() degrades unsupported chains to native-only", function () {
  const wallet = require("./wallet.js");
  return wallet.listHoldings(fakeProvider(), "0x2222222222222222222222222222222222222222", 137).then(function (rows) {
    assert.strictEqual(rows.length, 1, "native-only on an uncatalogued chain");
    assert.strictEqual(rows[0].symbol, "ETH");
    assert.strictEqual(rows[0].chain_id, 137);
    assert.ok(rows[0].address === null, "native has no contract address");
  });
});

test("hexToAmount() returns null on malformed input, never 0", function () {
  const wallet = require("./wallet.js");
  assert.strictEqual(wallet.hexToAmount("0x", 6), null);
  assert.strictEqual(wallet.hexToAmount("garbage", 18), null);
  assert.ok(Math.abs(wallet.hexToAmount("0xf4240", 6) - 1) < 1e-9);
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

run();
