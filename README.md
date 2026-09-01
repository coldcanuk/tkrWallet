# tkrWallet

GPLv3 open-source customer wallet for the tkrpik / tkrSwap funnel.

tkrWallet is a **PWA** and a **Chrome extension**. It is a client signer,
not a custodian. It talks **HTTPS only** to the public tkrShell API
(`https://tkrpik.com/v1/…`, plus the live tkrSwap desk hostname which
nginx sends through tkrShell). Self-custody sign uses wallet-standard /
injected providers (Phantom, MetaMask, Brave, Uniswap) and public chain
RPC. It never holds tickerpicker `pass` paths or vendor API keys
(Li.Fi, 1inch, Jupiter, 0x, Alchemy, Helius, Coinbase, Uniswap API,
Blockscout, Stripe).

Index cards, the public scoreboard, and Beaver Nickels come from
`GET /v1/snapshot` (tkrpik source of truth). Quotes, swaps, fill-status,
and hosted-wallet attach go through tkrShell. Hosted attach is plan-only
and returns no keys.

This repository succeeds the private `customwallet` tree
(`https://git.actvite.com/chuck/customwallet`), which is archived. Do
not hold customer funds here.

GitHub Copilot code review is **not** enabled on this public repo. Do not
request Copilot as a reviewer and do not wait for it. Copilot Lite reviews
the private `coldcanuk/tickerpicker` tree (tkrpik / tkrSwap) only. Work in
a git worktree; never commit on `main`.

Login is an injected-wallet connect (`#wallet-login`). Holdings open tkrSwap
with `token_in` / `from_address` / `source_chain_id`. The wallet never
auto-executes and never embeds `/api/quote` or a vendor hostname.

History was walked for vendor URL+key and `pass` paths. None were found
in this tree; history was not rewritten.

## Run as PWA

Open `index.html` (or any static host). Install when the browser offers it. `manifest.webmanifest` + `sw.js` enable install and offline chrome.

## Load as Chrome extension

1. Chrome → Extensions → Load unpacked
2. Select this directory
3. `manifest.json` is Manifest V3

## What it is not

No Lightning node. No hosted hot wallet. No billing BTC then sending ERC-20 from inventory.
No tickerpicker secrets. No aggregator clients.
