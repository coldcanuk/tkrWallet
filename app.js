(function (root) {
  var GAME_URL = "https://tkrpik.com/api/public/game";
  var SWAP_URL = "https://tkrswap.com/";
  var LOGIN_URL = "https://tkrpik.com/login?next=tkrswap";
  var NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

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

  function bravoHref(holding) {
    holding = holding || {};
    var params = new URLSearchParams();
    params.set("card", "BRAVO");
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

  function renderBravo(holdings) {
    var box = el("bravo-holdings");
    if (!box) {
      return;
    }
    box.textContent = "";
    if (!holdings || !holdings.length) {
      box.textContent = "No holdings yet. Connect a wallet to list BRAVO.";
      return;
    }
    holdings.forEach(function (holding) {
      var row = document.createElement("p");
      row.setAttribute("data-bravo", holding.symbol || "ETH");
      var amount = Number(holding.amount || 0);
      var label =
        "BRAVO " +
        (holding.symbol || "ETH") +
        " · " +
        amount.toFixed(4) +
        " · " +
        String(holding.address || "").slice(0, 10);
      row.appendChild(document.createTextNode(label + " "));
      var a = document.createElement("a");
      a.href = bravoHref(holding);
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
    renderBravo(holdings);
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
        return Promise.all([
          provider.request({ method: "eth_chainId" }).catch(function () {
            return "0x1";
          }),
          provider.request({ method: "eth_getBalance", params: [address, "latest"] }).catch(function () {
            return "0x0";
          }),
        ]).then(function (pair) {
          var chainId = parseInt(pair[0], 16) || 1;
          var holding = {
            kind: "BRAVO",
            symbol: "ETH",
            token: NATIVE_ETH,
            chain_id: chainId,
            address: address,
            amount: weiToEth(pair[1]),
          };
          applyHoldings([holding]);
          text(el("wallet-login-status"), "Connected " + address + ". You sign every fill.");
          return holding;
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
    bravoHref: bravoHref,
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
        });
      } else {
        bindLogin();
        loadGame();
      }
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
