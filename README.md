# tkrWallet

GPLv3, self-custody customer wallet for the **Scratchpost** stack. PWA and
Chrome extension (MV3) from one tree. It is a client signer, not a custodian —
it never holds keys, never auto-executes, and never shops vendors.

## Topology

```
Browser (mobile-first PWA + MV3 extension)
        │  https://tkrwallet.scratchpost.ai — same origin for app and API
        ▼
     icehut        the edge. TLS, static hosting, /api/*, rate limits.
                   Holds backend credentials server-side. No RPC passthrough.
        │
        ▼
   Scratchpost     blockchain-infrastructure: brain, pruned ETH/Base nodes,
                   rpc-gateway (signed raw bytes only). LAN/VPN — never public.
```

**The wallet talks to icehut and to nothing else. Ever.** Not eva, not the
brain, not a public RPC. This is enforced, not promised:

- `connect-src 'self'` in the page CSP and `extension_pages` CSP in
  `manifest.json` — the browser refuses any other origin.
- No RPC passthrough exists at the edge, so no node is reachable through it.
- `host_permissions` grants exactly `https://tkrwallet.scratchpost.ai/*`, and a
  test greps every shipped file and fails on any other origin.

EVM balances are read from the user's own injected provider (MetaMask, Brave,
…). The wallet never contacts a chain node itself.

## What works today

- Mobile-first shell: wallet value (USD/CAD), Send/Swap/Receive/Buy row, token
  list, four-tab navigation (Home/Swap/Activity/Search).
- Wallet connect via EIP-1193: native + ERC-20 balances for Ethereum, Base and
  Robinhood, with honest failure states — a failed RPC renders `—`, never `0`.
- Service worker: network-first shell, offline fallback, same-origin only.
- Honest placeholders: Swap is under construction (no router exists in this
  stack yet), Activity is device-local (the chain nodes are pruned).

## Development

```bash
npm run setup      # installs the Tailwind build tooling (tools/node_modules)
npm run check      # tests + committed-CSS freshness + class-resolution guard
npm run build:css  # rebuild app.css from tools/src/app.css (committed output)
```

There are **no runtime dependencies** and no JS build: the shipped tree is the
reviewed tree. `app.css` is committed because MV3 forbids the Tailwind CDN and
cannot relax `script-src`.

## Run as PWA

Open `index.html` (or any static host). Install when the browser offers it.
`manifest.webmanifest` + `sw.js` enable install and offline shell.

## Load as Chrome extension

1. Chrome → Extensions → Load unpacked
2. Select this directory
3. `manifest.json` is Manifest V3, with a pinned `key` so the extension ID
   (`hkljagpgkenlmfemcddcnhoaddpndldn`) is stable across unpacked loads.

## Edge contract

The edge is specified in `docs/specs/icehut-edge.md` — built to fit, not
reverse-engineered. A hardened nginx vhost template ships in
`deploy/nginx/tkrwallet-edge.conf.template`.

## What it is not

No Lightning node. No hosted hot wallet. No aggregator clients. No
tickerpicker secrets. No keys, no signing server-side, no vendor calls.

## Docs

- `docs/plans/rdap-build-plan.md` — the build plan this repo executes.
- `docs/reviews/wallet-technical-review.md`, `docs/security/security-audit.md`
  — the review and audit this build is closing.
- `docs/architecture/client.md` — the client contract and invariants.
