// 每次推送更新此版本号，浏览器会检测到 sw.js 变化并自动更新
// 格式：年月日+3位序号（YYYYMMDDNNN），如 20260701001、20260701002
const SW_VERSION = '20260727003';

// SW 缓存名由版本号派生：bump 版本即换新缓存，activate 时自动清理旧缓存
// （不要在这里用 Date.now()：SW 被系统杀死再唤醒时 install 不会重跑，CACHE 会变成空字符串）
const CACHE = 'gongshi-' + SW_VERSION;

const PRECACHE = [
  '/gongshi/',
  '/gongshi/index.html',
  '/gongshi/app.js',
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

// 响应版本号请求
self.addEventListener('message', e => {
  if (e.data === 'GET_VERSION') {
    e.source.postMessage({ type: 'VERSION', version: SW_VERSION });
  }
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
