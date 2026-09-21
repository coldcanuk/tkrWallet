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

  var SCREENS = ["home", "swap", "activity", "search", "settings", "accounts", "consolidate", "detail", "send", "receive", "airdrops"];
  var ACCOUNT_COLORS = ["#e8a33d", "#a8a29e", "#4ade80", "#cfc8b8", "#d98a1f"];
  var DEFAULT_SCREEN = "home";
  var CURRENCIES = ["usd", "cad", "mxn"];
  var STORAGE_KEY = "tkrwallet.currency";
  var LEAVE_GAS_KEY = "tkrwallet.leave-gas-buffer";
  var AUTOLOCK_KEY = "tkrwallet.autolock";
  var CONNECT_AT_LAUNCH_KEY = "tkrwallet.connectAtLaunch";
  var VIEW_SESSION_KEY = "tkrwallet.view-session";
  /* Auto-lock is a security floor, not a preference: it cannot be turned off
   * and the longest offered session is 1 hour. Default is 5 minutes. */
  var AUTOLOCK_OPTIONS = [1, 5, 15, 30, 60];
  var AUTOLOCK_DEFAULT = 5;
  var AUTOLOCK_MAX = 60;
  var CREATE_CONFIRM = "I saved my recovery phrase";
  var REMOVE_WALLET_CONFIRM = "remove this wallet";
  var WATCH_HELP_MS = 2000;

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

  /** Toolbar popup and side panel cannot show a getUserMedia permission prompt. */
  function cameraShellCannotPrompt(search, protocol, innerWidth) {
    if (String(protocol || "") !== "chrome-extension:") {
      return false;
    }
    if (parseShellMode(search, protocol) === "panel") {
      return true;
    }
    var w = Number(innerWidth);
    return isFinite(w) && w > 0 && w <= 520;
  }

  function wantsAutoScan(search) {
    return /(^|[?&])scan=1([&#]|$)/.test(String(search || ""));
  }

  function sendCameraErrorText(err) {
    var name = err && err.name ? String(err.name) : "";
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No camera was found on this desk.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "The camera is already in use.";
    }
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      return "This desk camera cannot be opened with the requested settings.";
    }
    if (name === "SecurityError") {
      return "This page is not allowed to use the camera.";
    }
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "PermissionDismissedError") {
      return "Camera permission was denied. Allow the camera for tkrWallet and try Scan QR again.";
    }
    return "The camera could not be opened.";
  }

  /* Native Max/percent leave a fee buffer. Tokens (USDC, etc.) reserve 0. */
  var SWAP_GAS_RESERVE = {
    1: 0.003,
    8453: 0.0002,
    4663: 0.0002,
    900001: 0.01,
    728126428: 15,
  };
  var SWAP_GAS_TIGHT = {
    1: 0.001,
    8453: 0.00005,
    4663: 0.00005,
    900001: 0.004,
    728126428: 8,
  };
  var SWAP_PCT_CMD = /^(25|50|75)%$/;

  var EXPLORER_ORIGIN = {
    1: "https://etherscan.io",
    8453: "https://basescan.org",
    4663: "https://robinhoodchain.blockscout.com",
  };
  var EXPLORER_CHAINS = [
    { chainId: 1, name: "Ethereum" },
    { chainId: 8453, name: "Base" },
    { chainId: 4663, name: "Robinhood" },
  ];

  function explorerAddressUrl(chainId, address) {
    var origin = EXPLORER_ORIGIN[Number(chainId)];
    var addr = String(address || "").trim();
    if (!origin || !addr) {
      return "";
    }
    return origin + "/address/" + addr;
  }

  function explorerTxUrl(chainId, hash) {
    var origin = EXPLORER_ORIGIN[Number(chainId)];
    var tx = String(hash || "").trim();
    if (!origin || !tx) {
      return "";
    }
    return origin + "/tx/" + tx;
  }

  var leaveGasBuffer = true;
  try {
    if (root.localStorage && root.localStorage.getItem(LEAVE_GAS_KEY) === "0") {
      leaveGasBuffer = false;
    }
  } catch (e) {
    leaveGasBuffer = true;
  }

  function readLeaveGasBuffer() {
    return leaveGasBuffer !== false;
  }

  function setLeaveGasBuffer(on) {
    leaveGasBuffer = !!on;
    try {
      if (root.localStorage) {
        root.localStorage.setItem(LEAVE_GAS_KEY, on ? "1" : "0");
      }
    } catch (e) {
      /* session-only */
    }
    var box = el("swap-leave-gas");
    if (box) {
      box.checked = !!on;
    }
  }

  function nativeGasReserve(chainId, isNative) {
    if (!isNative) {
      return 0;
    }
    var table = readLeaveGasBuffer() ? SWAP_GAS_RESERVE : SWAP_GAS_TIGHT;
    var n = table[Number(chainId)];
    return typeof n === "number" && isFinite(n) ? n : 0;
  }

  function spendableAmount(balance, chainId, isNative) {
    if (balance === null || balance === undefined || balance === "") {
      return null;
    }
    var b = Number(balance);
    if (!isFinite(b) || b < 0) {
      return null;
    }
    var spend = b - nativeGasReserve(chainId, isNative);
    return spend > 0 ? spend : 0;
  }

  function isMaxAmount(raw) {
    return String(raw || "").trim().toLowerCase() === "max";
  }

  function isNativeSendToken(token) {
    var t = String(token || "").trim();
    return !t || t.toLowerCase() === "native" || t.toUpperCase() === "ETH";
  }

  /** Tokens with a positive known balance, native last. Unknown/zero skipped. */
  function planEmptyChain(holdings, chainId) {
    var cid = Number(chainId);
    var tokens = [];
    var native = null;
    (holdings || []).forEach(function (h) {
      if (!h || Number(h.chain_id) !== cid) {
        return;
      }
      if (h.state && h.state !== "ok") {
        return;
      }
      if (!(Number(h.amount) > 0)) {
        return;
      }
      var nativeHold = !h.address || String(h.address).toLowerCase() === "native";
      var item = {
        token: nativeHold ? "native" : String(h.address),
        symbol: h.symbol || "",
        native: nativeHold,
      };
      if (nativeHold) {
        native = item;
      } else {
        tokens.push(item);
      }
    });
    if (native) {
      tokens.push(native);
    }
    return tokens;
  }

  function percentOfSpendable(balance, pct, chainId, isNative) {
    var spend = spendableAmount(balance, chainId, isNative);
    if (spend == null) {
      return null;
    }
    var p = Number(pct);
    if (!isFinite(p) || p <= 0) {
      return null;
    }
    return spend * (p / 100);
  }

  /** Plain decimal for #swap-amount. Never grouping separators (toAtomicAmount). */
  function formatSwapInput(value, maxDigits) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) {
      return "";
    }
    var digits = maxDigits == null ? 8 : Number(maxDigits);
    if (!isFinite(digits) || digits < 0) {
      digits = 8;
    }
    if (digits > 18) {
      digits = 18;
    }
    var s = n.toFixed(digits);
    if (s.indexOf(".") !== -1) {
      s = s.replace(/0+$/, "").replace(/\.$/, "");
    }
    return s;
  }

  var CLI_HELP = [
    "tkrWallet CLI. Secrets are never printed.",
    "help              this list",
    "status            lock state and public account",
    "home | search | settings | accounts | swap | activity",
    "search <query>    open token search",
    "currency usd|cad|mxn  display currency (also: usd, cad, mxn)",
    "swap              open swap",
    "swap from <id>    You Pay token (chain:asset)",
    "swap to <id>      You Receive token",
    "swap amount <n>   You Pay amount",
    "swap 25%|50%|75%|max  spendable fraction (also: 25%, max)",
    "swap dest <addr>  Sui/Stellar destination",
    "swap flip         flip You Pay and You Receive",
    "swap quote        quote first (also: quote)",
    "swap now          sign a live quote",
    "send              open send",
    "send 25%|50%|75%|max  fill amount (max empties after gas)",
    "send empty        empty this chain (tap again to confirm)",
    "swap leftover on|off  extra native gas buffer on Max",
    "consolidate       open consolidate",
    "connect           connect to Scratchpost",
    "disconnect        end the Scratchpost session",
    "connect-at-launch [on|off]  connect when the wallet unlocks",
    "lock              lock now",
    "dock              dock to the browser side panel",
    "clear             clear this log",
    "close             close the terminal",
  ];
  var CLI_REFUSE = /^(seed|mnemonic|phrase|secret|private|privkey|password|passwd|export|backup)$/i;

  function formatConnectIp(ipv4, ipv6) {
    var v4 = ipv4 ? String(ipv4) : "\u2014";
    var v6 = ipv6 ? String(ipv6) : "\u2014";
    return "Connect: " + v4 + "," + v6;
  }

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
    if (cmd === "connect") {
      out.action = { type: "connect" };
      out.lines.push("connecting.");
      return out;
    }
    if (cmd === "disconnect") {
      out.action = { type: "disconnect" };
      out.lines.push("disconnecting.");
      return out;
    }
    if (cmd === "connect-at-launch") {
      var flag = String(rest || "").trim().toLowerCase();
      if (!flag) {
        out.action = { type: "connect-at-launch-status" };
        return out;
      }
      if (flag !== "on" && flag !== "off") {
        out.lines.push("connect-at-launch on | off");
        return out;
      }
      out.action = { type: "connect-at-launch", on: flag === "on" };
      out.lines.push("connect at launch " + flag + ".");
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
    if (cmd === "home" || cmd === "settings" || cmd === "accounts" || cmd === "activity" || cmd === "consolidate") {
      out.action = { type: "go", screen: cmd };
      out.lines.push("opening " + cmd + ".");
      return out;
    }
    if (cmd === "usd" || cmd === "cad" || cmd === "mxn") {
      out.action = { type: "currency", currency: cmd };
      out.lines.push("currency " + cmd.toUpperCase() + ".");
      return out;
    }
    if (cmd === "currency") {
      var cur = String(rest || "").trim().toLowerCase();
      if (cur === "mxd") {
        cur = "mxn";
      }
      if (CURRENCIES.indexOf(cur) === -1) {
        out.lines.push("currency usd | cad | mxn");
        return out;
      }
      out.action = { type: "currency", currency: cur };
      out.lines.push("currency " + cur.toUpperCase() + ".");
      return out;
    }
    if (SWAP_PCT_CMD.test(cmd)) {
      out.action = { type: "swap-pct", pct: Number(cmd.slice(0, -1)) };
      out.lines.push("swap " + cmd + " of spendable.");
      return out;
    }
    if (cmd === "max") {
      out.action = { type: "swap-pct", pct: 100 };
      out.lines.push("swap max of spendable.");
      return out;
    }
    if (cmd === "quote") {
      out.action = { type: "swap-quote" };
      out.lines.push("quoting.");
      return out;
    }
    if (cmd === "swap") {
      if (!rest) {
        out.action = { type: "go", screen: "swap" };
        out.lines.push("opening swap.");
        return out;
      }
      var subParts = rest.split(/\s+/);
      var sub = subParts[0].toLowerCase();
      var subRest = subParts.slice(1).join(" ");
      if (sub === "from") {
        if (!subRest) {
          out.lines.push("swap from <chain:asset>");
          return out;
        }
        out.action = { type: "swap-from", value: subRest };
        out.lines.push("you pay " + subRest + ".");
        return out;
      }
      if (sub === "to") {
        if (!subRest) {
          out.lines.push("swap to <chain:asset>");
          return out;
        }
        out.action = { type: "swap-to", value: subRest };
        out.lines.push("you receive " + subRest + ".");
        return out;
      }
      if (sub === "amount") {
        if (!subRest) {
          out.lines.push("swap amount <n>");
          return out;
        }
        out.action = { type: "swap-amount", amount: subRest };
        out.lines.push("amount " + subRest + ".");
        return out;
      }
      if (sub === "dest") {
        out.action = { type: "swap-dest", value: subRest };
        out.lines.push(subRest ? "destination set." : "destination cleared.");
        return out;
      }
      if (SWAP_PCT_CMD.test(sub)) {
        out.action = { type: "swap-pct", pct: Number(sub.slice(0, -1)) };
        out.lines.push("swap " + sub + " of spendable.");
        return out;
      }
      if (sub === "max") {
        out.action = { type: "swap-pct", pct: 100 };
        out.lines.push("swap max of spendable.");
        return out;
      }
      if (sub === "quote") {
        out.action = { type: "swap-quote" };
        out.lines.push("quoting.");
        return out;
      }
      if (sub === "now" || sub === "submit") {
        out.action = { type: "swap-now" };
        out.lines.push("swap now.");
        return out;
      }
      if (sub === "flip") {
        out.action = { type: "swap-flip" };
        out.lines.push("flipping pair.");
        return out;
      }
      if (sub === "leftover") {
        var leftoverFlag = String(subRest || "").toLowerCase();
        if (leftoverFlag !== "on" && leftoverFlag !== "off") {
          out.lines.push("swap leftover on | off");
          return out;
        }
        out.action = { type: "leave-gas", on: leftoverFlag === "on" };
        out.lines.push("leave extra gas " + leftoverFlag + ".");
        return out;
      }
      out.lines.push("unknown swap command. type help.");
      return out;
    }
    if (cmd === "send") {
      if (!rest) {
        out.action = { type: "go", screen: "send" };
        out.lines.push("opening send.");
        return out;
      }
      var sendSub = rest.split(/\s+/)[0].toLowerCase();
      if (SWAP_PCT_CMD.test(sendSub)) {
        out.action = { type: "send-pct", pct: Number(sendSub.slice(0, -1)) };
        out.lines.push("send " + sendSub + " of spendable.");
        return out;
      }
      if (sendSub === "max") {
        out.action = { type: "send-pct", pct: 100 };
        out.lines.push("send max remaining after gas.");
        return out;
      }
      if (sendSub === "empty" || sendSub === "empty-chain") {
        out.action = { type: "send-empty-chain" };
        out.lines.push("empty this chain. tap again to confirm.");
        return out;
      }
      out.lines.push("send | send 25%|50%|75%|max | send empty");
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
      out.lines.push(ctx && ctx.edgeConnected ? "scratchpost connected." : "scratchpost disconnected.");
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
    var walletId = String(parsed.walletId || "").trim();
    if (walletId && !/^[A-Za-z0-9_-]{1,64}$/.test(walletId)) {
      walletId = "";
    }
    return {
      address: address,
      lastActivity: lastActivity,
      autolockMinutes: minutes,
      solAddress: solAddress || null,
      tronAddress: tronAddress || null,
      walletId: walletId || null,
    };
  }

  /** Typed backup confirm: exact sentence, trimmed. Not a checkbox. */
  function typedCreateConfirm(typed) {
    return String(typed || "").trim() === CREATE_CONFIRM;
  }

  function typedRemoveWallet(typed) {
    return String(typed || "").trim() === REMOVE_WALLET_CONFIRM;
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
    if (action.type === "connect") {
      onConnect();
      return;
    }
    if (action.type === "disconnect") {
      onDisconnect();
      return;
    }
    if (action.type === "connect-at-launch") {
      setConnectAtLaunch(action.on);
      appendTerminalLine("out", "connect at launch " + (action.on ? "on" : "off") + ".");
      return;
    }
    if (action.type === "connect-at-launch-status") {
      appendTerminalLine("out", "connect at launch " + (readStoredConnectAtLaunch() ? "on" : "off") + ".");
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
      return;
    }
    if (action.type === "currency") {
      setCurrency(action.currency);
      refreshPrices();
      return;
    }
    if (action.type === "swap-from" || action.type === "swap-to" || action.type === "swap-amount" || action.type === "swap-dest" || action.type === "swap-pct" || action.type === "swap-quote" || action.type === "swap-now" || action.type === "swap-flip") {
      showScreen("swap");
      if (root.location && root.location.hash !== "#/swap") {
        root.location.hash = "#/swap";
      }
      applySwapCliAction(action);
    }
    if (action.type === "send-pct" || action.type === "send-empty-chain") {
      showScreen("send");
      if (root.location && root.location.hash !== "#/send") {
        root.location.hash = "#/send";
      }
      applySendCliAction(action);
    }
    if (action.type === "leave-gas") {
      setLeaveGasBuffer(action.on);
      appendTerminalLine("out", "leave extra gas " + (action.on ? "on" : "off") + ".");
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
        edgeConnected: edgeConnected,
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
    if (next === "consolidate") {
      paintConsolidateVaults();
    }
    if (next === "settings") {
      refreshConnectIp();
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
    if (next === "activity") {
      renderActivity();
    }
    if (next === "send") {
      paintSendContacts();
    }
    if (next === "swap") {
      fillSwapPairs();
      paintSwapPanel();
    }
    if (next === "accounts") {
      renderAccountsManage();
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

  function isWatchRow(acc) {
    var c = crypto();
    if (c && typeof c.isWatchAccount === "function") {
      return c.isWatchAccount(acc);
    }
    return Boolean(acc && acc.kind === "watch");
  }

  function sessionCanSign() {
    return Boolean(
      session.phrase &&
        session.watch !== true &&
        session.index != null &&
        session.index !== "" &&
        Number.isInteger(Number(session.index)) &&
        Number(session.index) >= 0
    );
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

  function appendDrawerDot(list, opts) {
    var wrap = document.createElement("div");
    var btn = document.createElement("button");
    var cap = document.createElement("span");
    wrap.className = "flex flex-col items-center gap-1";
    btn.type = "button";
    btn.className =
      "flex size-11 items-center justify-center rounded-full text-xs font-semibold text-ink-950 ring-1 ring-inset ring-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400";
    if (opts.current) {
      btn.className += " ring-2";
    }
    btn.style.backgroundColor = ACCOUNT_COLORS[opts.n % ACCOUNT_COLORS.length];
    btn.textContent = opts.dot;
    btn.setAttribute("aria-label", opts.label);
    btn.setAttribute("aria-current", opts.current ? "true" : "false");
    btn.addEventListener("click", opts.onClick);
    cap.className = "max-w-14 truncate text-center text-[10px] leading-tight text-cream-500";
    cap.textContent = opts.caption;
    wrap.appendChild(btn);
    wrap.appendChild(cap);
    list.appendChild(wrap);
  }

  function renderAccountDrawer() {
    var list = el("account-list");
    if (!list) {
      return;
    }
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    var s = store();
    function paintWatches(startN) {
      var accounts = session.accounts || [];
      var watchN = 0;
      var n = startN || 0;
      accounts.forEach(function (acc) {
        if (!isWatchRow(acc)) {
          return;
        }
        watchN += 1;
        var mine =
          acc &&
          acc.evmAddress &&
          session.address &&
          String(acc.evmAddress).toLowerCase() === String(session.address).toLowerCase();
        appendDrawerDot(list, {
          n: n,
          current: mine,
          dot: "W" + watchN,
          label: "Watch " + watchN,
          caption: "Watch " + watchN,
          onClick: function () {
            switchToAccount(acc);
          },
        });
        n += 1;
      });
    }
    function paintWalletRows(rows) {
      var n = 0;
      (rows || []).forEach(function (row, i) {
        var current = row && row.id && session.walletId && String(row.id) === String(session.walletId);
        appendDrawerDot(list, {
          n: n,
          current: current || (!session.walletId && i === 0 && session.address && row.evmAddress && String(row.evmAddress).toLowerCase() === String(session.address).toLowerCase()),
          dot: accountDotLabel(i),
          label: "Wallet " + (i + 1),
          caption: "Wallet " + (i + 1),
          onClick: function () {
            switchWallet(row.id);
          },
        });
        n += 1;
      });
      paintWatches(n);
    }
    if (!s || typeof s.listVaults !== "function") {
      paintWatches(0);
      return;
    }
    s.listVaults()
      .then(function (rows) {
        if (!list || list !== el("account-list")) {
          return;
        }
        while (list.firstChild) {
          list.removeChild(list.firstChild);
        }
        if (!rows || !rows.length) {
          paintWatches(0);
          return;
        }
        paintWalletRows(rows);
      })
      .catch(function () {
        paintWatches(0);
      });
  }

  function switchWallet(id) {
    if (!id) {
      return;
    }
    closeAccountDrawer();
    if (session.walletId === id && session.phrase) {
      return;
    }
    session.pendingWalletId = id;
    var s = store();
    if (s && typeof s.setActiveVault === "function") {
      s.setActiveVault(id).catch(function () { /* non-fatal */ });
    }
    openGate("unlock");
  }

  function renderAccountsManage() {
    var list = el("accounts-manage-list");
    if (!list) {
      return;
    }
    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    var accounts = session.accounts || [];
    var watchSubmit = el("watch-account-submit");
    var c = crypto();
    var watchN = 0;
    var w;
    for (w = 0; w < accounts.length; w++) {
      if (isWatchRow(accounts[w])) {
        watchN += 1;
      }
    }
    var watchCap =
      c && typeof c.MAX_WATCH_ACCOUNTS === "number" ? watchN >= c.MAX_WATCH_ACCOUNTS : false;
    if (watchSubmit) {
      watchSubmit.disabled = !!watchCap;
    }
    var s = store();
    function paintWatches() {
      if (!session.phrase || !accounts.length) {
        return;
      }
      var watchShown = 0;
      accounts.forEach(function (acc) {
        if (!isWatchRow(acc)) {
          return;
        }
        watchShown += 1;
        var btn = document.createElement("button");
        var label = document.createElement("span");
        var meta = document.createElement("span");
        var mine =
          acc &&
          acc.evmAddress &&
          session.address &&
          String(acc.evmAddress).toLowerCase() === String(session.address).toLowerCase();
        btn.type = "button";
        btn.className =
          "mt-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-card bg-ink-950 px-4 text-left ring-1 ring-inset ring-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400";
        label.className = "text-sm text-cream-100";
        label.textContent = "Watch " + watchShown + (mine ? " (current)" : "");
        meta.className = "tnum truncate text-xs text-cream-500";
        meta.textContent = acc && acc.evmAddress ? shortAddress(acc.evmAddress) : "";
        btn.appendChild(label);
        btn.appendChild(meta);
        btn.setAttribute("aria-current", mine ? "true" : "false");
        btn.addEventListener("click", function () {
          switchToAccount(acc);
        });
        list.appendChild(btn);
      });
      if (watchCap) {
        showGateError("watch-account-error", "This vault already has the maximum of 20 watch addresses.");
      }
    }
    if (!s || typeof s.listVaults !== "function") {
      paintWatches();
      return;
    }
    s.listVaults()
      .then(function (rows) {
        if (!list) {
          return;
        }
        if (!rows || !rows.length) {
          var empty = document.createElement("p");
          empty.className = "text-xs leading-relaxed text-cream-500";
          empty.textContent = "No wallet on this device yet. New Wallet or Import Wallet adds one.";
          list.appendChild(empty);
          return;
        }
        rows.forEach(function (row, n) {
          var btn = document.createElement("button");
          var label = document.createElement("span");
          var meta = document.createElement("span");
          var current = row && row.id && session.walletId && String(row.id) === String(session.walletId);
          btn.type = "button";
          btn.className =
            "mt-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-card bg-ink-950 px-4 text-left ring-1 ring-inset ring-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400";
          label.className = "text-sm text-cream-100";
          label.textContent = "Wallet " + (n + 1) + (current ? " (current)" : "");
          meta.className = "tnum truncate text-xs text-cream-500";
          meta.textContent = row && row.evmAddress ? shortAddress(row.evmAddress) : "";
          btn.appendChild(label);
          btn.appendChild(meta);
          btn.setAttribute("aria-current", current ? "true" : "false");
          btn.addEventListener("click", function () {
            switchWallet(row.id);
          });
          list.appendChild(btn);
        });
        paintWatches();
      })
      .catch(function () {
        paintWatches();
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
    s.loadVault(session.walletId)
      .then(function (vault) {
        if (!vault) {
          return;
        }
        vault.selectedIndex = Number(index);
        vault.selectedKind = "hd";
        vault.selectedWatch = null;
        return s.saveVault(vault);
      })
      .catch(function () {
        /* non-fatal: next unlock falls back to account 0 */
      });
  }

  function persistSelectedWatch(address) {
    var s = store();
    if (!s) {
      return;
    }
    s.loadVault(session.walletId)
      .then(function (vault) {
        if (!vault) {
          return;
        }
        vault.selectedKind = "watch";
        vault.selectedWatch = address;
        return s.saveVault(vault);
      })
      .catch(function () {
        /* non-fatal: next unlock falls back to the last HD account */
      });
  }

  function switchToAccount(acc) {
    if (!session.phrase) {
      setWalletStatus("Unlock the wallet to switch accounts.");
      return;
    }
    if (!acc) {
      return;
    }
    if (isWatchRow(acc)) {
      revealWatchAccount(acc.evmAddress);
      persistSelectedWatch(acc.evmAddress);
      closeAccountDrawer();
      return;
    }
    var idx = Number(acc.i);
    if (!isFinite(idx) || idx < 0) {
      return;
    }
    session.watch = false;
    revealAccount(session.phrase, idx);
    persistSelectedIndex(idx);
    closeAccountDrawer();
  }

  function switchAccount(index) {
    var accounts = session.accounts || [];
    var i;
    for (i = 0; i < accounts.length; i++) {
      if (!isWatchRow(accounts[i]) && Number(accounts[i].i) === Number(index)) {
        switchToAccount(accounts[i]);
        return;
      }
    }
  }

  function setAccount(address, label) {
    var dot = el("account-dot");
    var unlocked = Boolean(address);
    var live = unlocked && edgeConnected && !session.watch;
    setText(el("account-label"), unlocked ? shortAddress(address) : label || "No wallet");
    setText(
      el("account-status"),
      live ? "Connected to Scratchpost. " + String(address) : unlocked ? "Unlocked. Not connected to Scratchpost." : "No wallet"
    );
    if (dot) {
      dot.classList.remove("bg-up-400", "bg-cream-500", "bg-ember-400");
      dot.classList.add(live ? "bg-up-400" : "bg-cream-500");
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

  function noteBroadcast(sent, kind, extra) {
    extra = extra || {};
    var hash = sent && sent.tx_hash ? String(sent.tx_hash) : "";
    var chainId = Number((sent && sent.chain_id) || extra.chain_id || 0);
    var s = store();
    if (!hash || !session.walletId || !s || typeof s.recordActivity !== "function") {
      return;
    }
    s.recordActivity({
      wallet_id: session.walletId,
      chain_id: chainId,
      tx_hash: hash,
      kind: kind || "swap",
      symbol: extra.symbol || "",
      amount: extra.amount || "",
      at: Date.now(),
    }).then(function () {
      if (state.screen === "activity") {
        renderActivity();
      }
    }).catch(function () {
      /* non-fatal */
    });
  }

  function renderActivity() {
    var explorers = el("activity-explorers");
    var list = el("activity-list");
    if (!explorers || !list) {
      return;
    }
    explorers.textContent = "";
    list.textContent = "";
    var addr = session.address;
    if (!addr) {
      var locked = document.createElement("p");
      locked.className = "px-4 py-3 text-sm text-cream-500";
      locked.textContent = "Unlock to see explorers and broadcasts for this wallet.";
      list.appendChild(locked);
      return;
    }
    var i;
    for (i = 0; i < EXPLORER_CHAINS.length; i++) {
      var spec = EXPLORER_CHAINS[i];
      var href = explorerAddressUrl(spec.chainId, addr);
      if (!href) {
        continue;
      }
      var a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className =
        "min-h-11 rounded-full bg-ink-900 px-4 text-sm font-medium text-ember-400 ring-1 ring-inset ring-white/10 hover:ring-ember-400/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400";
      a.textContent = spec.name + " explorer";
      explorers.appendChild(a);
    }
    var data = root.tkrWalletData;
    var localP =
      session.watch || !session.walletId
        ? Promise.resolve([])
        : store() && typeof store().listActivity === "function"
          ? store().listActivity(session.walletId).catch(function () {
              return [];
            })
          : Promise.resolve([]);
    var chainP =
      data && typeof data.getBaseActivity === "function"
        ? data.getBaseActivity(addr).then(function (r) {
            return r && r.state === "ok" ? r.items || [] : [];
          })
        : Promise.resolve([]);
    Promise.all([localP, chainP]).then(function (pair) {
      var localRows = pair[0] || [];
      var chainRows = pair[1] || [];
      list.textContent = "";
      var seen = {};
      var merged = [];
      var n;
      for (n = 0; n < localRows.length; n++) {
        var lr = localRows[n];
        var lh = String(lr.tx_hash || "").toLowerCase();
        if (lh) {
          seen[lh] = true;
        }
        merged.push({
          chain_id: lr.chain_id,
          tx_hash: lr.tx_hash,
          kind: lr.kind || "tx",
          at: lr.at,
          source: "local",
        });
      }
      for (n = 0; n < chainRows.length; n++) {
        var cr = chainRows[n];
        var ch = String(cr.tx_hash || "").toLowerCase();
        if (!ch || seen[ch]) {
          continue;
        }
        seen[ch] = true;
        merged.push({
          chain_id: 8453,
          tx_hash: cr.tx_hash,
          kind: "base",
          at: Number(cr.at) || 0,
          source: "chain",
        });
      }
      if (session.watch && !merged.length) {
        var watchNote = document.createElement("p");
        watchNote.className = "px-4 py-3 text-sm text-cream-500";
        watchNote.textContent = "Watch address. This device does not broadcast.";
        list.appendChild(watchNote);
        return;
      }
      if (!merged.length) {
        var none = document.createElement("p");
        none.className = "px-4 py-3 text-sm text-cream-500";
        none.textContent = "No broadcasts from this device yet.";
        list.appendChild(none);
        return;
      }
      for (n = 0; n < merged.length; n++) {
        var row = merged[n];
        var txHref = explorerTxUrl(row.chain_id, row.tx_hash);
        var line = document.createElement(txHref ? "a" : "p");
        line.className = "block px-4 py-3 text-sm text-cream-100 ring-1 ring-inset ring-white/10";
        if (txHref) {
          line.href = txHref;
          line.target = "_blank";
          line.rel = "noopener noreferrer";
          line.className += " text-ember-400";
        }
        var when = row.at ? new Date(Number(row.at)).toISOString().slice(0, 19).replace("T", " ") + " UTC" : "";
        var label = (row.kind || "tx") + " · " + String(row.tx_hash || "").slice(0, 10) + "…";
        line.textContent = when ? when + " · " + label : label;
        list.appendChild(line);
      }
    });
  }

  var copyResetTimer = null;
  function copyTextToClipboard(text, opts) {
    opts = opts || {};
    var okMessage = opts.okMessage || "Address copied to clipboard.";
    var failMessage = opts.failMessage || "Copy failed. Select the address and copy it manually.";
    var emptyMessage = opts.emptyMessage || "Unlock the wallet to copy an address.";
    function paintOk() {
      setWalletStatus(okMessage);
      if (opts.noteEl) {
        setText(opts.noteEl, okMessage);
      }
      if (opts.button) {
        opts.button.textContent = "Copied";
        if (copyResetTimer) {
          root.clearTimeout(copyResetTimer);
        }
        copyResetTimer = root.setTimeout(function () {
          opts.button.textContent = opts.buttonLabel || "Copy address";
        }, 2000);
      }
    }
    function paintFail(message) {
      setWalletStatus(message);
      if (opts.noteEl) {
        setText(opts.noteEl, message);
      }
    }
    if (!text) {
      paintFail(emptyMessage);
      return Promise.resolve(false);
    }
    try {
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
        var done = root.navigator.clipboard.writeText(text);
        if (done && typeof done.then === "function") {
          return done.then(function () {
            paintOk();
            return true;
          }).catch(function () {
            paintFail(failMessage);
            return false;
          });
        }
        paintOk();
        return Promise.resolve(true);
      }
    } catch (e) {
      /* fall through */
    }
    paintFail("Copy is unavailable in this browser. Select the address and copy it manually.");
    return Promise.resolve(false);
  }

  function addressForChain(chainId) {
    if (Number(chainId) === 900001) {
      return session.solAddress || "";
    }
    if (Number(chainId) === 728126428) {
      return session.tronAddress || "";
    }
    return session.address || "";
  }

  var busyCount = 0;
  var BUSY_BUTTONS = [
    "swap-quote",
    "swap-submit",
    "swap-flip",
    "send-submit",
    "send-empty-chain",
    "consolidate-run",
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
      extras = document.querySelectorAll("[data-currency], [data-swap-pct], [data-send-pct]");
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
        names.push(name + " could not be read" + (c.error ? " (" + c.error + ")" : ""));
      } else {
        names.push(name + " was read only in part" + (c.error ? " (" + c.error + ")" : ""));
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
    if (!sessionCanSign() || !c || !data) {
      return Promise.reject(new Error(session.watch ? "watch" : "locked"));
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
    if (!sessionCanSign()) {
      if (session.watch) {
        setPoolNote("This is a watch address. tkrWallet does not hold its key. Nothing was signed.");
        return;
      }
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

  function sendTokenDecimals(chainId, token) {
    if (Number(chainId) === 900001) {
      return 9;
    }
    var asset = isNativeSendToken(token) ? null : token;
    var hold = holdingFor(chainId, asset);
    if (hold && typeof hold.decimals === "number") {
      return hold.decimals;
    }
    var meta = metaFor(chainId, asset);
    if (meta && typeof meta.decimals === "number") {
      return meta.decimals;
    }
    return 18;
  }

  function broadcastSend(chainId, to, atomic, token) {
    var wallet = root.tkrWalletData;
    var from = Number(chainId) === 900001 ? session.solAddress : session.address;
    return wallet
      .buildSend({ chain_id: chainId, from: from, to: to, amount: atomic, token: token })
      .then(function (body) {
        if (!body || body.ok === false) {
          throw new Error((body && body.error) || "build");
        }
        if (Number(chainId) === 900001) {
          return signBuiltTx({ tx_b64: body.tx_b64 }, 900001);
        }
        return signBuiltTx(body.tx, body.chain_id);
      })
      .then(function (sent) {
        if (!sent || sent.ok === false) {
          throw new Error("broadcast");
        }
        noteBroadcast(sent, "send", {
          chain_id: chainId,
          amount: atomic,
          symbol: isNativeSendToken(token) ? "" : token,
        });
        return sent;
      });
  }

  var pendingEmpty = null;

  function onSendSubmit() {
    var wallet = root.tkrWalletData;
    var c = crypto();
    if (!wallet || typeof wallet.buildSend !== "function" || !c) {
      setText(el("send-note"), "Send is unavailable.");
      return;
    }
    if (!sessionCanSign()) {
      if (session.watch) {
        setText(el("send-note"), "This is a watch address. tkrWallet does not hold its key. Nothing was signed.");
        return;
      }
      openGate("unlock");
      return;
    }
    var chainId = Number((el("send-chain") || {}).value || 1);
    var to = String((el("send-to") || {}).value || "").trim();
    var amountHuman = String((el("send-amount") || {}).value || "").trim();
    var token = String((el("send-token") || {}).value || "native");
    if (!to) {
      setText(el("send-note"), "Enter a destination address.");
      return;
    }
    var atomic;
    if (isMaxAmount(amountHuman)) {
      atomic = "max";
    } else {
      atomic = wallet.toAtomicAmount(amountHuman, sendTokenDecimals(chainId, token));
    }
    if (!atomic) {
      setText(el("send-note"), "Enter an amount, or Max.");
      return;
    }
    pendingEmpty = null;
    setText(el("send-note"), "Building send\u2026");
    withBusy(function () {
      return broadcastSend(chainId, to, atomic, token).then(function (sent) {
        setText(el("send-note"), "Broadcast " + (sent.tx_hash || "") + ".");
        setWalletStatus("Sent. Key stayed on this device.");
      });
    }, "Building send on Scratchpost\u2026").catch(function () {
      setText(el("send-note"), "Send failed. Nothing was signed off-device.");
    });
  }

  function applySendPercent(pct) {
    var chainId = Number((el("send-chain") || {}).value || 1);
    var token = String((el("send-token") || {}).value || "native");
    var amountEl = el("send-amount");
    var native = isNativeSendToken(token);
    if (Number(pct) >= 100) {
      if (amountEl) {
        amountEl.value = "max";
      }
      setText(
        el("send-note"),
        native
          ? "Max remaining after gas. Scratchpost will empty this native balance."
          : "Max token balance. Native gas is still required."
      );
      return;
    }
    var hold = holdingFor(chainId, native ? null : token);
    if (!hold || hold.state !== "ok" || hold.amount == null) {
      setText(el("send-note"), "Balance is unknown. Type an amount.");
      return;
    }
    var part = percentOfSpendable(hold.amount, pct, chainId, native);
    if (part == null) {
      setText(el("send-note"), "Balance is unknown. Type an amount.");
      return;
    }
    if (!(part > 0)) {
      setText(el("send-note"), native ? "All of this native balance is reserved for gas." : "No balance to send.");
      return;
    }
    if (amountEl) {
      amountEl.value = formatSwapInput(part, Math.min(8, sendTokenDecimals(chainId, token)));
    }
    setText(el("send-note"), pct + "% of spendable filled.");
  }

  function onEmptyChain() {
    var wallet = root.tkrWalletData;
    var c = crypto();
    if (!wallet || typeof wallet.buildSend !== "function" || !c) {
      setText(el("send-note"), "Send is unavailable.");
      return;
    }
    if (!sessionCanSign()) {
      if (session.watch) {
        setText(el("send-note"), "This is a watch address. tkrWallet does not hold its key. Nothing was signed.");
        return;
      }
      openGate("unlock");
      return;
    }
    if (!edgeConnected) {
      pendingEmpty = null;
      setText(el("send-note"), "Connect to Scratchpost first. Nothing was signed.");
      setWalletStatus("Unlock and Connect first.");
      return;
    }
    var chainId = Number((el("send-chain") || {}).value || 1);
    var to = String((el("send-to") || {}).value || "").trim();
    if (!to) {
      pendingEmpty = null;
      setText(el("send-note"), "Enter a destination, then Empty this chain.");
      return;
    }
    var plan = planEmptyChain(uiData.lastHoldings, chainId);
    if (!plan.length) {
      pendingEmpty = null;
      setText(el("send-note"), "No holdings on this chain to empty. Check the Chain selector.");
      return;
    }
    var key = Number(chainId) + ":" + to.toLowerCase();
    var chainMeta = root.tkrWalletData && root.tkrWalletData.CHAINS[chainId];
    var chainName = (chainMeta && chainMeta.name) || ("chain " + chainId);
    if (!pendingEmpty || pendingEmpty.key !== key) {
      pendingEmpty = { key: key, chainId: chainId, to: to, plan: plan };
      var names = plan
        .map(function (p) {
          return p.symbol || p.token;
        })
        .join(", ");
      setText(
        el("send-note"),
        "Tap Empty this chain again to send " +
          plan.length +
          " holding" +
          (plan.length === 1 ? "" : "s") +
          " (" +
          names +
          ") on " +
          chainName +
          " to " +
          shortAddress(to) +
          ". Tokens first, then native. Keep this window open. This cannot be undone."
      );
      return;
    }
    var steps = pendingEmpty.plan.slice();
    var dest = pendingEmpty.to;
    var cid = pendingEmpty.chainId;
    pendingEmpty = null;
    var i = 0;
    function next() {
      if (i >= steps.length) {
        setText(
          el("send-note"),
          "Emptied " + steps.length + " holding" + (steps.length === 1 ? "" : "s") + " on " + chainName + "."
        );
        setWalletStatus("Sent. Key stayed on this device.");
        refreshBalances();
        return;
      }
      var step = steps[i];
      i += 1;
      setText(
        el("send-note"),
        "Emptying " + i + " of " + steps.length + " (" + (step.symbol || step.token) + ") on " + chainName + "\u2026"
      );
      return broadcastSend(cid, dest, "max", step.token).then(next);
    }
    withBusy(next, "Emptying " + chainName + " on Scratchpost\u2026").catch(function (err) {
      var why = err && err.message ? String(err.message) : "";
      if (why === "no_session") {
        setText(el("send-note"), "Connect to Scratchpost first. Nothing was signed.");
        return;
      }
      setText(el("send-note"), "Empty this chain stopped (" + (why || "send failed") + "). Nothing further was signed off-device.");
    });
  }

  function applySendCliAction(action) {
    if (!action || !action.type) {
      return;
    }
    if (action.type === "send-pct") {
      applySendPercent(action.pct);
      return;
    }
    if (action.type === "send-empty-chain") {
      onEmptyChain();
    }
  }

  var consolidateJob = null;
  var consolidateArmed = false;

  function consolidateNote(msg) {
    setText(el("consolidate-note"), msg || "");
  }

  function paintConsolidateVaults() {
    var destSel = el("consolidate-dest-vault");
    var box = el("consolidate-sources");
    var s = store();
    if (!s || typeof s.listVaults !== "function") {
      return;
    }
    s.listVaults()
      .then(function (rows) {
        if (destSel) {
          var keep = destSel.value;
          destSel.textContent = "";
          var blank = document.createElement("option");
          blank.value = "";
          blank.textContent = "Paste address below";
          destSel.appendChild(blank);
          (rows || []).forEach(function (row, n) {
            var opt = document.createElement("option");
            opt.value = String(row.id || "");
            opt.setAttribute("data-address", row.evmAddress || "");
            opt.textContent = "Wallet " + (n + 1) + " " + shortAddress(row.evmAddress || "");
            destSel.appendChild(opt);
          });
          if (keep) {
            destSel.value = keep;
          }
        }
        if (!box) {
          return;
        }
        while (box.firstChild) {
          box.removeChild(box.firstChild);
        }
        (rows || []).forEach(function (row, n) {
          var lab = document.createElement("label");
          lab.className = "flex min-h-11 items-center gap-3 text-sm text-cream-300";
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.className = "size-4 shrink-0";
          cb.setAttribute("data-consolidate-source", String(row.id || ""));
          cb.checked = true;
          var span = document.createElement("span");
          span.textContent = "Wallet " + (n + 1) + " " + shortAddress(row.evmAddress || "");
          lab.appendChild(cb);
          lab.appendChild(span);
          box.appendChild(lab);
        });
      })
      .catch(function () {
        consolidateNote("Could not list wallets on this device.");
      });
  }

  function readConsolidateDest() {
    var paste = String((el("consolidate-dest") || {}).value || "").trim();
    var sel = el("consolidate-dest-vault");
    var vid = sel && sel.value ? String(sel.value) : "";
    if (vid && sel.selectedIndex >= 0) {
      var opt = sel.options[sel.selectedIndex];
      var addr = opt ? String(opt.getAttribute("data-address") || "").trim() : "";
      return { vaultId: vid, address: addr || paste };
    }
    return { vaultId: "", address: paste };
  }

  function readConsolidateSources(destVaultId) {
    var nodes = document.querySelectorAll("[data-consolidate-source]");
    var out = [];
    Array.prototype.forEach.call(nodes, function (cb) {
      if (!cb.checked) {
        return;
      }
      var id = String(cb.getAttribute("data-consolidate-source") || "");
      if (!id || (destVaultId && id === String(destVaultId))) {
        return;
      }
      out.push({ id: id });
    });
    return out;
  }

  function runQuotedEvmSwap(fromChain, fromMint, toChain, toMint, amountHuman) {
    var wallet = root.tkrWalletData;
    var c = crypto();
    var fromTok = fromMint && fromMint !== "native" ? fromMint : "native";
    var toTok = toMint && toMint !== "native" ? toMint : "native";
    var atomic = wallet.toAtomicAmount(amountHuman, sendTokenDecimals(fromChain, fromTok));
    if (!atomic) {
      return Promise.reject(new Error("invalid-amount"));
    }
    if (!isScratchpostSwapPair(fromChain, toChain)) {
      return Promise.reject(new Error("no-route"));
    }
    return wallet
      .quoteSwap({
        chain_id: fromChain,
        from_chain_id: fromChain,
        to_chain_id: toChain,
        input_mint: fromTok,
        output_mint: toTok,
        amount: atomic,
      })
      .then(function (body) {
        if (!body || body.ok === false || !body.quote) {
          throw new Error((body && body.error) || "quote-failed");
        }
        function signBuilt(built) {
          if (!built || built.ok === false) {
            throw new Error((built && built.error) || "build-failed");
          }
          var signChain = Number(built.chain_id || fromChain);
          if (built.needs_approval && built.tx) {
            var approved = c.signAndBroadcastPayload(session.phrase, session.index, built.tx);
            return wallet.broadcastRaw({ raw: approved.raw, chain_id: approved.chainId }).then(function (sent) {
              if (!sent || sent.ok === false) {
                throw new Error((sent && sent.error) || "broadcast");
              }
              return wallet.buildSwap({ chain_id: signChain, quote: body.quote }).then(signBuilt);
            });
          }
          var tx = built.tx || built.unsigned_tx;
          if (!tx) {
            throw new Error("build-failed");
          }
          var signed = c.signAndBroadcastPayload(session.phrase, session.index, tx);
          return wallet.broadcastRaw({ raw: signed.raw, chain_id: signed.chainId });
        }
        function buildStep(quote, stepChain) {
          return wallet.buildSwap({ chain_id: stepChain, quote: quote }).then(signBuilt);
        }
        var q = body.quote || {};
        var first;
        if (q.route === "hop_then_lifi") {
          first = buildStep({ route: "hop_then_lifi", step: "hop", hop: q.hop, lifi: q.lifi }, fromChain).then(
            function (sent) {
              if (!sent || sent.ok === false) {
                throw new Error((sent && sent.error) || "broadcast");
              }
              return buildStep({ route: "hop_then_lifi", step: "lifi", hop: q.hop, lifi: q.lifi }, fromChain);
            }
          );
        } else if (q.route === "lifi_then_hop") {
          var lifiChain = Number((q.lifi && q.lifi.from_chain) || fromChain);
          var hopChain = Number((q.hop && q.hop.chain_id) || 8453);
          first = buildStep({ route: "lifi_then_hop", step: "lifi", hop: q.hop, lifi: q.lifi }, lifiChain).then(
            function (sent) {
              if (!sent || sent.ok === false) {
                throw new Error((sent && sent.error) || "broadcast");
              }
              return buildStep({ route: "lifi_then_hop", step: "hop", hop: q.hop, lifi: q.lifi }, hopChain);
            }
          );
        } else {
          first = buildStep(q, fromChain);
        }
        return first.then(function (sent) {
          if (!sent || sent.ok === false) {
            throw new Error((sent && sent.error) || "broadcast");
          }
          noteBroadcast(sent, "swap", { chain_id: fromChain });
          return sent;
        });
      });
  }

  function consolidateSwapThenSend(job) {
    var chainId = job.chainId;
    var target = job.token;
    var dest = job.dest;
    var holdings = planEmptyChain(uiData.lastHoldings, chainId);
    var targetNative = isNativeSendToken(target);
    var swaps = holdings.filter(function (h) {
      if (targetNative) {
        return !h.native;
      }
      return String(h.token || "").toLowerCase() !== String(target).toLowerCase();
    });
    function nextSwap(i) {
      if (i >= swaps.length) {
        return broadcastSend(chainId, dest, "max", targetNative ? "native" : target);
      }
      var h = swaps[i];
      var hold = holdingFor(chainId, h.native ? null : h.token);
      if (!hold || !(Number(hold.amount) > 0)) {
        return nextSwap(i + 1);
      }
      var amt = spendableAmount(hold.amount, chainId, h.native);
      if (!(amt > 0)) {
        return nextSwap(i + 1);
      }
      var human = formatSwapInput(amt, 8);
      return runQuotedEvmSwap(
        chainId,
        h.native ? "native" : h.token,
        chainId,
        targetNative ? "native" : target,
        human
      ).then(function () {
        return nextSwap(i + 1);
      });
    }
    return nextSwap(0);
  }

  function continueConsolidate() {
    if (!consolidateJob || consolidateJob.busy) {
      return;
    }
    var job = consolidateJob;
    if (job.i >= job.sources.length) {
      consolidateJob = null;
      consolidateArmed = false;
      consolidateNote("Consolidate finished. Key stayed on this device.");
      setWalletStatus("Consolidate finished. Key stayed on this device.");
      refreshBalances();
      return;
    }
    var src = job.sources[job.i];
    if (String(session.walletId || "") !== String(src.id)) {
      consolidateNote("Unlock source " + (job.i + 1) + " of " + job.sources.length + ".");
      session.pendingWalletId = src.id;
      openGate("unlock");
      return;
    }
    if (!sessionCanSign()) {
      openGate("unlock");
      return;
    }
    if (!edgeConnected) {
      consolidateNote("Connect source " + (job.i + 1) + " of " + job.sources.length + ".");
      onConnect();
      return;
    }
    job.busy = true;
    consolidateNote("Source " + (job.i + 1) + " of " + job.sources.length + "…");
    withBusy(function () {
      return refreshBalances().then(function () {
        if (job.mode === "swap-to") {
          return consolidateSwapThenSend(job);
        }
        return broadcastSend(job.chainId, job.dest, "max", job.token);
      });
    }, "Consolidating on Scratchpost…")
      .then(function () {
        job.i += 1;
        job.busy = false;
        continueConsolidate();
      })
      .catch(function (err) {
        job.busy = false;
        consolidateJob = null;
        consolidateArmed = false;
        var why = err && err.message ? String(err.message) : "send failed";
        consolidateNote("Stopped (" + why + "). Remaining sources were not signed.");
      });
  }

  function onConsolidateRun() {
    var dest = readConsolidateDest();
    if (!dest.address) {
      consolidateArmed = false;
      consolidateNote("Pick a destination wallet or paste an address.");
      return;
    }
    var chainId = Number((el("consolidate-chain") || {}).value || 8453);
    var token = String((el("consolidate-token") || {}).value || "native").trim() || "native";
    var modeEl = document.querySelector('input[name="consolidate-mode"]:checked');
    var mode = modeEl && modeEl.value === "swap-to" ? "swap-to" : "asset";
    var sources = readConsolidateSources(dest.vaultId);
    if (!sources.length) {
      consolidateArmed = false;
      consolidateNote("Check at least one source wallet (not the destination).");
      return;
    }
    var key = mode + ":" + chainId + ":" + token + ":" + dest.address.toLowerCase() + ":" + sources.map(function (s) { return s.id; }).join(",");
    if (!consolidateArmed || !consolidateJob || consolidateJob.key !== key) {
      consolidateArmed = true;
      consolidateJob = {
        key: key,
        dest: dest.address,
        mode: mode,
        chainId: chainId,
        token: token,
        sources: sources,
        i: 0,
        busy: false,
      };
      consolidateNote(
        "Tap Review consolidate again to move " +
          sources.length +
          " source" +
          (sources.length === 1 ? "" : "s") +
          " → " +
          shortAddress(dest.address) +
          " (" +
          mode +
          "). Keep this window open."
      );
      return;
    }
    continueConsolidate();
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
    if (state.screen === "swap") {
      paintSwapPanel();
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
    var swapFrom = selectedSwapToken(el("swap-from"));
    var swapTo = selectedSwapToken(el("swap-to"));
    if (swapFrom) {
      addKey(swapFrom.chainId + ":" + (swapFrom.mint || "native"));
    }
    if (swapTo) {
      addKey(swapTo.chainId + ":" + (swapTo.mint || "native"));
    }
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
  function holdingAmount(holdings, chainId, mint) {
    var want = String(mint || "native").toLowerCase();
    var rows = holdings || [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var h = rows[i];
      if (!h || Number(h.chain_id) !== Number(chainId)) {
        continue;
      }
      var got = String(h.address || "native").toLowerCase();
      if (want === "native" ? got === "native" : got === want) {
        return typeof h.amount === "number" && Number.isFinite(h.amount) ? h.amount : null;
      }
    }
    return null;
  }

  function refreshAfterSwap(fromChain, toChain, destMint) {
    var before = holdingAmount(uiData.lastHoldings, toChain, destMint);
    var destName =
      root.tkrWalletData && typeof root.tkrWalletData.chainName === "function"
        ? root.tkrWalletData.chainName(toChain)
        : "destination";
    return refreshBalances().then(function again(attempt) {
      if (Number(fromChain) === Number(toChain)) {
        return;
      }
      var after = holdingAmount(uiData.lastHoldings, toChain, destMint);
      if (after != null && (before == null || after > before + 1e-18)) {
        setWalletStatus("Received funds on " + destName + ".");
        return;
      }
      if (!attempt) {
        attempt = 1;
      }
      if (attempt >= 20) {
        setWalletStatus("Swap sent. " + destName + " may still be settling — open Home or pull refresh.");
        return;
      }
      setWalletStatus("Waiting for funds on " + destName + "…");
      return new Promise(function (resolve) {
        root.setTimeout(resolve, 2000);
      }).then(function () {
        return refreshBalances().then(function () {
          return again(attempt + 1);
        });
      });
    });
  }

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

  var session = { vault: null, address: null, solAddress: null, tronAddress: null, locked: false, index: 0, phrase: null, accounts: [], watch: false, walletId: null, pendingWalletId: null };
  var edgeConnected = false;
  var reconnectOnUnlock = false;
  var pendingCreate = null;
  var watchHelpTimer = null;
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
          walletId: session.walletId || null,
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
    if (mode === "unlock") {
      var sHint = store();
      if (sHint && typeof sHint.loadVault === "function") {
        sHint.loadVault(session.pendingWalletId || session.walletId).then(function (vault) {
          var addr = vault && vault.accounts && vault.accounts[0] && vault.accounts[0].evmAddress;
          if (addr) {
            setText(el("gate-subtitle"), "Unlock " + shortAddress(addr) + ". Each wallet has its own password.");
          }
        }).catch(function () { /* keep default subtitle */ });
      }
    }
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
    if (typeof s.listVaults === "function") {
      s.listVaults()
        .then(function (rows) {
          showGateForm(rows && rows.length ? "unlock" : "create");
        })
        .catch(function () {
          showGateForm("create");
        });
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
      "wallet-remove-confirm",
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
    session.watch = false;
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
    renderAccountsManage();
    maybeConnectAfterUnlock();
    paintConsolidateVaults();
    if (consolidateJob) {
      continueConsolidate();
    }
    return w;
  }

  function revealWatchAccount(address) {
    var c = crypto();
    var checksum;
    try {
      checksum = c && typeof c.parseEvmAddress === "function" ? c.parseEvmAddress(address) : String(address || "");
    } catch (e) {
      setWalletStatus("That is not a wallet address.");
      return;
    }
    session.address = checksum;
    session.solAddress = null;
    session.tronAddress = null;
    session.index = null;
    session.watch = true;
    session.locked = false;
    uiData.lastBalances = null;
    uiData.lastChecked = null;
    setAccount(checksum);
    setWalletStatus("Watch " + checksum + ". Reading balances\u2026 This address cannot send.");
    setWalletValue(null, state.currency, "Reading balances from the wallet edge\u2026");
    renderTokens(null);
    state.lastActivity = Date.now();
    scheduleLock();
    saveViewSession();
    refreshBalances();
    renderReceive();
    renderAccountDrawer();
    renderAccountsManage();
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

  function readStoredConnectAtLaunch() {
    try {
      return root.localStorage && root.localStorage.getItem(CONNECT_AT_LAUNCH_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setConnectAtLaunch(on) {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(CONNECT_AT_LAUNCH_KEY, on ? "1" : "0");
      }
    } catch (e) {
      /* non-fatal */
    }
    renderConnectAtLaunch();
  }

  function renderConnectAtLaunch() {
    var box = el("connect-at-launch");
    if (box) {
      box.checked = readStoredConnectAtLaunch();
    }
  }

  function paintConnectIp(ipv4, ipv6) {
    setText(el("connect-ip"), formatConnectIp(ipv4, ipv6));
  }

  function refreshConnectIp() {
    if (!edgeConnected) {
      paintConnectIp("", "");
      return;
    }
    var data = root.tkrWalletData;
    if (!data || typeof data.getSessionMe !== "function") {
      return;
    }
    data.getSessionMe().then(function (me) {
      if (!me || me.ok === false) {
        return;
      }
      paintConnectIp(me.ipv4, me.ipv6);
    }).catch(function () {
      /* keep last painted line */
    });
  }

  function dropEdgeSession() {
    var data = root.tkrWalletData;
    edgeConnected = false;
    paintConnectIp("", "");
    if (session.address) {
      setAccount(session.address);
    }
    if (data && typeof data.closeSession === "function") {
      data.closeSession().catch(function () {
        /* cookie may already be gone */
      });
    }
  }

  function maybeConnectAfterUnlock() {
    if (!sessionCanSign() || session.watch) {
      return;
    }
    if (readStoredConnectAtLaunch() || reconnectOnUnlock) {
      onConnect();
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
    if (edgeConnected) {
      reconnectOnUnlock = true;
      dropEdgeSession();
    }
    session.address = null;
    session.solAddress = null;
    session.tronAddress = null;
    session.index = 0;
    session.phrase = null;
    session.watch = false;
    session.vault = null;
    session.accounts = [];
    session.pendingWalletId = session.walletId || session.pendingWalletId;
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
    renderAccountsManage();
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
    s.loadVault(session.pendingWalletId || session.walletId)
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
        session.walletId = unlocked.vault && unlocked.vault.id ? unlocked.vault.id : session.walletId;
        session.pendingWalletId = null;
        if (s && typeof s.setActiveVault === "function" && session.walletId) {
          s.setActiveVault(session.walletId).catch(function () { /* non-fatal */ });
        }
        session.accounts =
          unlocked.vault && unlocked.vault.accounts && unlocked.vault.accounts.length
            ? unlocked.vault.accounts.slice()
            : c.accountsFromMnemonic(unlocked.phrase, 1);
        if (
          unlocked.vault &&
          unlocked.vault.selectedKind === "watch" &&
          unlocked.vault.selectedWatch &&
          typeof c.findAccountByAddress === "function" &&
          c.findAccountByAddress(session.accounts, unlocked.vault.selectedWatch)
        ) {
          session.phrase = unlocked.phrase;
          session.locked = false;
          revealWatchAccount(unlocked.vault.selectedWatch);
        } else {
          revealAccount(unlocked.phrase, selectedIndexFromVault(unlocked.vault));
        }
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
    var listed = typeof s.listVaults === "function" ? s.listVaults() : Promise.resolve([]);
    listed
      .then(function (rows) {
        var max = typeof s.MAX_WALLETS === "number" ? s.MAX_WALLETS : 20;
        if (rows && rows.length >= max) {
          throw new Error("wallet-cap");
        }
        var want = String(wallet.evmAddress || "").toLowerCase();
        var i;
        for (i = 0; i < (rows || []).length; i++) {
          if (String((rows[i] && rows[i].evmAddress) || "").toLowerCase() === want) {
            throw new Error("wallet-duplicate");
          }
        }
        return c.encryptVault(phrase, password);
      })
      .then(function (vault) {
        vault.accounts = c.accountsFromMnemonic(phrase, 1);
        vault.selectedIndex = 0;
        return s.saveVault(vault);
      })
      .then(function (vault) {
        session.walletId = vault && vault.id ? vault.id : session.walletId;
        session.pendingWalletId = null;
        session.accounts = c.accountsFromMnemonic(phrase, 1);
        revealAccount(phrase, 0);
        closeGate();
      })
      .catch(function (err) {
        if (err && err.message === "wallet-cap") {
          showGateError("gate-import-error", "This device already has the maximum of 20 wallets.");
          return;
        }
        if (err && err.message === "wallet-duplicate") {
          showGateError("gate-import-error", "That wallet is already on this device.");
          return;
        }
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
    var listed = typeof s.listVaults === "function" ? s.listVaults() : Promise.resolve([]);
    listed
      .then(function (rows) {
        var max = typeof s.MAX_WALLETS === "number" ? s.MAX_WALLETS : 20;
        if (rows && rows.length >= max) {
          throw new Error("wallet-cap");
        }
        return c.encryptVault(phrase, password);
      })
      .then(function (vault) {
        vault.accounts = c.accountsFromMnemonic(phrase, 1);
        vault.selectedIndex = 0;
        return s.saveVault(vault);
      })
      .then(function (vault) {
        session.walletId = vault && vault.id ? vault.id : session.walletId;
        session.pendingWalletId = null;
        session.accounts = c.accountsFromMnemonic(phrase, 1);
        revealAccount(phrase, 0);
        wipeSecrets();
        closeGate();
      })
      .catch(function (err) {
        if (err && err.message === "wallet-cap") {
          showGateError("gate-create-error", "This device already has the maximum of 20 wallets.");
          return;
        }
        showGateError("gate-create-error", "Could not store the wallet on this device.");
      });
  }

  function hideWalletRemoveForm() {
    var form = el("wallet-remove-form");
    if (form) {
      form.setAttribute("hidden", "");
    }
    var typed = el("wallet-remove-confirm");
    if (typed) {
      typed.value = "";
    }
    showGateError("wallet-action-error", null);
  }

  function onWalletNew() {
    hideWalletRemoveForm();
    openGate("create");
  }

  function onWalletImport() {
    hideWalletRemoveForm();
    openGate("import");
  }

  function onWalletRemove() {
    var form = el("wallet-remove-form");
    if (!form) {
      return;
    }
    if (!form.hasAttribute("hidden")) {
      hideWalletRemoveForm();
      return;
    }
    form.removeAttribute("hidden");
    var typed = el("wallet-remove-confirm");
    if (typed) {
      typed.focus();
    }
  }

  function onWalletRemoveConfirm() {
    if (!typedRemoveWallet((el("wallet-remove-confirm") || {}).value || "")) {
      showGateError("wallet-action-error", "Type exactly: " + REMOVE_WALLET_CONFIRM);
      return;
    }
    var s = store();
    if (!s || typeof s.clearVault !== "function") {
      showGateError("wallet-action-error", "Wallet storage unavailable in this browser.");
      return;
    }
    var id = session.walletId || session.pendingWalletId;
    s.clearVault(id)
      .then(function () {
        var wipe = typeof s.clearActivity === "function" ? s.clearActivity(id) : Promise.resolve();
        return wipe.then(function () {
          return typeof s.listVaults === "function" ? s.listVaults() : Promise.resolve([]);
        });
      })
      .then(function (rows) {
        hideWalletRemoveForm();
        session.walletId = rows && rows[0] ? rows[0].id : null;
        session.pendingWalletId = session.walletId;
        lockNow("removed");
        if (!rows || !rows.length) {
          setWalletStatus("Wallet removed from this device. The recovery phrase is the only backup.");
          go("home");
          return;
        }
        setWalletStatus("Wallet removed. " + rows.length + " left on this device.");
        go("accounts");
        renderAccountsManage();
      })
      .catch(function () {
        showGateError("wallet-action-error", "Could not remove the wallet from this device.");
      });
  }

  function hideWatchHelp() {
    if (watchHelpTimer) {
      clearTimeout(watchHelpTimer);
      watchHelpTimer = null;
    }
    var tip = el("watch-account-tip");
    if (tip) {
      tip.setAttribute("hidden", "");
    }
  }

  function bindWatchHelp(btn) {
    if (!btn) {
      return;
    }
    function arm() {
      hideWatchHelp();
      watchHelpTimer = setTimeout(function () {
        watchHelpTimer = null;
        var tip = el("watch-account-tip");
        if (tip) {
          tip.removeAttribute("hidden");
        }
      }, WATCH_HELP_MS);
    }
    btn.addEventListener("mouseenter", arm);
    btn.addEventListener("mouseleave", hideWatchHelp);
    btn.addEventListener("focus", arm);
    btn.addEventListener("blur", hideWatchHelp);
    btn.addEventListener("click", function () {
      hideWatchHelp();
      var form = el("watch-account-form");
      var open = form && form.hasAttribute("hidden");
      if (form) {
        if (open) {
          form.removeAttribute("hidden");
        } else {
          form.setAttribute("hidden", "");
        }
      }
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        var input = el("watch-account-address");
        if (input) {
          input.focus();
        }
      }
    });
  }

  function onAddWatchAccount() {
    var c = crypto();
    var s = store();
    if (!session.phrase) {
      showGateError("watch-account-error", "Unlock the wallet to add a watch address.");
      return;
    }
    if (!c || !s || typeof c.watchAccount !== "function") {
      showGateError("watch-account-error", "Wallet storage unavailable in this browser.");
      return;
    }
    var raw = (el("watch-account-address") || {}).value || "";
    var row;
    try {
      row = c.watchAccount(raw);
    } catch (err) {
      showGateError(
        "watch-account-error",
        err && err.message === "invalid-checksum"
          ? "That address checksum does not match."
          : "Enter a wallet address starting with 0x."
      );
      return;
    }
    s.loadVault(session.walletId)
      .then(function (vault) {
        if (!vault) {
          throw new Error("no vault");
        }
        var accounts =
          vault.accounts && vault.accounts.length
            ? vault.accounts.slice()
            : (session.accounts || []).slice();
        if (c.findAccountByAddress(accounts, row.evmAddress)) {
          showGateError("watch-account-error", "That address is already listed.");
          return;
        }
        var nWatch = 0;
        var i;
        for (i = 0; i < accounts.length; i++) {
          if (isWatchRow(accounts[i])) {
            nWatch += 1;
          }
        }
        if (typeof c.MAX_WATCH_ACCOUNTS === "number" && nWatch >= c.MAX_WATCH_ACCOUNTS) {
          showGateError("watch-account-error", "This vault already has the maximum of 20 watch addresses.");
          return;
        }
        accounts.push(row);
        vault.accounts = accounts;
        vault.selectedKind = "watch";
        vault.selectedWatch = row.evmAddress;
        return s.saveVault(vault).then(function () {
          session.accounts = accounts.slice();
          var input = el("watch-account-address");
          if (input) {
            input.value = "";
          }
          showGateError("watch-account-error", null);
          revealWatchAccount(row.evmAddress);
        });
      })
      .catch(function () {
        showGateError("watch-account-error", "Could not add a watch address.");
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
    if (!sessionCanSign() || !data || !c || typeof data.broadcastRaw !== "function") {
      if (session.watch) {
        setWalletStatus("This is a watch address. tkrWallet does not hold its key. Nothing was signed.");
        return;
      }
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
    if (!sessionCanSign() || !session.address) {
      if (session.watch) {
        setWalletStatus("This is a watch address. Connect needs a key this phrase does not hold.");
        return;
      }
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
        edgeConnected = true;
        reconnectOnUnlock = true;
        setAccount(session.address);
        paintConnectIp(sess.ipv4, sess.ipv6);
        refreshConnectIp();
        setWalletStatus("Connected as " + (sess.address || session.address) + ". Keys stayed on this device.");
        refreshPendingSigns();
        if (consolidateJob) {
          continueConsolidate();
        }
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
    [1, 8453, 4663, 900001, 728126428, 900002, 900003].forEach(function (chainId) {
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
    syncSwapDest();
  }

  function looksLikeSendAddress(value) {
    var s = String(value || "").trim();
    return (
      /^0x[a-fA-F0-9]{40}$/.test(s) ||
      /^0x[a-fA-F0-9]{64}$/.test(s) ||
      /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s) ||
      /^G[A-Z2-7]{55}$/.test(s) ||
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

  function openSendCameraTab() {
    try {
      if (
        root.chrome &&
        chrome.tabs &&
        typeof chrome.tabs.create === "function" &&
        chrome.runtime &&
        typeof chrome.runtime.getURL === "function"
      ) {
        chrome.tabs.create({ url: chrome.runtime.getURL("index.html") + "?scan=1#/send" });
        setText(el("send-note"), "Opened Send in a tab so the camera prompt can appear.");
        return true;
      }
    } catch (e) {
      /* PWA / tests */
    }
    setText(
      el("send-note"),
      "Open tkrWallet in a browser tab to scan a QR. The toolbar popup cannot ask for the camera."
    );
    return false;
  }

  function startSendCamera() {
    var search = root.location && root.location.search;
    var protocol = root.location && root.location.protocol;
    var width = root.innerWidth;
    if (cameraShellCannotPrompt(search, protocol, width)) {
      openSendCameraTab();
      return;
    }
    var video = el("send-camera");
    if (!video || !root.navigator || !root.navigator.mediaDevices || !root.navigator.mediaDevices.getUserMedia) {
      setText(el("send-note"), "Camera is unavailable in this browser.");
      return;
    }
    stopSendCamera();
    root.navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
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
      .catch(function (err) {
        setText(el("send-note"), sendCameraErrorText(err));
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
    var buttons = document.querySelectorAll("#swap-submit, [data-swap-now]");
    var i;
    for (i = 0; i < buttons.length; i++) {
      buttons[i].disabled = !live;
      if (live) {
        buttons[i].removeAttribute("aria-disabled");
      } else {
        buttons[i].setAttribute("aria-disabled", "true");
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
    var mode = parseShellMode(root.location && root.location.search, root.location && root.location.protocol);
    if (mode === "popup") {
      /* Native <dialog>.showModal() paints in the browser top layer, outside
       * the 432×600 popup. Swap Now stays on the Swap screen. */
      return;
    }
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

  function isEthBaseChain(id) {
    return id === 1 || id === 8453;
  }

  function isForeignChain(id) {
    return id === 900001 || id === 728126428 || id === 900002 || id === 900003;
  }

  function isEthBaseForeignPair(fromId, toId) {
    return (isEthBaseChain(fromId) && isForeignChain(toId)) || (isForeignChain(fromId) && isEthBaseChain(toId));
  }

  function isScratchpostSwapChain(id) {
    return id === 1 || id === 8453 || id === 4663 || id === 900001 || id === 728126428 || id === 900002 || id === 900003;
  }

  function isScratchpostSwapPair(fromId, toId) {
    return isScratchpostSwapChain(fromId) && isScratchpostSwapChain(toId);
  }

  function destAddressFor(toSel) {
    if (!toSel) {
      return "";
    }
    if (isEthBaseChain(toSel.chainId) || toSel.chainId === 4663) {
      return session.address || "";
    }
    if (toSel.chainId === 900001) {
      return session.solAddress || "";
    }
    if (toSel.chainId === 728126428) {
      return session.tronAddress || "";
    }
    return String((el("swap-dest") || {}).value || "").trim();
  }

  function syncSwapDest() {
    var wrap = el("swap-dest-wrap");
    var toSel = selectedSwapToken(el("swap-to"));
    if (!wrap) {
      return;
    }
    var need = !!(toSel && (toSel.chainId === 900002 || toSel.chainId === 900003));
    if (need) {
      wrap.removeAttribute("hidden");
    } else {
      wrap.setAttribute("hidden", "");
    }
  }

  function swapPriceProbe(sel) {
    if (!sel) {
      return null;
    }
    return {
      chain_id: sel.chainId,
      address: sel.mint && sel.mint !== "native" ? sel.mint : null,
      symbol: sel.token && sel.token.symbol,
      state: "ok",
      amount: 0,
    };
  }

  function invalidateSwapQuote() {
    pendingSwapQuote = null;
    clearQuoteTimer();
    hideSwapEstimate();
    closeQuoteDialog();
    setText(el("swap-receive-amount"), "\u2014");
    setText(el("swap-receive-fiat"), "\u2014");
    setText(el("swap-out"), "");
  }

  function paintSwapPanel() {
    var fromSel = selectedSwapToken(el("swap-from"));
    var amountEl = el("swap-amount");
    var amount = amountEl ? String(amountEl.value || "").trim() : "";
    var n = Number(amount);
    var fromHold = fromSel
      ? holdingFor(fromSel.chainId, fromSel.mint === "native" ? null : fromSel.mint)
      : null;
    var symbol = (fromHold && fromHold.symbol) || (fromSel && fromSel.token && fromSel.token.symbol) || "";
    var balText = "Balance \u2014";
    if (fromHold && fromHold.state === "ok" && fromHold.amount != null) {
      balText = "Balance " + formatHeld(fromHold.amount) + (symbol ? " " + symbol : "");
    }
    setText(el("swap-pay-balance"), balText);
    var payFiat = null;
    if (amount && isFinite(n) && n > 0 && fromSel) {
      var unit = unitPriceFor(swapPriceProbe(fromSel), uiData.lastPrices);
      if (unit != null) {
        payFiat = n * unit;
      }
    }
    setText(el("swap-pay-fiat"), formatFiat(payFiat, state.currency));
    if (quoteStillLive() && pendingSwapQuote && pendingSwapQuote.human) {
      setText(el("swap-receive-amount"), pendingSwapQuote.human);
      var recvUnit = unitPriceFor(swapPriceProbe(pendingSwapQuote.to), uiData.lastPrices);
      var recvN = Number(pendingSwapQuote.human);
      var recvFiat = recvUnit != null && isFinite(recvN) ? recvN * recvUnit : null;
      setText(el("swap-receive-fiat"), formatFiat(recvFiat, state.currency));
    } else if (!quoteStillLive()) {
      setText(el("swap-receive-amount"), "\u2014");
      setText(el("swap-receive-fiat"), "\u2014");
    }
    syncSwapDest();
  }

  function applySwapSelect(selectEl, value) {
    fillSwapPairs();
    if (!selectEl || value == null || String(value).trim() === "") {
      return false;
    }
    var want = String(value).trim();
    var opts = selectEl.options;
    var i;
    for (i = 0; i < opts.length; i++) {
      if (String(opts[i].value).toLowerCase() === want.toLowerCase()) {
        selectEl.value = opts[i].value;
        return true;
      }
    }
    var needle = want.toLowerCase();
    for (i = 0; i < opts.length; i++) {
      if (String(opts[i].textContent || "").toLowerCase().indexOf(needle) !== -1) {
        selectEl.value = opts[i].value;
        return true;
      }
    }
    return false;
  }

  function applySwapPercent(pct) {
    fillSwapPairs();
    var fromSel = selectedSwapToken(el("swap-from"));
    if (!fromSel) {
      setText(el("swap-note"), "Pick a token to pay.");
      return;
    }
    var isNative = fromSel.mint === "native";
    var hold = holdingFor(fromSel.chainId, isNative ? null : fromSel.mint);
    if (!hold || hold.state !== "ok" || hold.amount == null) {
      setText(el("swap-note"), "Balance is unknown. Type an amount.");
      return;
    }
    var part = percentOfSpendable(hold.amount, pct, fromSel.chainId, isNative);
    if (part == null) {
      setText(el("swap-note"), "Balance is unknown. Type an amount.");
      return;
    }
    if (!(part > 0)) {
      setText(
        el("swap-note"),
        isNative ? "All of this native balance is reserved for gas." : "No balance to swap."
      );
      return;
    }
    var decimals = fromSel.token && fromSel.token.decimals != null ? fromSel.token.decimals : 18;
    var amountEl = el("swap-amount");
    if (amountEl) {
      amountEl.value = formatSwapInput(part, Math.min(8, decimals));
    }
    invalidateSwapQuote();
    paintSwapPanel();
    setText(
      el("swap-note"),
      Number(pct) >= 100 ? "Max spendable filled. Quote to continue." : pct + "% of spendable filled. Quote to continue."
    );
  }

  function flipSwapPair() {
    var from = el("swap-from");
    var to = el("swap-to");
    if (!from || !to) {
      return;
    }
    var a = from.value;
    from.value = to.value;
    to.value = a;
    var amount = el("swap-amount");
    if (amount) {
      amount.value = "";
    }
    invalidateSwapQuote();
    paintSwapPanel();
    setText(el("swap-note"), "Pair flipped. Enter an amount and Quote.");
  }

  function applySwapCliAction(action) {
    if (!action || !action.type) {
      return;
    }
    fillSwapPairs();
    if (action.type === "swap-from") {
      if (!applySwapSelect(el("swap-from"), action.value)) {
        appendTerminalLine("out", "unknown you-pay token.");
        return;
      }
      invalidateSwapQuote();
      paintSwapPanel();
      return;
    }
    if (action.type === "swap-to") {
      if (!applySwapSelect(el("swap-to"), action.value)) {
        appendTerminalLine("out", "unknown you-receive token.");
        return;
      }
      invalidateSwapQuote();
      paintSwapPanel();
      return;
    }
    if (action.type === "swap-amount") {
      var amountEl = el("swap-amount");
      if (amountEl) {
        amountEl.value = String(action.amount || "");
      }
      invalidateSwapQuote();
      paintSwapPanel();
      return;
    }
    if (action.type === "swap-dest") {
      var destEl = el("swap-dest");
      if (destEl) {
        destEl.value = String(action.value || "");
      }
      invalidateSwapQuote();
      paintSwapPanel();
      return;
    }
    if (action.type === "swap-pct") {
      applySwapPercent(action.pct);
      return;
    }
    if (action.type === "swap-flip") {
      flipSwapPair();
      return;
    }
    if (action.type === "swap-quote") {
      onSwapQuote({ openDialog: false }).then(function (q) {
        if (q && q.human) {
          var sym = q.to && q.to.token && q.to.token.symbol ? q.to.token.symbol : "";
          appendTerminalLine(
            "out",
            "you receive about " + q.human + (sym ? " " + sym : "") + ". swap now to sign."
          );
        }
      });
      return;
    }
    if (action.type === "swap-now") {
      onSwapSubmit();
    }
  }

  function onSwapQuote(opts) {
    opts = opts || {};
    var openDialog = opts.openDialog !== false;
    var wallet = root.tkrWalletData;
    pendingSwapQuote = null;
    clearQuoteTimer();
    hideSwapEstimate();
    closeQuoteDialog();
    setText(el("swap-out"), "");
    setText(el("swap-receive-amount"), "\u2014");
    setText(el("swap-receive-fiat"), "\u2014");
    function failQuote(message) {
      setText(el("swap-note"), message);
      return Promise.resolve(null);
    }
    if (!wallet || typeof wallet.quoteSwap !== "function") {
      return failQuote("Swap is unavailable in this browser.");
    }
    var fromSel = selectedSwapToken(el("swap-from"));
    var toSel = selectedSwapToken(el("swap-to"));
    if (!fromSel || !toSel || (fromSel.chainId === toSel.chainId && fromSel.mint === toSel.mint)) {
      return failQuote("Pick two different assets.");
    }
    if (!isScratchpostSwapPair(fromSel.chainId, toSel.chainId)) {
      return failQuote("Scratchpost could not route that pair. Nothing was signed.");
    }
    if (fromSel.chainId === 900002 || fromSel.chainId === 900003) {
      return failQuote("This wallet cannot sign Sui or Stellar yet. Quote from Ethereum or Base.");
    }
    if (!edgeConnected) {
      return failQuote("Connect to Scratchpost first. Nothing was signed.");
    }
    if (fromSel.chainId === 900001 && !session.solAddress) {
      return failQuote("Unlock the wallet first. Nothing was signed.");
    }
    if (fromSel.chainId === 728126428 && !session.tronAddress) {
      return failQuote("Unlock the wallet first. Nothing was signed.");
    }
    var dest = destAddressFor(toSel);
    if (isForeignChain(toSel.chainId) && !dest) {
      return failQuote("Enter the destination address on that chain. Nothing was signed.");
    }
    var amount = wallet.toAtomicAmount(
      (el("swap-amount") || {}).value,
      fromSel.token && fromSel.token.decimals != null ? fromSel.token.decimals : 18
    );
    if (!amount) {
      return failQuote("Enter an amount greater than zero.");
    }
    setText(el("swap-note"), "Asking Scratchpost for a quote\u2026");
    return withBusy(function () {
      return wallet.quoteSwap({
        chain_id: fromSel.chainId,
        from_chain_id: fromSel.chainId,
        to_chain_id: toSel.chainId,
        input_mint: fromSel.mint,
        output_mint: toSel.mint,
        amount: amount,
        to_address: dest || undefined,
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
        paintSwapPanel();
        if (openDialog) {
          var mode = parseShellMode(root.location && root.location.search, root.location && root.location.protocol);
          if (mode !== "popup") {
            openQuoteDialog();
          }
        }
        return pendingSwapQuote;
      })
      .catch(function (err) {
        pendingSwapQuote = null;
        hideSwapEstimate();
        paintSwapPanel();
        var why = err && err.message ? String(err.message) : "";
        setText(
          el("swap-note"),
          why && why !== "quote-failed"
            ? "No quote (" + why + "). Scratchpost did not publish one. Nothing was signed."
            : "No quote. Scratchpost did not publish one. Nothing was signed."
        );
        setWalletStatus("Quote failed. Nothing was signed.");
        return null;
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
    if (!sessionCanSign()) {
      setText(
        el("swap-note"),
        session.watch
          ? "This is a watch address. tkrWallet does not hold its key. Nothing was signed."
          : "Unlock the wallet first. Nothing was signed."
      );
      return;
    }
    if (!wallet || typeof wallet.buildSwap !== "function") {
      setText(el("swap-note"), "Swap signing is unavailable in this browser.");
      return;
    }
    var chainId = pendingSwapQuote.chainId;
    var activeQuote = pendingSwapQuote.body.quote;
    setText(el("swap-note"), "Building unsigned swap\u2026");
    function signBuilt(built) {
      if (!built || built.ok === false) {
        throw new Error((built && built.error) || "build-failed");
      }
      var signChain = Number(built.chain_id || chainId);
      if (built.needs_approval && built.tx) {
        var approved = c.signAndBroadcastPayload(session.phrase, session.index, built.tx);
        return wallet.broadcastRaw({ raw: approved.raw, chain_id: approved.chainId }).then(function (sent) {
          if (!sent || sent.ok === false) {
            throw new Error((sent && sent.error) || "broadcast");
          }
          return wallet.buildSwap({ chain_id: signChain, quote: activeQuote });
        }).then(signBuilt);
      }
      var signed;
      if (signChain === 900001) {
        if (!built.unsigned_tx || typeof c.signSolanaVersionedTx !== "function") {
          throw new Error("build-failed");
        }
        signed = c.signSolanaVersionedTx(session.phrase, built.unsigned_tx);
      } else if (signChain === 728126428) {
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
    function buildStep(quote, stepChain) {
      activeQuote = quote;
      return wallet.buildSwap({ chain_id: stepChain, quote: quote }).then(signBuilt);
    }
    withBusy(function () {
      var q = pendingSwapQuote.body.quote || {};
      var first;
      if (q.route === "hop_then_lifi") {
        first = buildStep({ route: "hop_then_lifi", step: "hop", hop: q.hop, lifi: q.lifi }, chainId).then(function (sent) {
          if (!sent || sent.ok === false) {
            throw new Error((sent && sent.error) || "broadcast");
          }
          return buildStep({ route: "hop_then_lifi", step: "lifi", hop: q.hop, lifi: q.lifi }, chainId);
        });
      } else if (q.route === "lifi_then_hop") {
        var lifiChain = Number((q.lifi && q.lifi.from_chain) || chainId);
        var hopChain = Number((q.hop && q.hop.chain_id) || 8453);
        first = buildStep({ route: "lifi_then_hop", step: "lifi", hop: q.hop, lifi: q.lifi }, lifiChain).then(function (sent) {
          if (!sent || sent.ok === false) {
            throw new Error((sent && sent.error) || "broadcast");
          }
          return buildStep({ route: "lifi_then_hop", step: "hop", hop: q.hop, lifi: q.lifi }, hopChain);
        });
      } else {
        first = buildStep(q, chainId);
      }
      return first
        .then(function (sent) {
          if (!sent || sent.ok === false) {
            throw new Error((sent && sent.error) || "broadcast");
          }
          var fromSym =
            pendingSwapQuote && pendingSwapQuote.from && pendingSwapQuote.from.token
              ? pendingSwapQuote.from.token.symbol
              : "";
          var destChain = pendingSwapQuote && pendingSwapQuote.to ? Number(pendingSwapQuote.to.chainId) : chainId;
          var destMint =
            pendingSwapQuote && pendingSwapQuote.to && pendingSwapQuote.to.mint
              ? String(pendingSwapQuote.to.mint)
              : "native";
          noteBroadcast(sent, "swap", { chain_id: chainId, symbol: fromSym });
          pendingSwapQuote = null;
          clearQuoteTimer();
          hideSwapEstimate();
          closeQuoteDialog();
          setText(el("swap-note"), "Broadcast " + (sent.tx_hash || "") + ". Key stayed on this device.");
          setWalletStatus("Swap broadcast. Key stayed on this device.");
          paintSwapPanel();
          return refreshAfterSwap(chainId, destChain, destMint);
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
        edgeConnected = false;
        reconnectOnUnlock = false;
        paintConnectIp("", "");
        if (session.address) {
          setAccount(session.address);
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
        go("accounts");
      });
    }
    var receiveCopy = el("receive-copy");
    if (receiveCopy) {
      receiveCopy.addEventListener("click", function () {
        var chain = Number((el("receive-chain") || {}).value || 1);
        copyTextToClipboard(addressForChain(chain), {
          button: receiveCopy,
          noteEl: el("receive-note"),
          buttonLabel: "Copy address",
          okMessage: "Address copied to clipboard.",
        });
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
    var sendCopy = el("send-copy");
    if (sendCopy) {
      sendCopy.addEventListener("click", function () {
        var chain = Number((el("send-chain") || {}).value || 1);
        copyTextToClipboard(addressForChain(chain), {
          button: sendCopy,
          noteEl: el("send-note"),
          buttonLabel: "Copy address",
          okMessage: "Address copied to clipboard.",
        });
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
    var sendEmpty = el("send-empty-chain");
    if (sendEmpty) {
      sendEmpty.addEventListener("click", function () {
        var to = String((el("send-to") || {}).value || "").trim();
        var s = store();
        if (looksLikeSendAddress(to) && s && typeof s.rememberRecipient === "function") {
          s.rememberRecipient(to).catch(function () {});
        }
        onEmptyChain();
      });
    }
    var leaveGas = el("swap-leave-gas");
    if (leaveGas) {
      leaveGas.checked = readLeaveGasBuffer();
      leaveGas.addEventListener("change", function () {
        setLeaveGasBuffer(!!leaveGas.checked);
        setText(
          el("swap-note"),
          leaveGas.checked ? "Max will keep a native gas buffer." : "Max will leave only this swap's gas."
        );
      });
    }
    var sendPctBtns = document.querySelectorAll("[data-send-pct]");
    Array.prototype.forEach.call(sendPctBtns, function (btn) {
      btn.addEventListener("click", function (event) {
        applySendPercent(Number(event.currentTarget.getAttribute("data-send-pct")));
      });
    });
    var sendChain = el("send-chain");
    if (sendChain) {
      sendChain.addEventListener("change", function () {
        pendingEmpty = null;
      });
    }
    if (sendTo) {
      sendTo.addEventListener("input", function () {
        var now = String(sendTo.value || "").trim().toLowerCase();
        if (pendingEmpty && String(pendingEmpty.to || "").toLowerCase() !== now) {
          pendingEmpty = null;
        }
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
    var swapFrom = el("swap-from");
    if (swapFrom) {
      swapFrom.addEventListener("change", function () {
        invalidateSwapQuote();
        paintSwapPanel();
      });
    }
    var swapTo = el("swap-to");
    if (swapTo) {
      swapTo.addEventListener("change", function () {
        invalidateSwapQuote();
        paintSwapPanel();
      });
    }
    var swapAmount = el("swap-amount");
    if (swapAmount) {
      swapAmount.addEventListener("input", function () {
        invalidateSwapQuote();
        paintSwapPanel();
      });
    }
    var swapDest = el("swap-dest");
    if (swapDest) {
      swapDest.addEventListener("input", function () {
        invalidateSwapQuote();
      });
    }
    var pctBtns = document.querySelectorAll("[data-swap-pct]");
    var pi;
    for (pi = 0; pi < pctBtns.length; pi++) {
      pctBtns[pi].addEventListener("click", function (event) {
        applySwapPercent(Number(event.currentTarget.getAttribute("data-swap-pct")));
      });
    }
    var swapFlip = el("swap-flip");
    if (swapFlip) {
      swapFlip.addEventListener("click", function () {
        flipSwapPair();
      });
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
    var swapNowBtns = document.querySelectorAll("#swap-submit, [data-swap-now]");
    var sn;
    for (sn = 0; sn < swapNowBtns.length; sn++) {
      swapNowBtns[sn].addEventListener("click", function () {
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

    var walletNew = el("wallet-new");
    if (walletNew) {
      walletNew.addEventListener("click", function () {
        onWalletNew();
      });
    }
    var walletImport = el("wallet-import");
    if (walletImport) {
      walletImport.addEventListener("click", function () {
        onWalletImport();
      });
    }
    var accountsConsolidate = el("accounts-consolidate");
    if (accountsConsolidate) {
      accountsConsolidate.addEventListener("click", function () {
        go("consolidate");
      });
    }
    var settingsConsolidate = el("settings-consolidate");
    if (settingsConsolidate) {
      settingsConsolidate.addEventListener("click", function () {
        go("consolidate");
      });
    }
    var consolidateBack = el("consolidate-back");
    if (consolidateBack) {
      consolidateBack.addEventListener("click", function () {
        go("accounts");
      });
    }
    var consolidateImport = el("consolidate-import");
    if (consolidateImport) {
      consolidateImport.addEventListener("click", function () {
        onWalletImport();
      });
    }
    var consolidateRun = el("consolidate-run");
    if (consolidateRun) {
      consolidateRun.addEventListener("click", onConsolidateRun);
    }
    var walletRemove = el("wallet-remove");
    if (walletRemove) {
      walletRemove.addEventListener("click", function () {
        onWalletRemove();
      });
    }
    var walletRemoveForm = el("wallet-remove-form");
    if (walletRemoveForm) {
      walletRemoveForm.addEventListener("submit", function (event) {
        event.preventDefault();
        onWalletRemoveConfirm();
      });
    }
    bindWatchHelp(el("watch-account-open"));
    var watchAccountForm = el("watch-account-form");
    if (watchAccountForm) {
      watchAccountForm.addEventListener("submit", function (event) {
        event.preventDefault();
        onAddWatchAccount();
      });
    }
    var connectBtns = document.querySelectorAll("[data-connect]");
    for (var c = 0; c < connectBtns.length; c++) {
      connectBtns[c].addEventListener("click", function () {
        onConnect();
      });
    }
    var connectAtLaunch = el("connect-at-launch");
    if (connectAtLaunch) {
      connectAtLaunch.addEventListener("change", function (event) {
        setConnectAtLaunch(!!event.currentTarget.checked);
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

    var accountsBack = el("accounts-back");
    if (accountsBack) {
      accountsBack.addEventListener("click", function () {
        go("home");
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
    renderConnectAtLaunch();
    state.currency = readStoredCurrency();
    renderCurrency();
    showScreen(parseRoute(root.location && root.location.hash));
    if (wantsAutoScan(root.location && root.location.search)) {
      showScreen("send");
      startSendCamera();
    }
    maybePreview();
    if (!uiData.lastHoldings) {
      var restored = restoreViewSession();
      if (restored) {
        session.address = restored.address;
        session.solAddress = restored.solAddress || null;
        session.tronAddress = restored.tronAddress || null;
        session.walletId = restored.walletId || session.walletId;
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
      var boot = store();
      var listed = typeof boot.listVaults === "function" ? boot.listVaults() : boot.loadVault().then(function (v) { return v ? [v] : []; });
      listed
        .then(function (rows) {
          if (rows && rows.length) {
            // A wallet exists on this device: it starts locked, not absent.
            session.locked = true;
            if (!session.walletId && rows[0] && rows[0].id) {
              session.walletId = rows[0].id;
            }
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
    cameraShellCannotPrompt: cameraShellCannotPrompt,
    wantsAutoScan: wantsAutoScan,
    sendCameraErrorText: sendCameraErrorText,
    parseCurrency: parseCurrency,
    nativeGasReserve: nativeGasReserve,
    explorerAddressUrl: explorerAddressUrl,
    explorerTxUrl: explorerTxUrl,
    spendableAmount: spendableAmount,
    readLeaveGasBuffer: readLeaveGasBuffer,
    setLeaveGasBuffer: setLeaveGasBuffer,
    isMaxAmount: isMaxAmount,
    planEmptyChain: planEmptyChain,
    percentOfSpendable: percentOfSpendable,
    formatSwapInput: formatSwapInput,
    formatHeld: formatHeld,
    formatAsOf: formatAsOf,
    fetchLiveFx: fetchLiveFx,
    openSwapFor: openSwapFor,
    runCliCommand: runCliCommand,
    formatConnectIp: formatConnectIp,
    parseAutolockMinutes: parseAutolockMinutes,
    parseViewSession: parseViewSession,
    typedCreateConfirm: typedCreateConfirm,
    CREATE_CONFIRM: CREATE_CONFIRM,
    REMOVE_WALLET_CONFIRM: REMOVE_WALLET_CONFIRM,
    typedRemoveWallet: typedRemoveWallet,
    WATCH_HELP_MS: WATCH_HELP_MS,
    sessionCanSign: sessionCanSign,
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
    copyTextToClipboard: copyTextToClipboard,
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
