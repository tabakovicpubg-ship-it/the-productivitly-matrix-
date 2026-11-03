// Offline support. App files are network-first (so edits show up right away
// when online) with the cache as a fallback; Google Fonts are cache-first.

const VERSION = 'pm-v1';
const FONT_CACHE = 'pm-fonts';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, FONT_CACHE));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  // no-cache: always check with the server (a cheap 304 when nothing changed),
  // so a new version shows up on the next open instead of hiding in the HTTP cache.
  const network = fetch(request, { cache: 'no-cache' }).then(res => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  network.catch(() => {});

  // Give a slow network 3 seconds before falling back to the cached copy.
  try {
    const res = await Promise.race([network, new Promise(resolve => setTimeout(resolve, 3000))]);
    if (res) return res;
  } catch {}

  const cached = (await cache.match(request, { ignoreSearch: true }))
    || (request.mode === 'navigate' && (await cache.match('index.html')));
  return cached || network;
}
