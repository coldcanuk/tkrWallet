(function (root) {
  var GAME_URL = "https://tkrpik.com/api/public/game";
  var SWAP_URL = "https://tkrswap.com/";

  function el(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  function text(node, value) {
    if (node) {
      node.textContent = value;
    }
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

  function applyGame(data) {
    data = data || {};
    renderCards(data.index_cards || []);
    renderScoreboard(data.scoreboard || []);
    renderBeaver(data.beaver_nickels || 0);
    return data;
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

  var api = { GAME_URL: GAME_URL, SWAP_URL: SWAP_URL, applyGame: applyGame, loadGame: loadGame };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.tkrWallet = api;
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
          loadGame();
        });
      } else {
        loadGame();
      }
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
