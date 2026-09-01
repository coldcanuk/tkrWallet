const assert = require("assert");
const fs = require("fs");
const wallet = require("./app.js");

assert.strictEqual(wallet.SWAP_URL, "https://tkrswap.com/");
assert.ok(wallet.GAME_URL.indexOf("/api/public/game") !== -1);
assert.ok(wallet.GAME_URL.indexOf("tkrpik.com") !== -1);
assert.ok(wallet.LOGIN_URL.indexOf("/login") !== -1);
assert.strictEqual(typeof wallet.login, "function");
assert.strictEqual(typeof wallet.swapHref, "function");

const html = fs.readFileSync(__filename.replace("app_test.js", "index.html"), "utf8");
assert.ok(html.indexOf('id="wallet-login"') !== -1);
assert.ok(html.indexOf("Holdings") !== -1);
assert.ok(html.indexOf("You sign every fill") !== -1);
assert.ok(html.toLowerCase().indexOf("we never custody") === -1);

const src = fs.readFileSync(__filename.replace("app_test.js", "app.js"), "utf8");
assert.ok(src.indexOf("/api/quote") === -1, "wallet must not embed a second quote client");
assert.ok(src.indexOf("tkrswap.com") !== -1);
assert.ok(src.indexOf("take_profit") === -1);
assert.ok(src.indexOf("stop_loss") === -1);
assert.ok(src.indexOf("auto-execute") === -1);
assert.ok(src.indexOf("swapHref") !== -1);
assert.ok(src.indexOf("wallet-login") !== -1);

const href = wallet.swapHref({
  kind: "holding",
  symbol: "ETH",
  address: "0x1111111111111111111111111111111111111111",
  chain_id: 1,
});
assert.ok(href.indexOf("https://tkrswap.com/") === 0);
assert.ok(href.indexOf("token_in=") !== -1);
assert.ok(href.indexOf("token_in=ETH") !== -1);
assert.ok(href.indexOf("from_address=0x1111111111111111111111111111111111111111") !== -1);
assert.ok(href.indexOf("source_chain_id=1") !== -1);

const applied = wallet.applyGame({
  source: "tkrpik",
  beaver_nickels: 9,
  index_cards: [{ id: 1, name: "S&P500", performance: 5, beaver_nickels: 9 }],
  scoreboard: [{ rank: 1, index_name: "S&P500", performance: 5 }],
});
assert.strictEqual(applied.beaver_nickels, 9);
assert.strictEqual(applied.index_cards[0].name, "S&P500");

const fake = {
  request: function (args) {
    if (args.method === "eth_requestAccounts") {
      return Promise.resolve(["0x2222222222222222222222222222222222222222"]);
    }
    if (args.method === "eth_chainId") {
      return Promise.resolve("0x1");
    }
    if (args.method === "eth_getBalance") {
      return Promise.resolve("0xde0b6b3a7640000");
    }
    return Promise.reject(new Error("unexpected " + args.method));
  },
};

wallet.login(fake).then(function (holding) {
  assert.strictEqual(holding.kind, "holding");
  assert.strictEqual(holding.symbol, "ETH");
  assert.strictEqual(holding.address, "0x2222222222222222222222222222222222222222");
  assert.strictEqual(holding.chain_id, 1);
  assert.ok(Math.abs(holding.amount - 1) < 0.0001);
  const listed = wallet.applyHoldings([holding]);
  assert.strictEqual(listed[0].kind, "holding");
  console.log("ok");
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
