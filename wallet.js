/* tkrWallet — data layer.
 *
 * This is the ONLY file that makes network calls: fetch to the wallet edge for
 * prices. The single origin is BASE_URL; the test suite greps every shipped
 * file and fails on any other origin.
 *
 * Hard rules carried from the audits:
 *   - unknown != zero. Every read failure yields { state: "unknown" }, and no
 *     code path converts a failure into a 0 balance.
 *   - no auto-execution. This layer reads; it never sends a transaction.
 *   - no vendor strings. The wallet learns nothing about the backend.
 */
(function (root) {
  "use strict";

  var BASE_URL = "https://tkrwallet.scratchpost.ai";

  /* Chain catalogue. Solana is catalogued-not-queried: there is no balance
   * source until the edge provides reads (D10), so it has no TOKENS entry and
   * produces no RPC calls. */
  var CHAINS = {
    1: { name: "Ethereum", native: "ETH" },
    8453: { name: "Base", native: "ETH" },
    4663: { name: "Robinhood", native: "ETH" },
    900001: { name: "Solana", native: "SOL" },
  };

  var TOKENS = {
    1: [
      { symbol: "ETH" },
      { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    ],
    8453: [
      { symbol: "ETH" },
      { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      { symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
    ],
    4663: [{ symbol: "ETH" }],
  };

  /* Local colour table. Never a wire-supplied colour (audit W8/S-7). */
  var TOKEN_COLORS = {
    ETH: "#a8a29e",
    WETH: "#a8a29e",
    USDC: "#4d9de0",
    USDT: "#26a17b",
    SOL: "#e8a33d",
  };

  /* Preview mode (?preview=1): the operator's mockup numbers, clearly labelled
   * in the UI. Never used unless the query flag is present; production paths
   * never read these. */
  var PREVIEW_HOLDINGS = [
    row("SOL", 900001, 0.12345, null, 9),
    row("ETH", 1, 0.12345, null, 18),
    row("ETH", 8453, 0.34567, null, 18),
    row("ETH", 4663, 0.45678, null, 18),
  ];
  var PREVIEW_PRICES = {
    state: "ok",
    prices: {
      "900001:native": { usd: 145.2, cad: 199.65 },
      "1:native": { usd: 3120.55, cad: 4291.2 },
      "8453:native": { usd: 3120.55, cad: 4291.2 },
      "4663:native": { usd: 0.42, cad: 0.58 },
    },
  };

  function chainName(chainId) {
    var c = CHAINS[chainId];
    return c ? c.name : "Chain " + chainId;
  }

  function colorFor(symbol) {
    return TOKEN_COLORS[symbol] || "#cfc8b8";
  }

  function row(symbol, chainId, amount, address, decimals) {
    return {
      symbol: symbol,
      address: address || null,
      chain_id: chainId,
      chain_name: chainName(chainId),
      amount: amount,
      decimals: decimals || 18,
      color: colorFor(symbol),
      state: amount === null ? "unknown" : "ok",
    };
  }

  function assetKey(holding) {
    return holding.chain_id + ":" + (holding.address || "native");
  }

  /* Prices from the edge. assets is an array of "chain:address" strings with
   * "native" for gas tokens. Network/parse failure -> { state: "unknown" }.
   * Assets the response omits are unpriced, never zero. */
  function getPrices(assets, currencies, fetchFn) {
    fetchFn = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!fetchFn) {
      return Promise.resolve({ state: "unknown" });
    }
    var vs = (currencies && currencies.length ? currencies : ["usd"]).join(",");
    var q = "assets=" + encodeURIComponent(assets.join(",")) + "&vs=" + encodeURIComponent(vs);
    return fetchFn(BASE_URL + "/api/wallet/prices?" + q)
      .then(function (res) {
        if (!res.ok) {
          throw new Error("HTTP " + res.status);
        }
        return res.json();
      })
      .then(function (body) {
        if (!body || typeof body !== "object" || !body.prices) {
          return { state: "unknown" };
        }
        return { state: "ok", prices: body.prices, as_of: body.as_of || null };
      })
      .catch(function () {
        return { state: "unknown" };
      });
  }

  /* { state: "ok", value, priced, total } | { state: "unknown" }.
   * priced < total means some holdings were unpriced — the UI says so rather
   * than presenting an understated total as the truth. */
  function estimateValue(holdings, prices, currency) {
    holdings = holdings || [];
    currency = currency || "usd";
    if (!prices || prices.state !== "ok") {
      return { state: "unknown" };
    }
    var priced = 0;
    var total = 0;
    var value = 0;
    holdings.forEach(function (h) {
      if (h.state !== "ok" || h.amount === null) {
        return; // unknown balances are excluded and disclosed, never guessed
      }
      total++;
      var entry = prices.prices[assetKey(h)];
      if (!entry || typeof entry[currency] !== "number" || !Number.isFinite(entry[currency])) {
        return; // unpriced — disclosed, never treated as zero
      }
      priced++;
      value += h.amount * entry[currency];
    });
    return { state: "ok", value: value, priced: priced, total: total };
  }

  /* Search the built-in catalogue for tokens, filtered by symbol or address —
   * the same matching a server-side catalogue would do, applied to the list we
   * already hold. Pure and offline: no network call.
   *
   * Scope is Mainnet + Base only, per product direction. Chain-wide search
   * (every Mainnet/Base token, not just this curated set) needs the edge
   * catalogue endpoint, because "which tokens exist" is an index question, not
   * a chain-state question. See docs/specs/edge-server.md. */
  var SEARCHABLE_CHAINS = { 1: true, 8453: true };

  function searchCatalog(query, limit) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) {
      return [];
    }
    var max = limit || 20;
    var out = [];
    Object.keys(TOKENS).forEach(function (chainKey) {
      var chainId = Number(chainKey);
      if (!SEARCHABLE_CHAINS[chainId]) {
        return; // Mainnet + Base only
      }
      TOKENS[chainKey].forEach(function (tok) {
        var bySymbol = tok.symbol.toLowerCase().indexOf(q) !== -1;
        var byAddress = !!tok.address && tok.address.toLowerCase().indexOf(q) !== -1;
        if (bySymbol || byAddress) {
          out.push({
            symbol: tok.symbol,
            address: tok.address || null,
            chain_id: chainId,
            chain_name: chainName(chainId),
            decimals: tok.decimals || 18,
            color: colorFor(tok.symbol),
          });
        }
      });
    });
    return out.slice(0, max);
  }

  var api = {
    BASE_URL: BASE_URL,
    CHAINS: CHAINS,
    TOKENS: TOKENS,
    TOKEN_COLORS: TOKEN_COLORS,
    chainName: chainName,
    colorFor: colorFor,
    assetKey: assetKey,
    getPrices: getPrices,
    estimateValue: estimateValue,
    searchCatalog: searchCatalog,
    PREVIEW_HOLDINGS: PREVIEW_HOLDINGS,
    PREVIEW_PRICES: PREVIEW_PRICES,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.tkrWalletData = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
