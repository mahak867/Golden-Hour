/* Golden Hour service worker: the app, OCR engine and fonts work offline after the first visit.
 * Pages: network first (always fresh when online). Static files: cache first. Nothing user-generated is cached. */
const VERSION = "gh-v2";
const CORE = [
  "./", "index.html", "engine.js", "features.js", "manifest.webmanifest",
  "fonts/Inter.ttf", "fonts/JetBrainsMono.ttf", "fonts/NotoSansTamil.ttf", "fonts/Newsreader.ttf",
  "icons/icon-192.png", "icons/icon-512.png",
];
const LAZY = /\/(vendor|fonts|icons)\//;

self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/")) {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return r; }).catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
    return;
  }
  if (LAZY.test(url.pathname) || CORE.some(p => url.pathname.endsWith("/" + p))) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; })));
  }
});
