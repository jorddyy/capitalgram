// Offline support. App files come from the network when it answers within
// NETWORK_TIMEOUT (bypassing GitHub Pages' 10-minute HTTP cache) and from the
// cache otherwise, so a deploy shows up on the next launch while offline use
// stays instant. Bump VERSION on every deploy: the changed sw.js is what makes
// an already-open app reload itself (see app.js).
const VERSION = 'v4';
const NETWORK_TIMEOUT = 3000;
const CACHE = `capitalgram-${VERSION}`;
const FONTS = 'capitalgram-fonts';
const FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'vendor/d3-array.min.js',
  'vendor/d3-geo.min.js',
  'vendor/topojson-client.min.js',
  'data/countries.json',
  'data/anagrams.json',
  'data/countries-50m.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  try {
    // A slow network (pub Wi-Fi) loses the race; it still refreshes the cache
    const res = await Promise.race([network, new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT))]);
    if (res) return res;
  } catch (e) { /* offline */ }
  const cached = await cache.match(request, { ignoreSearch: true }) ||
    (request.mode === 'navigate' && await cache.match('./'));
  return cached || network;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONTS));
  }
});
