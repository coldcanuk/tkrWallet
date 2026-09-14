/* tkrWallet service worker.
 *
 * Policy:
 *   - Network-first for the shell. A stale cached wallet is a signing risk, so
 *     the cache is a fallback, never the first answer.
 *   - Same-origin GETs only. The worker must never touch cross-origin requests
 *     (the wallet talks to one origin, and the browser enforces the rest).
 *   - Old caches are deleted on activate; new workers take over immediately.
 */
const CACHE = "tkrwallet-v1";
const SHELL = ["./", "./index.html", "./ui.js", "./wallet.js", "./app.css", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return; // never cache or answer for other origins or methods
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
