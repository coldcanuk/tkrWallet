# Research — "connected, but no balances / no tokens / dead coin click"

Date: 2026-09-14
Branch: `gb/balance-honesty-token-detail`
Status: reproduction complete, evidence below is from the shipped tree at `1ffced8`.

## Symptom (operator report)

> launched with `PORT=9000 npm run dev`; imported my wallet — which was odd
> because I had imported it earlier — and I still see I'm connected with my
> wallet but there are no balances, no tokens, nothing. Searching worked,
> finally, yet when I click on a coin nothing happens.

Two distinct complaints, plus one confusion. All three are reproduced below.

## Method

- Real browser: Playwright headless Chromium, mobile viewport 390×844,
  fresh persistent profile per arm.
- Arm A — the shipped dev edge (`tools/dev-edge.js`, port 8899) and the
  canonical BIP-39 test vector.
- Arm B — a stub edge on port 8901 that returns fixed holdings for *any*
  address, to separate "client cannot render" from "this address has nothing".
- Arm C — the shipped dev edge with every chain RPC forced to fail
  (`.ui-shots/fail-fetch.js` preload rejects `publicnode`/`coingecko`).
- Baseline: `npm test` → 62 tests, 0 failures.

## Finding 1 — the client renders holdings correctly (arm B)

Arm B (`stub-edge`) proves the render pipeline is sound:

```
"status": "3 holdings listed.",
"value": "US$5,500.50",
"rowCount": 3,
"rows": ["ETH", "USDC", "ETH"],
API-CALLS: /api/wallet/balances?address=0x9858…da94&chains=1%2C8453
           /api/wallet/prices?assets=1%3Anative%2C1%3A0xA0b8…%2C8453%3Anative&vs=usd
```

So "no holdings" is **not** a rendering bug. The happy path works.

## Finding 2 — a total chain-read failure is reported as "you own nothing" (critical)

Arm C, with every upstream RPC failing:

```console
$ PORT=8902 node -r ./.ui-shots/fail-fetch.js tools/dev-edge.js &
$ curl -s "http://127.0.0.1:8902/api/wallet/balances?address=0xd8dA…6045&chains=1,8453"
{"balances":[],"as_of":1789360777}          # HTTP 200, success shape, no rows
```

`tools/dev-edge.js` wraps every chain read in a silent `catch`:

```js
} catch (e) {
  /* chain read failed -> omitted, not zero */
}
```

Per asset the row is omitted, but the **aggregate response is indistinguishable
from an address that owns nothing**. The client then does exactly what its
contract says:

- `wallet.js:225` — `Array.isArray(body.balances)` is true → `{ state: "ok" }`
- `ui.js:444` — `"0 holding" + "s" + " listed."`
- `ui.js:275` — empty card title **"No balances yet"**

This is the operator's exact symptom: connected, nothing listed, no error, no
explanation. It also breaks the repo's own first invariant
(`wallet.js:8-9`: *"unknown != zero. Every read failure yields
`{ state: "unknown" }`, and no code path converts a failure into a 0 balance."*)
— the edge converts the failure into an empty-owned set before the client ever
sees it, so the client cannot apply the rule.

Contrast: the *prices* endpoint does fail loudly (HTTP 502), which is why the
value line can disagree with the list.

## Finding 3 — tapping a coin is a dead click, by construction

`ui.js:309` (a holding) and `ui.js:374` (a search result) do one thing:

```js
row.addEventListener("click", function () {
  setWalletStatus("Token details are not built yet.");
});
```

Measured effect of clicking a rendered holding row (arm B):

```
ROW-CLICK: hash  ->  | status: Token details are not built yet.
```

The URL does not change, no screen appears, nothing scrolls. The only feedback
is a status line elsewhere on the page — from the user's seat, nothing happens.
There is no token-detail route, screen, or template anywhere in the tree.

## Finding 4 — holdings outside the built-in catalogue are invisible, silently

`wallet.js:46-90` hard-codes 37 tokens across Mainnet and Base.
`dev-edge.js:133` queries exactly those and nothing else. There is no
custom-token path and no per-address token discovery, so any ERC-20 the user
actually holds that is not on that list contributes no row and no explanation.
The search screen discloses the catalogue scope (`ui.js:352`); the holdings list
does not. Solana is catalogued but never queried (`wallet.js:32-34`), likewise
undisclosed on the home screen.

## Finding 5 — changing the dev port silently loses the wallet

`store.js:11` keeps the vault in IndexedDB, which is keyed by **origin**.
`127.0.0.1:8899` and `127.0.0.1:9000` are different origins with different
databases. README:72 documents `npm run dev` (port 8899); the operator ran
`PORT=9000`. Result: no vault on that origin, so the gate correctly offers
"Import wallet" again — which reads as "it forgot my wallet". Nothing in the
README, the dev-edge banner, or the UI mentions the port/origin coupling.

## Finding 6 — the meta CSP contains a directive browsers ignore

`index.html:18` ships `frame-ancestors 'none'` inside a `<meta http-equiv>`
CSP. Browsers ignore `frame-ancestors` when delivered via `<meta>` and log:

```
The Content Security Policy directive 'frame-ancestors' is ignored when
delivered via a <meta> element.
```

The protection is not lost (the nginx template sends it as a real header), but
every load logs a console error, and the doc comment claims an enforcement the
browser does not apply.

## Finding 7 — test coverage stops at the happy path

`app_test.js:422-458` covers a 200 response with rows and a rejected fetch. It
never covers `{"balances":[]}` produced by failed reads, because the wire format
cannot express it. There is no test for the edge handler's failure behaviour and
none for a token-detail route. `app_test.js:426` asserts the request shape only.

## Finding 8 — the reproducibility gates are path-sensitive

`npm run check:crypto` rebuilds `vendor/noble.js` and diffs it. esbuild embeds
the resolved source path in a comment, so building from a worktree whose
`tools/node_modules` is a **symlink** produces
`// ../../../tools/node_modules/@scure/bip39/wordlists/english.js` instead of
`// node_modules/@scure/…` and the gate fails spuriously. Worktrees must hold a
real copy of the tooling. (Encountered and worked around during Phase 0.)

## Answers to the operator's questions

| Question | Answer |
| --- | --- |
| Why no balances / no tokens? | If any chain read failed, the edge reports success-with-nothing and the UI states it as fact. If reads succeeded, the address holds none of the 37 catalogued tokens on Mainnet/Base — undisclosed. |
| Why did I have to import again? | Different origin (port 9000 vs 8899) ⇒ different IndexedDB ⇒ no vault. Not data loss. |
| Why does clicking a coin do nothing? | No detail screen exists; the handler only writes a status string. |
| Why did search "finally" work? | Search is offline against the built-in catalogue and needs no edge. |

## Reproduction commands

```bash
npm test                                             # 62 tests, 0 failures
PORT=8899 node tools/dev-edge.js                     # arm A
PORT=8902 node -r ./.ui-shots/fail-fetch.js tools/dev-edge.js   # arm C
node .ui-shots/probe-diag.js                         # arms A + B in-browser
```
