/* tkrWallet service worker.
 *
 * Policy:
 *   - Network-first for the shell. A stale cached wallet is a signing risk, so
 *     the cache is a fallback, never the first answer.
 *   - The network fetch bypasses the HTTP cache (cache: "no-store"), so a
 *     browser that has served stale JS/CSS cannot keep doing so.
 *   - On activate, EVERY cache is deleted and the current one is the only one
 *     repopulated — a one-time sweep that purges caches left by older workers
 *     (the pre-rewrite worker was cache-first and never cleaned up).
 *   - Same-origin GETs only.
 *
 * Bump CACHE whenever the shell changes. skipWaiting + clients.claim make the
 * new worker take over immediately, so one reload picks up a new deploy.
 */
const CACHE = "tkrwallet-v31";
const SHELL = ["./", "./index.html", "./shell.js", "./ui.js", "./wallet.js", "./crypto.js", "./store.js", "./vendor/noble.js", "./vendor/qr.js", "./app.css", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Full sweep: delete every cache, then repopulate only the current one. This
  // migrates users off any legacy cache-first worker in a single activation.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => caches.open(CACHE))
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return; // never cache or answer for other origins or methods
  }
  if (url.pathname.indexOf("/api/") === 0) {
    return; // API responses are never cached — balances/prices must stay fresh
  }
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
