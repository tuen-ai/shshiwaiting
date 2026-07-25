/* 壽司郎排隊追蹤器 — 前端邏輯 */
(() => {
  // 參考站 sushiro-hk-tracker.gosa.app 用 wire:poll.10s(每 10 秒);我哋行 8 秒。
  const REFRESH_MS = 8 * 1000;       // 分店列表更新
  const TRACK_MS = 8 * 1000;         // 追蹤中籌號更新
  const STALE_MS = 60 * 1000;        // 超過呢個秒數就當數據過期,要警告用戶

  const $ = (id) => document.getElementById(id);
  const $list = $('storeList');
  const $chips = $('summaryChips');
  const $updatedAt = $('updatedAt');
  const $search = $('searchBox');
  const $area = $('areaFilter');
  const $sort = $('sortBy');
  const $refresh = $('refreshBtn');
  const $demoBadge = $('demoBadge');
  const $island = $('trackerIsland');
  const $backdrop = $('sheetBackdrop');

  let stores = [];
  // 示範數據淨係喺 URL 明確加咗 ?demo=1 先會開,絕對唔會因為 API 失敗而靜靜切過去。
  // 排隊數字係用嚟決定去唔去食飯嘅,寧願冇數據都好過俾個似層層嘅假數。
  const demoMode = new URLSearchParams(location.search).get('demo') === '1';
  let dataTime = null;      // 呢批數據實際由官方攞返嚟嘅時間
  let lastError = null;     // 最後一次失敗原因,顯示俾用戶睇
  let firstRender = true;
  const expanded = new Set();
  const bookmarks = new Set(JSON.parse(localStorage.getItem('sushiro-bookmarks') || '[]'));

  /* ============ 示範數據(淨係 ?demo=1 先用)============
     店名同地址一律用明顯係假嘅佔位符。之前呢度擺咗真實分店名同地址,
     但嗰啲地址同座標其實係憑記憶作出嚟、未經核實嘅 —— 用真實店名配作嘅資料,
     就算收喺 demo 模式後面都唔應該。示範數據就要一眼睇得出係示範。 */
  // 欄位結構跟足官方真實回應(wait=分鐘、waitingGroup=組數),但值全部係假
  const DEMO_STORES = [
    { id: 9001, name: '示範店 A(假數據)', address: '呢間店唔存在,淨係用嚟睇介面', area: '示範區', storeStatus: 'OPEN', wait: 45, waitingGroup: 56, latitude: 22.32, longitude: 114.17 },
    { id: 9002, name: '示範店 B(假數據)', address: '呢間店唔存在,淨係用嚟睇介面', area: '示範區', storeStatus: 'OPEN', wait: 20, waitingGroup: 22, latitude: 22.28, longitude: 114.18 },
    { id: 9003, name: '示範店 C(假數據)', address: '呢間店唔存在,淨係用嚟睇介面', area: '示範區', storeStatus: 'OPEN', wait: 5, waitingGroup: 3, latitude: 22.38, longitude: 114.19 },
    { id: 9004, name: '示範店 D(假數據)', address: '呢間店唔存在,淨係用嚟睇介面', area: '示範區', storeStatus: 'CLOSED', wait: 0, waitingGroup: 0, latitude: 22.37, longitude: 114.12 },
    { id: 9005, name: '示範店 E(假數據)', address: '呢間店唔存在,淨係用嚟睇介面', area: '示範區', storeStatus: 'OPEN', wait: 120, waitingGroup: 60, latitude: 22.30, longitude: 114.17 },
  ];

  /* ============ 附近 / 定位 ============ */
  let currentTab = 'all';
  let userPos = null;      // { lat, lng }
  let geoState = 'idle';   // idle | asking | ok | denied

  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function storeDistance(s) {
    // 有用戶 GPS 就自己計(官方 distance 係用我哋傳去嘅固定座標計,唔啱用戶位置)
    if (userPos && Number.isFinite(s.latitude) && Number.isFinite(s.longitude)) {
      return haversineKm(userPos.lat, userPos.lng, s.latitude, s.longitude);
    }
    return null;
  }

  function fmtDist(km) {
    return km < 1 ? `${Math.round(km * 1000)} 米` : `${km.toFixed(1)} km`;
  }

  function requestGeo() {
    if (!('geolocation' in navigator)) { geoState = 'denied'; render(); return; }
    geoState = 'asking';
    render();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        geoState = 'ok';
        render();
      },
      () => { geoState = 'denied'; render(); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ============ 數據來源 ============
     1. 同源 Node proxy (api/stores) — 自己 host 時用
     2. CORS proxy 直連 SushiPass — GitHub Pages 等靜態 host 時用
     揀到邊個用邊個,之後停留喺嗰個模式 */
  const SUSHIPASS = 'https://sushipass.sushiro.com.hk/api/2.0';
  // 2026-07-25 實測(GitHub runner):
  //   cors.freehi.workers.dev → HTTP 200,38200 bytes ✅
  //   corsproxy.io            → HTTP 403「Server-side requests are not allowed on your plan」
  //   api.allorigins.win      → HTTP 500
  // 所以行得通嗰個擺第一,唔好再浪費一個 round trip 喺實測失敗嘅來源。
  // 名同 URL 綁埋一齊,咁重新排序都唔會同標籤脫節
  // (之前 SOURCE_NAMES 用數字索引另外寫一次,調換次序之後就報錯來源)
  const CORS_PROXIES = [
    { name: 'freehi worker', url: (u) => `https://cors.freehi.workers.dev/?${u}` },
    { name: 'corsproxy.io', url: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  ];
  let apiMode = null; // 'server' | 'direct' | 0 | 1 (proxy index)

  // 6 秒就放棄轉下一個來源:要試 3 個來源,timeout 太長會令用戶對住空白畫面幾十秒
  async function fetchJson(url, timeoutMs = 6000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  const sourceName = (m) =>
    m === 'server' ? '自家 proxy' : m === 'direct' ? '官方直連'
      : (typeof m === 'number' && CORS_PROXIES[m]) ? CORS_PROXIES[m].name : '';

  async function fetchStoresAny() {
    const errs = [];
    // numresults 一定要夠大:實測全港有 44 間分店,用 25 會直情少咗 19 間
    const upstream = `${SUSHIPASS}/info/storelist?latitude=22.32&longitude=114.17&numresults=100&region=HK`;

    // 1. 同源 Node proxy(自己 host 時)
    if (apiMode === null || apiMode === 'server') {
      try {
        const r = await fetchJson(new URL('api/stores', location.href));
        if (r && Array.isArray(r.stores)) {
          apiMode = 'server';
          // server 會回傳佢實際 call 官方 API 嗰刻嘅時間,唔係我哋收到嘅時間
          return { fetchedAt: r.fetchedAt || r.updatedAt || Date.now(), stores: r.stores };
        }
        errs.push('proxy 回傳格式唔啱');
      } catch (e) { errs.push(`自家 proxy: ${e.message}`); }
    }

    // 2. 直接 call 官方(同源部署 / 官方有開 CORS 時會成功)
    if (apiMode === null || apiMode === 'direct') {
      try {
        const data = await fetchJson(upstream);
        if (Array.isArray(data) && data.length) { apiMode = 'direct'; return { fetchedAt: Date.now(), stores: data }; }
      } catch (e) { errs.push(`直連: ${e.message}`); }
    }

    // 3. 公共 CORS proxy(GitHub Pages 等靜態 host)
    const order = typeof apiMode === 'number' ? [apiMode, ...CORS_PROXIES.keys()] : [...CORS_PROXIES.keys()];
    for (const i of [...new Set(order)]) {
      try {
        const data = await fetchJson(CORS_PROXIES[i].url(upstream));
        // 空陣列都當失敗:上游維護時會回 200 + [],否則畫面會永遠停喺「載入緊…」
        // 而頂部同時話「啱啱更新」
        if (Array.isArray(data) && data.length) { apiMode = i; return { fetchedAt: Date.now(), stores: data }; }
        errs.push(`${CORS_PROXIES[i].name}: ${Array.isArray(data) ? '回傳咗 0 間分店' : '回傳唔係分店列表'}`);
      } catch (e) { errs.push(`${CORS_PROXIES[i].name}: ${e.message}`); }
    }
    apiMode = null;
    throw new Error(errs.join(' / ') || '所有來源都連唔到');
  }

  /* ============ 分店列表 ============
     官方欄位語意 —— 2026-07-25 由 GitHub runner 同時攞官方 API 同參考站
     sushiro-hk-tracker.gosa.app 渲染頁面,逐間店並排比對確認:

       waitingGroup = 等緊嘅「組」數  ← 參考站顯示嘅就係佢,標籤「X組人等緊」
       wait         = 預計等候「分鐘」數,全部係 5 嘅倍數(參考站唔顯示)

     14 間店比對結果(gosa 顯示 / 官方 wait / 官方 waitingGroup):
       旺角店 31組 / 30 / 31      旺角東Moko店 74組 / 60 / 74
       黃埔時尚坊店 16組 / 35 / 16   樂富店 7組 / 10 / 7
       上環店 39組 / 35 / 39       黃大仙店 14組 / 15 / 14
     全部同 waitingGroup 對得上,同 wait 對唔上。
     所以主要數字用 waitingGroup(組),wait(分鐘)做輔助資訊。 */
  const numOr = (v) => {
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const groupsOf = (s) => numOr(s.waitingGroup);
  const minutesOf = (s) => numOr(s.wait);

  // 用組數分級,同主要顯示嘅數字一致
  function waitClass(store) {
    if (store.storeStatus !== 'OPEN') return 'wait-closed';
    const g = groupsOf(store);
    if (g === null) return minutesOf(store) === null ? 'wait-unknown' : 'wait-mid';
    if (g >= 30) return 'wait-high';
    if (g >= 10) return 'wait-mid';
    return 'wait-low';
  }

  // 15 分鐘以上顯示「1 小時 30 分」咁,純分鐘數大過 60 好難即時理解
  function fmtWaitMin(m) {
    if (m === null) return null;
    if (m === 0) return '即刻有位';
    if (m < 60) return `${m} 分鐘`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} 小時 ${r} 分` : `${h} 小時`;
  }

  function visibleStores() {
    const q = $search.value.trim().toLowerCase();
    const area = $area.value;
    let out = stores.filter(s =>
      (!area || s.area === area) &&
      (!q || s.name.toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q))
    );
    if (currentTab === 'fav') out = out.filter(s => bookmarks.has(s.id));
    const mode = $sort.value;
    out.sort((a, b) => {
      if (currentTab !== 'near') {
        const bm = (bookmarks.has(b.id) ? 1 : 0) - (bookmarks.has(a.id) ? 1 : 0);
        if (bm) return bm;
      }
      const openDiff = (a.storeStatus === 'OPEN' ? 0 : 1) - (b.storeStatus === 'OPEN' ? 0 : 1);
      if (openDiff) return openDiff;
      if (currentTab === 'near') {
        const da = storeDistance(a), db = storeDistance(b);
        if (da !== null && db !== null && da !== db) return da - db;
      }
      if (mode === 'name') return a.name.localeCompare(b.name, 'zh-HK');
      // 用組數排,同顯示嘅主要數字一致;未知一律排最後,唔可以當 0 排喺最前扮「最少人」
      const wa = groupsOf(a), wb = groupsOf(b);
      if (wa === null || wb === null) return (wa === null ? 1 : 0) - (wb === null ? 1 : 0);
      return mode === 'wait-desc' ? wb - wa : wa - wb;
    });
    return out;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); observer.unobserve(e.target); }
    }
  }, { threshold: 0.05 });

  function renderSummary() {
    // 「營業中幾多間」要數晒所有 OPEN 店;統計數字先至只用有組數嗰啲。
    // 舊版用同一個 filter,冇 waitingGroup 嘅營業中分店會由間數度消失(少報),
    // 極端情況全部冇值就成行 chips 清空,用戶以為全港冇店開。
    const openStores = stores.filter(s => s.storeStatus === 'OPEN');
    if (!openStores.length) { $chips.innerHTML = ''; return; }
    const withGroups = openStores.filter(s => groupsOf(s) !== null);

    const chips = [`<span>營業中 <b>${openStores.length}</b> 間</span>`];
    if (withGroups.length) {
      const fastest = withGroups.reduce((a, b) => (groupsOf(a) <= groupsOf(b) ? a : b));
      const totalGroups = withGroups.reduce((n, s) => n + groupsOf(s), 0);
      chips.push(`<span>最快:<b>${escapeHtml(fastest.name)}</b> <b>${groupsOf(fastest)}</b> 組</span>`);
      chips.push(`<span>合共 <b>${totalGroups}</b> 組等緊</span>`);
      if (withGroups.length < openStores.length) {
        chips.push(`<span>另有 <b>${openStores.length - withGroups.length}</b> 間冇等候數據</span>`);
      }
    }
    $chips.innerHTML = chips.join('');
  }

  function render() {
    renderSummary();
    renderFreshness();
    $list.innerHTML = '';

    // 完全冇數據:誠實顯示連唔到,絕對唔會攞假數字充數
    if (!stores.length) {
      const box = document.createElement('div');
      box.className = 'geo-card';
      box.innerHTML = lastError
        ? `⚠️ 而家攞唔到實時排隊數據。<br><span class="err-detail">${escapeHtml(lastError)}</span><br>
           官方 API 可能封鎖咗香港以外嘅網絡,或者暫時故障。<br>
           <button class="cta"><span>再試一次</span></button>`
        : '載入緊…';
      box.querySelector('.cta')?.addEventListener('click', () => load(true));
      $list.appendChild(box);
      return;
    }

    // 附近 tab:未有定位權限時顯示提示
    if (currentTab === 'near' && geoState !== 'ok') {
      const box = document.createElement('div');
      box.className = 'geo-card';
      if (geoState === 'asking') {
        box.innerHTML = '📡 攞緊你嘅位置…';
      } else if (geoState === 'denied') {
        box.innerHTML = '你封鎖咗定位權限。<br>去瀏覽器設定開返先可以睇附近分店。';
      } else {
        box.innerHTML = `想搵最近你嘅壽司郎?<br>需要攞一次你嘅位置(唔會儲存或者上傳)。
          <button class="cta"><span>開啟定位</span></button>`;
        box.querySelector('.cta').addEventListener('click', requestGeo);
      }
      $list.appendChild(box);
      return;
    }

    const list = visibleStores();
    if (!list.length) {
      $list.innerHTML = currentTab === 'fav'
        ? '<p class="empty-msg">未有喜愛店舖。<br>撳分店卡嘅 ♥ 加入,以後喺度一眼睇晒。</p>'
        : '<p class="empty-msg">冇符合嘅分店</p>';
      return;
    }
    list.forEach((store, i) => {
      const isOpen = store.storeStatus === 'OPEN';
      const shell = document.createElement('div');
      shell.className = 'store-shell';
      shell.style.transitionDelay = firstRender ? `${Math.min(i * 60, 480)}ms` : '0ms';

      const card = document.createElement('div');
      card.className = 'store-card' + (expanded.has(store.id) ? ' expanded' : '');
      card.innerHTML = `
        <div class="wait-badge ${waitClass(store)}">
          <div class="num">${badgeNum(store, isOpen)}</div>
          <div class="unit">${badgeUnit(store, isOpen)}</div>
        </div>
        <div class="store-info">
          <div class="store-name">
            <span class="status-dot ${isOpen ? 'open' : 'closed'}"></span>
            <span>${escapeHtml(store.name)}</span>
          </div>
          <div class="store-sub">${subLine(store, isOpen)}</div>
          <div class="store-addr">${distLabel(store)}${escapeHtml(store.address || '')}</div>
        </div>
        <div class="card-actions">
          <button class="mini-btn track">追蹤籌號</button>
          <button class="mini-btn bookmark ${bookmarks.has(store.id) ? 'active' : ''}">${bookmarks.has(store.id) ? '♥ 喜愛' : '♡ 喜愛'}</button>
        </div>`;

      card.querySelector('.bookmark').addEventListener('click', (e) => {
        e.stopPropagation();
        bookmarks.has(store.id) ? bookmarks.delete(store.id) : bookmarks.add(store.id);
        localStorage.setItem('sushiro-bookmarks', JSON.stringify([...bookmarks]));
        render();
      });
      card.querySelector('.track').addEventListener('click', (e) => {
        e.stopPropagation();
        openSheet(store.id);
      });
      card.addEventListener('click', () => toggleQueue(store));

      if (expanded.has(store.id)) attachQueuePanel(card, store, store._queue);
      shell.appendChild(card);
      $list.appendChild(shell);

      if (firstRender) observer.observe(shell);
      else shell.classList.add('in');
    });
    firstRender = false;
  }

  // 徽章大字用「組」數(waitingGroup),同參考站 gosa.app 一致;
  // 官方預計等候時間(wait,分鐘)放副行做輔助。兩個都係 API 真實數值,各自標明單位。
  function badgeNum(store, isOpen) {
    if (!isOpen) return '—';
    const g = groupsOf(store);
    if (g !== null) return g;
    const m = minutesOf(store);
    return m === null ? '?' : fmtWaitMin(m);
  }
  function badgeUnit(store, isOpen) {
    if (!isOpen) return '休息中';
    const g = groupsOf(store);
    if (g === null) return minutesOf(store) === null ? '冇數據' : '預計等候';
    return g === 0 ? '即刻有位' : '組人等緊';
  }
  function subLine(store, isOpen) {
    if (!isOpen) return '';
    const m = minutesOf(store);
    if (m === null) return '';
    return m === 0 ? '官方:即刻有位' : `官方預計等候 <b>${escapeHtml(fmtWaitMin(m))}</b>`;
  }

  function distLabel(store) {
    const d = storeDistance(store);
    return d === null ? '' : `<span class="dist">${fmtDist(d)}</span> · `;
  }

  function attachQueuePanel(card, store, queue) {
    const panel = document.createElement('div');
    panel.className = 'queue-panel';
    const mapLink = Number.isFinite(store.latitude)
      ? `<a class="map-link" href="https://www.google.com/maps/search/?api=1&query=${store.latitude},${store.longitude}" target="_blank" rel="noopener">地圖 ↗</a>`
      : '';
    // 三種狀態要分清楚:未載入 / 攞唔到 / 真係冇人排。
    // 舊版將「fetch 失敗(null)」同「空隊列」一齊顯示成「而家冇叫緊嘅籌號」,
    // 等於用一個網絡錯誤扮咗「零人排隊」。
    if (queue === undefined) panel.innerHTML = `${mapLink}載入籌號中…`;
    else if (queue === null) panel.innerHTML = `${mapLink}<span class="stale-bad">⚠️ 攞唔到籌號數據</span>`;
    else if (!queue.length) panel.innerHTML = `${mapLink}而家冇叫緊嘅籌號`;
    else panel.innerHTML = `${mapLink}叫緊嘅籌號:<div class="queue-numbers">${queue.map(n => `<span>${escapeHtml(n)}</span>`).join('')}</div>`;
    panel.querySelector('.map-link')?.addEventListener('click', (e) => e.stopPropagation());
    card.appendChild(panel);
  }

  async function toggleQueue(store) {
    if (expanded.has(store.id)) { expanded.delete(store.id); render(); return; }
    expanded.add(store.id);
    render();
    try {
      store._queue = await fetchQueue(store.id, store);
    } catch {
      store._queue = null;   // 任何錯誤都要退到「攞唔到」,唔好卡死喺 loading
    }
    render();
  }

  /**
   * 攞一間店而家叫緊嘅籌號。
   * 回傳:陣列 = 成功(可以係空陣列,代表真係冇人排)
   *       null = 攞唔到(網絡失敗 / 冇可用來源)—— 呢個唔可以當「冇人排」
   *
   * 實測回應有多條隊:storeQueue / storeBoothQueue / storeCounterQueue /
   * reservationQueue,加上 separateQueue 旗標。
   * separateQueue=0(實測樣本全部係 0)時 storeQueue 已經包含晒;
   * 非 0 就代表卡座同櫃檯分開計號,storeQueue 可能係空,要合併返嗰兩條。
   * reservationQueue 係另一個系列(實測見過 "8120"),唔可以撈埋落現場籌。
   */
  function pickQueue(data) {
    if (!data || typeof data !== 'object') return null;
    const arr = (v) => (Array.isArray(v) ? v : []);
    if (data.separateQueue) {
      const merged = [...arr(data.storeBoothQueue), ...arr(data.storeCounterQueue)];
      if (merged.length) return merged;
    }
    if (arr(data.storeQueue).length) return data.storeQueue;
    // storeQueue 空:再睇分隊有冇嘢,兩邊都空先當真係冇人排
    const fallback = [...arr(data.storeBoothQueue), ...arr(data.storeCounterQueue)];
    return fallback.length ? fallback : [];
  }

  async function fetchQueue(storeId, store) {
    if (demoMode) {
      const base = demoAdvance(storeId);
      return store && groupsOf(store) ? [base, base + 3, base + 7] : [];
    }
    const path = `${SUSHIPASS}/remote/groupqueues?region=HK&storeid=${storeId}`;
    try {
      let data;
      if (apiMode === 'server') {
        data = await fetchJson(new URL(`api/queue/${storeId}`, location.href));
      } else if (apiMode === 'direct') {
        // 舊版漏咗呢個分支,直連模式下籌號永遠 return null —— 分店列表睇落正常,
        // 但追蹤永遠停喺「等緊第一次數據…」,用戶以為 app 會提佢
        data = await fetchJson(path);
      } else if (typeof apiMode === 'number') {
        data = await fetchJson(CORS_PROXIES[apiMode].url(path));
      } else {
        return null;
      }
      return pickQueue(data);
    } catch { return null; }
  }

  function populateAreaFilter() {
    const areas = [...new Set(stores.map(s => s.area).filter(Boolean))].sort();
    const current = $area.value;
    $area.innerHTML = '<option value="">全部地區</option>' +
      areas.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    $area.value = current;
  }

  // 顯示數據有幾新鮮 — 每秒跳一次,過期就變色警告。
  // 舊版寫死「更新於 14:32」永遠唔郁,10 分鐘前嘅數據睇落同啱啱攞嘅一模一樣。
  function renderFreshness() {
    if (demoMode) {
      $updatedAt.textContent = '⚠️ 示範數據 · 全部數字都係假,唔好信';
      $updatedAt.className = 'updated stale-bad';
      return;
    }
    if (dataTime === null) {
      $updatedAt.textContent = lastError ? '⚠️ 攞唔到實時數據' : '載入中…';
      $updatedAt.className = 'updated' + (lastError ? ' stale-bad' : '');
      return;
    }
    const age = Math.round((Date.now() - dataTime) / 1000);
    const txt = age < 5 ? '啱啱更新' : age < 60 ? `${age} 秒前` : `${Math.floor(age / 60)} 分鐘前`;
    const src = sourceName(apiMode);
    $updatedAt.textContent = `${txt}${src ? ' · ' + src : ''}${lastError ? ' · 更新失敗中' : ''}`;
    $updatedAt.className = 'updated' +
      (age * 1000 > STALE_MS * 3 ? ' stale-bad' : age * 1000 > STALE_MS ? ' stale-warn' : '');
  }

  async function load(manual = false) {
    if (manual) $refresh.classList.add('spinning');
    if (demoMode) {
      stores = DEMO_STORES.map(s => ({ ...s }));
      dataTime = Date.now();
      $demoBadge.classList.remove('hidden');
      populateAreaFilter(); render();
      $refresh.classList.remove('spinning');
      return;
    }
    try {
      const payload = await fetchStoresAny();
      stores = (payload.stores || []).map(s => ({ ...s, _queue: undefined }));
      dataTime = payload.fetchedAt;
      lastError = null;
    } catch (err) {
      // 攞唔到就保留舊數據但標明過期,絕對唔會用假數據頂上
      lastError = err.message;
    }
    populateAreaFilter();
    render();
    $refresh.classList.remove('spinning');
  }

  /* ============ 我的籌號追蹤 ============ */
  let tracking = JSON.parse(localStorage.getItem('sushiro-tracking') || 'null');
  let trackTimer = null;
  let audioCtx = null;

  // 示範模式:每間店一個會慢慢行前嘅「而家叫到」號碼。
  // 呢啲數字係假嘅,所以喺 demo 模式下唔會發出任何「到你喇」提醒 —
  // 用假數據叫人出門口係最壞嘅 bug。
  const demoCalled = new Map();
  function demoAdvance(storeId) {
    if (!demoCalled.has(storeId)) {
      demoCalled.set(storeId, tracking && tracking.storeId === storeId ? tracking.ticket - 12 : 100);
    }
    const next = demoCalled.get(storeId) + 1 + Math.floor(Math.random() * 2);
    demoCalled.set(storeId, next);
    return next;
  }

  function saveTracking() {
    if (tracking) localStorage.setItem('sushiro-tracking', JSON.stringify(tracking));
    else localStorage.removeItem('sushiro-tracking');
  }

  function chime(times = 2) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < times; i++) {
        const t = audioCtx.currentTime + i * 0.35;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.exponentialRampToValueAtTime(1320, t + 0.12);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.32);
      }
    } catch { /* 冇聲都唔緊要 */ }
  }

  function notify(title, body) {
    chime(title.includes('到你') ? 3 : 2);
    if (navigator.vibrate) navigator.vibrate([200, 90, 200, 90, 300]);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, icon: undefined, tag: 'sushiro-tracker' }); } catch { /* ignore */ }
    }
  }

  function stopTracking() {
    tracking = null;
    saveTracking();
    clearInterval(trackTimer);
    trackTimer = null;
    document.title = '壽司郎排隊追蹤器 🍣';
    renderIsland();
  }

  // 服務日:以凌晨 4 點做分界(通宵營業嘅店,凌晨 2 點仍然算前一日)。
  // 籌號每日重置,所以隔咗一個服務日嘅追蹤記錄唔可以照計 —— 舊籌會喺第二日
  // 俾人「重新叫到」而發出假提醒,叫人白行。
  function serviceDay(ts = Date.now()) {
    const d = new Date(ts);
    d.setHours(d.getHours() - 4);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function startTracking(storeId, storeName, ticket, threshold, ticketLabel) {
    tracking = {
      storeId, storeName, ticket, threshold,
      ticketLabel: ticketLabel || String(ticket),  // 用戶原本打嗰個字串(可以係 "069-2")
      day: serviceDay(),
      startCalled: null, startAt: null, lastCalled: null,
      lastPollAt: null, staleSince: null, closedSince: null,
      notifiedNear: false, notifiedArrived: false,
    };
    saveTracking();
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    armTrackTimer();
    pollTracking();
    renderIsland();
  }

  function armTrackTimer() {
    clearInterval(trackTimer);
    trackTimer = setInterval(pollTracking, TRACK_MS);
  }

  // 實測籌號係零填充字串,而且會有 "069-1" / "069-2" 咁嘅細分後綴
  // (旺角東Moko店真實回應:["069-1","069-2","070"])。
  // 舊版 replace(/\D/g,'') 會將 "069-1" 變成 691,然後即刻誤報「到你喇」。
  // 正確做法:淨係取第一個 dash 前面嗰段。
  function parseTicket(v) {
    const head = String(v).trim().split(/[-–—/]/)[0];
    const digits = head.replace(/\D/g, '');
    if (!digits) return null;
    const n = parseInt(digits, 10);
    return Number.isFinite(n) ? n : null;
  }

  function parseCalled(queue) {
    if (!queue || !queue.length) return null;
    const nums = queue.map(parseTicket).filter((n) => n !== null);
    return nums.length ? Math.max(...nums) : null;
  }

  async function pollTracking() {
    if (!tracking) return;

    // 過咗服務日:籌號已經重置,舊籌唔可以再計。停低等用戶自己決定,
    // 唔好靜靜繼續 poll 然後喺第二日「重新叫到」而發假提醒。
    if (tracking.day && tracking.day !== serviceDay()) {
      tracking.expired = true;
      clearInterval(trackTimer); trackTimer = null;
      document.title = '壽司郎排隊追蹤器 🍣';
      saveTracking(); renderIsland();
      return;
    }

    // 間舖收咗工 / 唔喺營業狀態:籌已經冇意義,唔好再倒數或者發提醒
    const live = stores.find((s) => s.id === tracking.storeId);
    if (live && live.storeStatus !== 'OPEN') {
      tracking.closedSince = tracking.closedSince || Date.now();
      saveTracking(); renderIsland();
      return;
    }
    tracking.closedSince = null;

    const called = demoMode
      ? demoAdvance(tracking.storeId)
      : parseCalled(await fetchQueue(tracking.storeId));

    if (called === null) {
      // 攞唔到就記低,島上會顯示「數據唔新鮮」而唔係扮住繼續倒數
      tracking.staleSince = tracking.staleSince || Date.now();
      saveTracking(); renderIsland();
      return;
    }
    tracking.staleSince = null;
    tracking.lastCalled = called;
    tracking.lastPollAt = Date.now();
    if (tracking.startCalled === null) {
      tracking.startCalled = Math.min(called, tracking.ticket);
      tracking.startAt = Date.now();
    }
    const remaining = tracking.ticket - called;

    // demo 模式嘅數字係假嘅,唔可以攞嚟叫人出門 —— 連分頁標題都唔可以扮到咗,
    // 用戶切咗去第二個 tab 就淨係見到標題,見到「到你喇」一樣會出門
    const mayNotify = !demoMode;
    if (demoMode) {
      document.title = '示範模式 — 壽司郎';
    }
    if (remaining <= 0 && !tracking.notifiedArrived) {
      tracking.notifiedArrived = true;
      if (mayNotify) {
        notify('🍣 到你喇!', `${tracking.storeName} 已經叫到 ${called} 號,快啲去門口!`);
        document.title = '🔔 到你喇! — 壽司郎';
      }
    } else if (remaining > 0 && remaining <= tracking.threshold && !tracking.notifiedNear) {
      tracking.notifiedNear = true;
      if (mayNotify) {
        notify('🚶 好出發喇!', `${tracking.storeName} 仲差 ${remaining} 組就到你(你係 ${tracking.ticketLabel || tracking.ticket} 號)`);
        document.title = `仲差 ${remaining} 組 — 壽司郎`;
      }
    } else if (remaining > 0 && mayNotify) {
      document.title = `仲差 ${remaining} 組 — 壽司郎`;
    }
    saveTracking();
    renderIsland();
  }

  // 實測嘅叫號速度:由開始追蹤到而家,平均每組要幾耐。
  // 舊版寫死「每組 3 分鐘」係我憑空作出嚟嘅,冇任何根據。
  function etaMinutes() {
    const { startCalled, startAt, lastCalled } = tracking;
    if (startAt == null || startCalled == null || lastCalled == null) return null;
    const advanced = lastCalled - startCalled;
    const elapsedMin = (Date.now() - startAt) / 60000;
    if (advanced < 3 || elapsedMin < 2) return null;   // 樣本太少,唔亂估
    const perGroup = elapsedMin / advanced;
    const remaining = tracking.ticket - lastCalled;
    return Math.max(1, Math.round(perGroup * remaining));
  }

  function renderIsland() {
    if (!tracking) {
      $island.classList.add('hidden');
      return;
    }
    const { ticket, storeName, lastCalled, startCalled, threshold } = tracking;
    const expired = !!tracking.expired;
    const closed = !expired && !!tracking.closedSince;
    const remaining = lastCalled === null ? null : ticket - lastCalled;
    const arrived = !expired && !closed && remaining !== null && remaining <= 0;
    const near = !arrived && !expired && !closed && remaining !== null && remaining <= threshold;

    let progress = 0;
    if (arrived) progress = 1;
    else if (lastCalled !== null && startCalled !== null && ticket > startCalled) {
      progress = Math.max(0.04, Math.min(1, (lastCalled - startCalled) / (ticket - startCalled)));
    }

    const demoTag = demoMode ? '【示範】' : '';
    let statusHtml;
    if (expired) {
      statusHtml = `<div class="tracker-status"><span class="stale-bad">呢個籌係之前一日嘅,籌號已經重置</span> · 撳 ✕ 重新開始</div>`;
    } else if (closed) {
      statusHtml = `<div class="tracker-status"><span class="stale-bad">⚠️ ${escapeHtml(storeName)}而家唔喺營業狀態</span> · 呢個籌可能已經失效</div>`;
    } else if (arrived) {
      statusHtml = `<div class="tracker-status big">${demoTag}🎉 到你喇!快啲去門口!</div>`;
    } else if (lastCalled === null) {
      statusHtml = `<div class="tracker-status">${demoTag}等緊第一次數據…</div>`;
    } else {
      const eta = etaMinutes();
      const stale = tracking.staleSince ? ' · <span class="stale-bad">數據未更新到</span>' : '';
      const tail = near ? ' · 好出發喇 🚶' : (eta !== null ? ` · 照而家速度約 ${eta} 分鐘` : '');
      statusHtml = `<div class="tracker-status">${demoTag}而家叫到 <b>${lastCalled}</b> · 仲差 <b>${remaining}</b> 組${tail}${stale}</div>`;
    }

    // demo 模式唔可以用「到咗」嘅綠色高亮,假數據唔應該睇落好似真提醒
    $island.className = 'tracker-island' +
      (demoMode || expired || closed ? '' : (arrived ? ' arrived' : near ? ' near' : ''));
    $island.innerHTML = `
      <div class="tracker-top">
        <div class="tracker-num"><div class="label">你嘅籌號</div><div class="val">${escapeHtml(tracking.ticketLabel || ticket)}</div></div>
        <div class="tracker-mid">
          <div class="tracker-store">${escapeHtml(storeName)}</div>
          ${statusHtml}
        </div>
        <button class="tracker-close" title="停止追蹤" aria-label="停止追蹤">✕</button>
      </div>
      <div class="progress-track"><div class="progress-fill" style="transform: scaleX(${progress})"></div></div>`;
    $island.querySelector('.tracker-close').addEventListener('click', stopTracking);
  }

  /* ============ Bottom sheet ============ */
  function openSheet(preselectId) {
    // 用戶撳邊間就一定要包含嗰間,唔可以靜靜跌返第一間 OPEN 店 ——
    // 否則佢會以為追緊 A 店,實際個 app 對住 B 店倒數,兩邊都錯
    const open = stores.filter(s => s.storeStatus === 'OPEN');
    const pool = open.length ? open.slice() : stores.slice();
    const preselect = stores.find(s => s.id === preselectId);
    if (preselect && !pool.some(s => s.id === preselectId)) pool.unshift(preselect);

    $('sheetStore').innerHTML = pool
      .map(s => {
        // 舊版寫 `等緊 ${s.wait} 組` —— s.wait 係分鐘,標籤寫「組」,
        // 同卡片顯示嘅 waitingGroup 自相矛盾(康城店會寫「等緊 210 組」而實際 106 組)
        const g = groupsOf(s);
        const label = g === null ? '未知' : `等緊 ${g} 組`;
        const closed = s.storeStatus === 'OPEN' ? '' : ' · 非營業中';
        return `<option value="${s.id}" ${s.id === preselectId ? 'selected' : ''}>${escapeHtml(s.name)}(${label}${closed})</option>`;
      })
      .join('');
    $('sheetTicket').value = '';
    $backdrop.classList.remove('hidden');
    setTimeout(() => $('sheetTicket').focus(), 350);
  }
  function closeSheet() { $backdrop.classList.add('hidden'); }

  $('sheetCancel').addEventListener('click', closeSheet);
  $backdrop.addEventListener('click', (e) => { if (e.target === $backdrop) closeSheet(); });
  $('sheetStart').addEventListener('click', () => {
    const storeId = parseInt($('sheetStore').value, 10);
    const store = stores.find(s => s.id === storeId);
    // 輸入端一定要用同隊列一樣嘅 parser。舊版用 replace(/\D/g,''),
    // 「069-2」會變成 692,而隊列叫到 070 —— 差 622 組,提醒永遠唔會響。
    const raw = $('sheetTicket').value.trim();
    const ticket = parseTicket(raw);
    if (!store || ticket === null) {
      $('sheetTicket').focus();
      $('sheetTicket').placeholder = '請入返個號碼先~';
      return;
    }
    closeSheet();
    startTracking(store.id, store.name, ticket, parseInt($('sheetThreshold').value, 10), raw);
  });

  /* ============ 主題切換 ============ */
  const $themeBtn = $('themeBtn');
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('themeIconMoon').classList.toggle('hidden', theme === 'light');
    $('themeIconSun').classList.toggle('hidden', theme !== 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'light' ? '#f6f1e7' : '#0a0908';
  }
  const savedTheme = localStorage.getItem('sushiro-theme');
  applyTheme(savedTheme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  $themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('sushiro-theme', next);
    applyTheme(next);
  });

  /* ============ PWA ============ */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 註冊唔到照行 */ });
  }

  /* ============ Tabs ============ */
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
      if (currentTab === 'near' && geoState === 'idle') requestGeo();
      else render();
    });
  });

  /* ============ 事件 ============ */
  $search.addEventListener('input', render);
  $area.addEventListener('change', render);
  $sort.addEventListener('change', render);
  $refresh.addEventListener('click', () => load(true));

  /* ============ 啟動 ============ */
  render();   // 即刻畫「載入中」,唔好對住一片空白

  // 由 localStorage 讀返嚟嘅追蹤記錄,如果唔係今日嘅服務日就直接標記過期,
  // 唔好 arm timer —— 籌號每日重置,舊籌會俾人「重新叫到」而發假提醒
  if (tracking && tracking.day && tracking.day !== serviceDay()) {
    tracking.expired = true;
    saveTracking();
  }
  load().then(() => {
    if (tracking) {
      if (!tracking.expired) { armTrackTimer(); pollTracking(); }
      renderIsland();
    }
  });

  let refreshTimer = setInterval(load, REFRESH_MS);

  // 手機熄屏 / 切去第二個 app 嗰陣,瀏覽器會大幅 throttle 甚至凍結 setInterval,
  // 所以一返到嚟就即刻補做一次 + 重新 arm 計時器。冇呢個嘅話你打開手機
  // 見到嘅係幾分鐘前嘅舊數字,而「到你喇」嘅提醒亦會遲到。
  function resume() {
    if (document.visibilityState !== 'visible') return;
    clearInterval(refreshTimer);
    refreshTimer = setInterval(load, REFRESH_MS);
    load();
    if (tracking) { armTrackTimer(); pollTracking(); }
  }
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);

  // 每秒更新「幾秒前」,令過期數據一眼睇得出
  setInterval(() => { renderFreshness(); if (tracking) renderIsland(); }, 1000);
})();
