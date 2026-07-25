/* 壽司郎排隊追蹤器 — Service Worker
   靜態資源 cache-first(背景更新),API 請求永遠行網絡(排隊數據唔可以 stale)。 */
const CACHE = 'shshiwaiting-v5';
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

  // App shell(HTML / JS / CSS):network-first。
  // 用 cache-first 嘅話,修正咗嘅程式碼要開兩次網先生效 —— 對住一個
  // 「顯示錯數據」嘅 bug 修正,咁樣等於用戶會再中多一次。離線先用 cache。
  const isShell = e.request.mode === 'navigate' || /\.(html|js|css)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (isShell) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
    );
    return;
  }

  // 其他靜態資源(圖示等):cache-first + 背景更新
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
