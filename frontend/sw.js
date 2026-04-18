/* AgriSim — Service Worker
   Strategy:
     • Precache the core shell (HTML/CSS/JS) on install.
     • Runtime cache-first for same-origin static assets.
     • Stale-while-revalidate for cross-origin CDN libs & tiles.
     • Network-only for API calls to the backend.
*/

const VERSION = 'mittimantra-v15';
const CORE = [
  './',
  './index.html',
  './dashboard.html',
  './farm-boundary.html',
  './style.css',
  './assets/logo.png',
  './assets/logo-192.png',
  './assets/logo-512.png',
  './site-ui.js',
  './state-data.js',
  './india-globe.js',
  './demo-recommender.js',
  './dashboard.js',
  './offline-simulator.js',
  './farm-boundary.js',
  './i18n.js',
  './toolbar.js',
  './mm-core.js',
  './mm-enhance.js',
  './chatbot.js',
  './firebase-config.js',
  './user-data.js',
  './auth.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(CORE).catch(() => null))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isApiCall(url) {
  // Adjust to match your backend origin if different
  return /\/(api|docs|openapi\.json)(\/|$)/.test(url.pathname);
}

function isHtmlNav(req, url) {
  // Treat explicit page navigations, or requests that accept HTML, as
  // navigation requests. These MUST be network-first, otherwise stale HTML
  // can outlive a CSS/JS update and cause markup/style drift.
  if (req.mode === 'navigate') return true;
  const accept = req.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  return /\.html?$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Always hit the network for backend APIs
  if (url.origin === location.origin && isApiCall(url)) return;

  // Same-origin HTML: network-first, fall back to cache when offline.
  if (url.origin === location.origin && isHtmlNav(req, url)) {
    event.respondWith(
      fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => null);
        return res;
      }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // Same-origin static assets: cache-first
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          const clone = res.clone();
          caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => null);
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // Cross-origin: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => null);
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
