# tkrWallet

GPLv3 open-source wallet for the tkrpik / tkrSwap funnel.

tkrWallet is a **PWA** and a **Chrome extension**. It is a client signer, not a custodian. Swaps route through [tkrSwap](https://tkrswap.com) (`https://tkrpik.com/swap`). Index cards, the public scoreboard, and Beaver Nickels come from tkrpik.

This repository succeeds the private `customwallet` tree. Do not hold customer funds here.

## Run as PWA

Open `index.html` (or any static host). Install when the browser offers it. `manifest.webmanifest` + `sw.js` enable install and offline chrome.

## Load as Chrome extension

1. Chrome → Extensions → Load unpacked
2. Select this directory
3. `manifest.json` is Manifest V3

## What it is not

No Lightning node. No hosted hot wallet. No billing BTC then sending ERC-20 from inventory.
