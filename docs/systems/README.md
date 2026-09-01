# tkrWallet systems map

Public GPLv3 client for the tkrpik / tkrSwap funnel. PWA and Chrome
extension in this tree. GitHub Pages:
`https://coldcanuk.github.io/tkrWallet`.

Graph (source of truth): [`tkrwallet.mmd`](tkrwallet.mmd).

Sibling live path (private): `coldcanuk/tickerpicker`
`docs/systems/live-path.mmd` and `docs/tkrshell/tkrshell.mmd`.

## Trust boundary

This tree talks **HTTPS only** to:

- `https://tkrpik.com` (`SHELL_URL` in `app.js`) for `/v1/snapshot`,
  `/api/public/game`, `/v1/hosted-wallet/attach`, `/login?next=tkrswap`
- `https://tkrswap.com/` (`SWAP_URL`) to open the desk

It does **not** call vendor APIs. Quote shopping stays on tickerpicker
behind tkrShell. Hosted-wallet attach is plan-only and returns no keys.

Self-custody: injected providers plus public Solana RPC
(`https://api.mainnet-beta.solana.com`). No tickerpicker `pass` paths.

## CLI

This repository has no CLI. Operator intent ("talks via our CLI") is
not implemented here. The client is `app.js` in the browser / extension.

## Hosting

Static files: `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`,
`manifest.json`, `icon.svg`. No compose stack. No `/healthz`.

## What it is not

No Lightning node. No hosted hot wallet. No aggregator clients. Do not
request Copilot as a reviewer on this public repo.
