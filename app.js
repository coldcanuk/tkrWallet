(function (root) {
  var GAME_URL = "https://tkrpik.com/api/public/game";
  var SWAP_URL = "https://tkrswap.com/";
  var LOGIN_URL = "https://tkrpik.com/login?next=tkrswap";
  var NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  var TOKEN_CATALOG = {
    1: [
      { symbol: "ETH", decimals: 18 },
      { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    ],
    8453: [
      { symbol: "ETH", decimals: 18 },
      { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      { symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
    ],
  };

  function balanceOfData(addr) {
    var hex = String(addr || "").toLowerCase().replace(/^0x/, "");
    while (hex.length < 64) {
      hex = "0" + hex;
    }
    return "0x70a08231" + hex;
  }

  function hexToAmount(hex, decimals) {
    try {
      var n = BigInt(hex || "0x0");
      var d = BigInt(10) ** BigInt(decimals || 18);
      return Number(n) / Number(d);
    } catch (e) {
      return 0;
    }
  }

  function listHoldings(provider, address, chainId) {
    var catalog = TOKEN_CATALOG[chainId] || TOKEN_CATALOG[1];
    return Promise.all(
      catalog.map(function (tok) {
        if (!tok.address) {
          return provider
            .request({ method: "eth_getBalance", params: [address, "latest"] })
            .then(function (wei) {
              return {
                kind: "holding",
                symbol: tok.symbol,
                token: NATIVE_ETH,
                chain_id: chainId,
                address: address,
                amount: weiToEth(wei),
              };
            })
            .catch(function () {
              return null;
            });
        }
        return provider
          .request({
            method: "eth_call",
            params: [{ to: tok.address, data: balanceOfData(address) }, "latest"],
          })
          .then(function (raw) {
            return {
              kind: "holding",
              symbol: tok.symbol,
              token: tok.address,
              chain_id: chainId,
              address: address,
              amount: hexToAmount(raw, tok.decimals),
            };
          })
          .catch(function () {
            return null;
          });
      })
    ).then(function (rows) {
      return rows.filter(function (row) {
        return row && Number(row.amount) > 0;
      });
    });
  }

  function el(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  function text(node, value) {
    if (node) {
      node.textContent = value;
    }
  }

  function weiToEth(wei) {
    try {
      return Number(BigInt(wei || "0x0")) / 1e18;
    } catch (e) {
      return 0;
    }
  }

  function normalizeMode(mode) {
    mode = String(mode || "").toLowerCase();
    if (mode === "split") {
      return "split";
    }
    return "consolidate";
  }

  function batchHref(cardId, mode) {
    var params = new URLSearchParams();
    params.set("batch_card", cardId || "");
    params.set("mode", normalizeMode(mode));
    var join = SWAP_URL.indexOf("?") >= 0 ? "&" : "?";
    return SWAP_URL + join + params.toString();
  }

  function applyBatchQuery(search) {
    var q;
    try {
      q = new URLSearchParams(search || (typeof window !== "undefined" ? window.location.search : ""));
    } catch (e) {
      return null;
    }
    var card = String(q.get("batch_card") || "").trim();
    if (!card) {
      return null;
    }
    var mode = normalizeMode(q.get("mode"));
    var box = el("batch-intent");
    text(
      box,
      "tkrSwap " +
        mode +
        " intent " +
        card +
        ". Quotes stay on tkrSwap. You sign every fill."
    );
    return { card_id: card, mode: mode };
  }

  function swapHref(holding) {
    holding = holding || {};
    var params = new URLSearchParams();
    
    params.set("token_in", holding.symbol || "ETH");
    if (holding.address) {
      params.set("from_address", holding.address);
    }
    params.set("source_chain_id", String(holding.chain_id || 1));
    var join = SWAP_URL.indexOf("?") >= 0 ? "&" : "?";
    return SWAP_URL + join + params.toString();
  }

  function renderCards(cards) {
    var box = el("index-cards");
    if (!box) {
      return;
    }
    box.textContent = "";
    if (!cards || !cards.length) {
      box.textContent = "No public locked index cards yet.";
      return;
    }
    cards.forEach(function (card) {
      var p = document.createElement("p");
      p.setAttribute("data-index-card", String(card.id || ""));
      p.textContent =
        (card.name || "Index") +
        " · " +
        Number(card.performance || 0).toFixed(2) +
        "% · Beaver Nickels " +
        String(card.beaver_nickels || 0);
      box.appendChild(p);
    });
  }

  function renderScoreboard(rows) {
    var box = el("scoreboard");
    if (!box) {
      return;
    }
    box.textContent = "";
    if (!rows || !rows.length) {
      box.textContent = "Scoreboard is empty.";
      return;
    }
    rows.forEach(function (row) {
      var p = document.createElement("p");
      p.setAttribute("data-scoreboard-rank", String(row.rank || ""));
      p.textContent =
        "#" +
        String(row.rank || "") +
        " " +
        (row.index_name || "") +
        " · " +
        Number(row.performance || 0).toFixed(2) +
        "%";
      box.appendChild(p);
    });
  }

  function renderBeaver(total) {
    text(
      el("beaver-nickels"),
      "Beaver Nickels on public locked cards: " +
        String(total || 0) +
        " (tkrpik 7-day ledger, up minus down). Sign in on tkrpik for your private total."
    );
  }

  function renderHoldings(holdings) {
    var box = el("holdings-list");
    if (!box) {
      return;
    }
    box.textContent = "";
    if (!holdings || !holdings.length) {
      box.textContent = "No holdings yet. Connect a wallet to list them.";
      return;
    }
    holdings.forEach(function (holding) {
      var row = document.createElement("p");
      row.setAttribute("data-holding", holding.symbol || "ETH");
      var amount = Number(holding.amount || 0);
      var label =
        "Holding " +
        (holding.symbol || "ETH") +
        " · " +
        amount.toFixed(4) +
        " · " +
        String(holding.address || "").slice(0, 10);
      row.appendChild(document.createTextNode(label + " "));
      var a = document.createElement("a");
      a.href = swapHref(holding);
      a.textContent = "Start tkrSwap";
      row.appendChild(a);
      box.appendChild(row);
    });
  }

  function applyGame(data) {
    data = data || {};
    renderCards(data.index_cards || []);
    renderScoreboard(data.scoreboard || []);
    renderBeaver(data.beaver_nickels || 0);
    return data;
  }

  function applyHoldings(holdings) {
    holdings = holdings || [];
    renderHoldings(holdings);
    return holdings;
  }

  function loadGame(fetchFn) {
    fetchFn = fetchFn || fetch;
    return fetchFn(GAME_URL, { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) {
          throw new Error("HTTP " + res.status);
        }
        return res.json();
      })
      .then(applyGame)
      .catch(function () {
        text(el("index-cards"), "Could not load index cards. Open tkrpik.");
        text(el("scoreboard"), "Could not load scoreboard. Open tkrpik.");
        text(el("beaver-nickels"), "Beaver Nickels live on tkrpik. Sign in there for your private total.");
        return null;
      });
  }

  function login(provider) {
    provider = provider || (typeof window !== "undefined" ? window.ethereum : null);
    if (!provider || typeof provider.request !== "function") {
      text(el("wallet-login-status"), "Install an injected wallet, or sign in on tkrpik.");
      return Promise.resolve(null);
    }
    return provider
      .request({ method: "eth_requestAccounts" })
      .then(function (accounts) {
        var address = accounts && accounts[0];
        if (!address) {
          throw new Error("No account");
        }
        return provider
          .request({ method: "eth_chainId" })
          .catch(function () {
            return "0x1";
          })
          .then(function (chainHex) {
            var chainId = parseInt(chainHex, 16) || 1;
            return listHoldings(provider, address, chainId).then(function (holdings) {
              if (!holdings.length) {
                holdings = [
                  {
                    kind: "holding",
                    symbol: "ETH",
                    token: NATIVE_ETH,
                    chain_id: chainId,
                    address: address,
                    amount: 0,
                  },
                ];
              }
              applyHoldings(holdings);
              text(el("wallet-login-status"), "Connected " + address + ". You sign every fill.");
              var native = holdings.filter(function (h) {
                return h.symbol === "ETH";
              })[0];
              return native || holdings[0];
            });
          });
      })
      .catch(function (err) {
        text(el("wallet-login-status"), (err && err.message) || "Wallet login failed.");
        return null;
      });
  }

  function bindLogin() {
    var btn = el("wallet-login-btn");
    if (!btn) {
      return;
    }
    btn.addEventListener("click", function () {
      login();
    });
  }

  var api = {
    GAME_URL: GAME_URL,
    SWAP_URL: SWAP_URL,
    LOGIN_URL: LOGIN_URL,
    NATIVE_ETH: NATIVE_ETH,
    applyGame: applyGame,
    applyHoldings: applyHoldings,
    loadGame: loadGame,
    login: login,
    swapHref: swapHref,
    batchHref: batchHref,
    applyBatchQuery: applyBatchQuery,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.tkrWallet = api;
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
          bindLogin();
          loadGame();
          applyBatchQuery();
        });
      } else {
        bindLogin();
        loadGame();
        applyBatchQuery();
      }
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
