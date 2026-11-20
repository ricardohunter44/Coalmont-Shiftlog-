// Jobflow service worker: keeps the app itself available offline.
// Your data is in IndexedDB, not here. Bump VERSION whenever you deploy changes.
//
// Updates: with signal, the app's own files (page, scripts, styles) are always fetched fresh,
// so a new version shows up the next time Jobflow is opened. With no signal, the saved copy is used.
// A new version of this file takes over right away instead of waiting for a button tap.
const VERSION = 'jobflow-v1.2.2';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/app.js', 'js/db.js', 'js/timecalc.js', 'vendor/jszip.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'fonts/ibm-plex-sans-latin-400-normal.woff2', 'fonts/ibm-plex-sans-latin-500-normal.woff2', 'fonts/ibm-plex-sans-latin-600-normal.woff2',
  'fonts/ibm-plex-sans-condensed-latin-600-normal.woff2', 'fonts/ibm-plex-sans-condensed-latin-700-normal.woff2',
  'fonts/ibm-plex-mono-latin-400-normal.woff2', 'fonts/ibm-plex-mono-latin-500-normal.woff2',
];
const NETWORK_WAIT_MS = 3500; // weak signal: fall back to the saved copy after this long

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

const isAppCode = url => url.pathname.endsWith('/') || /\.(html|js|css|webmanifest)$/.test(url.pathname) && !url.pathname.includes('/vendor/');

async function networkFirst(req, cacheKey) {
  const cache = await caches.open(VERSION);
  const fromNet = fetch(req, { cache: 'no-store' }).then(res => {
    if (res && res.ok) cache.put(cacheKey, res.clone());
    return res;
  });
  const saved = await cache.match(cacheKey, { ignoreSearch: true });
  if (!saved) return fromNet;
  const timeout = new Promise(r => setTimeout(() => r(null), NETWORK_WAIT_MS));
  try {
    const res = await Promise.race([fromNet, timeout]);
    return res && res.ok ? res : saved;
  } catch { return saved; }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(new Request('index.html'), 'index.html')); return; }
  if (isAppCode(url)) { e.respondWith(networkFirst(req, req)); return; }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
