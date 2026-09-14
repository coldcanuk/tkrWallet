# Research — live tkrWallet: missing balances, missing 0.7.0, refresh re-prompt

Date: 2026-09-14
Branch: `gb/edge-session-honesty`
Live origin: `https://tkrwallet.scratchpost.ai` (Path B; healthz 200)
Status: reproduction complete. No production code in this commit.

## Scope captured

| Item | Statement |
| --- | --- |
| **Primary goal** | After unlock, tkrWallet shows real Mainnet and Base holdings from the wallet edge (`tkrwallet.scratchpost.ai`), and a reload within the auto-lock window does not re-prompt for the password. The wallet talks only to the edge. |
| **Non-goals** | Repair `blockchain-base-reth`. JSON-RPC passthrough. `eth_sendRawTransaction`. Solana/Robinhood reads. Vendor public RPC from the wallet or as a production default. Edge auth nonce/session cookies (§3.1). |
| **Success** | (1) Live PWA is the GitHub `main` tree (0.7.0 honesty + token detail + add-token), not the Sep 13 snapshot. (2) `GET /api/wallet/balances` reports a `chains[]` read status; 502 when nothing was readable; never 200+empty for a failed Base read. (3) `GET /api/wallet/token` works. (4) Unlock of a known-funded address lists Mainnet rows; Base-down is disclosed, not rendered as “you own nothing”. (5) Reload within auto-lock does not open the unlock gate. (6) Wallet source still greps clean for a single origin. |
| **Constraints** | `connect-src 'self'`. No lab IPs / hostnames / publicnode in wallet source. Production RPC URLs stay env-only on the origin. Auto-lock remains a floor (cannot be off, max 1 hour). Keys never leave the device; viewing-session storage must not hold the mnemonic or private key. |
| **Assumptions** | Operator can rsync the PWA to caesar `WALLET_ROOT` (`/opt/repo/tkrwallet-pwa`) and restart `tkrwallet-edge-origin-1`. Base node may stay down; honesty must still hold. |
| **Top risks** | (R1) Shipping 0.7.0 client against the old origin (no `chains[]`) → every empty read is `partial` / “Balances incomplete”. Mitigate: ship origin + PWA together. (R2) Base RPC stays down → Base rows remain absent; UI must say so. (R3) Viewing session in `sessionStorage` is XSS-readable — only the public address is stored. (R4) Caesar `blockchain-infrastructure` git is behind ATHENA; rsync `wallet-edge/` only. (R5) Stale service worker — bump cache name on ship. |

## Finding 1 — live PWA is a stale Sep 13 snapshot, not GitHub 0.7.0

Evidence (ATHENA, 2026-09-14):

| File | Live SHA-256 | `/opt/repo/tkrWallet` (pre-restore) | GitHub `main` `eb4ed2c` |
| --- | --- | --- | --- |
| `wallet.js` | `c105f83f…` | identical | different (honesty `chains[]`, `getTokenMeta`, extra tokens) |
| `ui.js` | `f7f25799…` | identical | different (token detail, retry, coverage) |
| `index.html` | `7bcf4370…` | identical | different |

GitHub `main` (merged today as `gb/balance-honesty-token-detail`) is **v0.7.0**: per-chain read status, 502 on total failure, token detail, add-token-by-address, catalogue OP row removed, 83 tests.

The live origin bind-mounts caesar `/opt/repo/tkrwallet-pwa`, which is that Sep 13 snapshot (no `package.json`, no `docs/`, no token detail). ATHENA `/opt/repo/tkrWallet` was the same snapshot **without a `.git`**. GitHub `coldcanuk/tkrWallet` is the source of truth.

This is why “I don’t see any of the recent improvements” is literally true on `tkrwallet.scratchpost.ai`.

Caesar also has an *older* git checkout at `/opt/repo/tkrWallet` (Sep 1, `app.js` era). It is not `WALLET_ROOT`.

## Finding 2 — production balances lie when Base cannot be read

Live probes (same hour):

```
GET /api/wallet/balances?address=0xd8dA…6045&chains=1,8453
→ 200 { "balances": [ …14 Ethereum rows… ], "as_of": … }
   # no chains[], no Base rows

GET /api/wallet/balances?address=0xd8dA…6045&chains=8453
→ 200 { "balances": [], "as_of": … }   in ~200ms
```

`wallet-edge/src/balances.ts` swallows RPC errors per asset and returns HTTP 200 with whatever succeeded. A dead Base endpoint is indistinguishable from “this address holds nothing on Base”.

Client on GitHub `main` already treats a missing `chains[]` as `{ state: "partial", reason: "edge-no-read-status" }` and refuses to call that “No balances yet”. The **live** client (0.6 snapshot) treats `{balances:[]}` as `ok` and shows:

- title: “No balances yet”
- body: “Balances for this account arrive with the wallet edge”
- value note after empty `refreshPrices`: **“Prices unavailable until the wallet edge ships.”**

That copy is what an unlocked user with Base-only (or catalogue-miss) funds sees. It reads as “the edge is not built”.

Vitalik injection against the live client **does** render 14 Mainnet rows and a fiat total (`$27,480.33`). The render pipeline works. Empty/failed reads are the lie.

## Finding 3 — refresh re-prompts because the viewing session is RAM-only

Playwright against live, after importing `test test … junk` (derives `0xf39F…2266`, BIP-44 match with Hardhat/MetaMask/Uniswap):

```
IMPORTED  address=0xf39F…2266  gateHidden=true
RELOADED  address=null  gateHidden=false  gateTitle="Unlock wallet"  locked=true
```

`ui.js#bind` always `openGate("unlock")` when IndexedDB has a vault. `session.address` is not written anywhere that survives `location.reload`. Auto-lock (1–60 min, default 5) only runs while the JS heap lives.

This is independent of balances. It is still present on GitHub `main` (`bind` at the vault-load path; no `sessionStorage`).

Derivation itself is not the bug: `test test … junk` → `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (canonical). Password unlock of a vault that was imported from the same phrase as Phantom/Uniswap yields the same EVM account.

## Finding 4 — the wallet already specifies the edge contract; production origin does not implement it

`docs/specs/edge-server.md` §3.3 / § token companion (and `tools/dev-edge.js`, covered by 83 tests):

- `chains[]` with `ok` / `partial` / `unknown` (+ optional `error`)
- empty `balances` means “you hold none of the requested tokens” **only if every chain is `ok`**
- **502** `{ok:false,error,detail}` when no requested chain could be read
- optional `tokens=chain:address,…` extra reads
- `GET /api/wallet/token?chain=&address=` for add-token

Production `wallet-edge` (Path B, prove passing against the *old* silent-omit contract):

- GET `/api/wallet/balances`, `/api/wallet/prices`, `/healthz` only
- no `chains[]`
- no `/api/wallet/token`
- extra `tokens=` ignored
- RPC env `WALLET_ETH_RPC` / `WALLET_BASE_RPC` only (no publicnode in src) — keep that

The wallet must keep zero infrastructure knowledge. The origin must grow to the spec the client already speaks.

## Finding 5 — Path B itself is up; ETH reads work; Base rank-1 does not

- `https://tkrwallet.scratchpost.ai/healthz` → `ok` (CSP, HSTS, `CDN-Cache-Control: no-store`)
- `https://wallet.scratchpost.ai/healthz` → `ok` (alias)
- ETH catalogue reads for Vitalik and `0xdead` succeed in <200ms (local Reth via the origin)
- Base-only always `[]` in ~200ms (fail-fast omit)
- POST `/` → nginx 403 (damRouter GET/HEAD only; correct)
- Origin on caesar: `tkrwallet-edge-origin-1`, `WALLET_ETH_RPC=http://192.168.1.79:18545`, `WALLET_BASE_RPC=…:19545`, `WALLET_ROOT=/wallet` ← `/opt/repo/tkrwallet-pwa`

Bringing Base Reth up is out of this change. The origin must *report* that Base was not read.

## Finding 6 — catalogue-only visibility is real, and 0.7.0 already has the escape hatch

The origin only `eth_call`s tokens listed in `wallet.js` `TOKENS` plus (once implemented) `tokens=`. Phantom/Uniswap index the chain. A user whose Mainnet bag is outside the 0.7.0 catalogue will still look empty on Ethereum even with a healthy read — **unless** they use Add token by address, which needs `/api/wallet/token` on the production origin.

## Updated plan (remaining)

See [`../plans/live-edge-session.md`](../plans/live-edge-session.md).
