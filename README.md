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

Current knowledge docs (how the UA talks to the edge, 0-knowledge scan, strengths
and remediations): [`docs/reviews/2026-09-14-technical-review.md`](docs/reviews/2026-09-14-technical-review.md),
[`docs/security/2026-09-14-security-audit.md`](docs/security/2026-09-14-security-audit.md).

## What works today

- Mobile-first shell: wallet value (USD/CAD), Send/Swap/Receive/Buy row, token
  list, four-tab navigation (Home/Swap/Activity/Search) plus a Settings screen.
- **Self-custody create / import / unlock**: create a new 12-word BIP-39
  wallet (phrase + Ethereum private key shown once, typed confirm
  `I saved my recovery phrase`, then wipe), import an existing phrase, or
  unlock the local vault with a password. The phrase is encrypted
  (PBKDF2-SHA256 at 600k iterations → AES-GCM) and stored only on this device.
  Derives Ethereum accounts at `m/44'/60'/0'/0/{i}` in the same vault and a
  Solana address at `m/44'/501'/0'/0'`, and signs EIP-191 messages and legacy
  EIP-155 transactions locally with audited `@noble`/`@scure` primitives —
  never a server. **Wallets** (`#/accounts`) holds several encrypted vaults
  in IndexedDB on this device (not HashiCorp Vault). + New Wallet and
  Import Wallet add another recovery phrase; − Remove Wallet deletes only
  the current one. **Watch** adds a public address the current wallet does
  not control (balances only, no send). Only public addresses sit next to
  the ciphertext.
  **Connect** (Settings)
  proves the address with an EIP-191 challenge–response on the wallet origin;
  the key never leaves the device and nothing is broadcast.
- **Auto-lock**: the wallet locks itself after inactivity — 5 minutes by
  default, configurable in Settings (1/5/15/30/60 min). It cannot be turned
  off and the longest session is 1 hour. "Lock now" is one tap away. A
  reload within that window does not re-prompt: the public address is kept
  in `sessionStorage` so balances can be re-read. Closing the tab or waiting
  out the timer still requires the password. The recovery phrase is never
  stored there.
- **Balances from the edge** (`GET /api/wallet/balances` + `/api/wallet/prices`,
  see `docs/specs/edge-server.md` §3.2–3.3): an unlocked wallet reads real
  Mainnet + Base holdings and fiat value. The production edge is not deployed
  yet, so `npm run dev` serves a working local edge (`tools/dev-edge.js`) —
  same origin, so the single-origin CSP still holds. There is no
  injected-provider (MetaMask/Brave/Uniswap) connect path.
- **Honest reads, not comfortable ones**: the edge reports which chains it
  actually read, and the client keeps three outcomes apart — *read*, *partly
  read*, *could not read*. A failed read says **"Balances unavailable"** and
  offers **Retry**; it is never rendered as "No balances yet". A partial read
  keeps the rows it got and discloses the gap. This is the repo's `unknown ≠
  zero` rule, enforced on the wire instead of promised in a comment.
- **Token detail**: tapping a holding or a search result opens
  `#/token/<chain>:<asset>` — symbol, name, chain, amount, fiat value, contract
  address (copyable), and an explicit note when the balance is unknown.
- **Token search and coverage**: a Mainnet + Base catalogue searchable offline
  by symbol, name, or address. Home chrome is **Mine** (balances you hold),
  **Tokens** (Ethereum + Base list, verified zeros first), and **Airdrop**
  (unpriced inbound) — not a fifth nav tab. **Add token by address** reads
  symbol/decimals from the contract via the edge and pins that token to the
  desk.
- Service worker: network-first shell, offline fallback, same-origin only,
  `/api/*` never cached.
- Swap Quote is a live Scratchpost Uniswap estimate. Tap the number for
  details and **Swap Now**; the button greys out when the quote expires.
  Activity is device-local (the chain nodes are pruned).

## Wallet custody model

tkrWallet is **non-custodial**: the recovery phrase is never sent anywhere, only
its ciphertext is persisted, and the private key exists in memory only while the
wallet is unlocked. The crypto surface is a committed, reproducible bundle of
audited libraries (`vendor/noble.js`), and the whole pipeline is locked by the
canonical BIP-39 test vector. See `docs/security/wallet-custody.md`.

## Development

```bash
npm run setup             # installs the Tailwind build tooling (tools/node_modules)
npm run dev               # local wallet + edge API on http://127.0.0.1:8899 (one origin)
npm run check             # tests + committed-CSS freshness + class-resolution guard
npm run build:css         # rebuild app.css from tools/src/app.css (committed output)
npm run verify:catalogue  # checks every catalogued token against real chain state
```

`npm run dev` serves the app **and** `/api/wallet/balances` + `/api/wallet/prices`
from one origin, so balances, prices and the CSP all behave like production.
Balances are read server-side from public chain RPCs and prices from CoinGecko —
dev-only stand-ins for the real edge.

> **Use the same port every time.** The vault lives in IndexedDB, which the
> browser scopes to an **origin**. `127.0.0.1:8899` and `127.0.0.1:9000` are
> different origins with different databases, so running on another port makes
> the wallet look forgotten and ask you to import again — nothing was lost, it is
> a different store. `npm run dev` prints this reminder on start.

`npm run verify:catalogue` needs network access and is deliberately **not** part
of `npm run check`: it proves each catalogued address really has bytecode and
matching `symbol()`/`decimals()` on the chain it is catalogued for. It exists
because the catalogue is trusted blindly by balances, prices and search, and one
entry (`OP`) was once listed on a chain it is not deployed on.

There are **no runtime dependencies** and no JS build for the app itself: the
shipped tree is the reviewed tree. `app.css` is committed because MV3 forbids
the Tailwind CDN and cannot relax `script-src`.

## Run as PWA

Open `index.html` (or any static host). Install when the browser offers it.
`manifest.webmanifest` + `sw.js` enable install and offline shell.

## Load as Chrome or Brave extension

On **kiff**, install from `$HOME`. Flatpak Chrome/Brave cannot pack or load
from `/opt/repo` — the xdg-document portal dies with
`bwrap: Can't find source path /run/user/1000/doc/by-app/…`.

```sh
cd /opt/repo/thePlatform/tkrWallet
git pull
./scripts/stage-unpacked.sh
```

Then chrome://extensions and brave://extensions → Remove tkrWallet →
Load unpacked → `/home/chuck/tkrWallet-unpacked`. Do not pick `/opt/repo`
in the file dialog.

The home card must read **tkrWallet 0.10.28**. If it does not, the browser
is not this tree. Site access for `tkrwallet.scratchpost.ai` must not be
“On click”.

`manifest.json` is Manifest V3, with a pinned `key` so the extension ID
(`kfgmpcgplemjepolfpdbodmakceacook`) is stable across unpacked loads.

Packed CRX is only for Pop Shop **deb** Chrome or Brave. Vault stays on
ATHENA. The script never uses Flatpak as the packer and never writes a
CRX into `/opt/repo`. If only Flatpak is installed it stages
`$HOME/tkrWallet-unpacked` and stops.

```sh
cd /opt/repo/thePlatform/tkrWallet
git pull
./scripts/pack-crx.sh
```

Drag `/home/chuck/tkrwallet.crx` if a CRX was written. Do not click Pack
extension. Do not pick `/opt/repo` in any file dialog.

## Edge contract

The edge is specified in `docs/specs/edge-server.md` — built to fit, not
reverse-engineered. A hardened nginx vhost template ships in
`deploy/nginx/tkrwallet-edge.conf.template`.

## What it is not

No Lightning node. No hosted hot wallet. No aggregator clients. No backend
secrets. No keys, no signing server-side, no vendor calls.

## Docs

- `docs/plans/rdap-build-plan.md` — the build plan this repo executes.
- `docs/reviews/2026-09-19-technical-review.md`,
  `docs/security/2026-09-19-audit.md` — current-tree review and four-track
  audit. The 0.7-era files under `docs/reviews/` and
  `docs/security/` are historical.
- `docs/architecture/client.md` — the client contract and invariants
  (swap screen note there is stale; the client quotes).
- `AGENTS.md` — Prime Directive: never write or commit on `main`.
