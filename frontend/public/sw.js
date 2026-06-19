// SwitchPilot service worker: makes the SPA installable and provides a basic
// offline shell. Network-first for navigations (so a fresh deploy is picked up
// the moment the device is back online); cache-first for hashed build assets.
// Live data is never cached: /api requests and non-GET requests bypass the SW.
const CACHE = 'switchpilot-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;                  // never cache writes
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;       // ignore cross-origin
  if (url.pathname.startsWith('/api/')) return;          // never cache live data

  // SPA navigations: try the network, fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Static assets (hashed under /assets): cache-first, then backfill the cache.
  event.respondWith(
    caches.match(request).then((cached) =>
      cached ||
      fetch(request).then((resp) => {
        if (resp.ok && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return resp;
      })
    )
  );
});
