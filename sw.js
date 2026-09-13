const CACHE = "tkrwallet-v3";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["./", "./index.html", "./ui.js", "./app.css", "./manifest.webmanifest"])));
});
self.addEventListener("fetch", (event) => {
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
