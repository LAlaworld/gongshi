// 每次更新代码后改这里，缓存名和预缓存列表会自动更新
const VERSION = '7';
const CACHE = 'gongshi-v' + VERSION;
const PRECACHE = [
  '/gongshi/',
  '/gongshi/index.html',
  '/gongshi/app.v' + VERSION + '.js',
  '/gongshi/style.css',
  '/gongshi/manifest.json'
];

// 需要 cache-first 的静态资源（图标、天气图标等不常变的文件）
const STATIC_PATTERN = /\.(png|jpg|jpeg|svg|ico|woff2?)$/;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 静态资源：cache-first（图标/字体等不常变）
  if (STATIC_PATTERN.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // HTML / JS / CSS：network-first + cache fallback
  // 在线时总拿最新版本，离线时回退到缓存
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
