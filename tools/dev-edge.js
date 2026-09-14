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
 * Endpoints (contract: docs/specs/edge-server.md):
 *   GET /api/wallet/balances?address=0x…&chains=1,8453
 *   GET /api/wallet/prices?assets=1:native,1:0xA0b8…&vs=usd,cad
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
  OP: "optimism",
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

function rpc(chainId, method, params) {
  const url = RPC[chainId];
  if (!url) {
    return Promise.reject(new Error("unsupported chain " + chainId));
  }
  return fetch(url, {
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

const BALANCE_SELECTOR = "0x70a08231";

async function balancesHandler(url) {
  const address = (url.searchParams.get("address") || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return json(400, { error: "bad address" });
  }
  const chains = (url.searchParams.get("chains") || "1,8453")
    .split(",")
    .map(Number)
    .filter((c) => RPC[c])
    .slice(0, 8);
  const rows = [];
  for (const chainId of chains) {
    const native = wallet.CHAINS[chainId] ? wallet.CHAINS[chainId].native : "ETH";
    try {
      const wei = await rpc(chainId, "eth_getBalance", [address, "latest"]);
      if (wei && BigInt(wei) !== 0n) {
        rows.push({ chain_id: chainId, symbol: native, address: null, amount: hexToDecimalString(wei, 18), decimals: 18 });
      }
    } catch (e) {
      /* chain read failed -> omitted, not zero */
    }
    for (const tok of wallet.TOKENS[chainId] || []) {
      if (!tok.address) {
        continue;
      }
      try {
        const raw = await rpc(chainId, "eth_call", [{ to: tok.address, data: BALANCE_SELECTOR + padAddress(address) }, "latest"]);
        if (raw && BigInt(raw) !== 0n) {
          rows.push({ chain_id: chainId, symbol: tok.symbol, address: tok.address, amount: hexToDecimalString(raw, tok.decimals || 18), decimals: tok.decimals || 18 });
        }
      } catch (e) {
        /* token read failed -> omitted, not zero */
      }
    }
  }
  return json(200, { balances: rows, as_of: Math.floor(Date.now() / 1000) });
}

/* token -> CoinGecko id by symbol, resolved from the built-in catalogue. */
function cgIdFor(chainId, address) {
  const list = wallet.TOKENS[chainId] || [];
  const tok = address === "native"
    ? list.find((t) => !t.address) || { symbol: wallet.CHAINS[chainId] ? wallet.CHAINS[chainId].native : "ETH" }
    : list.find((t) => (t.address || "").toLowerCase() === address.toLowerCase()) || null;
  if (!tok || !CG_IDS[tok.symbol]) {
    return null;
  }
  return CG_IDS[tok.symbol];
}

let priceCache = { at: 0, data: {} };

async function pricesHandler(url) {
  const assets = (url.searchParams.get("assets") || "").split(",").filter(Boolean).slice(0, 64);
  const vs = (url.searchParams.get("vs") || "usd").split(",").filter((c) => c === "usd" || c === "cad");
  if (!assets.length || !vs.length) {
    return json(400, { error: "bad request" });
  }
  const wanted = assets
    .map((a) => {
      const [chainKey, addr] = a.split(":");
      const chainId = Number(chainKey);
      return { asset: a, chainId, address: addr || "native", id: cgIdFor(chainId, addr || "native") };
    })
    .filter((w) => w.id);
  const ids = Array.from(new Set(wanted.map((w) => w.id)));
  if (!ids.length) {
    return json(200, { prices: {}, as_of: Math.floor(Date.now() / 1000) });
  }
  let data = {};
  if (Date.now() - priceCache.at < 60000) {
    data = priceCache.data;
  } else {
    const cg = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=" + encodeURIComponent(ids.join(",")) + "&vs_currencies=" + vs.join(",")
    ).then((r) => (r.ok ? r.json() : Promise.reject(new Error("coingecko " + r.status))));
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
      prices[w.asset] = out;
    }
  }
  return json(200, { prices, as_of: Math.floor(priceCache.at / 1000) });
}

function json(code, body) {
  return {
    code,
    type: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  };
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:" + PORT);
  const send = (r) => {
    res.writeHead(r.code, { "content-type": r.type, "cache-control": url.pathname.indexOf("/api/") === 0 ? "no-store" : "no-cache" });
    res.end(r.body);
  };
  const fail = (e) => send(json(502, { error: "upstream failed: " + (e && e.message) }));
  Promise.resolve()
    .then(() => {
      if (url.pathname === "/api/wallet/balances") {
        return balancesHandler(url);
      }
      if (url.pathname === "/api/wallet/prices") {
        return pricesHandler(url);
      }
      return staticFile(url);
    })
    .then(send)
    .catch(fail);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("tkrWallet dev edge on http://127.0.0.1:" + PORT);
  console.log("  app + /api/* on one origin (CSP connect-src 'self' satisfied)");
  console.log("  balances: public chain RPCs (server-side); prices: CoinGecko (dev-only)");
});
