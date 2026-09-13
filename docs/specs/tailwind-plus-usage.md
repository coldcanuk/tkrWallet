# Tailwind Plus usage policy

**Applies to:** tkrWallet (`coldcanuk/tkrWallet`), which is **GPLv3 and public**.

Two Tailwind Plus kits are used as design reference:

- `application-ui-v4/` — Application UI (HTML / React / Vue flavours)
- `catalyst-ui-kit/` — Catalyst (React + Headless UI)

Both are **purchased commercial products**, licensed under the
[Tailwind Plus licence](https://tailwindcss.com/plus/license).

---

## The position

The Tailwind Plus FAQ is explicit that open source is fine:

> "Can I use Tailwind Plus in open source projects? Yep! As long as what you're
> building is some sort of actual website and not a derivative component
> library, theme builder, or other product where the primary purpose is clearly
> to repackage and redistribute our components, it's totally okay for that
> project to be open source."

So there are two distinct acts, and only one of them is a problem:

| Act | Permitted? |
|---|---|
| Using Tailwind Plus components to **build the wallet** — adapting markup, styles and patterns into our own screens | ✅ Yes, explicitly |
| Committing **a copy of the kit itself** to this public repo | ❌ No — that is repackaging and redistributing the component library |

**tkrWallet is a wallet, not a UI kit.** What we build with these components is
squarely the permitted case. A checked-in `application-ui-v4/` directory is not.

---

## The rules

1. **The kit directories are gitignored.** They stay on disk as local reference
   material and never enter the repository. Enforced in `.gitignore`; verify with
   `git check-ignore -v application-ui-v4 catalyst-ui-kit`.

2. **Adapt, don't vendor.** Take patterns, structure and class idioms into
   `index.html` / `ui.js` and make them ours. Do not create a `components/`
   directory that mirrors Catalyst, and do not publish a theme, template or
   component package derived from either kit. That is the one line the licence
   actually draws.

3. **No `@tailwindplus/elements` CDN tag.** The Application UI examples reference
   `https://cdn.jsdelivr.net/npm/@tailwindplus/elements@1`. That is remote code:
   MV3 forbids it, `script-src 'self'` forbids it, and it would put a third-party
   origin in the trust path of a signing client. Interactivity is hand-written —
   which it already is.

4. **Attribution is not required** by the licence, and this file is not a licence
   notice. It exists so a future contributor does not helpfully commit the kits.

---

## What we take from each kit

**From `application-ui-v4/html`** — the plain-HTML flavour maps 1:1 onto this
project, which has no framework and no build step for markup:

- `application-shells/stacked` — the app shell and header structure
- `lists/stacked-lists` — the token list row anatomy
- `elements/buttons` and `elements/badges` — the action row and status pills
- `navigation/navbars` — header layout and the search affordance

The React and Vue flavours are not used; there is no framework here.

**From `catalyst-ui-kit`** — used for its **dark-mode craft**, which the
Application UI examples mostly lack. Measured from the kit's own sources:

| Idiom | Where it comes from | Why it matters here |
|---|---|---|
| `ring-1 ring-inset ring-white/10` | Catalyst uses **rings, not borders** | crisper edges on dark surfaces; no layout shift |
| Elevation ladder `zinc-950 → 900 → 800` | dominant in Catalyst (142 uses of `zinc-950`) | depth without shadows |
| `outline-2 outline-offset-2` focus | Tailwind v4 idiom | visible focus on dark, replaces `ring` focus |
| `rounded-lg` / `rounded-full` | Catalyst's two radii | consistent shape language |
| `data-*` state attributes | Headless UI convention | we use the same, hand-rolled |

Colours stay **warm** (`ink` / `cream` / `ember`) rather than Catalyst's neutral
`zinc`. The brand is tkrWallet's; what we borrow is the craft, not the palette.

---

## Framework decision

Catalyst is **React + Headless UI + `motion` + `clsx`**. Adopting it as a runtime
dependency would mean adding a bundler and roughly 150 KB of runtime to what is
currently 12 files and zero dependencies.

**Recommendation: don't — take its look, not its runtime.** This is a *signing
client*; "the shipped thing is the reviewable thing" is a security property, not
an aesthetic preference, and MV3 additionally forbids `unsafe-eval`, which would
have to be checked against `motion` before React could be considered safe here.

Recorded as decision **D11** in the plan. It is reversible: if a React runtime is
wanted, the work is an esbuild/JSX pipeline plus that dependency audit, and it
does not change any of the milestones.
