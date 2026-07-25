/**
 * 壽司郎排隊追蹤器 — 後端 proxy server
 *
 * 瀏覽器因為 CORS 限制唔可以直接 call Sushiro (SushiPass) API,
 * 所以由呢個 server 代為請求,並加上短時間 cache,減少對官方 API 嘅壓力。
 *
 * 用法: node server.js   (預設 http://localhost:3000)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SUSHIPASS = 'https://sushipass.sushiro.com.hk/api/2.0';
// 排隊人數變化好快,cache 太耐就唔算實時。15 秒係「唔轟炸官方 API」同
// 「數字夠新鮮」之間嘅平衡:前端每 30 秒 refresh,最多滯後約 45 秒。
const CACHE_TTL_MS = 15 * 1000;

const cache = new Map(); // url -> { time, data }

async function fetchWithCache(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < CACHE_TTL_MS) {
    return { data: hit.data, cached: true };
  }
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; sushiro-tracker)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const data = await res.json();
  cache.set(url, { time: Date.now(), data });
  return { data, cached: false };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(__dirname, 'public', path.normalize(rel));
  if (!file.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    // GET /api/stores — 全港分店 + 等候組數
    // fetchedAt 係實際由官方 API 攞返嚟嗰刻,唔係而家回應嘅時間 —
    // 咁前端先可以誠實顯示「呢個數字有幾舊」。
    if (url.pathname === '/api/stores') {
      const upstream = `${SUSHIPASS}/info/storelist?latitude=22.32&longitude=114.17&numresults=25&region=HK`;
      const { data, cached } = await fetchWithCache(upstream);
      return sendJson(res, 200, { fetchedAt: cache.get(upstream).time, cached, stores: data });
    }

    // GET /api/queue/:storeid — 單一分店叫緊嘅籌號
    const queueMatch = url.pathname.match(/^\/api\/queue\/(\d+)$/);
    if (queueMatch) {
      const upstream = `${SUSHIPASS}/remote/groupqueues?region=HK&storeid=${queueMatch[1]}`;
      const { data, cached } = await fetchWithCache(upstream);
      return sendJson(res, 200, { fetchedAt: cache.get(upstream).time, cached, ...data });
    }

    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'unknown endpoint' });
    }

    return serveStatic(res, url.pathname);
  } catch (err) {
    return sendJson(res, 502, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`壽司郎排隊追蹤器: http://localhost:${PORT}`);
});
