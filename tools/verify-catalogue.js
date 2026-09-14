#!/usr/bin/env node
/* Verify the built-in token catalogue against real chain state.
 *
 *   npm run verify:catalogue
 *
 * For every catalogued address this checks, on the chain it is catalogued for:
 *   1. the address actually has bytecode (eth_getCode != "0x"),
 *   2. symbol() returns a string matching the catalogue symbol,
 *   3. decimals() returns the catalogued decimals.
 *
 * This exists because the catalogue is trusted blindly by balances, prices and
 * search: a wrong address is invisible at runtime (the read just fails, or
 * worse, reports a plausible wrong number) and was exactly the bug found in
 * `OP`, which was catalogued on Ethereum mainnet but only exists as a
 * GovernanceToken predeploy on OP Mainnet (chain 10).
 *
 * Needs network access, so it is NOT part of `npm run check`.
 */
"use strict";

const wallet = require("../wallet.js");

const RPC = {
  1: "https://ethereum-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
};

function hexToUtf8(hex) {
  const bytes = (hex.replace(/^0x/, "").match(/../g) || []).map(function (h) {
    return parseInt(h, 16);
  });
  return Buffer.from(bytes).toString("utf8");
}

/* Tolerant ERC-20 string decode: dynamic string, else legacy bytes32. */
function abiString(hex) {
  if (!hex || hex === "0x") {
    return null;
  }
  const body = hex.slice(2);
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
  return out.replace(/\u0000/g, "").trim() || null;
}

async function call(url, method, params) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
      });
      const body = await res.json();
      if (body.error) {
        throw new Error(body.error.message || "rpc error");
      }
      return body.result;
    } catch (e) {
      lastError = e;
      await new Promise(function (s) {
        setTimeout(s, 300);
      });
    }
  }
  throw lastError;
}

async function main() {
  let checked = 0;
  let bad = 0;

  for (const chainId of Object.keys(RPC)) {
    const id = Number(chainId);
    const url = RPC[id];
    const tokens = wallet.TOKENS[id] || [];
    for (const tok of tokens) {
      if (!tok.address) {
        continue; // native gas token: always valid
      }
      checked++;
      const problems = [];
      let code = null;
      try {
        code = await call(url, "eth_getCode", [tok.address, "latest"]);
      } catch (e) {
        problems.push("could not reach the chain: " + e.message);
      }
      if (code !== null && (!code || code === "0x")) {
        problems.push("no contract bytecode at this address on chain " + id);
      } else if (code !== null) {
        try {
          const sym = abiString(await call(url, "eth_call", [{ to: tok.address, data: "0x95d89b41" }, "latest"]));
          if (!sym) {
            problems.push("symbol() returned nothing");
          } else if (sym.toUpperCase() !== tok.symbol.toUpperCase()) {
            problems.push("symbol mismatch: on-chain '" + sym + "', catalogue '" + tok.symbol + "'");
          }
        } catch (e) {
          problems.push("symbol() call failed: " + e.message);
        }
        try {
          const dec = Number(BigInt(await call(url, "eth_call", [{ to: tok.address, data: "0x313ce567" }, "latest"])));
          if (dec !== tok.decimals) {
            problems.push("decimals mismatch: on-chain " + dec + ", catalogue " + tok.decimals);
          }
        } catch (e) {
          problems.push("decimals() call failed: " + e.message);
        }
      }
      if (problems.length) {
        bad++;
        console.error("FAIL chain " + id + " " + tok.symbol + " " + tok.address);
        problems.forEach(function (p) {
          console.error("       " + p);
        });
      }
    }
  }

  console.log(
    "\ncatalogue: " + checked + " token address" + (checked === 1 ? "" : "es") + " checked, " + bad + " failed"
  );
  if (bad) {
    console.error("Fix the catalogue in wallet.js before shipping.");
    process.exit(1);
  }
  console.log("Every catalogued address has bytecode and matching symbol/decimals.");
}

main().catch(function (e) {
  console.error("verify-catalogue failed: " + ((e && e.message) || e));
  process.exit(1);
});
