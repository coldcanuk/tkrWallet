# Changelog

## 0.10.11 — 2026-09-19

### Added
- Same-chain swaps on Ethereum, Base, Solana, and TRON through the wallet
  edge. Scratchpost builds the unsigned swap; this device signs it.
  Mainnet and Base are separate Uniswap v3 swaps, not a bridge. Native
  SOL and TRX in/out are first-class. Keys never leave the device.

### Fixed
- “Some chains could not be read” with no chain name was a Solana HTTP 400:
  the live wallet-edge only accepted 0x addresses. The client now names
  Solana when that second request fails, and keeps a 502 body that still
  reports `chains[]`. Native SOL is read from Scratchpost Caesar, not Phantom.
- TRON (BIP-44 `m/44'/195'/0'/0/0`) is derived next to EVM and Solana so a
  TRX balance can be read and swapped through the same edge session.
- kiff install stays in `$HOME`. Flatpak Chrome cannot `--pack-extension`
  (`bwrap` document portal). `pack-crx.sh` no longer uses Flatpak as the
  packer and no longer writes a CRX into `/opt/repo`; with only Flatpak
  installed it stages `$HOME/tkrWallet-unpacked`.

## 0.10.10 — 2026-09-19

### Fixed
- Popup size is on the `<html>` tag (432×580) so Flatpak cannot load JS
  too late and leave a monitor-tall document. Home shows the build id.
- `scripts/stage-unpacked.sh` copies the tree to `$HOME/tkrWallet-unpacked`
  so Brave’s file picker is not the xdg-document portal over `/opt/repo`.
- Ask for `tkrwallet.scratchpost.ai` site access when Brave has it set to
  “On click” (that blocks every edge fetch with no CORS involved).

## 0.10.9 — 2026-09-19

### Fixed
- Extension meta CSP was `connect-src 'self'`. In the popup that is
  `chrome-extension://…`, so the browser blocked every edge fetch and the
  banner said the edge was down. The wallet origin is now in the meta policy
  as well as the manifest.
- Dual scrollbars: `100vh` in a toolbar popup is the monitor height. The
  document is sized 432×600 before CSS (`shell.js`); only `#main` scrolls.

## 0.10.8 — 2026-09-19

### Fixed
- Production PWA at tkrwallet.scratchpost.ai was still the Sep 16 0.10.5
  shell (wordmark + settings gear, dual scrollbars). Deploy the 0.10.7+
  client and bust the service-worker cache (`tkrwallet-v10`). Settings
  now shows the running version so a screenshot cannot lie about the build.

## 0.10.7 — 2026-09-19

### Fixed
- Extension CORS: the live wallet-edge now allowlists both the Vault-pinned
  CRX id and the pre-Vault id. A pin mismatch was the real “edge could not
  be reached” error — the edge was up; credentialed fetches were blocked.
- Auto-lock survives popup close. MV3 destroys `sessionStorage` with the
  popup; the viewing session now uses `localStorage` on `chrome-extension:`
  pages and still expires after the chosen minutes. Settings show a visible
  “Saved.” line. Closing the popup within the window no longer re-prompts.
- Balance reads distinguish HTTP errors from a true unreachable edge.
- Viewing-session restore keeps the Solana address so SOL balances reload.

## 0.10.6 — 2026-09-19

### Fixed
- One page scrollbar. The 660px popup document was taller than Chromium’s
  clamped window, so the outer window and `#main` both scrolled. The shell
  now fits the actual viewport; only `#main` (or the gate / CLI log) scrolls.

### Added
- Header trio like Phantom: Terminal, Search, Dock (Heroicons). Terminal
  opens the in-wallet CLI. Dock opens the wallet in the browser side panel.
- Settings moved to the account drawer.

## 0.10.5 — 2026-09-16

### Fixed
- MV3 popup scrolling stays inside the wallet content and gate; the clamped
  Chrome popup viewport no longer creates a second scrollbar on the document.


## 0.10.4 — 2026-09-15

### Changed
- Gate sign-in paths are explicit: **Unlock with password**, **Import / recover** (mnemonic), **Create a new wallet**.
- Create-wallet Ethereum private key is **masked** (`abc....123`) with a **Copy** control; the full key is never painted into the DOM.


## 0.10.3 — 2026-09-15

### Added
- Settings → **Disconnect** clears the Scratchpost edge session (`POST /api/wallet/logout`). Distinct from Lock now: vault stays on device; keys stay in RAM until lock.


## 0.10.2 — 2026-09-15

### Changed
- MV3 action popup height **660** (+10% over 0.10.1’s 600). Width stays 432.

## 0.10.1 — 2026-09-15

### Changed
- MV3 action popup shell: **432×600** (was content-shrunk / plan baseline 360×560). Width +20% from 360; height at Chromium popup max so Connect/Sign/home are not clipped short. PWA/tab layout unchanged (`100vh`).

## 0.10.0 — sign pending IcePike request and broadcast raw

After Connect, the wallet polls `/api/wallet/pending-signs`. Confirm signs
the unsigned tx locally and POSTs raw bytes to `/api/wallet/broadcast`.
The origin forwards to rpc-gateway. Keys stay on the device.

## 0.9.0 — connect (challenge–response)

The unlocked wallet can prove it owns the address without sending a key.
Settings → Connect to Scratchpost: same-origin `POST /api/wallet/nonce`,
local `personal_sign`, `POST /api/wallet/session`. The recovery phrase
stays in RAM only while unlocked; lock wipes it. Nothing is broadcast.

- **EIP-191 connect.** `signPersonal(mnemonic, i, statement)` derives,
  signs, zeros the private key.
- **Dev edge** issues a single-use nonce and recovers the signer. Replay
  is `410`.
- **Service worker cache `tkrwallet-v6`.**

97 tests, 0 failures.

## 0.8.0 — create account, typed confirm, HD index i

Create a wallet on the device, not only import one. The recovery phrase and
the Ethereum private key are shown **once**, the operator types
`I saved my recovery phrase`, then only AES-GCM ciphertext is persisted.
Closing the gate wipes the backup buffers. Extra accounts in the same vault
are `m/44'/60'/0'/0/{i}` — public addresses only next to the ciphertext.

- **Create flow.** Empty state offers Create wallet. Password → generate
  12 words + one-time EVM private key → typed confirm → `encryptVault` →
  IndexedDB. The phrase never lands in `sessionStorage`.
- **HD accounts.** `importMnemonic(phrase, i)` derives
  `m/44'/60'/0'/0/{i}`. Settings → Add account asks for the password,
  decrypts, derives the next index, and stores `{i, path, evmAddress}` on
  the vault blob (not the key).
- **Wipe.** `wipeSecrets()` clears create/import/unlock fields and the
  on-screen mnemonic/priv; `wipeBytes()` zeros `Uint8Array` key material.
- **Service worker cache `tkrwallet-v5`** so the new gate ships.

94 tests, 0 failures.

## 0.7.1 — live edge + viewing session

The production origin was still serving a Sep 13 snapshot that treated a
failed Base read as “you own nothing”, and a reload always re-opened the
password gate. This release is what `tkrwallet.scratchpost.ai` is meant to
be running.

- **Viewing session survives reload.** After unlock, the public address and
  activity timestamp live in `sessionStorage` for the auto-lock window
  (default 5 minutes, never off, max 1 hour). Reload does not re-prompt.
  Lock / expiry / closing the tab still require the password. The recovery
  phrase is never written there.
- **Service worker cache `tkrwallet-v4`** so a stale Sep 13 shell cannot
  keep answering after this ships.

The honesty contract (`chains[]`, 502 on total failure, `/api/wallet/token`)
is already in 0.7.0; the production origin in `blockchain-infrastructure`
is updated to match so live Base-down is disclosed instead of empty.

## 0.7.0 — truthful balances, token detail, catalogue coverage

Closes **F1** (`docs/reviews/technical-review.md:125-155`, severity High):
*"For a wallet, 'I could not check' must never be presented as 'you have
nothing.'"* It had been open, and `docs/specs/edge-server.md` §3.3 had been
written to forbid the fix, so the client could not implement it even in
principle. Research and reproduction: `docs/research/balances-empty-state.md`.

- **The edge now reports what it actually read.** `/api/wallet/balances`
  gains a required `chains` array (`ok` / `partial` / `unknown`, with the real
  error). An empty `balances` array now means "you hold none" *only* when every
  chain was read; when nothing could be read the response is **502**, not a 200
  with an empty list. The dev edge's silent per-asset `catch` — which turned
  every RPC failure into a confident "no balances" — is gone, transient reads
  are retried once, and a partial chain names the tokens that failed.
- **The client keeps three states, not two.** `getBalances` returns
  `ok` / `partial` / `unknown` with a reason. The UI says **"Balances
  unavailable"** with a **Retry** button when nothing was readable, **"Balances
  incomplete"** plus the offending chain when part of it was, and only claims
  "No balances yet" after a fully successful read. A read report that is missing
  altogether is treated as *partial*, never as empty.
- **Token detail screen.** Tapping a coin did nothing but write a status string;
  holdings and search rows now open `#/token/<chain>:<asset>` with symbol, name,
  chain, amount, fiat value, a copyable contract address, and an explicit note
  when the balance is unknown or the token is not held.
- **Coverage is disclosed and closable.** The holdings list states that it
  covers Mainnet + Base and a fixed catalogue, and offers **Add token by
  address** — a new `GET /api/wallet/token?chain=&address=` reads
  `symbol()`/`decimals()` from the contract, and only that public metadata is
  stored locally. User-added tokens rank first in search.
- **Catalogue bug found and fixed.** `OP` was catalogued on Ethereum mainnet at
  `0x4200…0042`, which is the *GovernanceToken predeploy on OP Mainnet (chain
  10)* and has no bytecode on Ethereum — so every mainnet read silently dropped
  it. New `npm run verify:catalogue` checks bytecode + `symbol()` + `decimals()`
  for every catalogued address against the chain (35 addresses, all passing);
  `wallet.js` no longer ships the bogus row.
- **Dev-edge spec conformance.** Errors now use the documented `{ok:false,
  error, detail}` envelope; over-cap requests return `400` instead of being
  silently truncated; prices are `Cache-Control: public, max-age=15`.
- **Dev-origin trap documented.** The vault is per-origin, so a different
  `PORT` looks like a lost wallet; `npm run dev` says so on start and the README
  explains it.
- **Repairs while in here:** the `frame-ancestors` directive is no longer
  declared in a `<meta>` CSP (browsers ignore it there and log an error; the
  nginx template still sends it as a real header), `package.json` matches the
  CHANGELOG version, the duplicated `§3.5` heading is renumbered, the stale v1
  `docs/systems/*` map (F14) is clearly marked, and two citations of the
  non-existent `docs/specs/icehut-edge.md` point at the real spec.
- 83 tests, 0 failures.

## 0.6.0 — auto-lock, working search, edge balances

- **Auto-lock**: 5-minute default, configurable in Settings (1/5/15/30/60 min).
  Cannot be turned off; the longest session is 1 hour. Idle timer resets on
  activity, re-checks after background-tab throttling, and a "Lock now" button
  wipes key material and holdings on demand. Locked state re-prompts for the
  password — never an import.
- **Search that works**: the built-in catalogue grew to 38 Mainnet + Base
  tokens (names, symbols, verified addresses); matching covers symbol, name and
  address, so "tether", "bitcoin" and "chainlink" all hit. Rows show name ·
  chain · short address.
- **Real balances after unlock**: `wallet.js#getBalances` reads
  `GET /api/wallet/balances` from the edge (contract specified in
  `docs/specs/edge-server.md` §3.3); unlock fetches Mainnet + Base holdings,
  then prices, and renders the value. The service worker never caches `/api/*`.
- **Local dev edge** (`npm run dev`, `tools/dev-edge.js`): serves the app and
  `/api/wallet/balances` + `/api/wallet/prices` from one origin — balances via
  server-side public chain RPCs, prices via CoinGecko. Dev-only stand-in for
  the production edge, so the single-origin CSP behaves like production.
- 62 tests, 0 failures.

## 0.5.0 — self-custody import / unlock + local signing

- Import a BIP-39 recovery phrase or unlock a local wallet with a password; the
  phrase is encrypted (PBKDF2-SHA256 600k → AES-GCM) and stored on-device only.
- Derives Ethereum and Solana addresses; signs EIP-191 messages and legacy
  EIP-155 transactions locally with audited @noble/@scure primitives.
- vendor/noble.js committed unminified + reproducible (check:crypto).
- Locked by the canonical BIP-39 vector; 55 tests, 0 failures.
- Docs: docs/security/wallet-custody.md.

## 0.4.0 — Scratchpost repurpose, hardening, data layer

Divorce from tkrShell (v1) complete; the wallet is now built for the Scratchpost
stack with icehut as its only counterparty.

**Security**

- Single-origin enforcement: `host_permissions` is exactly
  `https://tkrwallet.scratchpost.ai/*`; a grep test fails on any other origin in
  any shipped file.
- CSP in both targets: meta tag in `index.html`, tightened `extension_pages`
  policy in `manifest.json`. `connect-src 'self'` makes "never talks to eva"
  browser-enforced.
- `app.js` (v1) deleted: no `tkrpik.com`, no `tkrswap.com`, no public Solana RPC
  anywhere in the tree.
- Service worker rewritten: network-first shell, stale-cache cleanup,
  `skipWaiting`/`clients.claim`, same-origin GET-only.
- Extension: PNG icons 16/32/48/128, pinned key
  (ID `hkljagpgkenlmfemcddcnhoaddpndldn`), private key gitignored.
- Hardened edge vhost artifact in `deploy/nginx/` covering audit findings
  R-1…R-12 (CF-only origin, real-IP trust, rate limits, default-deny server,
  no RPC passthrough).

**Wallet**

- Data layer `wallet.js`: EIP-1193 connect, native + ERC-20 balances for
  Ethereum/Base/Robinhood, honest `unknown ≠ zero` semantics, edge price
  contract, value estimation with unpriced-asset disclosure.
- Shell wired to the data layer: connect button, token list, USD/CAD toggle,
  `aria-live` announcements.
- Beaver Nickels fully removed from the client.
- Navigation uses real links on hash routes (no invalid tab ARIA).
- Named 40-test harness with a sequential async runner; committed-CSS freshness
  and class-resolution guards in CI.

**Docs**

- README rewritten (topology, invariants, dev workflow).
- `docs/architecture/client.md`, `docs/specs/edge-server.md`,
  `docs/research/RESEARCH.md`, `docs/plans/rdap-build-plan.md`,
  `docs/reviews/AUDIT-CROSSCHECK.md`, `docs/security/security-audit.md`,
  `docs/reviews/wallet-technical-review.md`.

## 0.3.0 and earlier

v1 era — tkrShell/tkrpik funnel. Superseded and removed.
