# tkrWallet

GPLv3 open-source wallet for the tkrpik / tkrSwap funnel/

tkrWallet is a **PWA** and a **Chrome extension**. It is a client signer, not a custodian. Swaps route through [tkrSwap](https://tkrswap.com) (`https://tkrpik.com/swap`). Index cards, the public scoreboard, and Beaver Nickels come from tkrpik.

This repository succeeds the private `customwallet` tree (`https://git.actvite.com/chuck/customwallet`), which is archived. Do not hold customer funds here.

GitHub Copilot code review is **not** enabled on this public repo. Do not
request Copilot as a reviewer and do not wait for it. Copilot Lite reviews
the private `coldcanuk/tickerpicker` tree (tkrpik / tkrSwap) only. Work in
a git worktree; never commit on `main`.

Login is an injected-wallet connect (`#wallet-login`). Holdings open tkrSwap with `token_in` / `from_address` / `source_chain_id`. The wallet never auto-executes and never embeds `/api/quote`.

tkrpik index cards, the public scoreboard, and Beaver Nickels are fetched from `https://tkrpik.com/api/public/game` (same ledger the private game uses). Swaps never shop vendors inside this repo — they open tkrSwap.

## Run as PWA

Open `index.html` (or any static host). Install when the browser offers it. `manifest.webmanifest` + `sw.js` enable install and offline chrome.

## Load as Chrome extension

1. Chrome → Extensions → Load unpacked
2. Select this directory
3. `manifest.json` is Manifest V3

## What it is not

No Lightning node. No hosted hot wallet. No billing BTC then sending ERC-20 from inventory.
