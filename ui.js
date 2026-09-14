/* tkrWallet — UI shell.
 *
 * Scope of this file: navigation, currency toggle, and rendering primitives.
 * It holds NO wallet data logic and makes NO network calls; the data layer
 * (balances, prices, RPC) arrives in M3. Keeping the split means the shell can
 * be reviewed and tested without a chain.
 *
 * Two hard rules inherited from v1 and kept deliberately:
 *   - Every dynamic value reaches the DOM through textContent. There is no
 *     markup-string sink in this file.
 *   - No inline script in index.html: MV3 blocks it and cannot be relaxed.
 */
(function (root) {
  "use strict";

  var SCREENS = ["home", "swap", "activity", "search"];
  var DEFAULT_SCREEN = "home";
  var CURRENCIES = ["usd", "cad"];
  var STORAGE_KEY = "tkrwallet.currency";

  /* ---- pure helpers (unit-testable without a DOM) ---------------------- */

  /** Parse a location hash like "#/swap" into a known screen. Never throws. */
  function parseRoute(hash) {
    var raw = String(hash == null ? "" : hash);
    var name = raw.replace(/^#\/?/, "").split(/[?&#]/)[0].toLowerCase();
    return SCREENS.indexOf(name) === -1 ? DEFAULT_SCREEN : name;
  }

  /** Normalise a currency code, falling back to USD. */
  function parseCurrency(value) {
    var code = String(value == null ? "" : value).toLowerCase();
    return CURRENCIES.indexOf(code) === -1 ? "usd" : code;
  }

  /** "0x2222...2222" — short enough for a 360px header. */
  function shortAddress(address, lead, tail) {
    var a = String(address == null ? "" : address).trim();
    if (!a) {
      return "";
    }
    lead = lead || 6;
    tail = tail || 4;
    return a.length <= lead + tail + 1 ? a : a.slice(0, lead) + "\u2026" + a.slice(-tail);
  }

  /**
   * Format a fiat total. Returns an em dash when the value is unknown — never
   * "$0.00", because "we could not price this" and "this is worth nothing" are
   * different claims and the wallet must not confuse them.
   */
  function formatFiat(value, currency) {
    if (value === null || value === undefined || value === "" || isNaN(Number(value))) {
      return "\u2014";
    }
    var code = parseCurrency(currency).toUpperCase();
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        maximumFractionDigits: 2,
      }).format(Number(value));
    } catch (e) {
      return code + " " + Number(value).toFixed(2);
    }
  }

  /** Token amounts get more precision than fiat, and never trail zeros. */
  function formatAmount(value, maxDigits) {
    if (value === null || value === undefined || value === "" || isNaN(Number(value))) {
      return "\u2014";
    }
    var digits = maxDigits == null ? 6 : maxDigits;
    var n = Number(value);
    if (n === 0) {
      return "0";
    }
    return n.toLocaleString(undefined, { maximumFractionDigits: digits });
  }

  /* ---- DOM layer -------------------------------------------------------- */

  function el(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  function setText(node, value) {
    if (node) {
      node.textContent = value;
    }
  }

  function readStoredCurrency() {
    try {
      return parseCurrency(root.localStorage && root.localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return "usd"; // private mode / storage disabled
    }
  }

  function storeCurrency(code) {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(STORAGE_KEY, code);
      }
    } catch (e) {
      /* non-fatal: the toggle still works for this session */
    }
  }

  function renderCurrency() {
    var buttons = document.querySelectorAll("[data-currency]");
    for (var i = 0; i < buttons.length; i++) {
      var active = buttons[i].getAttribute("data-currency") === state.currency;
      buttons[i].setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function setCurrency(code) {
    state.currency = parseCurrency(code);
    storeCurrency(state.currency);
    renderCurrency();
    if (typeof state.onCurrencyChange === "function") {
      state.onCurrencyChange(state.currency);
    }
  }

  function showScreen(name) {
    var next = SCREENS.indexOf(name) === -1 ? DEFAULT_SCREEN : name;
    state.screen = next;

    var sections = document.querySelectorAll("[data-screen]");
    for (var i = 0; i < sections.length; i++) {
      var match = sections[i].getAttribute("data-screen") === next;
      if (match) {
        sections[i].removeAttribute("hidden");
      } else {
        sections[i].setAttribute("hidden", "");
      }
    }

    var tabs = document.querySelectorAll("[data-nav]");
    for (var j = 0; j < tabs.length; j++) {
      if (tabs[j].getAttribute("data-nav") === next) {
        tabs[j].setAttribute("aria-current", "page");
      } else {
        tabs[j].removeAttribute("aria-current");
      }
    }
    return next;
  }

  /** Navigate and keep the URL in step, so back/forward and deep links work. */
  function go(name) {
    var next = SCREENS.indexOf(name) === -1 ? DEFAULT_SCREEN : name;
    var want = "#/" + next;
    if (root.location && root.location.hash !== want) {
      root.location.hash = want; // hashchange handler does the render
      return next;
    }
    return showScreen(next);
  }

  /** Reflect connection state in the header. `unknown` never renders as zero. */
  function setAccount(address, label) {
    var dot = el("account-dot");
    var connected = Boolean(address);
    setText(el("account-label"), connected ? shortAddress(address) : label || "Not connected");
    setText(el("account-status"), connected ? "Connected " + String(address) : "Not connected");
    if (dot) {
      dot.classList.remove("bg-up-400", "bg-cream-500", "bg-ember-400");
      dot.classList.add(connected ? "bg-up-400" : "bg-cream-500");
    }
  }

  /** Announce a message to assistive tech without stealing focus. */
  function setStatus(message) {
    setText(el("account-status"), message);
  }

  /** Balance/price updates announce here, separate from connection state. */
  function setWalletStatus(message) {
    setText(el("wallet-status"), message);
  }

  function setWalletValue(value, currency, note) {
    var box = el("wallet-value");
    var unknown = value === null || value === undefined || value === "" || isNaN(Number(value));
    setText(box, formatFiat(value, currency || state.currency));
    if (box) {
      // A placeholder must never carry hero weight (data-empty styling).
      if (unknown) {
        box.setAttribute("data-empty", "");
      } else {
        box.removeAttribute("data-empty");
      }
    }
    if (note !== undefined) {
      setText(el("wallet-value-note"), note || "");
    }
  }

  /** Fiat value for one holding, or null when unpriced/unknown (renders —). */
  function fiatFor(holding, prices) {
    var wallet = root.tkrWalletData;
    if (!wallet || !holding || holding.state !== "ok" || holding.amount === null) {
      return null;
    }
    if (!prices || prices.state !== "ok") {
      return null;
    }
    var entry = prices.prices[wallet.assetKey(holding)];
    if (!entry || typeof entry[state.currency] !== "number" || !isFinite(entry[state.currency])) {
      return null;
    }
    return holding.amount * entry[state.currency];
  }

  function renderTokens(holdings, prices) {
    var box = el("token-list");
    var tpl = el("tpl-token-row");
    if (!box || !tpl) {
      return [];
    }
    box.textContent = "";
    if (!holdings || !holdings.length) {
      var tplEmpty = el("tpl-token-empty");
      if (tplEmpty) {
        var node = tplEmpty.content.firstElementChild.cloneNode(true);
        var cta = node.querySelector("[data-connect]");
        if (cta) {
          cta.addEventListener("click", connectWallet);
        }
        // The extension popup is its own security context: no other wallet can
        // inject a provider into it, so say what actually works there.
        if (isExtension()) {
          setText(
            node.querySelector("[data-empty-body]"),
            "An extension popup cannot see your wallet \u2014 other extensions cannot inject into it. Open tkrwallet.scratchpost.ai in a browser tab to connect."
          );
          if (cta) {
            cta.textContent = "How to connect";
          }
        }
        box.appendChild(node);
      }
      return [];
    }
    holdings.forEach(function (holding) {
      var row = tpl.content.firstElementChild.cloneNode(true);
      var badge = row.querySelector("[data-token-badge]");
      row.addEventListener("click", function () {
        setWalletStatus("Token details are not built yet.");
      });
      setText(row.querySelector("[data-token-name]"), holding.symbol || "?");
      setText(row.querySelector("[data-token-chain]"), holding.chain_name || "");
      setText(
        row.querySelector("[data-token-amount]"),
        holding.state === "unknown" ? "\u2014" : formatAmount(holding.amount)
      );
      setText(row.querySelector("[data-token-fiat]"), formatFiat(fiatFor(holding, prices), state.currency));
      if (badge) {
        // Colour comes from the data layer's local map — never from the wire.
        badge.style.backgroundColor = holding.color || "#cfc8b8";
        badge.textContent = String(holding.symbol || "?").slice(0, 3);
      }
      box.appendChild(row);
    });
    return holdings;
  }

  /* ---- search ------------------------------------------------------------ */

  /** Filter the built-in catalogue. Offline and synchronous — the catalogue is
   * already in the client. A chain-wide search needs the edge catalogue. */
  function searchResults(query) {
    var box = el("search-results");
    var tpl = el("tpl-search-row");
    if (!box) {
      return [];
    }
    box.textContent = "";
    var q = String(query || "").trim();
    var rows = q && root.tkrWalletData ? root.tkrWalletData.searchCatalog(q, 20) : [];

    if (!rows.length) {
      var hint = document.createElement("div");
      hint.className = "px-4 py-6 text-center";
      var line = document.createElement("p");
      line.className = "text-sm text-cream-300";
      line.textContent = q ? "No match in the built-in catalogue." : "Search the built-in catalogue";
      var sub = document.createElement("p");
      sub.className = "mt-1 text-xs text-cream-500";
      sub.textContent = q
        ? "Only the tokens this wallet ships with are searchable until the edge catalogue lands."
        : "Ethereum, Base and Robinhood tokens this wallet knows about. Full chain-wide search needs the wallet edge.";
      hint.appendChild(line);
      hint.appendChild(sub);
      box.appendChild(hint);
      return [];
    }

    rows.forEach(function (tok) {
      var row = tpl.content.firstElementChild.cloneNode(true);
      var badge = row.querySelector("[data-token-badge]");
      setText(row.querySelector("[data-token-name]"), tok.symbol);
      setText(
        row.querySelector("[data-token-chain]"),
        tok.address ? tok.chain_name + " \u00b7 " + shortAddress(tok.address, 6, 4) : tok.chain_name + " \u00b7 native"
      );
      if (badge) {
        badge.style.backgroundColor = tok.color || "#cfc8b8";
        badge.textContent = String(tok.symbol).slice(0, 3);
      }
      row.addEventListener("click", function () {
        setWalletStatus(tok.symbol + " on " + tok.chain_name + " selected. Token detail is not built yet.");
      });
      box.appendChild(row);
    });
    return rows;
  }

  /* ---- wallet wiring: shell talks to the data layer only ------------------ */

  var uiData = { lastHoldings: null, lastPrices: null, account: null };

  /** Re-render the list and value from whatever we last knew. */
  function renderAll() {
    if (uiData.lastHoldings) {
      renderTokens(uiData.lastHoldings, uiData.lastPrices);
      refreshValue();
    }
  }

  function refreshValue() {
    var wallet = root.tkrWalletData;
    var holdings = uiData.lastHoldings;
    if (!wallet || !holdings) {
      return;
    }
    var est = wallet.estimateValue(holdings, uiData.lastPrices, state.currency);
    if (est.state === "ok") {
      var note = est.priced < est.total ? est.priced + " of " + est.total + " holdings priced" : "";
      setWalletValue(est.value, state.currency, note);
    } else {
      setWalletValue(null, state.currency, "Prices unavailable until the wallet edge ships.");
    }
  }

  function refreshPrices() {
    var wallet = root.tkrWalletData;
    var holdings = uiData.lastHoldings;
    if (!wallet || !holdings || !holdings.length) {
      uiData.lastPrices = null;
      renderAll();
      return Promise.resolve(null);
    }
    var assets = holdings.filter(function (h) {
      return h.state === "ok" && h.amount !== null;
    }).map(function (h) {
      return wallet.assetKey(h);
    });
    return wallet.getPrices(assets, [state.currency]).then(function (prices) {
      uiData.lastPrices = prices;
      renderAll();
      return prices;
    });
  }

  /** Connect button: provider connect -> holdings -> prices. Read-only; the
   * data layer never sends a transaction. */
  function connectWallet() {
    var wallet = root.tkrWalletData;
    if (!wallet) {
      setStatus("Wallet data layer failed to load.");
      return Promise.resolve(null);
    }
    setStatus("Requesting wallet connection\u2026");
    var dot = el("account-dot");
    if (dot) {
      dot.classList.remove("bg-cream-500", "bg-up-400");
      dot.classList.add("bg-ember-400");
    }
    return wallet
      .connect()
      .then(function (account) {
        uiData.account = account;
        setAccount(account.address);
        setWalletStatus("Connected. Reading balances\u2026");
        return wallet.listHoldings(null, account.address, account.chain_id);
      })
      .then(function (holdings) {
        uiData.lastHoldings = holdings;
        renderTokens(holdings, null);
        setWalletStatus(holdings.length + " holding" + (holdings.length === 1 ? "" : "s") + " listed.");
        return refreshPrices();
      })
      .catch(function (err) {
        uiData.account = null;
        uiData.lastHoldings = null;
        uiData.lastPrices = null;
        var raw = (err && err.message) || "";
        var msg = /provider/i.test(raw)
          ? "No wallet detected here. Install MetaMask or Brave, then reload \u2014 or open tkrWallet in a browser tab."
          : raw || "Wallet connect failed.";
        setAccount(null, isExtension() ? "Open in a browser tab" : "Not connected");
        setStatus(msg);
        setWalletValue(null, state.currency, "Connect a wallet to see your balance.");
        renderTokens(null);
        return null;
      });
  }

  /* Extension popups are their own security context: other wallets cannot
   * inject a provider into them, so EIP-1193 connect is impossible there. The
   * extension points at the hosted wallet instead of pretending. */
  function isExtension() {
    return String((root.location && root.location.protocol) || "").indexOf("chrome-extension") === 0;
  }

  var state = {
    screen: DEFAULT_SCREEN,
    currency: "usd",
    onCurrencyChange: null,
  };

  function bind() {
    var tabs = document.querySelectorAll("[data-nav]");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (event) {
        go(event.currentTarget.getAttribute("data-nav"));
      });
    }

    var currencies = document.querySelectorAll("[data-currency]");
    for (var j = 0; j < currencies.length; j++) {
      currencies[j].addEventListener("click", function (event) {
        setCurrency(event.currentTarget.getAttribute("data-currency"));
        renderAll(); // re-paint fiat column and value in the new currency
      });
    }

    var accountBtn = el("account-btn");
    if (accountBtn) {
      accountBtn.addEventListener("click", function () {
        connectWallet();
      });
    }

    var searchInput = el("search-input");
    if (searchInput) {
      searchInput.addEventListener("input", function (event) {
        searchResults(event.currentTarget.value);
      });
    }

    var search = el("header-search");
    if (search) {
      search.addEventListener("click", function () {
        go("search");
        var input = el("search-input");
        if (input) {
          input.focus();
        }
      });
    }

    var actions = document.querySelectorAll("[data-action]");
    for (var k = 0; k < actions.length; k++) {
      actions[k].addEventListener("click", function (event) {
        var action = event.currentTarget.getAttribute("data-action");
        if (action === "swap") {
          // The one honest route: the swap screen explains why it is empty.
          go("swap");
          return;
        }
        // send / receive / buy are not built. Say so rather than dead-ending.
        setStatus(
          action.charAt(0).toUpperCase() +
            action.slice(1) +
            " is not built yet. Nothing was signed."
        );
      });
    }

    if (root.addEventListener) {
      root.addEventListener("hashchange", function () {
        showScreen(parseRoute(root.location.hash));
      });
    }

    state.currency = readStoredCurrency();
    renderCurrency();
    showScreen(parseRoute(root.location && root.location.hash));
    maybePreview();
    if (!uiData.lastHoldings) {
      renderTokens(null); // the one shared empty-state design
      searchResults("");
    }
  }

  /* Preview mode: opt-in via ?preview=1, clearly labelled, sample data only.
   * Never triggered in normal use; production paths never read it. */
  function maybePreview() {
    var wallet = root.tkrWalletData;
    var q = (root.location && root.location.search) || "";
    if (!wallet || !/(^|[?&])preview=1([&#]|$)/.test(q)) {
      return false;
    }
    uiData.lastHoldings = wallet.PREVIEW_HOLDINGS;
    uiData.lastPrices = wallet.PREVIEW_PRICES;
    var pill = el("preview-pill");
    if (pill) {
      pill.removeAttribute("hidden");
    }
    // The header must agree with the body: this is a preview, not a connection.
    setText(el("account-label"), "Preview");
    var dot = el("account-dot");
    if (dot) {
      dot.classList.remove("bg-cream-500", "bg-up-400");
      dot.classList.add("bg-ember-400");
    }
    setText(el("account-status"), "Preview mode: sample data. Nothing is real.");
    renderAll();
    setWalletStatus("Preview mode: sample holdings shown for design review. Nothing is real.");
    return true;
  }

  function registerServiceWorker() {
    // Guarded: serviceWorker is unavailable in MV3 extension pages, and the
    // popup must not throw on boot.
    try {
      if (root.navigator && "serviceWorker" in root.navigator) {
        root.navigator.serviceWorker.register("./sw.js");
      }
    } catch (e) {
      /* offline chrome is a nicety, not a requirement */
    }
  }

  var api = {
    SCREENS: SCREENS,
    parseRoute: parseRoute,
    parseCurrency: parseCurrency,
    shortAddress: shortAddress,
    formatFiat: formatFiat,
    formatAmount: formatAmount,
    showScreen: showScreen,
    go: go,
    setAccount: setAccount,
    setStatus: setStatus,
    setWalletStatus: setWalletStatus,
    setWalletValue: setWalletValue,
    setCurrency: setCurrency,
    renderTokens: renderTokens,
    connectWallet: connectWallet,
    searchResults: searchResults,
    maybePreview: maybePreview,
    renderAll: renderAll,
    uiData: uiData,
    bind: bind,
    state: state,
    el: el,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.tkrWalletUI = api;
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
          bind();
          registerServiceWorker();
        });
      } else {
        bind();
        registerServiceWorker();
      }
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
