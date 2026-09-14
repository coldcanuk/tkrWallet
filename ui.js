/* tkrWallet — UI shell.
 *
 * Scope of this file: navigation, currency toggle, and rendering primitives.
 * It holds NO wallet data logic and makes NO network calls; the data layer
 * (balances, prices) arrives in M3. Keeping the split means the shell can
 * be reviewed and tested without a chain.
 *
 * Two hard rules inherited from v1 and kept deliberately:
 *   - Every dynamic value reaches the DOM through textContent. There is no
 *     markup-string sink in this file.
 *   - No inline script in index.html: MV3 blocks it and cannot be relaxed.
 */
(function (root) {
  "use strict";

  var SCREENS = ["home", "swap", "activity", "search", "settings", "detail"];
  var DEFAULT_SCREEN = "home";
  var CURRENCIES = ["usd", "cad"];
  var STORAGE_KEY = "tkrwallet.currency";
  var AUTOLOCK_KEY = "tkrwallet.autolock";
  var VIEW_SESSION_KEY = "tkrwallet.view-session";
  /* Auto-lock is a security floor, not a preference: it cannot be turned off
   * and the longest offered session is 1 hour. Default is 5 minutes. */
  var AUTOLOCK_OPTIONS = [1, 5, 15, 30, 60];
  var AUTOLOCK_DEFAULT = 5;
  var AUTOLOCK_MAX = 60;

  /* ---- pure helpers (unit-testable without a DOM) ---------------------- */

  /** Parse a token-detail route: "#/token/<chain_id>:<native|0xaddress>".
   * Returns { chainId, asset } (asset === null means the native gas token),
   * or null when the hash is not a token route. Never throws. */
  function parseTokenRoute(hash) {
    var raw = String(hash == null ? "" : hash);
    var m = raw.replace(/^#\/?/, "").match(/^token\/(\d+):(native|0x[0-9a-fA-F]{40})$/);
    if (!m) {
      return null;
    }
    return { chainId: Number(m[1]), asset: m[2].toLowerCase() === "native" ? null : m[2] };
  }

  /** Parse a location hash like "#/swap" into a known screen. Never throws. */
  function parseRoute(hash) {
    if (parseTokenRoute(hash)) {
      return "detail";
    }
    var raw = String(hash == null ? "" : hash);
    var name = raw.replace(/^#\/?/, "").split(/[?&#]/)[0].toLowerCase();
    return SCREENS.indexOf(name) === -1 ? DEFAULT_SCREEN : name;
  }

  /** Normalise a currency code, falling back to USD. */
  function parseCurrency(value) {
    var code = String(value == null ? "" : value).toLowerCase();
    return CURRENCIES.indexOf(code) === -1 ? "usd" : code;
  }

  /** Normalise an auto-lock minutes value: never 0 (cannot be off), never
   * more than 60 (the longest session), snapped to the nearest offered option.
   * Bad or missing input falls back to the 5-minute default. */
  function parseAutolockMinutes(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return AUTOLOCK_DEFAULT;
    }
    var n = Number(value);
    if (!isFinite(n)) {
      n = AUTOLOCK_DEFAULT;
    }
    if (n < 1) {
      n = 1;
    }
    if (n > AUTOLOCK_MAX) {
      n = AUTOLOCK_MAX;
    }
    var best = AUTOLOCK_OPTIONS[0];
    for (var i = 0; i < AUTOLOCK_OPTIONS.length; i++) {
      if (Math.abs(AUTOLOCK_OPTIONS[i] - n) < Math.abs(best - n)) {
        best = AUTOLOCK_OPTIONS[i];
      }
    }
    return best;
  }

  /**
   * Viewing session: public address + activity timestamp, never key material.
   * Survives reload (sessionStorage) for the auto-lock window; rejected when
   * stale, malformed, or missing. Pure — tests call this without a DOM.
   */
  function parseViewSession(raw, now) {
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      return null;
    }
    var parsed;
    try {
      parsed = JSON.parse(String(raw));
    } catch (e) {
      return null;
    }
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    var address = String(parsed.address || "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return null;
    }
    var lastActivity = Number(parsed.lastActivity);
    if (!isFinite(lastActivity) || lastActivity <= 0) {
      return null;
    }
    var minutes = parseAutolockMinutes(parsed.autolockMinutes);
    var at = now == null ? Date.now() : Number(now);
    if (!isFinite(at)) {
      at = Date.now();
    }
    if (at - lastActivity >= minutes * 60000) {
      return null;
    }
    return { address: address, lastActivity: lastActivity, autolockMinutes: minutes };
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
    // Focus the search field once its screen is visible. The header button
    // navigates first; focusing before the section is un-hidden fails silently.
    if (next === "search") {
      var input = el("search-input");
      if (input && document.activeElement !== input) {
        input.focus();
      }
    }
    if (next === "detail") {
      renderDetail();
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

  /** Open a token's detail screen. `asset` is null for the native gas token or
   * a contract address. Tapping a coin used to be a dead click; this is the
   * route it now takes. */
  function goToken(chainId, asset) {
    var want = "#/token/" + Number(chainId) + ":" + (asset ? String(asset) : "native");
    if (root.location && root.location.hash !== want) {
      root.location.hash = want; // hashchange handler does the render
      return "detail";
    }
    return showScreen("detail");
  }

  /** Reflect wallet state in the header. `unknown` never renders as zero. */
  function setAccount(address, label) {
    var dot = el("account-dot");
    var connected = Boolean(address);
    setText(el("account-label"), connected ? shortAddress(address) : label || "No wallet");
    setText(el("account-status"), connected ? "Wallet " + String(address) : "No wallet");
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

  /** "Ethereum" / "Base · added by you" — the second line of a token row. */
  function chainLineFor(holding) {
    var name = holding.chain_name || "";
    if (holding.custom) {
      return name + " \u00b7 added by you";
    }
    return name;
  }

  /** The empty-state card, chosen from why the list is empty. "We could not
   * check" and "you own nothing" must never render the same way. */
  function emptyStateFor() {
    var read = uiData.lastBalances;
    if (session.address) {
      if (read && read.state === "unknown") {
        return {
          title: "Balances unavailable",
          body: "The wallet edge could not be reached, so your balances are unknown — not zero. Nothing was signed.",
          cta: "Retry",
          action: refreshBalances,
        };
      }
      if (read && read.state === "partial") {
        return {
          title: "Balances incomplete",
          body: "Some chains could not be read, so this list may be missing holdings. " + chainProblems(read),
          cta: "Retry",
          action: refreshBalances,
        };
      }
      return {
        title: "No balances yet",
        body: "No Mainnet or Base holdings were found for this account. Your keys stay on this device.",
        cta: "Refresh",
        action: refreshBalances,
      };
    }
    if (session.locked) {
      return {
        title: "Wallet locked",
        body: "Unlock with your password to see your wallet. It locks itself after a period of inactivity.",
        cta: "Unlock",
        action: function () {
          openGate("unlock");
        },
      };
    }
    return {
      title: "No wallet yet",
      body: "Import a wallet with a password or a recovery phrase. Your keys stay encrypted on this device \u2014 nothing leaves it.",
      cta: "Import wallet",
      action: function () {
        openGate();
      },
    };
  }

  /** Human summary of which chains failed, e.g. "Ethereum could not be read." */
  function chainProblems(read) {
    if (!read || !read.chains) {
      return "The edge did not report which chains it read.";
    }
    var names = [];
    read.chains.forEach(function (c) {
      if (!c || c.state === "ok") {
        return;
      }
      var name = (root.tkrWalletData && root.tkrWalletData.chainName(c.chain_id)) || "chain " + c.chain_id;
      if (c.state === "unknown") {
        names.push(name + " could not be read");
      } else {
        names.push(name + " was read only in part");
      }
    });
    return names.length ? names.join("; ") + "." : "";
  }

  function renderTokens(holdings, prices) {
    var box = el("token-list");
    var tpl = el("tpl-token-row");
    if (!box || !tpl) {
      return [];
    }
    box.textContent = "";
    renderBalancesNotice();
    if (!holdings || !holdings.length) {
      var tplEmpty = el("tpl-token-empty");
      if (tplEmpty) {
        var node = tplEmpty.content.firstElementChild.cloneNode(true);
        var state_ = emptyStateFor();
        var cta = node.querySelector("[data-import]");
        setText(node.querySelector("[data-empty-title]"), state_.title);
        setText(node.querySelector("[data-empty-body]"), state_.body);
        if (cta) {
          setText(cta, state_.cta);
          cta.addEventListener("click", function () {
            state_.action();
          });
        }
        box.appendChild(node);
      }
      return [];
    }
    holdings.forEach(function (holding) {
      var row = tpl.content.firstElementChild.cloneNode(true);
      var badge = row.querySelector("[data-token-badge]");
      // Tapping a coin opens its detail screen (this used to be a dead click).
      row.addEventListener("click", function () {
        goToken(holding.chain_id, holding.address);
      });
      setText(row.querySelector("[data-token-name]"), holding.symbol || "?");
      setText(row.querySelector("[data-token-chain]"), chainLineFor(holding));
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

  /** A visible, retryable notice when the read was not complete. Rows that did
   * arrive stay on screen — partial success is not thrown away. */
  function renderBalancesNotice() {
    var box = el("balances-notice");
    if (!box) {
      return;
    }
    var read = uiData.lastBalances;
    var show = Boolean(session.address) && read && read.state !== "ok";
    if (!show) {
      box.setAttribute("hidden", "");
      return;
    }
    var text =
      read.state === "unknown"
        ? "Balances are unknown: " + (read.reason === "edge-unreachable" ? "the wallet edge could not be reached." : "the read failed.")
        : "Some chains could not be read. " + chainProblems(read);
    setText(el("balances-notice-text"), text);
    var when = el("balances-checked");
    setText(when, uiData.lastChecked ? "Last checked " + new Date(uiData.lastChecked).toLocaleTimeString() : "");
    box.removeAttribute("hidden");
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
    var rows = q && root.tkrWalletData ? root.tkrWalletData.searchCatalog(q, 20, readStoredTokens()) : [];

    if (!rows.length) {
      var hint = document.createElement("div");
      hint.className = "px-4 py-6 text-center";
      var line = document.createElement("p");
      line.className = "text-sm text-cream-300";
      line.textContent = q ? "No match in the built-in catalogue." : "Search the built-in catalogue";
      var sub = document.createElement("p");
      sub.className = "mt-1 text-xs text-cream-500";
      sub.textContent = q
        ? "Only Mainnet and Base tokens this wallet ships with are searchable until the edge catalogue lands."
        : "Mainnet and Base tokens this wallet knows about. Full chain-wide search needs the wallet edge.";
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
        (tok.name && tok.name !== tok.symbol ? tok.name + " \u00b7 " : "") +
          tok.chain_name +
          (tok.address ? " \u00b7 " + shortAddress(tok.address, 6, 4) : "")
      );
      if (badge) {
        badge.style.backgroundColor = tok.color || "#cfc8b8";
        badge.textContent = String(tok.symbol).slice(0, 3);
      }
      row.addEventListener("click", function () {
        goToken(tok.chain_id, tok.address);
      });
      box.appendChild(row);
    });
    return rows;
  }

  /* ---- wallet wiring: shell talks to the data layer only ------------------ */

  var uiData = {
    lastHoldings: null,
    lastPrices: null,
    account: null,
    lastBalances: null, // { state, reason, chains } from the last read
    lastChecked: null, // when that read happened
  };

  /** Re-render the list and value from whatever we last knew. */
  function renderAll() {
    renderTokens(uiData.lastHoldings, uiData.lastPrices);
    if (uiData.lastHoldings) {
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
    } else if (!holdings.length) {
      var read = uiData.lastBalances;
      if (read && read.state === "unknown") {
        setWalletValue(null, state.currency, "Balances unavailable until the wallet edge responds.");
      } else if (read && read.state === "partial") {
        setWalletValue(null, state.currency, "Balances may be incomplete. " + chainProblems(read));
      } else {
        setWalletValue(null, state.currency, "");
      }
    } else {
      setWalletValue(null, state.currency, "Prices unavailable from the wallet edge.");
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

  /** Read balances for the unlocked account from the wallet edge, then price
   * what came back. Three outcomes are kept distinct:
   *   ok      — every chain was read; an empty list really means "none held"
   *   partial — some chains failed; rows are shown AND the gap is disclosed
   *   unknown — nothing readable; the UI says unknown, never "no balances"
   * `unknown` is never rendered as a zero balance. */
  function refreshBalances() {
    var wallet = root.tkrWalletData;
    if (!wallet || !session.address) {
      return Promise.resolve(null);
    }
    setWalletStatus("Reading balances from the wallet edge\u2026");
    uiData.lastBalances = null;
    renderBalancesNotice();
    var extras = readStoredTokens().map(function (t) {
      return t.chain_id + ":" + t.address;
    });
    return wallet
      .getBalances(session.address, [1, 8453], null, extras)
      .then(function (res) {
        uiData.lastChecked = Date.now();
        uiData.lastBalances = res;
        if (res.state === "ok" || res.state === "partial") {
          uiData.lastHoldings = res.balances || [];
          renderTokens(uiData.lastHoldings, null);
          if (res.state === "ok") {
            setWalletStatus(
              uiData.lastHoldings.length + " holding" + (uiData.lastHoldings.length === 1 ? "" : "s") + " listed."
            );
          } else {
            setWalletStatus("Balances may be incomplete. " + chainProblems(res));
          }
          return refreshPrices();
        }
        uiData.lastHoldings = null;
        uiData.lastPrices = null;
        renderTokens(null);
        setWalletStatus("Balances unknown: the wallet edge did not answer. Nothing was signed.");
        setWalletValue(null, state.currency, "Balances unavailable until the wallet edge responds.");
        return null;
      });
  }

  /* ---- user-added tokens -------------------------------------------------
   * Public token metadata only (symbol/name/decimals/address). Never key
   * material, never anything from the vault. The built-in catalogue is a fixed
   * list, so without this a wallet holding anything else looks empty. */

  var TOKENS_KEY = "tkrwallet.tokens";

  function readStoredTokens() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(TOKENS_KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) {
        return [];
      }
      return list.filter(function (t) {
        return t && /^0x[0-9a-fA-F]{40}$/.test(t.address || "") && Number.isFinite(Number(t.chain_id));
      });
    } catch (e) {
      return []; // private mode / corrupt value: the catalogue still works
    }
  }

  function storeTokens(list) {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(TOKENS_KEY, JSON.stringify(list));
      }
    } catch (e) {
      /* non-fatal for this session */
    }
  }

  /** Say out loud what the holdings list covers. The old screen implied the
   * list was the whole wallet; it is a fixed catalogue plus whatever the user
   * added, on two chains. */
  function holdingsScopeText() {
    var data = root.tkrWalletData;
    var count = 0;
    if (data && data.TOKENS) {
      [1, 8453].forEach(function (chainId) {
        count += (data.TOKENS[chainId] || []).length;
      });
    }
    var extra = readStoredTokens().length;
    return (
      "Mainnet and Base. " +
      count +
      " built-in tokens" +
      (extra ? " plus " + extra + " you added" : "") +
      ". Add any other token by its contract address."
    );
  }

  function addToken(chainId, address) {
    var wallet = root.tkrWalletData;
    var errNode = el("add-token-error");
    if (!wallet) {
      return Promise.resolve(null);
    }
    var addr = String(address || "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      showAddTokenError("That is not a contract address. It must be 0x followed by 40 hex characters.");
      return Promise.resolve(null);
    }
    if (readStoredTokens().some(function (t) {
      return Number(t.chain_id) === Number(chainId) && t.address.toLowerCase() === addr.toLowerCase();
    })) {
      showAddTokenError("That token is already in your list.");
      return Promise.resolve(null);
    }
    var builtIn = ((root.tkrWalletData && root.tkrWalletData.TOKENS[chainId]) || []).some(function (t) {
      return t.address && t.address.toLowerCase() === addr.toLowerCase();
    });
    if (builtIn) {
      showAddTokenError("That token is already built in — it is in the list above.");
      return Promise.resolve(null);
    }
    showAddTokenError(null);
    setWalletStatus("Looking up the token at " + shortAddress(addr, 6, 4) + "\u2026");
    return wallet.getTokenMeta(chainId, addr).then(function (res) {
      if (res.state !== "ok") {
        showAddTokenError(
          res.reason === "not-a-token"
            ? "No ERC-20 answers at that address on this chain."
            : "Could not read that token: " + res.reason
        );
        return null;
      }
      var list = readStoredTokens();
      list.push({
        chain_id: Number(chainId),
        address: res.token.address,
        symbol: res.token.symbol,
        name: res.token.name,
        decimals: res.token.decimals,
      });
      storeTokens(list);
      setWalletStatus("Added " + res.token.symbol + ". Reading balances\u2026");
      var form = el("add-token-form");
      if (form) {
        form.setAttribute("hidden", "");
      }
      var input = el("add-token-address");
      if (input) {
        input.value = "";
      }
      return refreshBalances();
    });
  }

  function showAddTokenError(message) {
    var node = el("add-token-error");
    if (!node) {
      return;
    }
    if (message) {
      setText(node, message);
      node.removeAttribute("hidden");
    } else {
      node.setAttribute("hidden", "");
    }
  }

  /* ---- token detail: the screen a coin tap opens ------------------------- */

  /** The holding for a route, if this wallet holds it (or the read said so). */
  function holdingFor(chainId, asset) {
    var list = uiData.lastHoldings || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].chain_id === Number(chainId) && String(list[i].address || "native").toLowerCase() === String(asset || "native").toLowerCase()) {
        return list[i];
      }
    }
    return null;
  }

  /** Catalogue/custom metadata for an asset, when we have it offline. */
  function metaFor(chainId, asset) {
    if (!asset) {
      var chain = root.tkrWalletData && root.tkrWalletData.CHAINS[chainId];
      return { symbol: chain ? chain.native : "?", name: chain ? chain.name + " native token" : "", decimals: 18 };
    }
    var custom = readStoredTokens().filter(function (t) {
      return Number(t.chain_id) === Number(chainId) && t.address.toLowerCase() === String(asset).toLowerCase();
    })[0];
    if (custom) {
      return custom;
    }
    var list = (root.tkrWalletData && root.tkrWalletData.TOKENS[chainId]) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].address && list[i].address.toLowerCase() === String(asset).toLowerCase()) {
        return list[i];
      }
    }
    return null;
  }

  /** Render the detail screen for the current hash. An invalid route goes home
   * rather than showing an empty shell. */
  function renderDetail() {
    var route = parseTokenRoute(root.location && root.location.hash);
    var screen = document.querySelector('[data-screen="detail"]');
    if (!route) {
      go("home");
      return null;
    }
    var holding = holdingFor(route.chainId, route.asset);
    var meta = metaFor(route.chainId, route.asset);
    var symbol = (holding && holding.symbol) || (meta && meta.symbol) || shortAddress(route.asset, 6, 4);
    var name = (meta && meta.name) || (holding && holding.symbol) || "Token";
    var chainName = (root.tkrWalletData && root.tkrWalletData.chainName(route.chainId)) || "chain " + route.chainId;

    setText(el("detail-heading"), symbol);
    setText(el("detail-name"), name);
    setText(el("detail-chain"), chainName);
    var badge = el("detail-badge");
    if (badge) {
      badge.style.backgroundColor = (holding && holding.color) || (root.tkrWalletData && root.tkrWalletData.colorFor(symbol)) || "#cfc8b8";
      setText(badge, String(symbol).slice(0, 3));
    }

    // Amount: unknown stays an em dash. "Not held" is only claimed when every
    // chain was actually read.
    var read = uiData.lastBalances;
    if (holding && holding.state === "ok") {
      setText(el("detail-amount"), formatAmount(holding.amount));
      setText(el("detail-fiat"), formatFiat(fiatFor(holding, uiData.lastPrices), state.currency));
    } else {
      setText(el("detail-amount"), "\u2014");
      setText(el("detail-fiat"), "\u2014");
    }
    var note;
    if (!holding) {
      if (!session.address) {
        note = "Unlock your wallet to see whether you hold this token.";
      } else if (!read) {
        note = "Balances have not been read yet.";
      } else if (read.state === "ok") {
        note = "Not held in this wallet, according to the last complete read.";
      } else {
        note = "This wallet's balances are not fully known right now, so this token may or may not be held.";
      }
    } else if (holding.state !== "ok") {
      note = "The balance for this token could not be read.";
    } else {
      note = "Your keys stay on this device.";
    }
    setText(el("detail-note"), note);

    // Contract row: the native gas token has no contract.
    var row = el("detail-contract-row");
    var copy = el("detail-copy");
    if (route.asset) {
      if (row) {
        row.removeAttribute("hidden");
      }
      if (copy) {
        copy.removeAttribute("hidden");
      }
      setText(el("detail-contract"), route.asset);
    } else {
      if (row) {
        row.setAttribute("hidden", "");
      }
      if (copy) {
        // Nothing to copy for ETH/SOL: hide the button rather than let it fail.
        copy.setAttribute("hidden", "");
      }
    }
    return { symbol: symbol, chainId: route.chainId, asset: route.asset };
  }

  function copyDetailContract() {
    var route = parseTokenRoute(root.location && root.location.hash);
    var text = route && route.asset ? route.asset : "";
    if (!text) {
      setWalletStatus("The native gas token has no contract address to copy.");
      return;
    }
    try {
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
        root.navigator.clipboard.writeText(text);
        setWalletStatus("Contract address copied.");
        return;
      }
    } catch (e) {
      /* fall through to the honest message */
    }
    setWalletStatus("Copy is unavailable in this browser. The address is shown above.");
  }

  /* ---- wallet gate: unlock with password, or import a recovery phrase ----- */

  var session = { vault: null, address: null, locked: false };

  function saveViewSession() {
    if (!session.address) {
      return;
    }
    try {
      if (!root.sessionStorage) {
        return;
      }
      root.sessionStorage.setItem(
        VIEW_SESSION_KEY,
        JSON.stringify({
          address: session.address,
          lastActivity: state.lastActivity,
          autolockMinutes: state.autolockMinutes,
        })
      );
    } catch (e) {
      /* private mode / quota: the in-memory session still works */
    }
  }

  function clearViewSession() {
    try {
      if (root.sessionStorage) {
        root.sessionStorage.removeItem(VIEW_SESSION_KEY);
      }
    } catch (e) {
      /* non-fatal */
    }
  }

  function restoreViewSession() {
    try {
      var raw = root.sessionStorage && root.sessionStorage.getItem(VIEW_SESSION_KEY);
      var parsed = parseViewSession(raw, Date.now());
      if (!parsed) {
        if (raw) {
          clearViewSession();
        }
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function crypto() {
    return root.tkrCrypto || null;
  }
  function store() {
    return root.tkrStore || null;
  }

  function showGateForm(mode) {
    var unlock = el("gate-unlock");
    var importForm = el("gate-import");
    var toggle = el("gate-toggle");
    var importing = mode === "import";
    if (unlock) {
      unlock.hidden = importing;
    }
    if (importForm) {
      importForm.hidden = !importing;
    }
    setText(el("gate-title"), importing ? "Import wallet" : "Unlock wallet");
    if (toggle) {
      toggle.textContent = importing ? "Unlock with password instead" : "Use a recovery phrase instead";
    }
  }

  function showGateError(id, message) {
    var node = el(id);
    if (!node) {
      return;
    }
    if (message) {
      setText(node, message);
      node.removeAttribute("hidden");
    } else {
      node.setAttribute("hidden", "");
    }
  }

  function openGate(mode) {
    var gate = el("wallet-gate");
    if (!gate) {
      return;
    }
    gate.removeAttribute("hidden");
    showGateError("gate-error", null);
    showGateError("gate-import-error", null);
    if (mode === "unlock" || mode === "import") {
      showGateForm(mode);
      return;
    }
    // Auto-detect: unlock if a vault exists, else import.
    var s = store();
    if (!s) {
      showGateForm("import");
      return;
    }
    s.loadVault()
      .then(function (vault) {
        showGateForm(vault ? "unlock" : "import");
      })
      .catch(function () {
        showGateForm("import");
      });
  }

  function closeGate() {
    var gate = el("wallet-gate");
    if (gate) {
      gate.setAttribute("hidden", "");
    }
    var pw = el("gate-password");
    var np = el("gate-new-password");
    var mn = el("gate-mnemonic");
    if (pw) {
      pw.value = "";
    }
    if (np) {
      np.value = "";
    }
    if (mn) {
      mn.value = "";
    }
  }

  /* Derive + reveal the account. The plaintext phrase exists only for the
   * duration of this function; it is never stored outside the vault. */
  function revealAccount(phrase) {
    var c = crypto();
    var w = c.importMnemonic(phrase);
    session.address = w.evmAddress;
    session.locked = false;
    uiData.lastBalances = null; // never show a previous wallet's read
    uiData.lastChecked = null;
    setAccount(w.evmAddress);
    setWalletStatus("Wallet " + w.evmAddress + " unlocked. Reading balances\u2026");
    setWalletValue(null, state.currency, "Reading balances from the wallet edge\u2026");
    // Repaint the list so the empty state reflects the now-unlocked wallet
    // instead of the boot-time "No wallet yet" card, then pull real balances.
    renderTokens(null);
    state.lastActivity = Date.now();
    scheduleLock();
    saveViewSession();
    refreshBalances();
    return w;
  }

  /* ---- auto-lock: a security floor, not a preference --------------------- */

  function readStoredAutolock() {
    try {
      return parseAutolockMinutes(root.localStorage && root.localStorage.getItem(AUTOLOCK_KEY));
    } catch (e) {
      return AUTOLOCK_DEFAULT; // private mode / storage disabled
    }
  }

  function storeAutolock(minutes) {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(AUTOLOCK_KEY, String(minutes));
      }
    } catch (e) {
      /* non-fatal: the setting still applies for this session */
    }
  }

  function renderAutolock() {
    var buttons = document.querySelectorAll("[data-autolock]");
    for (var i = 0; i < buttons.length; i++) {
      var active = Number(buttons[i].getAttribute("data-autolock")) === state.autolockMinutes;
      buttons[i].setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function setAutolock(minutes) {
    state.autolockMinutes = parseAutolockMinutes(minutes);
    storeAutolock(state.autolockMinutes);
    renderAutolock();
    scheduleLock();
    setWalletStatus(
      "Auto-lock after " + state.autolockMinutes + " minute" + (state.autolockMinutes === 1 ? "" : "s") +
        " of inactivity. It cannot be turned off."
    );
  }

  function resetActivity() {
    state.lastActivity = Date.now();
    scheduleLock();
    saveViewSession();
  }

  /** Arm the inactivity timer. Activity resets it; expiry locks the wallet.
   * The re-check on fire keeps background-tab timer throttling honest. */
  function scheduleLock() {
    if (state.lockTimer) {
      clearTimeout(state.lockTimer);
      state.lockTimer = null;
    }
    if (!session.address) {
      return; // nothing unlocked to lock
    }
    var timeoutMs = state.autolockMinutes * 60000;
    var tick = function () {
      var remaining = timeoutMs - (Date.now() - state.lastActivity);
      if (remaining <= 0) {
        state.lockTimer = null;
        lockNow("auto");
      } else {
        state.lockTimer = setTimeout(tick, remaining);
      }
    };
    state.lockTimer = setTimeout(tick, timeoutMs);
  }

  function lockNow(reason) {
    var wasUnlocked = Boolean(session.address);
    if (!wasUnlocked && !session.locked) {
      setWalletStatus("No wallet is unlocked.");
      return;
    }
    if (state.lockTimer) {
      clearTimeout(state.lockTimer);
      state.lockTimer = null;
    }
    session.address = null;
    session.vault = null;
    session.locked = session.locked || wasUnlocked;
    clearViewSession();
    uiData.lastHoldings = null;
    uiData.lastPrices = null;
    uiData.lastBalances = null;
    uiData.lastChecked = null;
    closeGate();
    setAccount(null, "Locked");
    setWalletStatus(
      reason === "auto"
        ? "Auto-locked after " + state.autolockMinutes + " minutes of inactivity."
        : "Wallet locked."
    );
    setWalletValue(null, state.currency, "Unlock your wallet to see your balance.");
    renderTokens(null);
  }

  function onUnlock() {
    var password = (el("gate-password") || {}).value || "";
    if (!password) {
      showGateError("gate-error", "Enter your password.");
      return;
    }
    var s = store();
    var c = crypto();
    if (!s || !c) {
      showGateError("gate-error", "Wallet storage unavailable in this browser.");
      return;
    }
    s.loadVault()
      .then(function (vault) {
        if (!vault) {
          // No wallet on this device. Move to import and say why — a silent
          // bounce reads as a broken button.
          showGateForm("import");
          showGateError("gate-import-error", "No wallet on this device yet. Import a recovery phrase to create one.");
          throw new Error("no vault");
        }
        return c.decryptVault(vault, password);
      })
      .then(function (phrase) {
        session.vault = null;
        revealAccount(phrase);
        closeGate();
      })
      .catch(function (err) {
        if (err && err.message === "wrong-password") {
          showGateError("gate-error", "Wrong password.");
        } else if (err && err.message !== "no vault") {
          showGateError("gate-error", "Could not unlock this wallet.");
        }
      });
  }

  function onImport() {
    var phrase = ((el("gate-mnemonic") || {}).value || "").trim();
    var password = (el("gate-new-password") || {}).value || "";
    if (password.length < 8) {
      showGateError("gate-import-error", "Use at least 8 characters.");
      return;
    }
    var c = crypto();
    var s = store();
    if (!c || !s) {
      showGateError("gate-import-error", "Wallet storage unavailable in this browser.");
      return;
    }
    var wallet;
    try {
      wallet = c.importMnemonic(phrase); // throws invalid-mnemonic
    } catch (e) {
      showGateError("gate-import-error", "That phrase is not a valid recovery phrase.");
      return;
    }
    c.encryptVault(phrase, password)
      .then(function (vault) {
        return s.saveVault(vault);
      })
      .then(function () {
        revealAccount(phrase);
        closeGate();
      })
      .catch(function () {
        showGateError("gate-import-error", "Could not store the wallet on this device.");
      });
  }

  var state = {
    screen: DEFAULT_SCREEN,
    currency: "usd",
    onCurrencyChange: null,
    autolockMinutes: AUTOLOCK_DEFAULT,
    lastActivity: Date.now(),
    lockTimer: null,
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
        openGate();
      });
    }

    var unlockForm = el("gate-unlock");
    if (unlockForm) {
      unlockForm.addEventListener("submit", function (event) {
        event.preventDefault();
        onUnlock();
      });
    }
    var importForm = el("gate-import");
    if (importForm) {
      importForm.addEventListener("submit", function (event) {
        event.preventDefault();
        onImport();
      });
    }
    var toggle = el("gate-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        var importing = importForm && !importForm.hidden;
        showGateForm(importing ? "unlock" : "import");
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

    var settingsBtn = el("header-settings");
    if (settingsBtn) {
      settingsBtn.addEventListener("click", function () {
        go("settings");
      });
    }

    var autolockBtns = document.querySelectorAll("[data-autolock]");
    for (var a = 0; a < autolockBtns.length; a++) {
      autolockBtns[a].addEventListener("click", function (event) {
        setAutolock(event.currentTarget.getAttribute("data-autolock"));
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
        if (action === "lock") {
          lockNow("manual");
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

    /* Retry: the balance read is no longer a single shot. If it failed or came
     * back partial, the user can ask again instead of reloading the page. */
    var retry = el("balances-retry");
    if (retry) {
      retry.addEventListener("click", function () {
        refreshBalances();
      });
    }

    /* Add token by address: the built-in catalogue is fixed, so this is how a
     * holding outside it becomes visible. */
    var addBtn = el("add-token-btn");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        var form = el("add-token-form");
        if (!form) {
          return;
        }
        if (form.hasAttribute("hidden")) {
          form.removeAttribute("hidden");
          showAddTokenError(null);
          var address = el("add-token-address");
          if (address) {
            address.focus();
          }
        } else {
          form.setAttribute("hidden", "");
        }
      });
    }
    var addForm = el("add-token-form");
    if (addForm) {
      addForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var sel = el("add-token-chain");
        var input = el("add-token-address");
        addToken(sel ? sel.value : 1, input ? input.value : "");
      });
    }

    var detailBack = el("detail-back");
    if (detailBack) {
      detailBack.addEventListener("click", function () {
        go("home");
      });
    }
    var detailCopy = el("detail-copy");
    if (detailCopy) {
      detailCopy.addEventListener("click", copyDetailContract);
    }

    setText(el("holdings-scope"), holdingsScopeText());

    if (root.addEventListener) {
      root.addEventListener("hashchange", function () {
        showScreen(parseRoute(root.location.hash));
      });
    }

    /* Any interaction while unlocked re-arms the auto-lock timer. */
    if (root.addEventListener) {
      ["pointerdown", "keydown", "touchstart"].forEach(function (evt) {
        root.addEventListener(
          evt,
          function () {
            if (session.address) {
              resetActivity();
            }
          },
          { passive: true }
        );
      });
      // Timers are throttled in background tabs; on return, either the timeout
      // already elapsed (lock) or we re-arm for the remaining time.
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState !== "visible") {
          return;
        }
        if (!session.address) {
          return;
        }
        var timeoutMs = state.autolockMinutes * 60000;
        if (Date.now() - state.lastActivity >= timeoutMs) {
          lockNow("auto");
        } else {
          scheduleLock();
        }
      });
    }

    state.autolockMinutes = readStoredAutolock();
    renderAutolock();
    state.currency = readStoredCurrency();
    renderCurrency();
    showScreen(parseRoute(root.location && root.location.hash));
    maybePreview();
    if (!uiData.lastHoldings) {
      var restored = restoreViewSession();
      if (restored) {
        session.address = restored.address;
        session.locked = false;
        state.lastActivity = restored.lastActivity;
        state.autolockMinutes = restored.autolockMinutes;
        renderAutolock();
        setAccount(restored.address);
        setWalletStatus("Wallet " + restored.address + " still unlocked. Reading balances\u2026");
        setWalletValue(null, state.currency, "Reading balances from the wallet edge\u2026");
        scheduleLock();
        refreshBalances();
      }
    }
    if (!uiData.lastHoldings) {
      renderTokens(null); // the one shared empty-state design
      searchResults("");
    }
    // If a wallet is already on this device and no viewing session restored,
    // prompt for the password on boot — but not in preview mode.
    if (!session.address && !uiData.lastHoldings && store()) {
      store()
        .loadVault()
        .then(function (vault) {
          if (vault) {
            // A wallet exists on this device: it starts locked, not absent.
            session.locked = true;
            openGate("unlock");
          }
        })
        .catch(function () {
          /* storage unavailable — stay on the empty state */
        });
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
    parseTokenRoute: parseTokenRoute,
    parseCurrency: parseCurrency,
    parseAutolockMinutes: parseAutolockMinutes,
    parseViewSession: parseViewSession,
    AUTOLOCK_OPTIONS: AUTOLOCK_OPTIONS,
    AUTOLOCK_DEFAULT: AUTOLOCK_DEFAULT,
    shortAddress: shortAddress,
    formatFiat: formatFiat,
    formatAmount: formatAmount,
    showScreen: showScreen,
    go: go,
    goToken: goToken,
    setAccount: setAccount,
    setStatus: setStatus,
    setWalletStatus: setWalletStatus,
    setWalletValue: setWalletValue,
    setCurrency: setCurrency,
    renderTokens: renderTokens,
    searchResults: searchResults,
    maybePreview: maybePreview,
    renderAll: renderAll,
    renderDetail: renderDetail,
    refreshBalances: refreshBalances,
    readStoredTokens: readStoredTokens,
    addToken: addToken,
    holdingsScopeText: holdingsScopeText,
    openGate: openGate,
    closeGate: closeGate,
    showGateForm: showGateForm,
    lockNow: lockNow,
    setAutolock: setAutolock,
    session: session,
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
