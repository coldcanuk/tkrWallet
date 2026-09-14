# Plan — Truthful balances & token detail (RDAP)

Proof this is the right target: `docs/reviews/technical-review.md:125-155` rates
this **High (F1)** — *"'I could not check' must never be presented as 'you have
nothing.' This is the highest-value fix in this review."* It was never closed,
and `docs/specs/edge-server.md` §3.3 was later written to forbid the fix.

Method: Research-Driven Adaptive Planning (Double Diamond → Spiral → small-win
milestones). Research is `docs/research/balances-empty-state.md`; this file is the
frozen plan it produced.

## Scope

**Primary goal.** An unlocked wallet must never present *unknown* as *you own
nothing*, and tapping a coin must open a real detail screen. Catalogue coverage
limits must be disclosed, and a token outside the built-in catalogue must be
addable.

**Non-goals.** Swap routing, send/broadcast, Activity/history indexer, Solana
balance reads, edge deployment, custodial anything, chains beyond the existing
catalogue.

**Success criteria (measurable).**

1. Every chain read fails ⇒ client state is `unknown` with a reason, the UI says
   so and offers **Retry**; the string "No balances yet" is *not* shown.
2. A partial failure is disclosed (`1 of 2 chains read`), and the rows that did
   arrive are still shown.
3. "No balances yet" appears only when **every** requested chain read succeeded.
4. Tapping a holding *or* a search result navigates to `#/token/<chain>:<asset>`
   and renders a detail screen (symbol, name, chain, contract, amount, fiat,
   copy-address, back).
5. The holdings list states its catalogue scope and offers *Add token by
   address*; an added token is queried through the edge and persists.
6. `npm run check` is green; PWA and MV3 extension both load; the single-origin
   grep test still passes.
7. `docs/specs/edge-server.md`, `docs/architecture/client.md`, README and
   CHANGELOG match the shipped behaviour.

**Constraints.** No runtime dependencies; no build for app JS; `app.css` is
committed so Tailwind changes require `npm run build:css`; MV3 forbids inline
script; every network call goes through `wallet.js`; `unknown ≠ zero`; the
worktree needs a real (not symlinked) `tools/node_modules` because
`check:crypto` embeds resolved paths.

## Top risks

| Risk | Mitigation |
|---|---|
| Breaking the `unknown ≠ zero` tests while adding states | Extend, never weaken: `state:"ok"` keeps its meaning; add `partial`/`unknown` alongside |
| New Tailwind classes not in the committed `app.css` | Run `npm run build:css` and let `check:css` + `check:classes` gate it |
| Detail route fights the existing hash router | Extend `parseRoute`/`showScreen` with a `detail` screen; keep `#/home`, `#/swap`, `#/activity`, `#/search`, `#/settings` unchanged |
| Custom-token storage leaking secrets | Only public token metadata in `localStorage`; the mnemonic stays in the vault |
| Edge contract change breaking the future real edge | Amend `docs/specs/edge-server.md` in the same commit as the code |

## Phase 1 — Research & discovery

- **M1.1** ✅ Reproduce and document the failure → `docs/research/balances-empty-state.md`.
- **M1.2** Docs/contract research across `docs/**` (edge spec, client contract,
  reviews, audits, plans).
- **M1.3** Synthesize into this frozen plan.

## Phase 2 — Define the contract

- **M2.1** Amend `docs/specs/edge-server.md` §3.3 and
  `docs/architecture/client.md`:
  - The edge **must** report per-chain read status, and an empty `balances`
    array **must not** be produced when no chain was read.
  - New response field (additive, back-compatible):
    `"chains": [{ "chain_id": 1, "state": "ok"|"unknown", "error": "…" }]`.
  - `GET /api/wallet/balances` gains an optional
    `tokens=<chain:address,…>` parameter for user-added tokens.
  - `GET /api/wallet/token?chain=<id>&address=<0x…>` → symbol/name/decimals,
    promoting the spec's existing "optional companion" (§3.5 line 286) to the
    contract the client relies on.
  - Client states: `ok` | `partial` | `unknown`, each with `reason`.

## Phase 3 — Implementation

- **M3.1** `tools/dev-edge.js`: per-chain status; 502 when *no* chain could be
  read; `tokens=` support; `token` metadata endpoint; **and conformance with the
  spec it claims to implement** — the §3 error envelope, `400` on over-cap
  instead of silent truncation, and one honest failure policy shared by both
  endpoints. Tests in `app_test.js` driving the handler with a stubbed fetch.
- **M3.2** `wallet.js`: `getBalances` returns `ok`/`partial`/`unknown` + reason;
  `getTokenMeta`; custom-token helpers. Tests.
- **M3.3** `ui.js`: honest empty/unknown/partial states, **Retry**, last-checked
  timestamp, queried address disclosure.
- **M3.4** Token detail screen + `#/token/<chain>:<asset>` route from holdings
  and search; `index.html` template; `app.css` rebuild.
- **M3.5** Catalogue-scope disclosure on the holdings list + *Add token by
  address* (localStorage, queried via the edge).
- **M3.6** Dev-origin trap: dev-edge banner, README, and first-run copy.
- **M3.7** Repository drift: mark `docs/systems/*` as the stale v1 map (F14),
  align `package.json` version with `CHANGELOG.md`, fix the duplicate `§3.5`
  numbering and the citations of the non-existent `docs/specs/icehut-edge.md`
  in `edge-server.md`/`CHANGELOG.md`/`deploy/README.md`.

## Phase 4 — Verification, polish, integration

- **M4.1** Playwright e2e: full success, total failure, partial failure, detail
  navigation, extension load.
- **M4.2** `npm run check`; README/CHANGELOG; docs pass.
- **M4.3** Merge `--no-ff` into `main`, push, remove the worktree, confirm the
  tree is clean.
