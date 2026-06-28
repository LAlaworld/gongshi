const CACHE = 'gongshi-v1';
const FILES = [
  '/gongshi/',
  '/gongshi/index.html',
  '/gongshi/app.v6.js',
  '/gongshi/style.css',
  '/gongshi/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
