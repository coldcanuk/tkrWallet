/* tkrWallet dev edge — a local stand-in for the wallet edge.
 *
 * Serves the app AND /api/* from ONE origin so the single-origin CSP
 * (connect-src 'self') is satisfied, exactly as in production. Balances are
 * read SERVER-SIDE from public chain RPCs — the wallet itself never talks to
 * them. Dev tooling only: production serves the same contract from
 * https://tkrwallet.scratchpost.ai.
 *
 * Run: npm run dev   (or node tools/dev-edge.js; PORT=8899 by default)
 *
 * NOTE: the vault is stored per ORIGIN. Changing PORT changes the origin, so the
 * browser has a different IndexedDB and the wallet looks forgotten. See README.
 *
 * Endpoints (contract: docs/specs/edge-server.md):
 *   GET /api/wallet/balances?address=0x…&chains=1,8453[&tokens=1:0x…]
 *   GET /api/wallet/prices?assets=1:native,1:0xA0b8…&vs=usd,cad
 *   GET /api/wallet/token?chain=8453&address=0x…
 *
 * HONESTY RULE (the reason this file has a `chains` field):
 * "we could not check" must never be reported as "you own nothing". Every
 * response says which chains were actually read; if none could be read the
 * response is 502, never a 200 with an empty list.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const wallet = require("../wallet.js");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8899);

/* Public chain RPCs (server-side only — the wallet never sees these). */
const RPC = {
  1: "https://ethereum-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
};

/* CoinGecko ids for the built-in catalogue (dev-only price source). */
const CG_IDS = {
  ETH: "ethereum",
  WETH: "weth",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
  WBTC: "wrapped-bitcoin",
  LINK: "chainlink",
  UNI: "uniswap",
  AAVE: "aave",
  SHIB: "shiba-inu",
  PEPE: "pepe",
  ARB: "arbitrum",
  MATIC: "matic-network",
  CRV: "curve-dao-token",
  MKR: "maker",
  LDO: "lido-dao",
  GRT: "the-graph",
  SNX: "havven",
  COMP: "compound-governance-token",
  ENS: "ethereum-name-service",
  APE: "apecoin",
  INJ: "injective-protocol",
  RNDR: "render-token",
  cbBTC: "coinbase-wrapped-btc",
  AERO: "aerodrome-finance",
  BRETT: "based-brett",
  DEGEN: "degen-base",
  WELL: "moonwell",
  VIRTUAL: "virtual-protocol",
  USDbC: "bridged-usd-coin-base",
  cbETH: "coinbase-wrapped-staked-eth",
  wstETH: "wrapped-steth",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_CHAINS = 8; // docs/specs/edge-server.md §3.3
const MAX_ASSETS = 64; // §3.2
const BALANCE_SELECTOR = "0x70a08231"; // balanceOf(address)
const DECIMALS_SELECTOR = "0x313ce567"; // decimals()
const SYMBOL_SELECTOR = "0x95d89b41"; // symbol()
const NAME_SELECTOR = "0x06fdde03"; // name()

function message(e) {
  return (e && e.message) || String(e);
}

/* Error envelope — docs/specs/edge-server.md §3. Never bare {error}. */
function err(error, detail) {
  return { ok: false, error: error, detail: detail };
}

function json(code, body) {
  return { code, type: "application/json; charset=utf-8", body: JSON.stringify(body) };
}

function httpError(code, error, detail) {
  return json(code, err(error, detail));
}

function rpcOnce(chainId, method, params, fetchFn) {
  const url = RPC[chainId];
  if (!url) {
    return Promise.reject(new Error("unsupported chain " + chainId));
  }
  const doFetch = fetchFn || fetch;
  return doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
    .then((r) => r.json())
    .then((b) => {
      if (b.error) {
        throw new Error(b.error.message || "rpc error");
      }
      return b.result;
    });
}

/* Public RPCs fail transiently (rate limits, cold nodes) often enough that a
 * single retry turns a spurious "partial" into a clean read. A genuine failure
 * still surfaces — the retry never invents a result. */
async function rpc(chainId, method, params, fetchFn, attempts) {
  const tries = attempts || 2;
  let lastError = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await rpcOnce(chainId, method, params, fetchFn);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/* "0xde0b6b3a7640000", 18 -> "1" (exact decimal string, trailing zeros off). */
function hexToDecimalString(hex, decimals) {
  const v = BigInt(hex);
  const scale = 10n ** BigInt(decimals);
  const whole = v / scale;
  const frac = (v % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? whole.toString() + "." + frac : whole.toString();
}

function padAddress(address) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function shortAddress(address) {
  return address.slice(0, 6) + "\u2026" + address.slice(-4);
}

function hexToUtf8(hex) {
  const bytes = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return Buffer.from(bytes).toString("utf8");
}

/* Tolerant ABI string decode: covers the dynamic `string` return used by most
 * ERC-20s and the legacy right-padded `bytes32` used by older ones (MKR, etc.). */
function abiString(hex) {
  if (typeof hex !== "string" || hex.indexOf("0x") !== 0) {
    return null;
  }
  const body = hex.slice(2);
  if (!body) {
    return null;
  }
  let out = null;
  if (body.length >= 128) {
    try {
      const len = Number(BigInt("0x" + body.slice(64, 128)));
      if (len > 0 && len <= 128 && body.length >= 128 + len * 2) {
        out = hexToUtf8(body.slice(128, 128 + len * 2));
      }
    } catch (e) {
      out = null;
    }
  }
  if (out === null) {
    out = hexToUtf8(body.slice(0, 64));
  }
  out = out.replace(/\u0000/g, "").trim();
  return out || null;
}

/* decimals() for a token the catalogue does not know. Cached per process. */
const decimalsCache = new Map();

async function readDecimals(chainId, address, fetchFn) {
  const key = chainId + ":" + address.toLowerCase();
  if (decimalsCache.has(key)) {
    return decimalsCache.get(key);
  }
  const raw = await rpc(chainId, "eth_call", [{ to: address, data: DECIMALS_SELECTOR }, "latest"], fetchFn);
  const dec = Number(BigInt(raw));
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) {
    throw new Error("implausible decimals");
  }
  decimalsCache.set(key, dec);
  return dec;
}

/* "1:0xabc,8453:0xdef" -> { 1: ["0xabc"], 8453: ["0xdef"] }, ignoring anything
 * malformed or on a chain that was not requested. Never fatal. */
function parseExtraTokens(raw, chains) {
  const out = Object.create(null);
  if (!raw) {
    return out;
  }
  const allowed = Object.create(null);
  chains.forEach(function (c) {
    allowed[c] = true;
  });
  raw.split(",").forEach(function (part) {
    const bits = part.split(":");
    if (bits.length < 2) {
      return;
    }
    const chainId = Number(bits[0]);
    const address = bits[1];
    if (!allowed[chainId] || !ADDRESS_RE.test(address)) {
      return;
    }
    if (!out[chainId]) {
      out[chainId] = [];
    }
    out[chainId].push(address);
  });
  return out;
}

/* Read one chain. Reports state per chain:
 *   ok      — every attempted read succeeded
 *   partial — some succeeded, some failed (holdings shown may be incomplete)
 *   unknown — nothing on this chain could be read
 * The `error` is the first real failure message, never invented. */
async function readChain(chainId, address, extraAddresses, fetchFn) {
  const rows = [];
  const chain = wallet.CHAINS[chainId];
  if (!RPC[chainId]) {
    return {
      status: { chain_id: chainId, state: "unknown", error: "unsupported chain in this build" },
      rows: rows,
    };
  }

  let nativeError = null;
  try {
    const wei = await rpc(chainId, "eth_getBalance", [address, "latest"], fetchFn);
    if (wei && BigInt(wei) !== 0n) {
      rows.push({
        chain_id: chainId,
        symbol: chain ? chain.native : "ETH",
        address: null,
        amount: hexToDecimalString(wei, 18),
        decimals: 18,
      });
    }
  } catch (e) {
    nativeError = message(e);
  }

  const tokens = [];
  const seen = Object.create(null);
  (wallet.TOKENS[chainId] || []).forEach(function (t) {
    if (!t.address) {
      return;
    }
    seen[t.address.toLowerCase()] = true;
    tokens.push({ symbol: t.symbol, address: t.address, decimals: t.decimals });
  });
  (extraAddresses || []).forEach(function (a) {
    if (!seen[a.toLowerCase()]) {
      seen[a.toLowerCase()] = true;
      tokens.push({ symbol: null, address: a, decimals: null });
    }
  });

  let tokenFailures = 0;
  let tokenError = null;
  const failedTokens = [];
  for (const tok of tokens) {
    try {
      let decimals = tok.decimals;
      if (decimals === null || decimals === undefined) {
        decimals = await readDecimals(chainId, tok.address, fetchFn);
      }
      const raw = await rpc(
        chainId,
        "eth_call",
        [{ to: tok.address, data: BALANCE_SELECTOR + padAddress(address) }, "latest"],
        fetchFn
      );
      if (raw && BigInt(raw) !== 0n) {
        rows.push({
          chain_id: chainId,
          symbol: tok.symbol || shortAddress(tok.address),
          address: tok.address,
          amount: hexToDecimalString(raw, decimals),
          decimals: decimals,
        });
      }
    } catch (e) {
      tokenFailures++;
      failedTokens.push(tok.symbol || shortAddress(tok.address));
      tokenError = tokenError || message(e);
    }
  }

  const attempts = 1 + tokens.length;
  const failures = (nativeError !== null ? 1 : 0) + tokenFailures;
  const successes = attempts - failures;
  let state = "ok";
  if (failures > 0 && successes === 0) {
    state = "unknown";
  } else if (failures > 0) {
    state = "partial";
  }
  const status = { chain_id: chainId, state: state };
  const firstError = nativeError || tokenError;
  if (firstError) {
    status.error = firstError;
  }
  if (state === "partial" && tokenFailures) {
    const shown = failedTokens.slice(0, 3).join(", ");
    status.error =
      tokenFailures +
      " token read" +
      (tokenFailures === 1 ? "" : "s") +
      " failed" +
      (shown ? " (" + shown + (failedTokens.length > 3 ? ", \u2026" : "") + ")" : "");
  }
  return { status: status, rows: rows };
}

async function balancesHandler(url, fetchFn) {
  const address = (url.searchParams.get("address") || "").trim();
  if (!ADDRESS_RE.test(address)) {
    return httpError(400, "bad-address", "address must be 0x followed by 40 hex characters");
  }

  const rawChains = (url.searchParams.get("chains") || "1,8453")
    .split(",")
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
  if (rawChains.length > MAX_CHAINS) {
    return httpError(400, "too-many-chains", "at most " + MAX_CHAINS + " chains per request");
  }
  const chains = [];
  rawChains.forEach(function (c) {
    const n = Number(c);
    if (Number.isFinite(n) && chains.indexOf(n) === -1) {
      chains.push(n);
    }
  });
  if (!chains.length) {
    return httpError(400, "bad-chains", "chains must be a comma list of numeric chain ids");
  }

  const extra = parseExtraTokens(url.searchParams.get("tokens"), chains);

  const statuses = [];
  const rows = [];
  for (const chainId of chains) {
    const result = await readChain(chainId, address, extra[chainId] || [], fetchFn);
    statuses.push(result.status);
    rows.push.apply(rows, result.rows);
  }

  // Nothing readable at all: this is a failure, not a wallet with no assets.
  const readable = statuses.filter(function (s) {
    return s.state !== "unknown";
  }).length;
  if (!readable) {
    return httpError(502, "chain-read-failed", "no requested chain could be read");
  }

  return json(200, { balances: rows, chains: statuses, as_of: Math.floor(Date.now() / 1000) });
}

/* token -> CoinGecko id by symbol, resolved from the built-in catalogue. */
function cgIdFor(chainId, address) {
  const list = wallet.TOKENS[chainId] || [];
  const tok =
    address === "native"
      ? list.find(function (t) {
          return !t.address;
        }) || { symbol: wallet.CHAINS[chainId] ? wallet.CHAINS[chainId].native : "ETH" }
      : list.find(function (t) {
          return (t.address || "").toLowerCase() === address.toLowerCase();
        }) || null;
  if (!tok || !CG_IDS[tok.symbol]) {
    return null;
  }
  return CG_IDS[tok.symbol];
}

let priceCache = { at: 0, data: {} };

async function pricesHandler(url, fetchFn) {
  const rawAssets = (url.searchParams.get("assets") || "").split(",").filter(Boolean);
  if (rawAssets.length > MAX_ASSETS) {
    return httpError(400, "too-many-assets", "at most " + MAX_ASSETS + " assets per request");
  }
  const assets = rawAssets.slice();
  const vs = (url.searchParams.get("vs") || "usd")
    .split(",")
    .filter(function (c) {
      return c === "usd" || c === "cad";
    });
  if (!assets.length || !vs.length) {
    return httpError(400, "bad-request", "assets and vs are required");
  }

  const wanted = assets
    .map(function (a) {
      const bits = a.split(":");
      const chainId = Number(bits[0]);
      const addr = bits[1] || "native";
      return { asset: a, chainId: chainId, address: addr, id: cgIdFor(chainId, addr) };
    })
    .filter(function (w) {
      return w.id;
    });
  const ids = Array.from(
    new Set(
      wanted.map(function (w) {
        return w.id;
      })
    )
  );
  if (!ids.length) {
    return json(200, { prices: {}, vs: vs, as_of: Math.floor(Date.now() / 1000) });
  }

  let data = {};
  if (Date.now() - priceCache.at < 60000) {
    data = priceCache.data;
  } else {
    const doFetch = fetchFn || fetch;
    let cg;
    try {
      const r = await doFetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=" +
          encodeURIComponent(ids.join(",")) +
          "&vs_currencies=" +
          vs.join(",")
      );
      if (!r.ok) {
        throw new Error("coingecko " + r.status);
      }
      cg = await r.json();
    } catch (e) {
      // Prices failing is an unknown, never a zero — say so loudly.
      return httpError(502, "price-source-failed", message(e));
    }
    priceCache = { at: Date.now(), data: cg };
    data = cg;
  }

  const prices = {};
  for (const w of wanted) {
    const entry = data[w.id];
    if (entry) {
      const out = {};
      for (const c of vs) {
        if (typeof entry[c] === "number") {
          out[c] = entry[c];
        }
      }
      if (Object.keys(out).length) {
        prices[w.asset] = out;
      }
    }
  }
  return json(200, { prices: prices, vs: vs, as_of: Math.floor(priceCache.at / 1000) });
}

/* Metadata for an arbitrary address, so the client can label a token it was
 * told about instead of shipping a hardcoded table (§3.5). */
async function tokenHandler(url, fetchFn) {
  const chainId = Number(url.searchParams.get("chain"));
  const address = (url.searchParams.get("address") || "").trim();
  if (!RPC[chainId]) {
    return httpError(400, "unsupported-chain", "chain is not supported in this build");
  }
  if (!ADDRESS_RE.test(address)) {
    return httpError(400, "bad-address", "address must be 0x followed by 40 hex characters");
  }

  let decimals;
  try {
    decimals = await readDecimals(chainId, address, fetchFn);
  } catch (e) {
    return httpError(404, "not-a-token", "no decimals() at this address");
  }
  if (decimals === undefined) {
    return httpError(404, "not-a-token", "no decimals() at this address");
  }

  let symbol = null;
  try {
    symbol = abiString(await rpc(chainId, "eth_call", [{ to: address, data: SYMBOL_SELECTOR }, "latest"], fetchFn));
  } catch (e) {
    symbol = null;
  }
  if (!symbol) {
    return httpError(404, "not-a-token", "no symbol() at this address");
  }
  let name = null;
  try {
    name = abiString(await rpc(chainId, "eth_call", [{ to: address, data: NAME_SELECTOR }, "latest"], fetchFn));
  } catch (e) {
    name = null;
  }

  return json(200, {
    token: { chain_id: chainId, address: address, symbol: symbol, name: name || symbol, decimals: decimals },
  });
}

function staticFile(url) {
  let p = decodeURIComponent(url.pathname);
  if (p === "/") {
    p = "/index.html";
  }
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    return { code: 403, type: "text/plain", body: "forbidden" };
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return { code: 404, type: "text/plain", body: "not found" };
  }
  return {
    code: 200,
    type: MIME[path.extname(file)] || "application/octet-stream",
    body: fs.readFileSync(file),
  };
}

function route(url, fetchFn) {
  if (url.pathname === "/api/wallet/balances") {
    return balancesHandler(url, fetchFn);
  }
  if (url.pathname === "/api/wallet/prices") {
    return pricesHandler(url, fetchFn);
  }
  if (url.pathname === "/api/wallet/token") {
    return tokenHandler(url, fetchFn);
  }
  return staticFile(url);
}

function cacheControl(pathname) {
  if (pathname === "/api/wallet/prices") {
    return "public, max-age=15"; // §3.2
  }
  if (pathname.indexOf("/api/") === 0) {
    return "no-store";
  }
  return "no-cache";
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, "http://127.0.0.1:" + PORT);
  const send = function (r) {
    res.writeHead(r.code, { "content-type": r.type, "cache-control": cacheControl(url.pathname) });
    res.end(r.body);
  };
  Promise.resolve()
    .then(function () {
      return route(url);
    })
    .then(send)
    .catch(function (e) {
      send(httpError(502, "upstream-failed", message(e)));
    });
});

if (require.main === module) {
  server.listen(PORT, "127.0.0.1", function () {
    console.log("tkrWallet dev edge on http://127.0.0.1:" + PORT);
    console.log("  app + /api/* on one origin (CSP connect-src 'self' satisfied)");
    console.log("  balances: public chain RPCs (server-side); prices: CoinGecko (dev-only)");
    console.log("  NOTE: the vault lives in IndexedDB, which is per ORIGIN. A different PORT");
    console.log("        is a different origin, so it will look like your wallet was forgotten.");
    console.log("        Use http://127.0.0.1:" + PORT + " consistently.");
  });
}

module.exports = {
  balancesHandler: balancesHandler,
  pricesHandler: pricesHandler,
  tokenHandler: tokenHandler,
  route: route,
  server: server,
  config: { RPC: RPC, PORT: PORT, MAX_CHAINS: MAX_CHAINS, MAX_ASSETS: MAX_ASSETS },
};
