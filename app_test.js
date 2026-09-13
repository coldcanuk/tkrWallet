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
const SHIPPED = ["index.html", "ui.js", "sw.js", "manifest.json", "manifest.webmanifest"];

let failures = [];
let count = 0;

function test(name, fn) {
  count++;
  try {
    fn();
    console.log("ok   " + name);
  } catch (e) {
    failures.push("FAIL " + name + " — " + (e && e.message ? e.message : e));
    console.error("FAIL " + name + " — " + (e && e.message ? e.message : e));
  }
}

function end() {
  if (failures.length) {
    console.error("\n" + failures.length + " of " + count + " tests failed.");
    process.exit(1);
  }
  console.log("\n" + count + " tests, 0 failures");
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

test("service worker no longer precaches the deleted v1 app.js", function () {
  const sw = readFile("sw.js");
  assert.ok(sw.indexOf('"./app.js"') === -1, "sw.js still precaches app.js");
  assert.ok(sw.indexOf("./ui.js") !== -1, "sw.js must precache the shell");
});

end();
