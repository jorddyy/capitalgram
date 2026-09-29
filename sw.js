// Offline support. Serves every file from the cache straight away and
// refreshes the cache in the background, so a new deploy shows up on the
// next launch. Bump VERSION when files are added, renamed or removed.
const VERSION = 'v1';
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
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function staleWhileRevalidate(request, cacheName, fallback) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true }) || (fallback && await cache.match(fallback));
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
    event.respondWith(staleWhileRevalidate(request, CACHE, request.mode === 'navigate' ? './' : null));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONTS));
  }
});
