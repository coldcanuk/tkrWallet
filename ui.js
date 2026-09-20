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

  var SCREENS = ["home", "swap", "activity", "search", "settings", "detail", "send", "receive", "airdrops"];
  var ACCOUNT_COLORS = ["#e8a33d", "#a8a29e", "#4ade80", "#cfc8b8", "#d98a1f"];
  var DEFAULT_SCREEN = "home";
  var CURRENCIES = ["usd", "cad", "mxn"];
  var STORAGE_KEY = "tkrwallet.currency";
  var AUTOLOCK_KEY = "tkrwallet.autolock";
  var VIEW_SESSION_KEY = "tkrwallet.view-session";
  /* Auto-lock is a security floor, not a preference: it cannot be turned off
   * and the longest offered session is 1 hour. Default is 5 minutes. */
  var AUTOLOCK_OPTIONS = [1, 5, 15, 30, 60];
  var AUTOLOCK_DEFAULT = 5;
  var AUTOLOCK_MAX = 60;
  var CREATE_CONFIRM = "I saved my recovery phrase";

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

  /** Extension popup vs docked side panel vs PWA/tab. Never throws. */
  function parseShellMode(search, protocol) {
    var q = String(search == null ? "" : search);
    if (/(^|[?&])mode=panel([&#]|$)/.test(q)) {
      return "panel";
    }
    if (String(protocol || "") === "chrome-extension:") {
      return "popup";
    }
    return "page";
  }

  var CLI_HELP = [
    "tkrWallet CLI. Secrets are never printed.",
    "help              this list",
    "status            lock state and public account",
    "home | search | settings | swap | activity",
    "search <query>    open token search",
    "lock              lock now",
    "dock              dock to the browser side panel",
    "clear             clear this log",
    "close             close the terminal",
  ];
  var CLI_REFUSE = /^(seed|mnemonic|phrase|secret|private|privkey|password|passwd|export|backup)$/i;

  /**
   * Wallet CLI. Pure — tests call this without a DOM.
   * Returns { lines, action, refuse }. Never includes key material.
   */
  function runCliCommand(raw, ctx) {
    var line = String(raw == null ? "" : raw).trim();
    var out = { lines: [], action: null, refuse: false };
    if (!line) {
      return out;
    }
    var parts = line.split(/\s+/);
    var cmd = parts[0].toLowerCase();
    var rest = parts.slice(1).join(" ");
    if (CLI_REFUSE.test(cmd)) {
      out.refuse = true;
      out.lines.push("refused: the CLI never prints keys, phrases, or passwords.");
      return out;
    }
    if (cmd === "help" || cmd === "?") {
      out.lines = CLI_HELP.slice();
      return out;
    }
    if (cmd === "clear") {
      out.action = { type: "clear" };
      return out;
    }
    if (cmd === "close" || cmd === "exit") {
      out.action = { type: "close" };
      return out;
    }
    if (cmd === "lock") {
      out.action = { type: "lock" };
      out.lines.push("locking.");
      return out;
    }
    if (cmd === "dock") {
      out.action = { type: "dock" };
      return out;
    }
    if (cmd === "home" || cmd === "settings" || cmd === "swap" || cmd === "activity") {
      out.action = { type: "go", screen: cmd };
      out.lines.push("opening " + cmd + ".");
      return out;
    }
    if (cmd === "search") {
      out.action = { type: "search", query: rest };
      out.lines.push(rest ? "searching." : "opening search.");
      return out;
    }
    if (cmd === "status") {
      var unlocked = !!(ctx && ctx.unlocked);
      var address = ctx && ctx.address ? String(ctx.address) : "";
      out.lines.push(unlocked ? "unlocked." : "locked.");
      out.lines.push(address ? shortAddress(address) : "no account.");
      return out;
    }
    out.lines.push("unknown command. type help.");
    return out;
  }

  /** Normalise a currency code, falling back to USD. */
  function parseCurrency(value) {
    var code = String(value == null ? "" : value).toLowerCase();
    if (code === "mxd") {
      code = "mxn";
    }
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
   * PWA keeps it in sessionStorage; the MV3 popup uses localStorage because
   * the popup document is destroyed on close. Rejected when stale, malformed,
   * or missing. Pure — tests call this without a DOM.
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
    var solAddress = String(parsed.solAddress || "").trim();
    if (solAddress && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solAddress)) {
      solAddress = "";
    }
    var tronAddress = String(parsed.tronAddress || "").trim();
    if (tronAddress && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(tronAddress)) {
      tronAddress = "";
    }
    return {
      address: address,
      lastActivity: lastActivity,
      autolockMinutes: minutes,
      solAddress: solAddress || null,
      tronAddress: tronAddress || null,
    };
  }

  /** Typed backup confirm: exact sentence, trimmed. Not a checkbox. */
  function typedCreateConfirm(typed) {
    return String(typed || "").trim() === CREATE_CONFIRM;
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

  function formatHeld(value) {
    if (value === null || value === undefined || value === "" || isNaN(Number(value))) {
      return "\u2014";
    }
    var n = Number(value);
    if (Number.isInteger(n)) {
      return String(n);
    }
    return formatAmount(n);
  }

  function formatAsOf(unix) {
    if (unix === null || unix === undefined || unix === "" || isNaN(Number(unix))) {
      return "\u2014";
    }
    var d = new Date(Number(unix) * 1000);
    if (isNaN(d.getTime())) {
      return "\u2014";
    }
    return d.toLocaleString();
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

  function applyShellClass() {
    var search = root.location && root.location.search;
    var protocol = root.location && root.location.protocol;
    var mode = parseShellMode(search, protocol);
    if (typeof document === "undefined" || !document.documentElement) {
      return mode;
    }
    document.documentElement.classList.remove("extension-popup", "extension-panel");
    if (mode === "panel") {
      document.documentElement.classList.add("extension-panel");
    } else if (mode === "popup") {
      document.documentElement.classList.add("extension-popup");
    }
    var dock = el("header-dock");
    if (dock) {
      if (mode === "panel") {
        dock.setAttribute("aria-pressed", "true");
        dock.setAttribute("aria-label", "Undock");
      } else {
        dock.removeAttribute("aria-pressed");
        dock.setAttribute("aria-label", "Dock");
      }
    }
    return mode;
  }

  function appendTerminalLine(kind, text) {
    var log = el("terminal-log");
    if (!log) {
      return;
    }
    var line = document.createElement("p");
    line.className = kind === "in" ? "text-cream-500" : "whitespace-pre-wrap text-cream-100";
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function clearTerminalLog() {
    var log = el("terminal-log");
    if (log) {
      while (log.firstChild) {
        log.removeChild(log.firstChild);
      }
    }
  }

  function openTerminal() {
    var term = el("wallet-terminal");
    if (!term) {
      return;
    }
    var log = el("terminal-log");
    if (log && !log.firstChild) {
      appendTerminalLine("out", "tkrWallet CLI. Type help. Secrets are never printed.");
    }
    term.removeAttribute("hidden");
    var input = el("terminal-input");
    if (input) {
      input.focus();
    }
  }

  function closeTerminal() {
    var term = el("wallet-terminal");
    if (term) {
      term.setAttribute("hidden", "");
    }
  }

  function applyCliResult(result) {
    if (!result) {
      return;
    }
    var i;
    for (i = 0; i < result.lines.length; i++) {
      appendTerminalLine("out", result.lines[i]);
    }
    var action = result.action;
    if (!action || !action.type) {
      return;
    }
    if (action.type === "clear") {
      clearTerminalLog();
      return;
    }
    if (action.type === "close") {
      closeTerminal();
      return;
    }
    if (action.type === "lock") {
      closeTerminal();
      lockNow();
      return;
    }
    if (action.type === "dock") {
      dockWallet();
      return;
    }
    if (action.type === "go") {
      closeTerminal();
      go(action.screen);
      return;
    }
    if (action.type === "search") {
      closeTerminal();
      go("search");
      var input = el("search-input");
      if (input) {
        input.value = action.query || "";
        searchResults(input.value);
        input.focus();
      }
    }
  }

  function submitTerminal() {
    var input = el("terminal-input");
    var raw = input ? input.value : "";
    if (input) {
      input.value = "";
    }
    if (String(raw).trim()) {
      appendTerminalLine("in", "$ " + String(raw).trim());
    }
    applyCliResult(
      runCliCommand(raw, {
        unlocked: !!(session.address && !session.locked),
        address: session.address || "",
      })
    );
  }

  function dockWallet() {
    var mode = parseShellMode(root.location && root.location.search, root.location && root.location.protocol);
    if (mode === "panel") {
      if (typeof root.close === "function") {
        root.close();
      }
      return;
    }
    var chromeApi = root.chrome;
    var sidePanel = chromeApi && chromeApi.sidePanel;
    var windowsApi = chromeApi && chromeApi.windows;
    if (!sidePanel || typeof sidePanel.open !== "function" || !windowsApi || typeof windowsApi.getCurrent !== "function") {
      setWalletStatus("Dock needs the Chrome or Brave extension.");
      return;
    }
    windowsApi.getCurrent(function (win) {
      if (!win || !win.id) {
        setWalletStatus("Dock could not find this browser window.");
        return;
      }
      var opened = sidePanel.open({ windowId: win.id });
      if (opened && typeof opened.then === "function") {
        opened
          .then(function () {
            if (typeof root.close === "function") {
              root.close();
            }
          })
          .catch(function () {
            setWalletStatus("Dock is not available in this browser.");
          });
        return;
      }
      if (typeof root.close === "function") {
        root.close();
      }
    });
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
    if (next !== "send") {
      stopSendCamera();
      hideSendRecent();
    }
    if (next === "detail") {
      renderDetail();
    }
    if (next === "receive") {
      renderReceive();
    }
    if (next === "send") {
      paintSendContacts();
    }
    if (next === "swap") {
      fillSwapPairs();
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
  function accountDotLabel(index) {
    var n = Number(index);
    if (!isFinite(n) || n < 0) {
      n = 0;
    }
    return "A" + String(n + 1);
  }

  function selectedIndexFromVault(vault) {
    if (!vault || !vault.accounts || !vault.accounts.length) {
      return 0;
    }
    var selected = Number(vault.selectedIndex);
    var i;
    if (isFinite(selected) && selected >= 0 && selected === Math.floor(selected)) {
      for (i = 0; i < vault.accounts.length; i++) {
        if (Number(vault.accounts[i].i) === selected) {
          return selected;
        }
      }
    }
    var first = Number(vault.accounts[0].i);
    return isFinite(first) && first >= 0 ? first : 0;
  }

  function renderReceive() {
    var chain = Number((el("receive-chain") || {}).value || 1);
    var addr = chain === 900001 ? session.solAddress : session.address;
    var label = chain === 900001 ? "Solana" : chain === 8453 ? "Base" : chain === 4663 ? "Robinhood" : "Ethereum";
    setText(el("receive-account-label"), "Account " + (Number(session.index) + 1) + " · " + label);
    setText(el("receive-address"), addr || "Unlock to see this address.");
    setText(
      el("receive-note"),
      addr
        ? chain === 900001
          ? "Pay this Solana address. It is not the EVM address."
          : "Same EVM address on Ethereum, Base, and Robinhood. Scan the QR to pay this account."
        : "No wallet is unlocked."
    );
    paintReceiveQr(addr);
  }

  function paintReceiveQr(addr) {
    var img = el("receive-qr");
    if (!img) {
      return;
    }
    if (!addr || !root.tkrQr || typeof root.tkrQr.encode !== "function") {
      img.setAttribute("hidden", "");
      img.removeAttribute("src");
      return;
    }
    try {
      var qr = root.tkrQr.encode(String(addr));
      var data = qr && qr.data;
      if (!data || !data.length) {
        img.setAttribute("hidden", "");
        return;
      }
      var size = data.length;
      var scale = Math.max(4, Math.floor(192 / size));
      var canvas = document.createElement("canvas");
      canvas.width = size * scale;
      canvas.height = size * scale;
      var ctx = canvas.getContext("2d");
      if (!ctx) {
        img.setAttribute("hidden", "");
        return;
      }
      ctx.fillStyle = "#faf8f2";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#12100e";
      var y;
      var x;
      for (y = 0; y < size; y++) {
        for (x = 0; x < size; x++) {
          if (data[y][x]) {
            ctx.fillRect(x * scale, y * scale, scale, scale);
          }
        }
      }
      img.src = canvas.toDataURL("image/png");
      img.removeAttribute("hidden");
    } catch (e) {
      img.setAttribute("hidden", "");
      img.removeAttribute("src");
    }
  }

  function renderAccountDrawer() {
    var list = el("account-list");
    if (!list) {
      return;
    }
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    var accounts = session.accounts || [];
    if (!session.address || !accounts.length) {
      return;
    }
    accounts.forEach(function (acc, n) {
      var wrap = document.createElement("div");
      var btn = document.createElement("button");
      var cap = document.createElement("span");
      var idx = acc && acc.i != null ? Number(acc.i) : n;
      var mine =
        acc &&
        acc.evmAddress &&
        session.address &&
        String(acc.evmAddress).toLowerCase() === String(session.address).toLowerCase();
      wrap.className = "flex flex-col items-center gap-1";
      btn.type = "button";
      btn.className =
        "flex size-11 items-center justify-center rounded-full text-xs font-semibold text-ink-950 ring-1 ring-inset ring-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400";
      if (mine) {
        btn.className += " ring-2";
      }
      btn.style.backgroundColor = ACCOUNT_COLORS[n % ACCOUNT_COLORS.length];
      btn.textContent = accountDotLabel(idx);
      btn.setAttribute("aria-label", "Account " + (idx + 1));
      btn.setAttribute("aria-current", mine ? "true" : "false");
      btn.addEventListener("click", function () {
        switchAccount(idx);
      });
      cap.className = "max-w-14 truncate text-center text-[10px] leading-tight text-cream-500";
      cap.textContent = "Account " + (idx + 1);
      wrap.appendChild(btn);
      wrap.appendChild(cap);
      list.appendChild(wrap);
    });
  }

  function setDrawerOpen(open) {
    var btn = el("account-btn");
    if (btn) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }

  function openAccountDrawer() {
    renderAccountDrawer();
    var drawer = el("account-drawer");
    var backdrop = el("account-drawer-backdrop");
    if (drawer) {
      drawer.removeAttribute("hidden");
    }
    if (backdrop) {
      backdrop.removeAttribute("hidden");
    }
    setDrawerOpen(true);
  }

  function closeAccountDrawer() {
    var drawer = el("account-drawer");
    var backdrop = el("account-drawer-backdrop");
    if (drawer) {
      drawer.setAttribute("hidden", "");
    }
    if (backdrop) {
      backdrop.setAttribute("hidden", "");
    }
    setDrawerOpen(false);
  }

  function persistSelectedIndex(index) {
    var s = store();
    if (!s) {
      return;
    }
    s.loadVault()
      .then(function (vault) {
        if (!vault) {
          return;
        }
        vault.selectedIndex = Number(index);
        return s.saveVault(vault);
      })
      .catch(function () {
        /* non-fatal: next unlock falls back to account 0 */
      });
  }

  function switchAccount(index) {
    if (!session.phrase) {
      setWalletStatus("Unlock the wallet to switch accounts.");
      return;
    }
    var idx = Number(index);
    if (!isFinite(idx) || idx < 0) {
      return;
    }
    revealAccount(session.phrase, idx);
    persistSelectedIndex(idx);
    closeAccountDrawer();
  }

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

  var busyCount = 0;
  var BUSY_BUTTONS = [
    "swap-quote",
    "swap-submit",
    "send-submit",
    "pool-add",
    "pool-search",
    "pool-refresh",
    "balances-retry",
    "detail-buy",
    "detail-send",
    "detail-swap",
    "add-token-btn",
    "fx-live",
  ];

  function isBusy() {
    return busyCount > 0;
  }

  function paintBusy(message) {
    var on = busyCount > 0;
    var bar = el("scratchpost-busy");
    var app = el("app");
    var card = el("wallet-value-card");
    var label = el("scratchpost-busy-label");
    var i;
    var extras;
    if (app) {
      if (on) {
        app.setAttribute("aria-busy", "true");
      } else {
        app.removeAttribute("aria-busy");
      }
    }
    if (bar) {
      if (on) {
        bar.removeAttribute("hidden");
      } else {
        bar.setAttribute("hidden", "");
      }
    }
    if (label && on && message) {
      setText(label, message);
    }
    if (card && card.classList) {
      if (on) {
        card.classList.add("tkr-busy-pulse");
      } else {
        card.classList.remove("tkr-busy-pulse");
      }
    }
    if (typeof document !== "undefined" && document.documentElement && document.documentElement.classList) {
      document.documentElement.classList.toggle("tkr-busy", on);
    }
    for (i = 0; i < BUSY_BUTTONS.length; i++) {
      var btn = el(BUSY_BUTTONS[i]);
      if (!btn) {
        continue;
      }
      btn.disabled = on;
      if (on) {
        btn.setAttribute("aria-disabled", "true");
      } else {
        btn.removeAttribute("aria-disabled");
      }
    }
    if (typeof document !== "undefined" && document.querySelectorAll) {
      extras = document.querySelectorAll("[data-currency]");
      for (i = 0; i < extras.length; i++) {
        extras[i].disabled = on;
        if (on) {
          extras[i].setAttribute("aria-disabled", "true");
        } else {
          extras[i].removeAttribute("aria-disabled");
        }
      }
    }
  }

  function setBusy(message) {
    var first = busyCount === 0;
    busyCount += 1;
    if (message && first) {
      setWalletStatus(message);
    }
    paintBusy(message);
  }

  function clearBusy() {
    if (busyCount > 0) {
      busyCount -= 1;
    }
    paintBusy();
  }

  /** Refcount Scratchpost waits so overlapping fetches keep one indicator
   * and Quote / Retry / Send stay inert until the last wait settles. */
  function withBusy(work, message) {
    setBusy(message || "Talking to Scratchpost\u2026");
    return Promise.resolve()
      .then(function () {
        return typeof work === "function" ? work() : work;
      })
      .then(
        function (value) {
          clearBusy();
          return value;
        },
        function (err) {
          clearBusy();
          throw err;
        }
      );
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
  function unitPriceFor(holding, prices) {
    var wallet = root.tkrWalletData;
    if (!prices || prices.state !== "ok" || !prices.prices) {
      return null;
    }
    var entry = prices.prices[wallet ? wallet.assetKey(holding) : ""];
    if (!entry && holding && holding.address) {
      entry = prices.prices[holding.chain_id + ":" + String(holding.address).toLowerCase()];
    }
    if (!entry || typeof entry[state.currency] !== "number" || !isFinite(entry[state.currency])) {
      return null;
    }
    return entry[state.currency];
  }

  function usdPriceFor(holding, prices) {
    var wallet = root.tkrWalletData;
    if (!prices || prices.state !== "ok" || !prices.prices || !holding) {
      return null;
    }
    var entry = prices.prices[wallet ? wallet.assetKey(holding) : ""];
    if (!entry && holding.address) {
      entry = prices.prices[holding.chain_id + ":" + String(holding.address).toLowerCase()];
    }
    if (!entry || typeof entry.usd !== "number" || !isFinite(entry.usd)) {
      return null;
    }
    return entry.usd;
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
        cta: "Unlock with password",
        action: function () {
          openGate("unlock");
        },
      };
    }
    return {
      title: "No wallet yet",
      body: "Unlock with a password, import / recover with a recovery phrase, or create a new wallet. Keys stay encrypted on this device.",
      cta: "Import / Recover",
      action: function () {
        openGate("import");
      },
      create: function () {
        openGate("create");
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

  function paintTokenBadge(badge, symbol, color, chainId, address) {
    if (!badge) {
      return;
    }
    badge.style.backgroundColor = color || "#cfc8b8";
    var letter = badge.querySelector("[data-token-letter]");
    if (letter) {
      letter.textContent = String(symbol || "?").slice(0, 3);
    }
    var logo = badge.querySelector("[data-token-logo]");
    var src =
      root.tkrWalletData && root.tkrWalletData.tokenIconUrl
        ? root.tkrWalletData.tokenIconUrl(chainId, address)
        : null;
    if (!logo || !src) {
      if (logo) {
        logo.setAttribute("hidden", "");
      }
      if (!letter) {
        badge.textContent = String(symbol || "?").slice(0, 3);
      }
      return;
    }
    logo.onload = function () {
      logo.removeAttribute("hidden");
    };
    logo.onerror = function () {
      logo.setAttribute("hidden", "");
      logo.removeAttribute("src");
    };
    logo.setAttribute("hidden", "");
    logo.src = src;
  }

  function fillTokenRow(holding, prices) {
    var tpl = el("tpl-token-row");
    if (!tpl) {
      return null;
    }
    var row = tpl.content.firstElementChild.cloneNode(true);
    var badge = row.querySelector("[data-token-badge]");
    row.addEventListener("click", function () {
      goToken(holding.chain_id, holding.address);
    });
    setText(row.querySelector("[data-token-name]"), holding.symbol || "?");
    setText(
      row.querySelector("[data-token-amount]"),
      holding.state === "unknown" ? "\u2014" : formatHeld(holding.amount)
    );
    setText(row.querySelector("[data-token-price]"), formatFiat(unitPriceFor(holding, prices), state.currency));
    setText(row.querySelector("[data-token-asof]"), formatAsOf(prices && prices.as_of));
    if (badge) {
      paintTokenBadge(badge, holding.symbol, holding.color, holding.chain_id, holding.address);
    }
    return row;
  }

  function splitCurrentHoldings(holdings, prices) {
    var wallet = root.tkrWalletData;
    if (!wallet || !wallet.splitHoldings) {
      return { desk: holdings || [], airdrops: [] };
    }
    return wallet.splitHoldings(holdings, prices, readStoredTokens(), state.currency);
  }

  function renderAirdrops(airdrops, prices) {
    var open = el("airdrops-open");
    var box = el("airdrop-list");
    var count = airdrops && airdrops.length ? airdrops.length : 0;
    if (open) {
      setText(open, count ? "Airdrop (" + count + ")" : "Airdrop");
    }
    if (!box) {
      return;
    }
    box.textContent = "";
    appendHoldingRows(box, airdrops, prices, "No unpriced airdrops right now.");
  }

  function appendHoldingRows(box, rows, prices, emptyCopy) {
    if (!box) {
      return;
    }
    if (!rows || !rows.length) {
      var empty = document.createElement("p");
      empty.className = "px-4 py-6 text-center text-sm text-cream-300";
      empty.textContent = emptyCopy;
      box.appendChild(empty);
      return;
    }
    rows.forEach(function (holding) {
      var row = fillTokenRow(holding, prices);
      if (row) {
        box.appendChild(row);
      }
    });
  }

  function paintDeskTabs() {
    var tabs = document.querySelectorAll("[data-desk-tab]");
    var current = uiData.deskTab || "mine";
    for (var i = 0; i < tabs.length; i++) {
      var name = tabs[i].getAttribute("data-desk-tab");
      tabs[i].setAttribute("aria-pressed", name === current ? "true" : "false");
    }
  }

  function signBuiltTx(tx, chainId) {
    var c = crypto();
    var data = root.tkrWalletData;
    if (!session.phrase || !c || !data) {
      return Promise.reject(new Error("locked"));
    }
    if (Number(chainId) === 900001) {
      var signedSol = c.signSolanaVersionedTx(session.phrase, tx.tx_b64 || tx);
      return data.broadcastRaw({ raw: signedSol.raw, chain_id: 900001 });
    }
    var signed = c.signAndBroadcastPayload(session.phrase, session.index, tx);
    return data.broadcastRaw({ raw: signed.raw, chain_id: signed.chainId });
  }

  function poolChainId() {
    return Number((el("pool-chain") || {}).value || 1);
  }

  function setPoolNote(msg) {
    setText(el("pool-note"), msg || "");
  }

  function refreshPoolPositions() {
    var wallet = root.tkrWalletData;
    var box = el("pool-positions");
    if (!wallet || typeof wallet.listPositions !== "function" || !box) {
      return;
    }
    if (!session.address) {
      box.textContent = "Unlock to see positions.";
      return;
    }
    box.textContent = "Reading positions\u2026";
    return withBusy(function () {
      return wallet.listPositions(poolChainId(), session.address);
    }, "Reading pool positions from Scratchpost\u2026").then(function (body) {
      box.textContent = "";
      var rows = (body && body.positions) || [];
      if (!rows.length) {
        box.textContent = "No Uniswap v3 positions on this chain.";
        return;
      }
      rows.forEach(function (p) {
        var row = document.createElement("div");
        row.className = "mb-3 rounded-lg bg-ink-950 p-3 ring-1 ring-inset ring-white/10";
        var title = document.createElement("p");
        title.className = "text-sm text-cream-100";
        title.textContent = (p.symbol0 || "T0") + "/" + (p.symbol1 || "T1") + " · " + (Number(p.fee) / 10000) + "%";
        var meta = document.createElement("p");
        meta.className = "mt-1 text-[11px] text-cream-500";
        meta.textContent = "NFT " + p.token_id + " · liq " + p.liquidity;
        var actions = document.createElement("div");
        actions.className = "mt-2 flex gap-2";
        var collect = document.createElement("button");
        collect.type = "button";
        collect.className = "min-h-9 flex-1 rounded-full bg-ink-900 text-xs text-ember-400 ring-1 ring-inset ring-white/10";
        collect.textContent = "Collect fees";
        collect.addEventListener("click", function () {
          onPoolBuild({ action: "collect", chain_id: poolChainId(), token_id: p.token_id });
        });
        var exit = document.createElement("button");
        exit.type = "button";
        exit.className = "min-h-9 flex-1 rounded-full bg-ink-900 text-xs text-ember-400 ring-1 ring-inset ring-white/10";
        exit.textContent = "Withdraw";
        exit.addEventListener("click", function () {
          onPoolBuild({
            action: "decrease",
            chain_id: poolChainId(),
            token_id: p.token_id,
            liquidity: p.liquidity,
          });
        });
        actions.appendChild(collect);
        actions.appendChild(exit);
        row.appendChild(title);
        row.appendChild(meta);
        row.appendChild(actions);
        box.appendChild(row);
      });
    }).catch(function () {
      box.textContent = "Could not read positions.";
    });
  }

  function onPoolBuild(payload) {
    var wallet = root.tkrWalletData;
    if (!wallet || typeof wallet.buildPool !== "function") {
      setPoolNote("Pools are unavailable.");
      return;
    }
    if (!session.phrase) {
      openGate("unlock");
      return;
    }
    setPoolNote("Building\u2026");
    withBusy(function () {
      return wallet.buildPool(payload).then(function (body) {
        if (!body || body.ok === false || !body.tx) {
          throw new Error((body && body.error) || "build");
        }
        return signBuiltTx(body.tx, body.chain_id).then(function (sent) {
          if (!sent || sent.ok === false) {
            throw new Error("broadcast");
          }
          setPoolNote("Broadcast " + (sent.tx_hash || "") + ". If Scratchpost asked for wrap or approve, tap Add again.");
          return refreshPoolPositions();
        });
      });
    }, "Building pool transaction\u2026").catch(function () {
      setPoolNote("Pool tx failed. The key did not leave this device.");
    });
  }

  function onPoolSearch() {
    var wallet = root.tkrWalletData;
    var box = el("pool-search-results");
    if (!wallet || typeof wallet.searchPools !== "function" || !box) {
      return;
    }
    var a = String((el("pool-token-a") || {}).value || "native");
    var b = String((el("pool-token-b") || {}).value || "");
    box.textContent = "Searching\u2026";
    withBusy(function () {
      return wallet.searchPools({
        chain_id: poolChainId(),
        token_a: a,
        token_b: b,
        fee: Number((el("pool-fee") || {}).value || 3000),
      });
    }, "Searching pools on Scratchpost\u2026").then(function (body) {
      box.textContent = "";
      var pools = (body && body.pools) || [];
      if (!pools.length) {
        box.textContent = "No pool on this fee tier.";
        return;
      }
      pools.forEach(function (p) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = "mb-2 min-h-11 w-full rounded-lg bg-ink-950 px-3 text-left text-xs text-cream-100 ring-1 ring-inset ring-white/10";
        row.textContent = (p.symbol0 || "T0") + "/" + (p.symbol1 || "T1") + " · " + p.pool;
        row.addEventListener("click", function () {
          if (el("pool-token-a")) el("pool-token-a").value = p.token0;
          if (el("pool-token-b")) el("pool-token-b").value = p.token1;
          setPoolNote("Selected " + p.pool);
        });
        box.appendChild(row);
      });
    }).catch(function () {
      box.textContent = "Search failed.";
    });
  }

  function onSendSubmit() {
    var wallet = root.tkrWalletData;
    var c = crypto();
    if (!wallet || typeof wallet.buildSend !== "function" || !c) {
      setText(el("send-note"), "Send is unavailable.");
      return;
    }
    if (!session.phrase) {
      openGate("unlock");
      return;
    }
    var chainId = Number((el("send-chain") || {}).value || 1);
    var to = String((el("send-to") || {}).value || "").trim();
    var amountHuman = String((el("send-amount") || {}).value || "").trim();
    var token = String((el("send-token") || {}).value || "native");
    var atomic = wallet.toAtomicAmount(amountHuman, chainId === 900001 ? 9 : 18);
    var from = chainId === 900001 ? session.solAddress : session.address;
    setText(el("send-note"), "Building send\u2026");
    withBusy(function () {
      return wallet
        .buildSend({ chain_id: chainId, from: from, to: to, amount: atomic, token: token })
        .then(function (body) {
          if (!body || body.ok === false) {
            throw new Error((body && body.error) || "build");
          }
          if (chainId === 900001) {
            return signBuiltTx({ tx_b64: body.tx_b64 }, 900001);
          }
          return signBuiltTx(body.tx, body.chain_id);
        })
        .then(function (sent) {
          if (!sent || sent.ok === false) {
            throw new Error("broadcast");
          }
          setText(el("send-note"), "Broadcast " + (sent.tx_hash || "") + ".");
          setWalletStatus("Sent. Key stayed on this device.");
        });
    }, "Building send on Scratchpost\u2026").catch(function () {
      setText(el("send-note"), "Send failed. Nothing was signed off-device.");
    });
  }

  function onPoolAdd() {
    var wallet = root.tkrWalletData;
    if (!wallet || typeof wallet.toAtomicAmount !== "function") {
      return;
    }
    var a = String((el("pool-token-a") || {}).value || "native");
    var b = String((el("pool-token-b") || {}).value || "");
    var amtA = String((el("pool-amount-a") || {}).value || "0");
    var amtB = String((el("pool-amount-b") || {}).value || "0");
    var atomicA = wallet.toAtomicAmount(amtA, 18);
    var atomicB = wallet.toAtomicAmount(amtB, 18);
    onPoolBuild({
      action: "mint",
      chain_id: poolChainId(),
      token_a: a,
      token_b: b,
      fee: Number((el("pool-fee") || {}).value || 3000),
      amount_a: atomicA,
      amount_b: atomicB,
      native_a: !a || a.toLowerCase() === "native" || a.toUpperCase() === "ETH",
      native_b: !b || b.toLowerCase() === "native" || b.toUpperCase() === "ETH",
    });
  }

  function setDeskTab(name) {
    var next = name === "tokens" || name === "airdrop" || name === "pools" ? name : "mine";
    uiData.deskTab = next;
    paintDeskTabs();
    setText(el("holdings-scope"), holdingsScopeText());
    if (state.screen !== "home") {
      go("home");
    }
    renderTokens(uiData.lastHoldings, uiData.lastPrices);
  }

  function rowsForDeskTab(holdings, prices) {
    var wallet = root.tkrWalletData;
    var split = splitCurrentHoldings(holdings, prices);
    var tab = uiData.deskTab || "mine";
    if (tab === "airdrop") {
      return { rows: split.airdrops, empty: "No unpriced airdrops right now." };
    }
    if (tab === "tokens") {
      var chains = uiData.lastBalances && uiData.lastBalances.chains;
      var list =
        wallet && typeof wallet.tokenListRows === "function"
          ? wallet.tokenListRows(holdings || [], chains, readStoredTokens())
          : [];
      return {
        rows: list,
        empty: "Ethereum and Base tokens will list here after a successful read.",
      };
    }
    var mine = wallet && typeof wallet.mineHoldings === "function" ? wallet.mineHoldings(split.desk) : split.desk;
    return {
      rows: mine,
      empty: split.airdrops.length
        ? "No balances on Mine. Open Airdrop for unpriced tokens."
        : "No balances on this account. Tokens lists Ethereum and Base, including zeros.",
    };
  }

  function renderTokens(holdings, prices) {
    var box = el("token-list");
    var tpl = el("tpl-token-row");
    if (!box || !tpl) {
      return [];
    }
    box.textContent = "";
    renderBalancesNotice();
    paintDeskTabs();
    setText(el("holdings-scope"), holdingsScopeText());
    var poolsPanel = el("pools-panel");
    if (poolsPanel) {
      if ((uiData.deskTab || "mine") === "pools") {
        poolsPanel.removeAttribute("hidden");
        box.setAttribute("hidden", "");
        refreshPoolPositions();
        return;
      }
      poolsPanel.setAttribute("hidden", "");
      box.removeAttribute("hidden");
    }
    var split = splitCurrentHoldings(holdings, prices);
    renderAirdrops(split.airdrops, prices);
    if (!session.address || holdings == null) {
      var tplEmpty = el("tpl-token-empty");
      if (tplEmpty) {
        var node = tplEmpty.content.firstElementChild.cloneNode(true);
        var state_ = emptyStateFor();
        var cta = node.querySelector("[data-import]");
        var createBtn = node.querySelector("[data-create]");
        setText(node.querySelector("[data-empty-title]"), state_.title);
        setText(node.querySelector("[data-empty-body]"), state_.body);
        if (cta) {
          setText(cta, state_.cta);
          cta.addEventListener("click", function () {
            state_.action();
          });
        }
        if (createBtn) {
          if (state_.create) {
            createBtn.removeAttribute("hidden");
            createBtn.addEventListener("click", function () {
              state_.create();
            });
          } else {
            createBtn.setAttribute("hidden", "");
          }
        }
        box.appendChild(node);
      }
      return [];
    }
    var view = rowsForDeskTab(holdings, prices);
    appendHoldingRows(box, view.rows, prices, view.empty);
    return view.rows;
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
        ? "Balances are unknown: " +
          (read.reason === "edge-unreachable"
            ? "the wallet edge could not be reached."
            : read.reason === "edge-http"
              ? "the wallet edge returned an error."
              : "the read failed.")
        : "Some chains could not be read. " + chainProblems(read);
    setText(el("balances-notice-text"), text);
    var extra = [];
    if (read.detail) {
      extra.push(read.detail);
    }
    try {
      if (root.chrome && chrome.runtime && chrome.runtime.id) {
        extra.push("extension " + chrome.runtime.id);
      }
    } catch (e) {
      /* non-extension */
    }
    setText(el("balances-notice-detail"), extra.join(" · "));
    var when = el("balances-checked");
    setText(when, uiData.lastChecked ? "Last checked " + new Date(uiData.lastChecked).toLocaleTimeString() : "");
    box.removeAttribute("hidden");
  }

  /* ---- search ------------------------------------------------------------ */

  /** Paint search hits. Edge catalogue first (ETH/Base); local list fills gaps. */
  var searchSeq = 0;
  var searchDebounce = null;

  function paintSearchHint(box, q, fromEdge) {
    var hint = document.createElement("div");
    hint.className = "px-4 py-6 text-center";
    var line = document.createElement("p");
    line.className = "text-sm text-cream-300";
    line.textContent = q
      ? fromEdge
        ? "No match on Ethereum or Base."
        : "No match in known tokens."
      : "Search Ethereum and Base tokens";
    var sub = document.createElement("p");
    sub.className = "mt-1 text-xs text-cream-500";
    sub.textContent = q
      ? "Search uses Scratchpost's indexed Mainnet and Base catalogue. Solana and TRON stay address-only so we do not burn vendor API credits."
      : "Type a ticker, name, or 0x address. Missing tokens mean they are not indexed yet.";
    hint.appendChild(line);
    hint.appendChild(sub);
    box.appendChild(hint);
  }

  function paintSearchRows(box, tpl, rows) {
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
        paintTokenBadge(badge, tok.symbol, tok.color, tok.chain_id, tok.address);
      }
      row.addEventListener("click", function () {
        goToken(tok.chain_id, tok.address);
      });
      box.appendChild(row);
    });
  }

  function searchResults(query) {
    var box = el("search-results");
    var tpl = el("tpl-search-row");
    if (!box) {
      return [];
    }
    box.textContent = "";
    var q = String(query || "").trim();
    var local = q && root.tkrWalletData ? root.tkrWalletData.searchCatalog(q, 20, readStoredTokens()) : [];
    if (!q) {
      paintSearchHint(box, "", false);
      return [];
    }
    if (local.length) {
      paintSearchRows(box, tpl, local);
    } else {
      paintSearchHint(box, q, false);
    }
    var seq = ++searchSeq;
    if (!root.tkrWalletData || typeof root.tkrWalletData.searchTokens !== "function") {
      return local;
    }
    withBusy(function () {
      return root.tkrWalletData.searchTokens(q, readStoredTokens());
    }, "Searching Scratchpost\u2026").then(function (remote) {
      if (seq !== searchSeq) {
        return;
      }
      var hits = Array.isArray(remote) ? remote : [];
      if (!hits.length) {
        if (!local.length) {
          box.textContent = "";
          paintSearchHint(box, q, true);
        }
        return;
      }
      box.textContent = "";
      paintSearchRows(box, tpl, hits);
    }).catch(function () {
      /* keep local rows */
    });
    return local;
  }

  /* ---- wallet wiring: shell talks to the data layer only ------------------ */

  var uiData = {
    lastHoldings: null,
    lastPrices: null,
    account: null,
    lastBalances: null, // { state, reason, chains } from the last read
    lastChecked: null, // when that read happened
    lastQuote: null,
    quoteTimer: null,
    deskTab: "mine",
    fxSource: "boc",
  };

  /** Re-render the list and value from whatever we last knew. */
  function renderAll() {
    renderTokens(uiData.lastHoldings, uiData.lastPrices);
    if (uiData.lastHoldings) {
      refreshValue();
    }
    if (state.screen === "detail") {
      renderDetail();
    }
    if (state.screen === "send") {
      paintSendContacts();
    }
  }

  function refreshValue() {
    var wallet = root.tkrWalletData;
    var holdings = uiData.lastHoldings;
    if (!wallet || !holdings) {
      return;
    }
    var split = splitCurrentHoldings(holdings, uiData.lastPrices);
    var est = wallet.estimateValue(split.desk, uiData.lastPrices, state.currency);
    if (est.state === "ok") {
      var note = est.priced < est.total ? est.priced + " of " + est.total + " holdings priced" : "";
      var fx = uiData.lastPrices && uiData.lastPrices.fx;
      var fxNote =
        uiData.fxSource === "live"
          ? "Live FX"
          : fx && fx.observation_date
            ? "BoC " + fx.observation_date
            : "";
      if (note && fxNote) {
        note = note + " \u00b7 " + fxNote;
      } else if (fxNote) {
        note = fxNote;
      }
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

  function priceAssets() {
    var wallet = root.tkrWalletData;
    var keys = Object.create(null);
    function addKey(k) {
      if (k) {
        keys[k] = true;
      }
    }
    function addHolding(h) {
      if (h && wallet) {
        addKey(wallet.assetKey(h));
      }
    }
    (uiData.lastHoldings || []).forEach(function (h) {
      if (h && h.state === "ok") {
        addHolding(h);
      }
    });
    if (wallet && typeof wallet.tokenListRows === "function") {
      wallet
        .tokenListRows(
          uiData.lastHoldings || [],
          uiData.lastBalances && uiData.lastBalances.chains,
          readStoredTokens()
        )
        .forEach(addHolding);
    }
    addKey("1:native");
    addKey("8453:native");
    addKey("1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    addKey("8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    return Object.keys(keys);
  }

  function paintFxButton() {
    var btn = el("fx-live");
    if (!btn) {
      return;
    }
    btn.setAttribute("aria-pressed", uiData.fxSource === "live" ? "true" : "false");
  }

  function fetchLiveFx() {
    uiData.fxSource = "live";
    paintFxButton();
    setWalletStatus("Fetching live exchange rate\u2026");
    return refreshPrices();
  }

  function refreshPrices() {
    var wallet = root.tkrWalletData;
    if (!wallet || uiData.lastHoldings == null) {
      uiData.lastPrices = null;
      renderAll();
      return Promise.resolve(null);
    }
    var assets = priceAssets();
    if (!assets.length) {
      uiData.lastPrices = null;
      renderAll();
      return Promise.resolve(null);
    }
    var vs = CURRENCIES.slice();
    paintFxButton();
    return withBusy(function () {
      return wallet.getPrices(assets, vs, null, uiData.fxSource).then(function (prices) {
        uiData.lastPrices = prices;
        renderAll();
        return prices;
      });
    }, "Fetching prices from Scratchpost\u2026").catch(function () {
      setWalletStatus("Prices unavailable from the wallet edge.");
      renderAll();
      return null;
    });
  }

  function mergeBalanceReads(evm, sol, tron) {
    var evmState = (evm && evm.state) || "unknown";
    var solState = sol ? sol.state || "unknown" : "ok";
    var tronState = tron ? tron.state || "unknown" : "ok";
    var balances = []
      .concat((evm && evm.balances) || [])
      .concat((sol && sol.balances) || [])
      .concat((tron && tron.balances) || []);
    var chains = []
      .concat((evm && evm.chains) || [])
      .concat((sol && sol.chains) || [])
      .concat((tron && tron.chains) || []);
    function hasChain(id) {
      return chains.some(function (c) {
        return c && Number(c.chain_id) === id;
      });
    }
    if (sol && solState !== "ok" && !hasChain(900001)) {
      chains.push({
        chain_id: 900001,
        state: solState === "partial" ? "partial" : "unknown",
        error: sol.reason || sol.detail || "sol-read-failed",
      });
    }
    if (tron && tronState !== "ok" && !hasChain(728126428)) {
      chains.push({
        chain_id: 728126428,
        state: tronState === "partial" ? "partial" : "unknown",
        error: tron.reason || tron.detail || "tron-read-failed",
      });
    }
    if (evm && evmState !== "ok" && !(evm.chains && evm.chains.length)) {
      [1, 8453, 4663].forEach(function (id) {
        if (!hasChain(id)) {
          chains.push({
            chain_id: id,
            state: evmState === "partial" ? "partial" : "unknown",
            error: evm.reason || evm.detail || "evm-read-failed",
          });
        }
      });
    }
    var fetched = [evmState, sol ? solState : null, tron ? tronState : null].filter(function (s) {
      return s != null;
    });
    var stateOut = "ok";
    if (fetched.every(function (s) { return s === "unknown"; })) {
      stateOut = "unknown";
    } else if (fetched.some(function (s) { return s !== "ok"; })) {
      stateOut = "partial";
    }
    return {
      state: stateOut,
      balances: balances,
      chains: chains,
      reason: stateOut === "ok" ? null : (tron && tron.reason) || (sol && sol.reason) || (evm && evm.reason) || "some-chains-failed",
      detail: (tron && tron.detail) || (sol && sol.detail) || (evm && evm.detail) || null,
      as_of: (evm && evm.as_of) || (sol && sol.as_of) || (tron && tron.as_of) || null,
    };
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
    return withBusy(function () {
      return ensureEdgeAccess().then(function (allowed) {
      if (!allowed) {
        uiData.lastChecked = Date.now();
        uiData.lastBalances = {
          state: "unknown",
          reason: "edge-unreachable",
          detail: "Brave site access is off for tkrwallet.scratchpost.ai. Open the extension card → Site access → allow that host.",
        };
        renderBalancesNotice();
        return null;
      }
      return wallet
      .getBalances(session.address, [1, 8453, 4663], null, extras)
      .then(function (evm) {
        var next = Promise.resolve({ evm: evm, sol: null, tron: null });
        if (session.solAddress) {
          next = next.then(function (acc) {
            return wallet.getBalances(session.solAddress, [900001]).then(function (sol) {
              acc.sol = sol;
              return acc;
            });
          });
        }
        if (session.tronAddress) {
          next = next.then(function (acc) {
            return wallet.getBalances(session.tronAddress, [728126428]).then(function (tron) {
              acc.tron = tron;
              return acc;
            });
          });
        }
        return next.then(function (acc) {
          return mergeBalanceReads(acc.evm, acc.sol, acc.tron);
        });
      })
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
    });
    }, "Reading balances from Scratchpost\u2026").catch(function () {
      uiData.lastChecked = Date.now();
      uiData.lastBalances = {
        state: "unknown",
        reason: "edge-unreachable",
        detail: "The wallet edge did not answer.",
      };
      renderBalancesNotice();
      setWalletStatus("Balances unknown: the wallet edge did not answer. Nothing was signed.");
      setWalletValue(null, state.currency, "Balances unavailable until the wallet edge responds.");
      return null;
    });
  }

  /* ---- user-added tokens -------------------------------------------------
   * Public token metadata only (symbol/name/decimals/address). Never key
   * material, never anything from the vault. Discovery lists what you hold;
   * this is the miss path for a token Scratchpost did not index. */

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

  /** Copy under the Mine / Tokens / Airdrop control. */
  function holdingsScopeText() {
    var extra = readStoredTokens().length;
    var extraBit = extra ? " · " + extra + " added by address" : "";
    var tab = uiData.deskTab || "mine";
    if (tab === "tokens") {
      return (
        "Ethereum and Base tokens. Verified zeros first, then what you hold on those chains" +
        extraBit +
        "."
      );
    }
    if (tab === "airdrop") {
      return "Unpriced tokens sent to this address. They are not in your total.";
    }
    if (tab === "pools") {
      return "Uniswap v3 positions on Ethereum, Base, and Robinhood. Add, withdraw, and collect fees. Mainnet and Base quotes use the desk L1/L2 nodes.";
    }
    return (
      "Only crypto you hold. Zero balances are on Tokens, not here" +
      extraBit +
      "."
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
    return withBusy(function () {
      return wallet.getTokenMeta(chainId, addr);
    }, "Looking up the token on Scratchpost\u2026").then(function (res) {
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

  var USDC_MAIN = "1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  var USDC_BASE = "8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  function amountInUsdAsset(usdValue, assetKey) {
    var prices = uiData.lastPrices;
    if (usdValue === null || usdValue === undefined || !prices || prices.state !== "ok" || !prices.prices) {
      return null;
    }
    var entry = prices.prices[assetKey];
    var px = entry && entry.usd;
    if (typeof px !== "number" || !isFinite(px) || !(px > 0)) {
      return null;
    }
    return usdValue / px;
  }

  function swapOptionValue(chainId, asset) {
    return Number(chainId) + ":" + (asset || "native");
  }

  function ensureSelectOption(sel, value, label) {
    if (!sel) {
      return;
    }
    var opts = sel.options;
    var i;
    for (i = 0; i < opts.length; i++) {
      if (opts[i].value.toLowerCase() === String(value).toLowerCase()) {
        sel.value = opts[i].value;
        return;
      }
    }
    var opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
    sel.value = value;
  }

  function defaultCounterAsset(chainId, asset) {
    var self = swapOptionValue(chainId, asset).toLowerCase();
    var native = swapOptionValue(chainId, null).toLowerCase();
    if (self === native) {
      if (Number(chainId) === 8453) {
        return USDC_BASE;
      }
      if (Number(chainId) === 900001) {
        return "900001:native";
      }
      return USDC_MAIN;
    }
    return swapOptionValue(chainId, null);
  }

  function openSwapFor(chainId, asset, side) {
    fillSwapPairs();
    var value = swapOptionValue(chainId, asset);
    var meta = metaFor(chainId, asset);
    var label = ((meta && meta.symbol) || "Token") + " \u00b7 chain " + chainId;
    var from = el("swap-from");
    var to = el("swap-to");
    var counter = defaultCounterAsset(chainId, asset);
    if (side === "to") {
      ensureSelectOption(to, value, label);
      if (from) {
        if (String(from.value).toLowerCase() === value.toLowerCase()) {
          ensureSelectOption(from, counter, counter);
        }
      }
    } else {
      ensureSelectOption(from, value, label);
      if (to) {
        if (String(to.value).toLowerCase() === value.toLowerCase()) {
          ensureSelectOption(to, counter, counter);
        }
      }
    }
    go("swap");
  }

  function openSendFor(chainId, asset) {
    var chain = el("send-chain");
    var token = el("send-token");
    if (chain) {
      chain.value = String(chainId);
    }
    if (token) {
      token.value = asset || "native";
    }
    go("send");
  }

  function stampDetailActions(chainId, asset) {
    var key = asset || "native";
    ["detail-buy", "detail-send", "detail-swap"].forEach(function (id) {
      var btn = el(id);
      if (btn) {
        btn.setAttribute("data-chain", String(chainId));
        btn.setAttribute("data-asset", key);
      }
    });
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
    var probe = holding || {
      chain_id: route.chainId,
      address: route.asset,
      symbol: symbol,
      color: root.tkrWalletData && root.tkrWalletData.colorFor(symbol),
      state: "ok",
      amount: 0,
    };

    setText(el("detail-heading"), symbol);
    setText(el("detail-name"), name);
    setText(el("detail-chain"), chainName);
    paintTokenBadge(
      el("detail-badge"),
      symbol,
      (holding && holding.color) || (root.tkrWalletData && root.tkrWalletData.colorFor(symbol)),
      route.chainId,
      route.asset
    );

    var read = uiData.lastBalances;
    var unit = unitPriceFor(probe, uiData.lastPrices);
    setText(el("detail-price"), formatFiat(unit, state.currency));
    if (holding && holding.state === "ok") {
      setText(el("detail-amount"), formatHeld(holding.amount));
      setText(el("detail-fiat"), formatFiat(fiatFor(holding, uiData.lastPrices), state.currency));
    } else {
      setText(el("detail-amount"), "\u2014");
      setText(el("detail-fiat"), "\u2014");
    }
    var usdUnit = usdPriceFor(probe, uiData.lastPrices);
    var usdValue =
      holding && holding.state === "ok" && holding.amount !== null && usdUnit != null
        ? holding.amount * usdUnit
        : null;
    setText(el("detail-eth-main"), formatAmount(amountInUsdAsset(usdValue, "1:native")));
    setText(el("detail-eth-base"), formatAmount(amountInUsdAsset(usdValue, "8453:native")));
    setText(
      el("detail-usdc"),
      formatAmount(amountInUsdAsset(usdValue, USDC_MAIN) != null
        ? amountInUsdAsset(usdValue, USDC_MAIN)
        : amountInUsdAsset(usdValue, USDC_BASE))
    );
    setText(el("detail-lesou"), "lesou coming soon");
    stampDetailActions(route.chainId, route.asset);
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

  var session = { vault: null, address: null, solAddress: null, tronAddress: null, locked: false, index: 0, phrase: null, accounts: [] };
  var pendingCreate = null;
  var pendingSwapQuote = null;
  var sendCameraStream = null;
  var sendScanTimer = null;
  var QUOTE_TTL_MS = 15000;

  function chromeExtensionDocument() {
    try {
      return String(root.location && root.location.protocol ? root.location.protocol : "").indexOf("chrome-extension") === 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * PWA tab: sessionStorage (tab close locks).
   * MV3 popup/side panel: localStorage. sessionStorage dies when the popup
   * is destroyed, so a 15-minute auto-lock would otherwise re-prompt on every
   * toolbar click. parseViewSession still expires the blob.
   */
  function viewSessionStore() {
    try {
      if (chromeExtensionDocument() && root.localStorage) {
        return root.localStorage;
      }
      return root.sessionStorage || null;
    } catch (e) {
      return null;
    }
  }

  function saveViewSession() {
    if (!session.address) {
      return;
    }
    try {
      var storeRef = viewSessionStore();
      if (!storeRef) {
        return;
      }
      storeRef.setItem(
        VIEW_SESSION_KEY,
        JSON.stringify({
          address: session.address,
          solAddress: session.solAddress || null,
          tronAddress: session.tronAddress || null,
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
      if (root.localStorage) {
        root.localStorage.removeItem(VIEW_SESSION_KEY);
      }
    } catch (e) {
      /* non-fatal */
    }
  }

  function restoreViewSession() {
    try {
      var storeRef = viewSessionStore();
      var raw = storeRef && storeRef.getItem(VIEW_SESSION_KEY);
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


  /** Never paint a full EVM private key into the DOM. Mask for display; copy uses RAM. */
  function maskPrivateKey(hex) {
    var h = String(hex || "").replace(/^0x/i, "");
    if (h.length < 8) {
      return "••••";
    }
    return h.slice(0, 3) + "...." + h.slice(-3);
  }

  function showGateForm(mode) {
    var unlock = el("gate-unlock");
    var importForm = el("gate-import");
    var createForm = el("gate-create");
    if (unlock) {
      unlock.hidden = mode !== "unlock";
    }
    if (importForm) {
      importForm.hidden = mode !== "import";
    }
    if (createForm) {
      createForm.hidden = mode !== "create";
    }
    var titles = {
      unlock: "Unlock with password",
      import: "Import / recover wallet",
      create: "Create a new wallet",
    };
    var subtitles = {
      unlock: "Sign in to the wallet already on this device.",
      import: "Restore from a 12 or 24-word recovery phrase (sign-in from another device).",
      create: "Make a new wallet on this device. You will write down the recovery phrase once.",
    };
    setText(el("gate-title"), titles[mode] || titles.unlock);
    setText(el("gate-subtitle"), subtitles[mode] || subtitles.unlock);
    var navBtns = document.querySelectorAll("[data-gate-nav]");
    for (var n = 0; n < navBtns.length; n++) {
      var nav = navBtns[n].getAttribute("data-gate-nav");
      navBtns[n].hidden = nav === mode;
    }
    if (mode !== "create") {
      setText(el("create-mnemonic"), "");
      setText(el("create-priv"), "");
      pendingCreate = null;
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
    if (mode === "unlock" || mode === "import" || mode === "create") {
      showGateForm(mode);
      return;
    }
    // Auto-detect: unlock if a vault exists, else create.
    var s = store();
    if (!s) {
      showGateForm("create");
      return;
    }
    s.loadVault()
      .then(function (vault) {
        showGateForm(vault ? "unlock" : "create");
      })
      .catch(function () {
        showGateForm("create");
      });
  }

  function wipeSecrets() {
    var ids = [
      "gate-password",
      "gate-new-password",
      "gate-mnemonic",
      "create-password",
      "create-password-confirm",
      "create-confirm",
      "add-account-password",
    ];
    for (var i = 0; i < ids.length; i++) {
      var node = el(ids[i]);
      if (node && "value" in node) {
        node.value = "";
      }
    }
    setText(el("create-mnemonic"), "");
    setText(el("create-priv"), "");
    pendingCreate = null;
    var step1 = el("create-step-password");
    var step2 = el("create-step-backup");
    if (step1) {
      step1.removeAttribute("hidden");
    }
    if (step2) {
      step2.setAttribute("hidden", "");
    }
  }

  function closeGate() {
    var gate = el("wallet-gate");
    if (gate) {
      gate.setAttribute("hidden", "");
    }
    wipeSecrets();
  }

  /* Derive + reveal the account. The phrase stays in RAM until lock so
   * connect can sign; it is never written to IndexedDB or sessionStorage. */
  function revealAccount(phrase, index) {
    var c = crypto();
    var w = c.importMnemonic(phrase, index);
    session.address = w.evmAddress;
    session.solAddress = w.solAddress;
    session.tronAddress = w.tronAddress;
    session.index = w.index;
    session.phrase = w.mnemonic;
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
    renderReceive();
    renderAccountDrawer();
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
    saveViewSession();
    var label =
      "Auto-lock set to " +
      state.autolockMinutes +
      " minute" +
      (state.autolockMinutes === 1 ? "" : "s") +
      " of inactivity. Saved.";
    setWalletStatus(label);
    setText(el("autolock-feedback"), label);
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
    session.solAddress = null;
    session.tronAddress = null;
    session.index = 0;
    session.phrase = null;
    session.vault = null;
    session.accounts = [];
    session.locked = session.locked || wasUnlocked;
    clearViewSession();
    pendingSwapQuote = null;
    clearQuoteTimer();
    hideSwapEstimate();
    closeQuoteDialog();
    stopSendCamera();
    uiData.lastHoldings = null;
    uiData.lastPrices = null;
    uiData.lastBalances = null;
    uiData.lastChecked = null;
    closeGate();
    closeAccountDrawer();
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
        return c.decryptVault(vault, password).then(function (phrase) {
          return { vault: vault, phrase: phrase };
        });
      })
      .then(function (unlocked) {
        session.vault = null;
        session.accounts =
          unlocked.vault && unlocked.vault.accounts && unlocked.vault.accounts.length
            ? unlocked.vault.accounts.slice()
            : c.accountsFromMnemonic(unlocked.phrase, 1);
        revealAccount(unlocked.phrase, selectedIndexFromVault(unlocked.vault));
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
        vault.accounts = c.accountsFromMnemonic(phrase, 1);
        vault.selectedIndex = 0;
        return s.saveVault(vault);
      })
      .then(function () {
        session.accounts = c.accountsFromMnemonic(phrase, 1);
        revealAccount(phrase, 0);
        closeGate();
      })
      .catch(function () {
        showGateError("gate-import-error", "Could not store the wallet on this device.");
      });
  }

  function copyCreatePrivateKey() {
    var full = pendingCreate && pendingCreate.privateKeyHex;
    if (!full) {
      setWalletStatus("Generate a wallet first, then copy the private key.");
      return;
    }
    try {
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
        root.navigator.clipboard.writeText(full);
        setWalletStatus("Private key copied. It is not shown in full on screen.");
        return;
      }
    } catch (e) {
      /* fall through */
    }
    setWalletStatus("Copy is unavailable in this browser. Write down the recovery phrase instead.");
  }

  function onCreateStart() {
    var password = ((el("create-password") || {}).value || "");
    var confirmPw = ((el("create-password-confirm") || {}).value || "");
    if (password.length < 8) {
      showGateError("gate-create-error", "Use at least 8 characters.");
      return;
    }
    if (password !== confirmPw) {
      showGateError("gate-create-error", "Passwords do not match.");
      return;
    }
    var c = crypto();
    var s = store();
    if (!c || !s) {
      showGateError("gate-create-error", "Wallet storage unavailable in this browser.");
      return;
    }
    var w;
    var secret;
    try {
      w = c.generateWallet();
      secret = c.revealEvmSecret(w.mnemonic, 0);
    } catch (e) {
      showGateError("gate-create-error", "Could not generate a wallet.");
      return;
    }
    pendingCreate = {
      mnemonic: w.mnemonic,
      password: password,
      privateKeyHex: secret.privateKeyHex,
    };
    setText(el("create-mnemonic"), w.mnemonic);
    setText(el("create-priv"), maskPrivateKey(secret.privateKeyHex));
    var step1 = el("create-step-password");
    var step2 = el("create-step-backup");
    if (step1) {
      step1.setAttribute("hidden", "");
    }
    if (step2) {
      step2.removeAttribute("hidden");
    }
    showGateError("gate-create-error", null);
  }

  function onCreateConfirm() {
    var typed = ((el("create-confirm") || {}).value || "");
    if (!typedCreateConfirm(typed)) {
      showGateError("gate-create-error", "Type exactly: " + CREATE_CONFIRM);
      return;
    }
    if (!pendingCreate || !pendingCreate.mnemonic) {
      showGateError("gate-create-error", "Generate a wallet first.");
      return;
    }
    var c = crypto();
    var s = store();
    if (!c || !s) {
      showGateError("gate-create-error", "Wallet storage unavailable in this browser.");
      return;
    }
    var phrase = pendingCreate.mnemonic;
    var password = pendingCreate.password;
    s.loadVault()
      .then(function (existing) {
        if (existing) {
          showGateError("gate-create-error", "A wallet already exists on this device. Unlock it, or add an account in Settings.");
          throw new Error("vault-exists");
        }
        return c.encryptVault(phrase, password);
      })
      .then(function (vault) {
        vault.accounts = c.accountsFromMnemonic(phrase, 1);
        vault.selectedIndex = 0;
        return s.saveVault(vault);
      })
      .then(function () {
        session.accounts = c.accountsFromMnemonic(phrase, 1);
        revealAccount(phrase, 0);
        wipeSecrets();
        closeGate();
      })
      .catch(function (err) {
        if (err && err.message === "vault-exists") {
          return;
        }
        showGateError("gate-create-error", "Could not store the wallet on this device.");
      });
  }

  function onAddAccount() {
    var password = ((el("add-account-password") || {}).value || "");
    if (!password) {
      showGateError("add-account-error", "Enter your password.");
      return;
    }
    var c = crypto();
    var s = store();
    if (!c || !s) {
      showGateError("add-account-error", "Wallet storage unavailable in this browser.");
      return;
    }
    s.loadVault()
      .then(function (vault) {
        if (!vault) {
          throw new Error("no vault");
        }
        return c.decryptVault(vault, password).then(function (phrase) {
          var next = c.nextAccountIndex(vault.accounts);
          var accounts =
            vault.accounts && vault.accounts.length
              ? vault.accounts.slice()
              : c.accountsFromMnemonic(phrase, Math.max(next, 1));
          if (next < accounts.length) {
            next = c.nextAccountIndex(accounts);
          }
          var w = c.importMnemonic(phrase, next);
          accounts.push({ i: w.index, path: w.path, evmAddress: w.evmAddress });
          vault.accounts = accounts;
          vault.selectedIndex = w.index;
          return s.saveVault(vault).then(function () {
            session.accounts = accounts.slice();
            revealAccount(phrase, w.index);
            var pw = el("add-account-password");
            if (pw) {
              pw.value = "";
            }
            showGateError("add-account-error", null);
            setWalletStatus("Account " + w.index + " \u00b7 " + w.path);
          });
        });
      })
      .catch(function (err) {
        if (err && err.message === "wrong-password") {
          showGateError("add-account-error", "Wrong password.");
        } else {
          showGateError("add-account-error", "Could not add an account.");
        }
      });
  }

  function refreshPendingSigns() {
    var data = root.tkrWalletData;
    if (!data || typeof data.listPendingSigns !== "function") {
      return;
    }
    data.listPendingSigns().then(function (out) {
      var n = (out && out.requests && out.requests.length) || 0;
      var btn = document.querySelector("[data-confirm-sign]");
      if (btn) {
        if (n) {
          btn.removeAttribute("hidden");
        } else {
          btn.setAttribute("hidden", "");
        }
      }
      if (n) {
        setWalletStatus(n + " pending sign request" + (n === 1 ? "" : "s") + " from IcePike.");
      }
    }).catch(function () {
      /* non-fatal */
    });
  }

  function onConfirmSign() {
    var data = root.tkrWalletData;
    var c = crypto();
    if (!session.phrase || !data || !c || typeof data.broadcastRaw !== "function") {
      setWalletStatus("Unlock and Connect first.");
      openGate("unlock");
      return;
    }
    data
      .listPendingSigns()
      .then(function (out) {
        var req = ((out && out.requests) || [])[0];
        if (!req || !req.tx) {
          throw new Error("none");
        }
        var signed = c.signAndBroadcastPayload(session.phrase, session.index, req.tx);
        return data.broadcastRaw({ raw: signed.raw, chain_id: signed.chainId, request_id: req.id });
      })
      .then(function (sent) {
        if (!sent || sent.ok === false) {
          throw new Error("broadcast");
        }
        setWalletStatus("Broadcast " + (sent.tx_hash || "") + ". Key stayed on this device.");
        refreshPendingSigns();
      })
      .catch(function () {
        setWalletStatus("Sign/broadcast failed. The key did not leave this device.");
      });
  }

  function onConnect() {
    var data = root.tkrWalletData;
    var c = crypto();
    if (!session.phrase || !session.address) {
      setWalletStatus("Unlock with your password to connect. The recovery phrase is not in this tab.");
      openGate("unlock");
      return;
    }
    if (!data || !c || typeof data.requestNonce !== "function") {
      setWalletStatus("Connect is unavailable in this browser.");
      return;
    }
    data
      .requestNonce()
      .then(function (issued) {
        if (!issued || !issued.statement || !issued.nonce) {
          throw new Error("no-nonce");
        }
        var signed = c.signPersonal(session.phrase, session.index, issued.statement);
        return data.openSession({
          address: signed.address,
          chain_id: 1,
          nonce: issued.nonce,
          signature: signed.signature,
          sol_address: session.solAddress,
          tron_address: session.tronAddress,
        });
      })
      .then(function (sess) {
        if (!sess || sess.ok === false) {
          throw new Error((sess && sess.error) || "session-failed");
        }
        setWalletStatus("Connected as " + (sess.address || session.address) + ". Keys stayed on this device.");
        refreshPendingSigns();
      })
      .catch(function () {
        setWalletStatus("Connect failed. Nothing was broadcast.");
      });
  }

  function swapTokenValue(chainId, tok) {
    return Number(chainId) + ":" + (tok && tok.address ? String(tok.address) : "native");
  }

  function fillSwapPairs() {
    var from = el("swap-from");
    var to = el("swap-to");
    var wallet = root.tkrWalletData;
    if (!from || !to || !wallet || !wallet.TOKENS) {
      return;
    }
    var keepFrom = from.value;
    var keepTo = to.value;
    from.textContent = "";
    to.textContent = "";
    [1, 8453, 4663, 900001, 728126428].forEach(function (chainId) {
      var list = wallet.TOKENS[chainId] || [];
      var chain = wallet.CHAINS[chainId];
      var chainName = chain ? chain.name : "chain " + chainId;
      list.forEach(function (tok) {
        var value = swapTokenValue(chainId, tok);
        var label = tok.symbol + " \u00b7 " + chainName;
        [from, to].forEach(function (sel) {
          var opt = document.createElement("option");
          opt.value = value;
          opt.textContent = label;
          sel.appendChild(opt);
        });
      });
    });
    from.value = keepFrom || "1:native";
    to.value = keepTo || "1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    if (from.value === to.value) {
      to.value = "1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    }
  }

  function looksLikeSendAddress(value) {
    var s = String(value || "").trim();
    return (
      /^0x[a-fA-F0-9]{40}$/.test(s) ||
      /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s) ||
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)
    );
  }

  function addressFromQrText(text) {
    var s = String(text || "").trim();
    if (!s) {
      return "";
    }
    var hex = s.match(/0x[a-fA-F0-9]{40}/);
    if (hex) {
      return hex[0];
    }
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) {
      return s;
    }
    return "";
  }

  function hideSendRecent() {
    var box = el("send-recent");
    if (box) {
      box.setAttribute("hidden", "");
      box.textContent = "";
    }
  }

  function paintSendRecent() {
    var box = el("send-recent");
    var s = store();
    if (!box || !s || typeof s.listRecentRecipients !== "function") {
      return;
    }
    s.listRecentRecipients(3)
      .then(function (rows) {
        box.textContent = "";
        var list = Array.isArray(rows) ? rows.slice(0, 3) : [];
        if (!list.length) {
          box.setAttribute("hidden", "");
          return;
        }
        list.forEach(function (row) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className =
            "min-h-9 w-full rounded-full bg-ink-950 px-4 text-left text-xs text-cream-100 ring-1 ring-inset ring-white/10 hover:ring-ember-400/40";
          btn.textContent = shortAddress(row.address);
          btn.addEventListener("mousedown", function (event) {
            event.preventDefault();
          });
          btn.addEventListener("click", function () {
            var input = el("send-to");
            if (input) {
              input.value = row.address;
            }
            hideSendRecent();
          });
          box.appendChild(btn);
        });
        box.removeAttribute("hidden");
      })
      .catch(function () {
        hideSendRecent();
      });
  }

  function paintSendContacts() {
    var box = el("send-contacts");
    var s = store();
    if (!box) {
      return;
    }
    if (!s || typeof s.listContacts !== "function") {
      box.textContent = "";
      return;
    }
    s.listContacts()
      .then(function (rows) {
        box.textContent = "";
        (rows || []).forEach(function (row) {
          var wrap = document.createElement("div");
          wrap.className = "flex items-center gap-2";
          var pick = document.createElement("button");
          pick.type = "button";
          pick.className =
            "min-h-9 min-w-0 flex-1 rounded-full bg-ink-950 px-4 py-2 text-left ring-1 ring-inset ring-white/10 hover:ring-ember-400/40";
          var title = document.createElement("span");
          title.className = "block truncate text-xs text-cream-100";
          title.textContent = row.label || shortAddress(row.address);
          var sub = document.createElement("span");
          sub.className = "block truncate text-[11px] text-cream-500";
          sub.textContent = shortAddress(row.address);
          pick.appendChild(title);
          pick.appendChild(sub);
          pick.addEventListener("click", function () {
            var input = el("send-to");
            if (input) {
              input.value = row.address;
            }
            hideSendRecent();
          });
          var del = document.createElement("button");
          del.type = "button";
          del.className =
            "min-h-9 shrink-0 rounded-full px-3 text-xs text-cream-500 ring-1 ring-inset ring-white/10 hover:ring-ember-400/40";
          del.textContent = "Remove";
          del.addEventListener("click", function () {
            s.removeContact(row.id).then(paintSendContacts).catch(function () {});
          });
          wrap.appendChild(pick);
          wrap.appendChild(del);
          box.appendChild(wrap);
        });
      })
      .catch(function () {
        box.textContent = "";
      });
  }

  function onSaveContact() {
    var addr = String((el("send-to") || {}).value || "").trim();
    var label = String((el("send-contact-label") || {}).value || "").trim();
    var s = store();
    if (!addr) {
      setText(el("send-note"), "Enter an address to save.");
      return;
    }
    if (!s || typeof s.addContact !== "function") {
      setText(el("send-note"), "Contacts are unavailable in this browser.");
      return;
    }
    s.addContact(label || shortAddress(addr), addr)
      .then(function () {
        var name = el("send-contact-label");
        if (name) {
          name.value = "";
        }
        paintSendContacts();
        setText(el("send-note"), "Contact saved on this device.");
      })
      .catch(function () {
        setText(el("send-note"), "Could not save that contact.");
      });
  }

  function stopSendCamera() {
    if (sendScanTimer) {
      root.clearTimeout(sendScanTimer);
      sendScanTimer = null;
    }
    if (sendCameraStream) {
      sendCameraStream.getTracks().forEach(function (track) {
        track.stop();
      });
      sendCameraStream = null;
    }
    var video = el("send-camera");
    if (video) {
      video.srcObject = null;
      video.setAttribute("hidden", "");
    }
  }

  function detectQrFromVideo(video) {
    if (!root.BarcodeDetector) {
      return Promise.resolve("");
    }
    try {
      var det = new root.BarcodeDetector({ formats: ["qr_code"] });
      return det.detect(video).then(function (codes) {
        return codes && codes[0] && codes[0].rawValue ? String(codes[0].rawValue) : "";
      }).catch(function () {
        return "";
      });
    } catch (e) {
      return Promise.resolve("");
    }
  }

  function tickSendScan() {
    var video = el("send-camera");
    if (!video || !sendCameraStream) {
      return;
    }
    detectQrFromVideo(video).then(function (text) {
      var addr = addressFromQrText(text);
      if (addr) {
        var input = el("send-to");
        if (input) {
          input.value = addr;
        }
        stopSendCamera();
        setText(el("send-note"), "Address filled from QR.");
        return;
      }
      sendScanTimer = root.setTimeout(tickSendScan, 400);
    });
  }

  function startSendCamera() {
    var video = el("send-camera");
    if (!video || !root.navigator || !root.navigator.mediaDevices || !root.navigator.mediaDevices.getUserMedia) {
      setText(el("send-note"), "Camera is unavailable in this browser.");
      return;
    }
    stopSendCamera();
    root.navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(function (stream) {
        sendCameraStream = stream;
        video.srcObject = stream;
        video.removeAttribute("hidden");
        return video.play();
      })
      .then(function () {
        if (!root.BarcodeDetector) {
          setText(el("send-note"), "Camera is on. This browser cannot decode QR codes.");
          return;
        }
        setText(el("send-note"), "Hold a QR code to the camera.");
        tickSendScan();
      })
      .catch(function () {
        setText(el("send-note"), "Camera permission was denied. Nothing was signed.");
      });
  }

  function clearQuoteTimer() {
    if (uiData.quoteTimer) {
      root.clearInterval(uiData.quoteTimer);
      uiData.quoteTimer = null;
    }
  }

  function quoteStillLive() {
    return Boolean(pendingSwapQuote && pendingSwapQuote.expiresAt && Date.now() < pendingSwapQuote.expiresAt);
  }

  function applyQuoteExpiryUi() {
    var live = quoteStillLive();
    var btn = el("swap-submit");
    if (btn) {
      btn.disabled = !live;
      if (live) {
        btn.removeAttribute("aria-disabled");
      } else {
        btn.setAttribute("aria-disabled", "true");
      }
    }
    var remain = "";
    if (!pendingSwapQuote) {
      remain = "";
    } else if (!live) {
      remain = "Quote expired. Request a new quote.";
    } else {
      var sec = Math.max(0, Math.ceil((pendingSwapQuote.expiresAt - Date.now()) / 1000));
      remain = "Expires in " + sec + "s";
    }
    setText(el("swap-quote-timer"), remain);
    setText(el("swap-estimate-timer"), remain);
  }

  function startQuoteTimer() {
    clearQuoteTimer();
    applyQuoteExpiryUi();
    uiData.quoteTimer = root.setInterval(function () {
      applyQuoteExpiryUi();
      if (!quoteStillLive()) {
        clearQuoteTimer();
      }
    }, 250);
  }

  function hideSwapEstimate() {
    var btn = el("swap-estimate");
    if (btn) {
      btn.setAttribute("hidden", "");
    }
    setText(el("swap-estimate-value"), "\u2014");
    setText(el("swap-estimate-timer"), "");
  }

  function showSwapEstimate(human, symbol) {
    var btn = el("swap-estimate");
    setText(el("swap-estimate-value"), human ? human + " " + symbol : "\u2014");
    if (btn) {
      btn.removeAttribute("hidden");
    }
  }

  function closeQuoteDialog() {
    var dlg = el("swap-quote-dialog");
    if (dlg && dlg.open && typeof dlg.close === "function") {
      dlg.close();
    }
  }

  function openQuoteDialog() {
    if (!pendingSwapQuote || !pendingSwapQuote.body) {
      return;
    }
    var wallet = root.tkrWalletData;
    var from = pendingSwapQuote.from;
    var to = pendingSwapQuote.to;
    var body = pendingSwapQuote.body;
    var chain =
      wallet && typeof wallet.chainName === "function" ? wallet.chainName(pendingSwapQuote.chainId) : "";
    var min =
      wallet && typeof wallet.fromAtomicAmount === "function"
        ? wallet.fromAtomicAmount(
            body.other_amount_threshold,
            to.token && to.token.decimals != null ? to.token.decimals : 18
          )
        : "";
    var amount = String((el("swap-amount") || {}).value || "");
    setText(
      el("swap-quote-detail"),
      "You send " +
        amount +
        " " +
        from.token.symbol +
        (chain ? " on " + chain : "") +
        ". You receive about " +
        pendingSwapQuote.human +
        " " +
        to.token.symbol +
        (min ? " (at least " + min + " after slippage)" : "") +
        "."
    );
    applyQuoteExpiryUi();
    var dlg = el("swap-quote-dialog");
    if (!dlg) {
      return;
    }
    try {
      if (typeof dlg.showModal === "function") {
        if (!dlg.open) {
          dlg.showModal();
        }
        return;
      }
    } catch (e) {
      /* popup / overflow ancestors can reject showModal; fall through */
    }
    if (typeof dlg.show === "function" && !dlg.open) {
      dlg.show();
    } else {
      dlg.setAttribute("open", "");
    }
  }

  function selectedSwapToken(selectEl) {
    var wallet = root.tkrWalletData;
    var value = selectEl ? String(selectEl.value || "") : "";
    var bits = value.split(":");
    var chainId = Number(bits[0]);
    var asset = bits.slice(1).join(":") || "native";
    var list = (wallet && wallet.TOKENS && wallet.TOKENS[chainId]) || [];
    for (var i = 0; i < list.length; i++) {
      if (swapTokenValue(chainId, list[i]) === value) {
        return { chainId: chainId, token: list[i], mint: asset };
      }
    }
    return null;
  }

  function onSwapQuote() {
    var wallet = root.tkrWalletData;
    pendingSwapQuote = null;
    clearQuoteTimer();
    hideSwapEstimate();
    closeQuoteDialog();
    setText(el("swap-out"), "");
    if (!wallet || typeof wallet.quoteSwap !== "function") {
      setText(el("swap-note"), "Swap is unavailable in this browser.");
      return;
    }
    var fromSel = selectedSwapToken(el("swap-from"));
    var toSel = selectedSwapToken(el("swap-to"));
    if (!fromSel || !toSel || fromSel.chainId !== toSel.chainId || fromSel.mint === toSel.mint) {
      setText(el("swap-note"), "Pick two different assets on the same chain. Mainnet, Base, and Robinhood are separate swaps, not a bridge.");
      return;
    }
    if (fromSel.chainId === 900001 && !session.solAddress) {
      setText(el("swap-note"), "Unlock the wallet first. Nothing was signed.");
      return;
    }
    if (fromSel.chainId === 728126428 && !session.tronAddress) {
      setText(el("swap-note"), "Unlock the wallet first. Nothing was signed.");
      return;
    }
    var amount = wallet.toAtomicAmount(
      (el("swap-amount") || {}).value,
      fromSel.token && fromSel.token.decimals != null ? fromSel.token.decimals : 18
    );
    if (!amount) {
      setText(el("swap-note"), "Enter an amount greater than zero.");
      return;
    }
    setText(el("swap-note"), "Asking Scratchpost for a quote\u2026");
    withBusy(function () {
      return wallet.quoteSwap({
        chain_id: fromSel.chainId,
        input_mint: fromSel.mint,
        output_mint: toSel.mint,
        amount: amount,
      });
    }, "Asking Scratchpost for a quote\u2026")
      .then(function (body) {
        if (!body || body.ok === false) {
          throw new Error((body && body.error) || "quote-failed");
        }
        if (!body.out_amount) {
          throw new Error("quote-failed");
        }
        var decimals = toSel.token && toSel.token.decimals != null ? toSel.token.decimals : 18;
        var human =
          typeof wallet.fromAtomicAmount === "function" ? wallet.fromAtomicAmount(body.out_amount, decimals) : null;
        if (!human) {
          throw new Error("quote-failed");
        }
        var expiresAt = Number(body.expires_at);
        if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
          expiresAt = Date.now() + QUOTE_TTL_MS;
        }
        pendingSwapQuote = {
          chainId: fromSel.chainId,
          from: fromSel,
          to: toSel,
          body: body,
          human: human,
          expiresAt: expiresAt,
        };
        showSwapEstimate(human, toSel.token.symbol);
        setText(el("swap-out"), "");
        setText(
          el("swap-note"),
          "Estimate from Scratchpost. The final amount may vary slightly. Tap the number for details and Swap Now."
        );
        startQuoteTimer();
        openQuoteDialog();
      })
      .catch(function (err) {
        pendingSwapQuote = null;
        hideSwapEstimate();
        var why = err && err.message ? String(err.message) : "";
        setText(
          el("swap-note"),
          why && why !== "quote-failed"
            ? "No quote (" + why + "). Scratchpost did not publish one. Nothing was signed."
            : "No quote. Scratchpost did not publish one. Nothing was signed."
        );
        setWalletStatus("Quote failed. Nothing was signed.");
      });
  }

  function onSwapSubmit() {
    var wallet = root.tkrWalletData;
    var c = crypto();
    if (!pendingSwapQuote || !pendingSwapQuote.body || !pendingSwapQuote.body.quote) {
      setText(el("swap-note"), "Quote first. Nothing was signed.");
      return;
    }
    if (!quoteStillLive()) {
      applyQuoteExpiryUi();
      setText(el("swap-note"), "Quote expired. Request a new quote. Nothing was signed.");
      return;
    }
    if (!session.phrase) {
      setText(el("swap-note"), "Unlock the wallet first. Nothing was signed.");
      return;
    }
    if (!wallet || typeof wallet.buildSwap !== "function") {
      setText(el("swap-note"), "Swap signing is unavailable in this browser.");
      return;
    }
    var chainId = pendingSwapQuote.chainId;
    setText(el("swap-note"), "Building unsigned swap\u2026");
    function signBuilt(built) {
      if (!built || built.ok === false) {
        throw new Error((built && built.error) || "build-failed");
      }
      if (built.needs_approval && built.tx) {
        var approved = c.signAndBroadcastPayload(session.phrase, session.index, built.tx);
        return wallet.broadcastRaw({ raw: approved.raw, chain_id: approved.chainId }).then(function (sent) {
          if (!sent || sent.ok === false) {
            throw new Error((sent && sent.error) || "broadcast");
          }
          return wallet.buildSwap({ chain_id: chainId, quote: pendingSwapQuote.body.quote });
        }).then(signBuilt);
      }
      var signed;
      if (chainId === 900001) {
        if (!built.unsigned_tx || typeof c.signSolanaVersionedTx !== "function") {
          throw new Error("build-failed");
        }
        signed = c.signSolanaVersionedTx(session.phrase, built.unsigned_tx);
      } else if (chainId === 728126428) {
        if (!built.unsigned_tx || typeof c.signTronTransaction !== "function") {
          throw new Error("build-failed");
        }
        signed = c.signTronTransaction(session.phrase, built.unsigned_tx);
      } else {
        var tx = built.tx || built.unsigned_tx;
        if (!tx || typeof c.signAndBroadcastPayload !== "function") {
          throw new Error("build-failed");
        }
        signed = c.signAndBroadcastPayload(session.phrase, session.index, tx);
      }
      return wallet.broadcastRaw({ raw: signed.raw, chain_id: signed.chainId });
    }
    withBusy(function () {
      return wallet
        .buildSwap({ chain_id: chainId, quote: pendingSwapQuote.body.quote })
        .then(signBuilt)
        .then(function (sent) {
          if (!sent || sent.ok === false) {
            throw new Error((sent && sent.error) || "broadcast");
          }
          pendingSwapQuote = null;
          clearQuoteTimer();
          hideSwapEstimate();
          closeQuoteDialog();
          setText(el("swap-note"), "Broadcast " + (sent.tx_hash || "") + ". Key stayed on this device.");
          setWalletStatus("Swap broadcast. Key stayed on this device.");
          return refreshBalances();
        });
    }, "Building unsigned swap\u2026").catch(function () {
      setText(el("swap-note"), "Swap did not broadcast. The key did not leave this device.");
      setWalletStatus("Swap failed. The key did not leave this device.");
    });
  }

  function onDisconnect() {
    var data = root.tkrWalletData;
    if (!data || typeof data.closeSession !== "function") {
      setWalletStatus("Disconnect is unavailable in this browser.");
      return;
    }
    withBusy(function () {
      return data.closeSession();
    }, "Disconnecting from Scratchpost\u2026")
      .then(function (out) {
        if (!out || out.ok === false) {
          throw new Error((out && out.error) || "logout-failed");
        }
        var confirmSign = document.querySelector("[data-confirm-sign]");
        if (confirmSign) {
          confirmSign.hidden = true;
        }
        setWalletStatus("Disconnected from Scratchpost. Local wallet is still unlocked.");
      })
      .catch(function () {
        setWalletStatus("Disconnect failed. Edge session may still be open.");
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
        refreshPrices();
      });
    }

    var accountBtn = el("account-btn");
    if (accountBtn) {
      accountBtn.addEventListener("click", function () {
        if (session.address) {
          var drawer = el("account-drawer");
          if (drawer && !drawer.hasAttribute("hidden")) {
            closeAccountDrawer();
          } else {
            openAccountDrawer();
          }
          return;
        }
        openGate();
      });
    }
    var drawerBackdrop = el("account-drawer-backdrop");
    if (drawerBackdrop) {
      drawerBackdrop.addEventListener("click", function () {
        closeAccountDrawer();
      });
    }
    var drawerAdd = el("account-drawer-add");
    if (drawerAdd) {
      drawerAdd.addEventListener("click", function () {
        closeAccountDrawer();
        go("settings");
        var addBtn = document.querySelector("[data-add-account]");
        if (addBtn) {
          addBtn.click();
        }
      });
    }
    var receiveCopy = el("receive-copy");
    if (receiveCopy) {
      receiveCopy.addEventListener("click", function () {
        var addr = session.address;
        if (!addr) {
          setWalletStatus("Unlock the wallet to copy an address.");
          return;
        }
        if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
          root.navigator.clipboard.writeText(addr);
        }
        setWalletStatus("Address copied.");
      });
    }
    var sendTo = el("send-to");
    if (sendTo) {
      sendTo.addEventListener("focus", function () {
        paintSendRecent();
      });
      sendTo.addEventListener("blur", function () {
        root.setTimeout(hideSendRecent, 180);
      });
    }
    var sendScan = el("send-scan");
    if (sendScan) {
      sendScan.addEventListener("click", function () {
        startSendCamera();
      });
    }
    var sendAddContact = el("send-add-contact");
    if (sendAddContact) {
      sendAddContact.addEventListener("click", function () {
        onSaveContact();
      });
    }
    var sendSubmit = el("send-submit");
    if (sendSubmit) {
      sendSubmit.addEventListener("click", function () {
        var to = String((el("send-to") || {}).value || "").trim();
        var s = store();
        if (looksLikeSendAddress(to) && s && typeof s.rememberRecipient === "function") {
          s.rememberRecipient(to).catch(function () {});
        }
        onSendSubmit();
      });
    }
    var receiveChain = el("receive-chain");
    if (receiveChain) {
      receiveChain.addEventListener("change", function () {
        renderReceive();
      });
    }
    var poolSearch = el("pool-search");
    if (poolSearch) {
      poolSearch.addEventListener("click", onPoolSearch);
    }
    var poolAdd = el("pool-add");
    if (poolAdd) {
      poolAdd.addEventListener("click", onPoolAdd);
    }
    var poolRefresh = el("pool-refresh");
    if (poolRefresh) {
      poolRefresh.addEventListener("click", refreshPoolPositions);
    }
    var swapQuote = el("swap-quote");
    if (swapQuote) {
      swapQuote.addEventListener("click", function () {
        onSwapQuote();
      });
    }
    var swapEstimate = el("swap-estimate");
    if (swapEstimate) {
      swapEstimate.addEventListener("click", function () {
        openQuoteDialog();
      });
    }
    var swapQuoteClose = el("swap-quote-close");
    if (swapQuoteClose) {
      swapQuoteClose.addEventListener("click", function () {
        closeQuoteDialog();
      });
    }
    var swapSubmit = el("swap-submit");
    if (swapSubmit) {
      swapSubmit.addEventListener("click", function () {
        onSwapSubmit();
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
    var createForm = el("gate-create");
    if (createForm) {
      createForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var backup = el("create-step-backup");
        if (backup && !backup.hidden) {
          onCreateConfirm();
        } else {
          onCreateStart();
        }
      });
    }
    var gateNav = document.querySelectorAll("[data-gate-nav]");
    for (var gn = 0; gn < gateNav.length; gn++) {
      gateNav[gn].addEventListener("click", function (event) {
        var next = event.currentTarget.getAttribute("data-gate-nav");
        if (next === "unlock" || next === "import" || next === "create") {
          showGateForm(next);
        }
      });
    }
    var privCopy = el("create-priv-copy");
    if (privCopy) {
      privCopy.addEventListener("click", function () {
        copyCreatePrivateKey();
      });
    }
    var toggle = el("gate-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        showGateForm("import");
      });
    }

    var searchInput = el("search-input");
    if (searchInput) {
      searchInput.addEventListener("input", function (event) {
        var value = event.currentTarget.value;
        if (searchDebounce) {
          root.clearTimeout(searchDebounce);
        }
        searchDebounce = root.setTimeout(function () {
          searchResults(value);
        }, 180);
      });
    }

    var search = el("header-search");
    if (search) {
      search.addEventListener("click", function () {
        closeTerminal();
        go("search");
        var input = el("search-input");
        if (input) {
          input.focus();
        }
      });
    }

    var terminalBtn = el("header-terminal");
    if (terminalBtn) {
      terminalBtn.addEventListener("click", function () {
        openTerminal();
      });
    }
    var terminalClose = el("terminal-close");
    if (terminalClose) {
      terminalClose.addEventListener("click", function () {
        closeTerminal();
      });
    }
    var terminalForm = el("terminal-form");
    if (terminalForm) {
      terminalForm.addEventListener("submit", function (event) {
        event.preventDefault();
        submitTerminal();
      });
    }
    if (typeof document !== "undefined") {
      document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") {
          return;
        }
        var term = el("wallet-terminal");
        if (term && !term.hasAttribute("hidden")) {
          closeTerminal();
        }
      });
    }

    var dockBtn = el("header-dock");
    if (dockBtn) {
      dockBtn.addEventListener("click", function () {
        dockWallet();
      });
    }

    var drawerSettings = el("account-drawer-settings");
    if (drawerSettings) {
      drawerSettings.addEventListener("click", function () {
        closeAccountDrawer();
        go("settings");
      });
    }
    var gateSettings = el("gate-settings");
    if (gateSettings) {
      gateSettings.addEventListener("click", function () {
        closeGate();
        go("settings");
      });
    }

    var autolockBtns = document.querySelectorAll("[data-autolock]");
    for (var a = 0; a < autolockBtns.length; a++) {
      autolockBtns[a].addEventListener("click", function (event) {
        setAutolock(event.currentTarget.getAttribute("data-autolock"));
      });
    }

    var addAccountBtn = document.querySelector("[data-add-account]");
    if (addAccountBtn) {
      addAccountBtn.addEventListener("click", function () {
        var form = el("add-account-form");
        if (!form) {
          return;
        }
        if (form.hasAttribute("hidden")) {
          form.removeAttribute("hidden");
          showGateError("add-account-error", null);
          var pw = el("add-account-password");
          if (pw) {
            pw.focus();
          }
        } else {
          form.setAttribute("hidden", "");
        }
      });
    }
    var addAccountForm = el("add-account-form");
    if (addAccountForm) {
      addAccountForm.addEventListener("submit", function (event) {
        event.preventDefault();
        onAddAccount();
      });
    }
    var connectBtn = document.querySelector("[data-connect]");
    if (connectBtn) {
      connectBtn.addEventListener("click", function () {
        onConnect();
      });
    }
    var confirmSign = document.querySelector("[data-confirm-sign]");
    if (confirmSign) {
      confirmSign.addEventListener("click", function () {
        onConfirmSign();
      });
    }

    var actions = document.querySelectorAll("[data-action]");
    for (var k = 0; k < actions.length; k++) {
      actions[k].addEventListener("click", function (event) {
        var action = event.currentTarget.getAttribute("data-action");
        if (action === "swap") {
          go("swap");
          return;
        }
        if (action === "send") {
          go("send");
          return;
        }
        if (action === "receive") {
          go("receive");
          return;
        }
        if (action === "lock") {
          lockNow("manual");
          return;
        }
        if (action === "disconnect") {
          onDisconnect();
          return;
        }
        if (action === "buy") {
          setStatus("Buy is not built yet. Nothing was signed.");
          return;
        }
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

    var deskTabs = document.querySelectorAll("[data-desk-tab]");
    for (var dt = 0; dt < deskTabs.length; dt++) {
      deskTabs[dt].addEventListener("click", function (event) {
        setDeskTab(event.currentTarget.getAttribute("data-desk-tab"));
      });
    }
    var airdropsBack = el("airdrops-back");
    if (airdropsBack) {
      airdropsBack.addEventListener("click", function () {
        go("home");
      });
    }

    /* Add token by address: discovery lists what you hold; this catches a miss. */
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
    function detailAsset(btn) {
      var asset = btn.getAttribute("data-asset");
      return asset === "native" ? null : asset;
    }
    var detailBuy = el("detail-buy");
    if (detailBuy) {
      detailBuy.addEventListener("click", function () {
        openSwapFor(Number(detailBuy.getAttribute("data-chain")), detailAsset(detailBuy), "to");
      });
    }
    var detailSend = el("detail-send");
    if (detailSend) {
      detailSend.addEventListener("click", function () {
        openSendFor(Number(detailSend.getAttribute("data-chain")), detailAsset(detailSend));
      });
    }
    var detailSwap = el("detail-swap");
    if (detailSwap) {
      detailSwap.addEventListener("click", function () {
        openSwapFor(Number(detailSwap.getAttribute("data-chain")), detailAsset(detailSwap), "from");
      });
    }
    var fxLive = el("fx-live");
    if (fxLive) {
      fxLive.addEventListener("click", function () {
        fetchLiveFx();
      });
    }
    paintFxButton();

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
          if (session.address) {
            saveViewSession();
          }
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
      root.addEventListener("pagehide", function () {
        if (session.address) {
          saveViewSession();
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
        session.solAddress = restored.solAddress || null;
        session.tronAddress = restored.tronAddress || null;
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
    // PWA only. MV3 popup pages must not register the offline worker — if
    // Brave exposes the API, a same-origin worker can still surprise us.
    try {
      if (parseShellMode(root.location && root.location.search, root.location && root.location.protocol) !== "page") {
        return;
      }
      if (root.navigator && "serviceWorker" in root.navigator) {
        root.navigator.serviceWorker.register("./sw.js");
      }
    } catch (e) {
      /* offline chrome is a nicety, not a requirement */
    }
  }

  function edgeHostPermission() {
    return { origins: ["https://tkrwallet.scratchpost.ai/*"] };
  }

  /** Brave/Chrome "Site access: On click" blocks every edge fetch. */
  function ensureEdgeAccess() {
    var perms = root.chrome && chrome.permissions;
    if (!perms || typeof perms.contains !== "function") {
      return Promise.resolve(true);
    }
    return new Promise(function (resolve) {
      perms.contains(edgeHostPermission(), function (ok) {
        if (ok) {
          resolve(true);
          return;
        }
        if (typeof perms.request !== "function") {
          resolve(false);
          return;
        }
        perms.request(edgeHostPermission(), function (granted) {
          resolve(Boolean(granted));
        });
      });
    });
  }

  var api = {
    SCREENS: SCREENS,
    parseRoute: parseRoute,
    parseTokenRoute: parseTokenRoute,
    parseShellMode: parseShellMode,
    parseCurrency: parseCurrency,
    formatHeld: formatHeld,
    formatAsOf: formatAsOf,
    fetchLiveFx: fetchLiveFx,
    openSwapFor: openSwapFor,
    runCliCommand: runCliCommand,
    parseAutolockMinutes: parseAutolockMinutes,
    parseViewSession: parseViewSession,
    typedCreateConfirm: typedCreateConfirm,
    CREATE_CONFIRM: CREATE_CONFIRM,
    AUTOLOCK_OPTIONS: AUTOLOCK_OPTIONS,
    AUTOLOCK_DEFAULT: AUTOLOCK_DEFAULT,
    accountDotLabel: accountDotLabel,
    selectedIndexFromVault: selectedIndexFromVault,
    shortAddress: shortAddress,
    formatFiat: formatFiat,
    formatAmount: formatAmount,
    showScreen: showScreen,
    go: go,
    goToken: goToken,
    setAccount: setAccount,
    setStatus: setStatus,
    setWalletStatus: setWalletStatus,
    withBusy: withBusy,
    isBusy: isBusy,
    BUSY_BUTTONS: BUSY_BUTTONS,
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
    mergeBalanceReads: mergeBalanceReads,
    chainProblems: chainProblems,
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
      /* Popup vs side panel vs PWA: see parseShellMode / tools/src/app.css. */
      try {
        applyShellClass();
      } catch (e) {
        /* preview / non-extension hosts ignore */
      }
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
