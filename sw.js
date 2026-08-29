const CACHE = 'morsethai-v8';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/morse-data.js',
  './js/text-data.js',
  './js/audio.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).catch(function (err) {
      console.warn('[SW] addAll failed', err);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  // navigation fallback: offline -> index.html
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(function () { return caches.match('./index.html'); })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).catch(function () { return cached; });
    })
  );
});
