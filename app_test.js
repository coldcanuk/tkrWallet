const assert = require("assert");
const wallet = require("./app.js");

assert.strictEqual(wallet.SWAP_URL, "https://tkrswap.com/");
assert.ok(wallet.GAME_URL.indexOf("/api/public/game") !== -1);
assert.ok(wallet.GAME_URL.indexOf("tkrpik.com") !== -1);

const src = require("fs").readFileSync(__filename.replace("app_test.js", "app.js"), "utf8");
assert.ok(src.indexOf("/api/quote") === -1, "wallet must not embed a second quote client");
assert.ok(src.indexOf("tkrswap.com") !== -1);

const applied = wallet.applyGame({
  source: "tkrpik",
  beaver_nickels: 9,
  index_cards: [{ id: 1, name: "S&P500", performance: 5, beaver_nickels: 9 }],
  scoreboard: [{ rank: 1, index_name: "S&P500", performance: 5 }],
});
assert.strictEqual(applied.beaver_nickels, 9);
assert.strictEqual(applied.index_cards[0].name, "S&P500");
console.log("ok");
