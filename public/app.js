/* 壽司郎排隊追蹤器 — 前端邏輯 */
(() => {
  const REFRESH_MS = 30 * 1000;      // 分店列表更新
  const TRACK_MS = 15 * 1000;        // 追蹤中籌號更新
  const STALE_MS = 90 * 1000;        // 超過呢個秒數就當數據過期,要警告用戶

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
  const DEMO_STORES = [
    { id: 9001, name: '示範店 A(假數據)', address: '呢間店唔存在,淨係用嚟睇介面', area: '示範區', storeStatus: 'OPEN', wait: 42, latitude: 22.32, longitude: 114.17 },
    { id: 9002, name: '示範店 B(假數據)', address: '呢間店唔存在,淨係用嚟睇介面', area: '示範區', storeStatus: 'OPEN', wait: 18, latitude: 22.28, longitude: 114.18 },
    { id: 9003, name: '示範店 C(假數據)', address: '呢間店唔存在,淨係用嚟睇介面', area: '示範區', storeStatus: 'OPEN', wait: 7, latitude: 22.38, longitude: 114.19 },
    { id: 9004, name: '示範店 D(假數據)', address: '呢間店唔存在,淨係用嚟睇介面', area: '示範區', storeStatus: 'CLOSED', wait: 0, latitude: 22.37, longitude: 114.12 },
    { id: 9005, name: '示範店 E(假數據)', address: '呢間店唔存在,淨係用嚟睇介面', area: '示範區', storeStatus: 'OPEN', wait: 63, latitude: 22.30, longitude: 114.17 },
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
    if (!userPos || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) return null;
    return haversineKm(userPos.lat, userPos.lng, s.latitude, s.longitude);
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
  const CORS_PROXIES = [
    (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    (u) => `https://cors.freehi.workers.dev/?${u}`,
  ];
  let apiMode = null; // 'server' | 0 | 1 (proxy index)

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

  const SOURCE_NAMES = { server: '自家 proxy', 0: 'corsproxy.io', 1: 'freehi worker', direct: '官方直連' };

  async function fetchStoresAny() {
    const errs = [];
    const upstream = `${SUSHIPASS}/info/storelist?latitude=22.32&longitude=114.17&numresults=25&region=HK`;

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
        if (Array.isArray(data)) { apiMode = 'direct'; return { fetchedAt: Date.now(), stores: data }; }
      } catch (e) { errs.push(`直連: ${e.message}`); }
    }

    // 3. 公共 CORS proxy(GitHub Pages 等靜態 host)
    const order = typeof apiMode === 'number' ? [apiMode, ...CORS_PROXIES.keys()] : [...CORS_PROXIES.keys()];
    for (const i of [...new Set(order)]) {
      try {
        const data = await fetchJson(CORS_PROXIES[i](upstream));
        if (Array.isArray(data)) { apiMode = i; return { fetchedAt: Date.now(), stores: data }; }
        errs.push(`${SOURCE_NAMES[i]}: 回傳唔係分店列表`);
      } catch (e) { errs.push(`${SOURCE_NAMES[i]}: ${e.message}`); }
    }
    apiMode = null;
    throw new Error(errs.join(' / ') || '所有來源都連唔到');
  }

  /* ============ 分店列表 ============ */
  // 官方 API 冇回傳 wait(或者係 null / 字串)嗰陣,一定唔可以當 0 處理 —
  // 舊版 `undefined >= 30` 係 false,結果未知等候人數會渲染成綠色「好少人等」,誤導性極高。
  const waitOf = (s) => {
    const n = typeof s.wait === 'number' ? s.wait : parseInt(s.wait, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  function waitClass(store) {
    if (store.storeStatus !== 'OPEN') return 'wait-closed';
    const w = waitOf(store);
    if (w === null) return 'wait-unknown';
    if (w >= 30) return 'wait-high';
    if (w >= 10) return 'wait-mid';
    return 'wait-low';
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
      // 未知等候人數一律排最後,唔可以當 0 排喺最前扮「最少人」
      const wa = waitOf(a), wb = waitOf(b);
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
    // 只用真係有等候數字嘅分店嚟做統計,唔會將未知當 0 撈落總數
    const open = stores.filter(s => s.storeStatus === 'OPEN' && waitOf(s) !== null);
    if (!open.length) { $chips.innerHTML = ''; return; }
    const min = open.reduce((a, b) => (waitOf(a) <= waitOf(b) ? a : b));
    const total = open.reduce((n, s) => n + waitOf(s), 0);
    $chips.innerHTML = `
      <span>營業中 <b>${open.length}</b> 間</span>
      <span>最快:<b>${escapeHtml(min.name.replace(/^壽司郎\s*/, ''))}</b> 等 <b>${waitOf(min)}</b> 組</span>
      <span>全港合共 <b>${total}</b> 組等緊</span>`;
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
          <div class="num">${!isOpen ? '—' : (waitOf(store) === null ? '?' : waitOf(store))}</div>
          <div class="unit">${!isOpen ? '休息中' : (waitOf(store) === null ? '冇數據' : '組等候')}</div>
        </div>
        <div class="store-info">
          <div class="store-name">
            <span class="status-dot ${isOpen ? 'open' : 'closed'}"></span>
            <span>${escapeHtml(store.name)}</span>
          </div>
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
    if (queue === undefined) panel.innerHTML = `${mapLink}載入籌號中…`;
    else if (!queue || !queue.length) panel.innerHTML = `${mapLink}而家冇叫緊嘅籌號`;
    else panel.innerHTML = `${mapLink}叫緊嘅籌號:<div class="queue-numbers">${queue.map(n => `<span>${escapeHtml(n)}</span>`).join('')}</div>`;
    panel.querySelector('.map-link')?.addEventListener('click', (e) => e.stopPropagation());
    card.appendChild(panel);
  }

  async function toggleQueue(store) {
    if (expanded.has(store.id)) { expanded.delete(store.id); render(); return; }
    expanded.add(store.id);
    render();
    store._queue = await fetchQueue(store.id, store);
    render();
  }

  async function fetchQueue(storeId, store) {
    if (demoMode) {
      const base = demoAdvance(storeId);
      return store && waitOf(store) ? [base, base + 3, base + 7] : [];
    }
    try {
      let data;
      if (apiMode === 'server') {
        data = await fetchJson(new URL(`api/queue/${storeId}`, location.href));
      } else if (typeof apiMode === 'number') {
        data = await fetchJson(CORS_PROXIES[apiMode](`${SUSHIPASS}/remote/groupqueues?region=HK&storeid=${storeId}`));
      } else return null;
      return data.storeQueue || [];
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
    const src = SOURCE_NAMES[apiMode] || '';
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

  function startTracking(storeId, storeName, ticket, threshold) {
    tracking = {
      storeId, storeName, ticket, threshold,
      startCalled: null, startAt: null, lastCalled: null,
      lastPollAt: null, staleSince: null,
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

  function parseCalled(queue) {
    if (!queue || !queue.length) return null;
    const nums = queue.map(v => parseInt(String(v).replace(/\D/g, ''), 10)).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : null;
  }

  async function pollTracking() {
    if (!tracking) return;
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

    // demo 模式嘅數字係假嘅,唔可以攞嚟叫人出門
    const mayNotify = !demoMode;
    if (remaining <= 0 && !tracking.notifiedArrived) {
      tracking.notifiedArrived = true;
      if (mayNotify) notify('🍣 到你喇!', `${tracking.storeName} 已經叫到 ${called} 號,快啲去門口!`);
      document.title = '🔔 到你喇! — 壽司郎';
    } else if (remaining > 0 && remaining <= tracking.threshold && !tracking.notifiedNear) {
      tracking.notifiedNear = true;
      if (mayNotify) notify('🚶 好出發喇!', `${tracking.storeName} 仲差 ${remaining} 組就到你(你係 ${tracking.ticket} 號)`);
      document.title = `仲差 ${remaining} 組 — 壽司郎`;
    } else if (remaining > 0) {
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
    const remaining = lastCalled === null ? null : ticket - lastCalled;
    const arrived = remaining !== null && remaining <= 0;
    const near = !arrived && remaining !== null && remaining <= threshold;

    let progress = 0;
    if (arrived) progress = 1;
    else if (lastCalled !== null && startCalled !== null && ticket > startCalled) {
      progress = Math.max(0.04, Math.min(1, (lastCalled - startCalled) / (ticket - startCalled)));
    }

    let statusHtml;
    if (arrived) {
      statusHtml = `<div class="tracker-status big">🎉 到你喇!快啲去門口!</div>`;
    } else if (lastCalled === null) {
      statusHtml = `<div class="tracker-status">等緊第一次數據…</div>`;
    } else {
      const eta = etaMinutes();
      const stale = tracking.staleSince ? ' · <span class="stale-bad">數據未更新到</span>' : '';
      const tail = near ? ' · 好出發喇 🚶' : (eta !== null ? ` · 照而家速度約 ${eta} 分鐘` : '');
      statusHtml = `<div class="tracker-status">而家叫到 <b>${lastCalled}</b> · 仲差 <b>${remaining}</b> 組${tail}${stale}</div>`;
    }

    $island.className = 'tracker-island' + (arrived ? ' arrived' : near ? ' near' : '');
    $island.innerHTML = `
      <div class="tracker-top">
        <div class="tracker-num"><div class="label">你嘅籌號</div><div class="val">${escapeHtml(ticket)}</div></div>
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
    const open = stores.filter(s => s.storeStatus === 'OPEN');
    const pool = open.length ? open : stores;
    $('sheetStore').innerHTML = pool
      .map(s => `<option value="${s.id}" ${s.id === preselectId ? 'selected' : ''}>${escapeHtml(s.name)}(等緊 ${s.wait} 組)</option>`)
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
    const ticket = parseInt($('sheetTicket').value.replace(/\D/g, ''), 10);
    if (!store || !Number.isFinite(ticket)) {
      $('sheetTicket').focus();
      $('sheetTicket').placeholder = '請入返個號碼先~';
      return;
    }
    closeSheet();
    startTracking(store.id, store.name, ticket, parseInt($('sheetThreshold').value, 10));
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
  load().then(() => {
    if (tracking) {
      armTrackTimer();
      pollTracking();
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
