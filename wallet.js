/* tkrWallet — data layer.
 *
 * This is the ONLY file that makes network calls: fetch to the wallet edge for
 * balances and prices. The single origin is BASE_URL; the test suite greps
 * every shipped file and fails on any other origin.
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

  /* The API base for a path.
   *
   * The PWA is served FROM the edge, so API calls are relative ("/api/…"):
   * same origin, no CORS, and the single-origin CSP holds in local dev too
   * (the dev edge serves app + API from one origin). Extension pages have
   * origin chrome-extension://, so they call the edge origin explicitly —
   * the extension CSP allow-lists exactly that origin. */
  function apiUrl(path) {
    var isExtension =
      typeof location !== "undefined" &&
      String(location.protocol || "").indexOf("chrome-extension") === 0;
    return isExtension ? BASE_URL + path : path;
  }

  function tokenIconUrl(chainId, address) {
    if (!address) {
      return null;
    }
    return apiUrl(
      "/api/wallet/token-icon?chain=" +
        encodeURIComponent(String(chainId)) +
        "&address=" +
        encodeURIComponent(String(address))
    );
  }

  /* Chain catalogue. Solana native + SPL catalogue is queried through the
   * wallet edge. The client never dials a Solana RPC. */
  var CHAINS = {
    1: { name: "Ethereum", native: "ETH" },
    8453: { name: "Base", native: "ETH" },
    4663: { name: "Robinhood", native: "ETH" },
    900001: { name: "Solana", native: "SOL" },
    728126428: { name: "TRON", native: "TRX" },
  };

  /* Built-in catalogue: search + swap presets. Holdings are discovered by
   * Scratchpost (what you actually hold), not this list. Robinhood ETH/WETH/USDG
   * stay here for same-chain swaps. Every address below is a well-known contract. */
  var TOKENS = {
    1: [
      { symbol: "ETH", name: "Ether" },
      { symbol: "WETH", name: "Wrapped Ether", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
      { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      { symbol: "USDT", name: "Tether USD", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      { symbol: "DAI", name: "Dai", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
      { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
      { symbol: "LINK", name: "Chainlink", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
      { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
      { symbol: "AAVE", name: "Aave", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18 },
      { symbol: "SHIB", name: "Shiba Inu", address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", decimals: 18 },
      { symbol: "PEPE", name: "Pepe", address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18 },
      { symbol: "ARB", name: "Arbitrum", address: "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1", decimals: 18 },
      { symbol: "MATIC", name: "Polygon", address: "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0", decimals: 18 },
      { symbol: "CRV", name: "Curve DAO", address: "0xD533a949740bb3306d119CC777fa900bA034cd52", decimals: 18 },
      { symbol: "MKR", name: "Maker", address: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2", decimals: 18 },
      { symbol: "LDO", name: "Lido DAO", address: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32", decimals: 18 },
      { symbol: "GRT", name: "The Graph", address: "0xc944E90C64B2c07662A292be6244BDf05Cda44a7", decimals: 18 },
      { symbol: "SNX", name: "Synthetix", address: "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F", decimals: 18 },
      { symbol: "COMP", name: "Compound", address: "0xc00e94Cb662C3520282E6f5717214004A7f26888", decimals: 18 },
      { symbol: "ENS", name: "Ethereum Name Service", address: "0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72", decimals: 18 },
      { symbol: "APE", name: "ApeCoin", address: "0x4d224452801ACEd8B2F0aebE155379bb5D594381", decimals: 18 },
      { symbol: "INJ", name: "Injective", address: "0xe28b3B32B6c345A34Ff64674606124Dd5Aceca30", decimals: 18 },
      { symbol: "RNDR", name: "Render", address: "0x6De037ef9aD2725EB40118Bb1702EBb27e4Aeb24", decimals: 18 },
    ],
    8453: [
      { symbol: "ETH", name: "Ether" },
      { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      { symbol: "USDT", name: "Tether USD", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
      { symbol: "DAI", name: "Dai", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
      { symbol: "cbBTC", name: "Coinbase Wrapped Bitcoin", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
      { symbol: "AERO", name: "Aerodrome Finance", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
      { symbol: "BRETT", name: "Brett", address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", decimals: 18 },
      { symbol: "DEGEN", name: "Degen", address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", decimals: 18 },
      { symbol: "WELL", name: "Moonwell", address: "0xA88594D404727625A9437C3f886C7643872296AE", decimals: 18 },
      { symbol: "VIRTUAL", name: "Virtuals Protocol", address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", decimals: 18 },
      { symbol: "USDbC", name: "USDC (Bridged)", address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
      { symbol: "cbETH", name: "Coinbase Wrapped Staked ETH", address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18 },
      { symbol: "wstETH", name: "Wrapped liquid staked Ether", address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", decimals: 18 },
    ],
    4663: [
      { symbol: "ETH", name: "Ether" },
      { symbol: "WETH", name: "Wrapped Ether", address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", decimals: 18 },
      { symbol: "USDG", name: "Global Dollar", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
    ],
    900001: [
      { symbol: "SOL", name: "Solana", decimals: 9 },
      { symbol: "USDC", name: "USD Coin", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
      { symbol: "USDT", name: "Tether USD", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
    ],
    728126428: [
      { symbol: "TRX", name: "TRON", decimals: 6 },
      { symbol: "USDT", name: "Tether USD", address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6 },
    ],
  };

  /* Local colour table. Never a wire-supplied colour (audit W8/S-7). */
  var TOKEN_COLORS = {
    ETH: "#a8a29e",
    WETH: "#a8a29e",
    USDC: "#4d9de0",
    USDG: "#4d9de0",
    USDT: "#26a17b",
    DAI: "#f5ac37",
    WBTC: "#f7931a",
    LINK: "#2a5ada",
    UNI: "#ff007a",
    AAVE: "#b6509e",
    SHIB: "#ffa409",
    PEPE: "#3d9e2f",
    ARB: "#28a0f0",
    OP: "#ff0420",
    MATIC: "#8247e5",
    CRV: "#00c2a8",
    MKR: "#1aab9b",
    LDO: "#00a3ff",
    GRT: "#6747ed",
    SNX: "#00d1ff",
    COMP: "#00d395",
    ENS: "#5298ff",
    APE: "#054dcd",
    INJ: "#00f3ff",
    RNDR: "#e9448a",
    cbBTC: "#0052ff",
    AERO: "#20b9e8",
    BRETT: "#74a0ff",
    DEGEN: "#a36efd",
    WELL: "#9c3cff",
    VIRTUAL: "#1b49f1",
    USDbC: "#4d9de0",
    cbETH: "#0052ff",
    wstETH: "#00a3ff",
    SOL: "#e8a33d",
    TRX: "#eb0029",
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
    return fetchFn(apiUrl("/api/wallet/prices?" + q))
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

  /* Balances from the edge (contract: docs/specs/edge-server.md §3.3).
   * amount strings are converted to numbers; assets the response omits are
   * simply absent (the user's real holdings are what the edge returns).
   *
   * The result distinguishes three outcomes, because "we could not check" and
   * "you own nothing" are different claims and this wallet must never confuse
   * them:
   *   { state: "ok",      balances: [...], chains: [...] }  every chain read
   *   { state: "partial", balances: [...], chains: [...] }  some chains failed
   *   { state: "unknown", reason: "…" }                     none readable
   * Only `ok` with an empty array may be rendered as "you hold none".
   *
   * `extraTokens` are user-added "chain:address" strings, read in addition to
   * discovered holdings and the built-in catalogue. */
  function requestNonce(fetchFn) {
    fetchFn = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!fetchFn) {
      return Promise.resolve({ ok: false, error: "no-fetch" });
    }
    return fetchFn(apiUrl("/api/wallet/nonce"), {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json" },
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          return { ok: false, error: (body && body.error) || "nonce-failed" };
        }
        return body;
      });
    });
  }

  function listPendingSigns(fetchFn) {
    fetchFn = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!fetchFn) {
      return Promise.resolve({ ok: false, requests: [], error: "no-fetch" });
    }
    return fetchFn(apiUrl("/api/wallet/pending-signs"), {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          return { ok: false, requests: [], error: (body && body.error) || "pending-failed" };
        }
        return { ok: true, requests: (body && body.requests) || [] };
      });
    });
  }

  function broadcastRaw(payload, fetchFn) {
    fetchFn = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!fetchFn) {
      return Promise.resolve({ ok: false, error: "no-fetch" });
    }
    return fetchFn(apiUrl("/api/wallet/broadcast"), {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          return { ok: false, error: (body && body.error) || "broadcast-failed" };
        }
        return body;
      });
    });
  }

  function openSession(payload, fetchFn) {
    fetchFn = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!fetchFn) {
      return Promise.resolve({ ok: false, error: "no-fetch" });
    }
    return fetchFn(apiUrl("/api/wallet/session"), {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          return { ok: false, error: (body && body.error) || "session-failed" };
        }
        return body;
      });
    });
  }

  /* Clear the Scratchpost edge session cookie (docs/specs/edge-server.md §3.1).
   * Distinct from Lock: vault stays on device; only the HttpOnly session ends. */
  function closeSession(fetchFn) {
    fetchFn = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!fetchFn) {
      return Promise.resolve({ ok: false, error: "no-fetch" });
    }
    return fetchFn(apiUrl("/api/wallet/logout"), {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json" },
    }).then(function (res) {
      if (res.status === 204 || res.ok) {
        return { ok: true };
      }
      return res
        .json()
        .then(function (body) {
          return { ok: false, error: (body && body.error) || "logout-failed" };
        })
        .catch(function () {
          return { ok: false, error: "logout-failed" };
        });
    });
  }

  function getBalances(address, chainIds, fetchFn, extraTokens) {
    fetchFn = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!fetchFn) {
      return Promise.resolve({ state: "unknown", reason: "no-fetch" });
    }
    var chains = (chainIds && chainIds.length ? chainIds : [1, 8453, 4663]).join(",");
    var q = "address=" + encodeURIComponent(String(address || "")) + "&chains=" + encodeURIComponent(chains);
    if (extraTokens && extraTokens.length) {
      q += "&tokens=" + encodeURIComponent(extraTokens.join(","));
    }
    return fetchFn(apiUrl("/api/wallet/balances?" + q))
      .then(function (res) {
        return Promise.resolve(res.json()).then(
          function (body) {
            return { ok: res.ok, status: res.status, body: body };
          },
          function () {
            return { ok: res.ok, status: res.status, body: null };
          }
        );
      })
      .then(function (got) {
        var body = got.body;
        if (!got.ok && !(body && typeof body === "object" && Array.isArray(body.balances))) {
          var err = new Error("HTTP " + got.status);
          err.name = "EdgeHttpError";
          throw err;
        }
        if (!body || typeof body !== "object" || !Array.isArray(body.balances)) {
          return { state: "unknown", reason: "bad-response" };
        }
        var rows = body.balances.map(function (b) {
          var amount = typeof b.amount === "string" ? Number(b.amount) : b.amount;
          return row(b.symbol, b.chain_id, Number.isFinite(amount) ? amount : null, b.address || null, b.decimals || 18);
        });
        var reported = Array.isArray(body.chains) ? body.chains : null;
        if (!reported) {
          // The edge did not say which chains it read. An empty list here cannot
          // honestly be shown as "you own nothing", so it is a partial result.
          return { state: "partial", balances: rows, chains: null, reason: "edge-no-read-status" };
        }
        var problems = reported.filter(function (c) {
          return !c || c.state !== "ok";
        });
        if (!problems.length) {
          return { state: "ok", balances: rows, chains: reported, as_of: body.as_of || null };
        }
        var readable = reported.some(function (c) {
          return c && c.state !== "unknown";
        });
        if (rows.length || readable) {
          return {
            state: "partial",
            balances: rows,
            chains: reported,
            reason: "some-chains-failed",
            as_of: body.as_of || null,
          };
        }
        return { state: "unknown", balances: rows, chains: reported, reason: "all-chains-failed" };
      })
      .catch(function (err) {
        var detail = err && err.message ? String(err.message) : "fetch-failed";
        if (err && err.name === "EdgeHttpError") {
          return { state: "unknown", reason: "edge-http", detail: detail };
        }
        return { state: "unknown", reason: "edge-unreachable", detail: detail };
      });
  }

  /* Metadata for an arbitrary ERC-20 the user added by address — the edge reads
   * symbol()/decimals() so the client never ships a table of every token.
   * { state: "ok", token } | { state: "unknown", reason }. */
  function getTokenMeta(chainId, address, fetchFn) {
    fetchFn = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!fetchFn) {
      return Promise.resolve({ state: "unknown", reason: "no-fetch" });
    }
    var q = "chain=" + encodeURIComponent(String(chainId)) + "&address=" + encodeURIComponent(String(address || ""));
    return fetchFn(apiUrl("/api/wallet/token?" + q))
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (r) {
        if (!r.ok || !r.body || !r.body.token) {
          return { state: "unknown", reason: (r.body && r.body.error) || "HTTP " + r.status };
        }
        var t = r.body.token;
        return {
          state: "ok",
          token: {
            symbol: t.symbol,
            name: t.name || t.symbol,
            address: t.address,
            chain_id: t.chain_id,
            decimals: typeof t.decimals === "number" ? t.decimals : 18,
            color: colorFor(t.symbol),
          },
        };
      })
      .catch(function () {
        return { state: "unknown", reason: "edge-unreachable" };
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

  /** Home list vs airdrops. Native, catalogue, user-added, and priced tokens
   * stay on the desk. Unpriced discovered contracts wait behind Airdrops so
   * spam does not crowd Ethereum/Base/Robinhood holdings. Until prices return,
   * nothing is hidden — a load must not look like a wipe. */
  function knownAssetKeys(extras) {
    var keys = Object.create(null);
    Object.keys(TOKENS).forEach(function (chainKey) {
      (TOKENS[chainKey] || []).forEach(function (t) {
        keys[Number(chainKey) + ":" + String(t.address || "native").toLowerCase()] = true;
      });
    });
    (extras || []).forEach(function (t) {
      if (!t || !t.address || !Number.isFinite(Number(t.chain_id))) {
        return;
      }
      keys[Number(t.chain_id) + ":" + String(t.address).toLowerCase()] = true;
    });
    return keys;
  }

  function holdingHasPrice(holding, prices, currency) {
    if (!prices || prices.state !== "ok" || !prices.prices) {
      return false;
    }
    var vs = currency || "usd";
    var entry = prices.prices[assetKey(holding)];
    if (!entry && holding.address) {
      entry = prices.prices[holding.chain_id + ":" + String(holding.address).toLowerCase()];
    }
    return Boolean(entry && typeof entry[vs] === "number" && Number.isFinite(entry[vs]));
  }

  function splitHoldings(holdings, prices, extras, currency) {
    var desk = [];
    var airdrops = [];
    var known = knownAssetKeys(extras);
    var pricesReady = Boolean(prices && prices.state === "ok");
    (holdings || []).forEach(function (h) {
      if (!h) {
        return;
      }
      var key = h.chain_id + ":" + String(h.address || "native").toLowerCase();
      var pinned = !h.address || known[key];
      if (pinned || holdingHasPrice(h, prices, currency) || !pricesReady) {
        desk.push(h);
      } else {
        airdrops.push(h);
      }
    });
    return { desk: desk, airdrops: airdrops };
  }

  var TOKEN_LIST_CHAINS = [1, 8453];

  function holdingKey(holding) {
    return Number(holding.chain_id) + ":" + String(holding.address || "native").toLowerCase();
  }

  function chainReadOk(chains, chainId) {
    if (!Array.isArray(chains)) {
      return false;
    }
    for (var i = 0; i < chains.length; i++) {
      if (chains[i] && Number(chains[i].chain_id) === Number(chainId) && chains[i].state === "ok") {
        return true;
      }
    }
    return false;
  }

  /** Mine: crypto actually held. Unknown is not zero; 0 is not held. */
  function mineHoldings(desk) {
    return (desk || []).filter(function (h) {
      return h && h.state === "ok" && typeof h.amount === "number" && Number.isFinite(h.amount) && h.amount > 0;
    });
  }

  /**
   * Tokens tab: Ethereum + Base catalogue (plus extras / held rows on those
   * chains). Edge omits zeros; fill 0 only when that chain read is `ok`.
   * Sort verified zeros first.
   */
  function tokenListRows(holdings, chains, extras) {
    var index = Object.create(null);
    (holdings || []).forEach(function (h) {
      if (!h) {
        return;
      }
      var cid = Number(h.chain_id);
      if (cid !== 1 && cid !== 8453) {
        return;
      }
      index[holdingKey(h)] = h;
    });
    var out = [];
    var seen = Object.create(null);
    function take(h) {
      var k = holdingKey(h);
      if (seen[k]) {
        return;
      }
      seen[k] = true;
      out.push(h);
    }
    function absentAmount(chainId) {
      return chainReadOk(chains, chainId) ? 0 : null;
    }
    TOKEN_LIST_CHAINS.forEach(function (chainId) {
      (TOKENS[chainId] || []).forEach(function (t) {
        var key = holdingKey({ chain_id: chainId, address: t.address || null });
        if (index[key]) {
          take(index[key]);
          return;
        }
        take(row(t.symbol, chainId, absentAmount(chainId), t.address || null, t.decimals || 18));
      });
    });
    (extras || []).forEach(function (t) {
      if (!t || !t.address) {
        return;
      }
      var cid = Number(t.chain_id);
      if (cid !== 1 && cid !== 8453) {
        return;
      }
      var key = holdingKey({ chain_id: cid, address: t.address });
      if (index[key]) {
        take(index[key]);
        return;
      }
      take(row(t.symbol || "Token", cid, absentAmount(cid), t.address, t.decimals || 18));
    });
    Object.keys(index).forEach(function (k) {
      take(index[k]);
    });
    out.sort(function (a, b) {
      function rank(h) {
        if (h && h.state === "ok" && h.amount === 0) {
          return 0;
        }
        if (!h || h.state !== "ok" || h.amount === null) {
          return 1;
        }
        return 2;
      }
      var ra = rank(a);
      var rb = rank(b);
      if (ra !== rb) {
        return ra - rb;
      }
      var as = String(a.symbol || "");
      var bs = String(b.symbol || "");
      if (as !== bs) {
        return as < bs ? -1 : 1;
      }
      return Number(a.chain_id) - Number(b.chain_id);
    });
    return out;
  }

  /* Search the built-in catalogue by symbol, name or address — the same
   * matching a server-side catalogue would do, applied to the list we already
   * hold. Pure and offline: no network call.
   *
   * Scope is Mainnet + Base only, per product direction. Chain-wide search
   * (every Mainnet/Base token, not just this curated set) needs the edge
   * catalogue endpoint, because "which tokens exist" is an index question, not
   * a chain-state question. See docs/specs/edge-server.md. */
  var SEARCHABLE_CHAINS = { 1: true, 8453: true };

  function searchCatalog(query, limit, extras) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) {
      return [];
    }
    var max = limit || 20;
    var out = [];
    var seen = Object.create(null);

    function matches(tok) {
      return (
        String(tok.symbol || "").toLowerCase().indexOf(q) !== -1 ||
        (!!tok.name && String(tok.name).toLowerCase().indexOf(q) !== -1) ||
        (!!tok.address && String(tok.address).toLowerCase().indexOf(q) !== -1)
      );
    }

    function push(tok, chainId) {
      var key = chainId + ":" + String(tok.address || "native").toLowerCase();
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      out.push({
        symbol: tok.symbol,
        name: tok.name || tok.symbol,
        address: tok.address || null,
        chain_id: chainId,
        chain_name: chainName(chainId),
        decimals: tok.decimals || 18,
        color: colorFor(tok.symbol),
        custom: !!tok.custom,
      });
    }

    // User-added tokens rank first: the user explicitly asked for them.
    (extras || []).forEach(function (tok) {
      var chainId = Number(tok.chain_id);
      if (SEARCHABLE_CHAINS[chainId] && matches(tok)) {
        push(tok, chainId);
      }
    });

    Object.keys(TOKENS).forEach(function (chainKey) {
      var chainId = Number(chainKey);
      if (!SEARCHABLE_CHAINS[chainId]) {
        return; // Mainnet + Base only
      }
      TOKENS[chainKey].forEach(function (tok) {
        if (matches(tok)) {
          push(tok, chainId);
        }
      });
    });
    return out.slice(0, max);
  }

  function mergeSearchRows(primary, extra, limit) {
    var max = limit || 20;
    var out = [];
    var seen = Object.create(null);
    function push(tok) {
      var chainId = Number(tok.chain_id);
      if (!SEARCHABLE_CHAINS[chainId]) {
        return;
      }
      var key = chainId + ":" + String(tok.address || "native").toLowerCase();
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      out.push({
        symbol: tok.symbol,
        name: tok.name || tok.symbol,
        address: tok.address || null,
        chain_id: chainId,
        chain_name: chainName(chainId),
        decimals: tok.decimals || 18,
        color: colorFor(tok.symbol),
        custom: !!tok.custom,
      });
    }
    (primary || []).forEach(push);
    (extra || []).forEach(push);
    return out.slice(0, max);
  }

  /** Edge catalog first (own L1/L2 index). Falls back to the built-in list. */
  function searchTokens(query, extras, fetchFn) {
    var extraList = Array.isArray(extras) ? extras : [];
    var local = searchCatalog(query, 20, extraList);
    fetchFn = fetchFn || (typeof fetch === "function" ? fetch : null);
    var q = String(query || "").trim();
    if (!q) {
      return Promise.resolve([]);
    }
    if (!fetchFn) {
      return Promise.resolve(local);
    }
    return fetchFn(apiUrl("/api/wallet/tokens/search?q=" + encodeURIComponent(q)))
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (r) {
        var remote = r.ok && r.body && Array.isArray(r.body.tokens) ? r.body.tokens : [];
        return mergeSearchRows(remote, local, 20);
      })
      .catch(function () {
        return local;
      });
  }

  function toAtomicAmount(human, decimals) {
    var s = String(human || "").trim();
    if (!/^\d+(\.\d+)?$/.test(s)) {
      return null;
    }
    var dec = Number(decimals);
    if (!Number.isInteger(dec) || dec < 0 || dec > 18) {
      return null;
    }
    var parts = s.split(".");
    var whole = parts[0];
    var frac = (parts[1] || "").slice(0, dec);
    while (frac.length < dec) {
      frac += "0";
    }
    var raw = (whole + frac).replace(/^0+/, "") || "0";
    if (raw === "0") {
      return null;
    }
    return raw;
  }

  function fromAtomicAmount(raw, decimals) {
    var s = String(raw || "").trim();
    if (!/^\d+$/.test(s)) {
      return null;
    }
    s = s.replace(/^0+(?=\d)/, "") || "0";
    var dec = Number(decimals);
    if (!Number.isInteger(dec) || dec < 0 || dec > 18) {
      return null;
    }
    if (s === "0") {
      return "0";
    }
    if (dec === 0) {
      return s;
    }
    while (s.length <= dec) {
      s = "0" + s;
    }
    var whole = s.slice(0, s.length - dec).replace(/^0+(?=\d)/, "") || "0";
    var frac = s.slice(s.length - dec).replace(/0+$/, "");
    return frac ? whole + "." + frac : whole;
  }

  function quoteSwap(payload, fetchFn) {
    fetchFn = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!fetchFn) {
      return Promise.resolve({ ok: false, error: "no-fetch" });
    }
    return fetchFn(apiUrl("/api/wallet/swap/quote"), {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          return { ok: false, error: (body && body.error) || "quote-failed" };
        }
        return body;
      });
    });
  }

  function buildSwap(payload, fetchFn) {
    fetchFn = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!fetchFn) {
      return Promise.resolve({ ok: false, error: "no-fetch" });
    }
    return fetchFn(apiUrl("/api/wallet/swap/build"), {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          return { ok: false, error: (body && body.error) || "build-failed" };
        }
        return body;
      });
    });
  }

  var api = {
    BASE_URL: BASE_URL,
    CHAINS: CHAINS,
    TOKENS: TOKENS,
    TOKEN_COLORS: TOKEN_COLORS,
    chainName: chainName,
    colorFor: colorFor,
    tokenIconUrl: tokenIconUrl,
    assetKey: assetKey,
    getPrices: getPrices,
    getBalances: getBalances,
    requestNonce: requestNonce,
    openSession: openSession,
    closeSession: closeSession,
    listPendingSigns: listPendingSigns,
    broadcastRaw: broadcastRaw,
    getTokenMeta: getTokenMeta,
    estimateValue: estimateValue,
    splitHoldings: splitHoldings,
    mineHoldings: mineHoldings,
    tokenListRows: tokenListRows,
    searchCatalog: searchCatalog,
    searchTokens: searchTokens,
    toAtomicAmount: toAtomicAmount,
    fromAtomicAmount: fromAtomicAmount,
    quoteSwap: quoteSwap,
    buildSwap: buildSwap,
    PREVIEW_HOLDINGS: PREVIEW_HOLDINGS,
    PREVIEW_PRICES: PREVIEW_PRICES,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.tkrWalletData = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
