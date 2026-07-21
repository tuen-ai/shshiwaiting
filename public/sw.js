/* 壽司郎排隊追蹤器 — Service Worker
   靜態資源 cache-first(背景更新),API 請求永遠行網絡(排隊數據唔可以 stale)。 */
const CACHE = 'shshiwaiting-v1';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // 排隊數據 / CORS proxy / 字型:唔好 cache,直接行網絡
  const isLive = url.pathname.includes('/api/') ||
    url.hostname.includes('sushiro') ||
    url.hostname.includes('corsproxy') ||
    url.hostname.includes('workers.dev');
  if (isLive || url.origin !== location.origin) return;

  // 靜態資源:cache-first + 背景更新 (stale-while-revalidate)
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || fresh;
    })
  );
});
