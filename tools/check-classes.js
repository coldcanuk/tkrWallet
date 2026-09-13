#!/usr/bin/env node
/* Guard: every class used by the shell must exist in the committed app.css.
 *
 * Why this exists: app.css is a *build artifact that is committed*, and the
 * class names live in hand-written HTML/JS. A typo produces no error anywhere —
 * the browser just renders an unstyled element. Tailwind will happily emit a
 * stylesheet with no rule for a class that does not exist, and CI's freshness
 * check compares the build to itself, so it cannot catch this either.
 *
 * Run from the repo root (or via `npm run check:classes`).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CSS = path.join(ROOT, "app.css");
const SOURCES = ["index.html", "ui.js"];

if (!fs.existsSync(CSS)) {
  console.error("check-classes: app.css is missing — run `npm run build:css` first.");
  process.exit(1);
}

const css = fs.readFileSync(CSS, "utf8");
const referenced = new Set();

for (const rel of SOURCES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  for (const match of src.matchAll(/class(?:Name)?\s*=\s*"([^"]*)"/g)) {
    for (const cls of match[1].split(/\s+/)) {
      if (cls) {
        referenced.add(cls);
      }
    }
  }
}

// Tailwind escapes CSS-special characters in selectors: `p-0.5` becomes
// `.p-0\.5`, `bg-ink-950/95` becomes `.bg-ink-950\/95`.
const escapeClass = (cls) => cls.replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\" + ch);
const missing = [...referenced].filter((cls) => !css.includes("." + escapeClass(cls)));

if (missing.length) {
  console.error(`check-classes: ${missing.length} class(es) used but absent from app.css:`);
  missing.sort().forEach((cls) => console.error("  " + cls));
  console.error("\nEither fix the typo, or add the class and rebuild: npm run build:css");
  process.exit(1);
}

console.log(`check-classes: ok (${referenced.size} classes, all present in app.css)`);
