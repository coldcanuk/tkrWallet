# tkrWallet

GPLv3, self-custody customer wallet for the **Scratchpost** stack. PWA and
Chrome extension (MV3) from one tree. It is a client signer, not a custodian —
it never holds keys, never auto-executes, and never shops vendors.

## Topology

```
Browser (mobile-first PWA + MV3 extension)
        │  https://tkrwallet.scratchpost.ai — same origin for app and API
        ▼
   Edge Server     the edge. TLS, static hosting, /api/*, rate limits.
                   Holds backend credentials server-side. No RPC passthrough.
        │
        ▼
   Scratchpost     the backend: brain, pruned ETH/Base nodes,
                   rpc-gateway (signed raw bytes only). LAN/VPN — never public.
```

**The wallet talks to the edge and to nothing else. Ever.** Not the chain host, not the
brain, not a public RPC. This is enforced, not promised:

- `connect-src 'self'` in the page CSP and `extension_pages` CSP in
  `manifest.json` — the browser refuses any other origin.
- No RPC passthrough exists at the edge, so no node is reachable through it.
- `host_permissions` grants exactly `https://tkrwallet.scratchpost.ai/*`, and a
  test greps every shipped file and fails on any other origin.

EVM balances for an unlocked wallet arrive from the wallet edge — they are not
read from any injected provider, and the wallet never contacts a chain node
itself.

## What works today

- Mobile-first shell: wallet value (USD/CAD), Send/Swap/Receive/Buy row, token
  list, four-tab navigation (Home/Swap/Activity/Search) plus a Settings screen.
- **Self-custody import / unlock**: import a 12/24-word BIP-39 recovery phrase
  or unlock an existing local wallet with a password. The phrase is encrypted
  (PBKDF2-SHA256 at 600k iterations → AES-GCM) and stored only on this device.
  Derives the Ethereum (`m/44'/60'/0'/0/0`) and Solana (`m/44'/501'/0'/0'`)
  addresses, and signs EIP-191 messages and legacy EIP-155 transactions locally
  with audited `@noble`/`@scure` primitives — never a server.
- **Auto-lock**: the wallet locks itself after inactivity — 5 minutes by
  default, configurable in Settings (1/5/15/30/60 min). It cannot be turned
  off and the longest session is 1 hour. "Lock now" is one tap away.
- **Balances from the edge** (`GET /api/wallet/balances` + `/api/wallet/prices`,
  see `docs/specs/edge-server.md` §3.2–3.3): an unlocked wallet reads real
  Mainnet + Base holdings and fiat value. The production edge is not deployed
  yet, so `npm run dev` serves a working local edge (`tools/dev-edge.js`) —
  same origin, so the single-origin CSP still holds. There is no
  injected-provider (MetaMask/Brave/Uniswap) connect path.
- **Token search**: a 38-token Mainnet + Base catalogue searchable offline by
  symbol, name, or address.
- Service worker: network-first shell, offline fallback, same-origin only,
  `/api/*` never cached.
- Honest placeholders: Swap is under construction (no router exists in this
  stack yet), Activity is device-local (the chain nodes are pruned).

## Wallet custody model

tkrWallet is **non-custodial**: the recovery phrase is never sent anywhere, only
its ciphertext is persisted, and the private key exists in memory only while the
wallet is unlocked. The crypto surface is a committed, reproducible bundle of
audited libraries (`vendor/noble.js`), and the whole pipeline is locked by the
canonical BIP-39 test vector. See `docs/security/wallet-custody.md`.

## Development

```bash
npm run setup      # installs the Tailwind build tooling (tools/node_modules)
npm run dev        # local wallet + edge API on http://127.0.0.1:8899 (one origin)
npm run check      # tests + committed-CSS freshness + class-resolution guard
npm run build:css  # rebuild app.css from tools/src/app.css (committed output)
```

`npm run dev` serves the app **and** `/api/wallet/balances` + `/api/wallet/prices`
from one origin, so balances, prices and the CSP all behave like production.
Balances are read server-side from public chain RPCs and prices from CoinGecko —
dev-only stand-ins for the real edge.

There are **no runtime dependencies** and no JS build for the app itself: the
shipped tree is the reviewed tree. `app.css` is committed because MV3 forbids
the Tailwind CDN and cannot relax `script-src`.

## Run as PWA

Open `index.html` (or any static host). Install when the browser offers it.
`manifest.webmanifest` + `sw.js` enable install and offline shell.

## Load as Chrome extension

1. Chrome → Extensions → Load unpacked
2. Select this directory
3. `manifest.json` is Manifest V3, with a pinned `key` so the extension ID
   (`hkljagpgkenlmfemcddcnhoaddpndldn`) is stable across unpacked loads.

## Edge contract

The edge is specified in `docs/specs/edge-server.md` — built to fit, not
reverse-engineered. A hardened nginx vhost template ships in
`deploy/nginx/tkrwallet-edge.conf.template`.

## What it is not

No Lightning node. No hosted hot wallet. No aggregator clients. No backend
secrets. No keys, no signing server-side, no vendor calls.

## Docs

- `docs/plans/rdap-build-plan.md` — the build plan this repo executes.
- `docs/reviews/wallet-technical-review.md`, `docs/security/security-audit.md`
  — the review and audit this build is closing.
- `docs/architecture/client.md` — the client contract and invariants.
