# PLAN — live edge honesty + viewing session

Research gate: [`../research/live-edge-session.md`](../research/live-edge-session.md).
tkrWallet worktree: `/opt/repo/gb-edge-session-honesty-wt` · `gb/edge-session-honesty`
Infra worktree: `/opt/repo/blockchain-infrastructure/.worktrees/wallet-edge-honesty` · `gb/wallet-edge-honesty`

Git identity: feature branches only. Open PRs. Do not push `main`. Operator ship of PWA + origin is in-band for this task because live is serving a stale tree.

## Phase 0 — Isolation (done)

- Restored `/opt/repo/tkrWallet` as a git clone of `origin/main` (`eb4ed2c`).
- Worktree `../gb-edge-session-honesty-wt` on `gb/edge-session-honesty`.
- Infra worktree `.worktrees/wallet-edge-honesty` on `gb/wallet-edge-honesty`.
- Baseline: `node app_test.js` → 83 tests, 0 failures. `WALLET_ROOT=<worktree> npm test` in `wallet-edge/` → prove OK.

## Phase 1 — Research (this directory)

- Milestone 1.1: live reproduction (Playwright + curl) in the research note.
- Milestone 1.2: this plan. Commit: `Milestone 1.2: live-edge research + plan`.

## Phase 2 — Architecture

Keep the split: **wallet = edge client**. Production origin implements the contract `tools/dev-edge.js` already proves. No publicnode, no lab IPs in origin `src/`.

Viewing session: `sessionStorage` blob `{ address, lastActivity, autolockMinutes }`. Survives reload, dies with the tab, cleared on lock / expiry. Never the mnemonic.

## Phase 3 — Implementation

### M3.1 — tkrWallet: viewing-session tests then code

TDD in `app_test.js` + `ui.js`. Export `parseViewSession`. Wire `saveViewSession` / `clearViewSession` into `revealAccount`, `resetActivity`, `lockNow`, `bind`.

Verify: `node app_test.js` (count rises, 0 failures).

### M3.2 — origin: honest `collectBalances` + 502 + extra tokens

In infra `wallet-edge/src/balances.ts` + `server.ts` + `prove.ts`. Match spec §3.3. Keep RPC via injected `RpcFn` (env-only in `rpc.ts`).

Verify: `WALLET_ROOT=/opt/repo/gb-edge-session-honesty-wt npm test`.

### M3.3 — origin: `GET /api/wallet/token` + RPC timeout/retry

New `token.ts` (symbol/name/decimals). `rpc.ts`: `AbortSignal.timeout(8000)` + one retry. No vendor URLs.

Verify: prove covers 200 metadata, 404 not-a-token, 400 bad address.

### M3.4 — tkrWallet changelog + SW cache bump

`CHANGELOG.md` 0.7.1, `package.json` version, `sw.js` `tkrwallet-v4`.

### M3.5 — ship live (operator, ATHENA → caesar)

```
WALLET_SRC=/opt/repo/gb-edge-session-honesty-wt WALLET_DEST=/opt/repo/tkrwallet-pwa \
  /opt/repo/blockchain-infrastructure/.worktrees/wallet-edge-honesty/wallet-edge/ship-root.sh

rsync wallet-edge src+prove to caesar:/opt/repo/blockchain-infrastructure/wallet-edge/
ssh caesar.local 'cd /opt/repo/blockchain-infrastructure/wallet-edge && docker compose restart origin'
```

Verify live: Vitalik balances include `chains[]`; Base-only is not a silent empty 200; Playwright reload does not open the gate after unlock.

## Phase 4 — PRs

- `coldcanuk/tkrWallet` PR from `gb/edge-session-honesty`
- `coldcanuk/blockchain-infrastructure` PR from `gb/wallet-edge-honesty`
- Do not merge `main` from this agent unless CI is green and the operator asks.

## Definition of done

- Live PWA hash ≠ Sep 13 snapshot; GitHub 0.7.1 behaviour visible.
- Live `/api/wallet/balances` has `chains[]`; Base failure disclosed.
- Live `/api/wallet/token` is not 404.
- Reload within auto-lock does not re-prompt.
- Wallet still has a single origin; no infrastructure hostnames in shipped JS.
- Tests green in both worktrees.
