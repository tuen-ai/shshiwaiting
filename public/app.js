/* 壽司郎排隊追蹤器 — 前端邏輯 */
(() => {
  const REFRESH_MS = 60 * 1000;      // 分店列表更新
  const TRACK_MS = 20 * 1000;        // 追蹤中籌號更新
  const TRACK_MS_DEMO = 6 * 1000;    // 示範模式行快啲,方便試提醒

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
  let demoMode = false;
  let firstRender = true;
  const expanded = new Set();
  const bookmarks = new Set(JSON.parse(localStorage.getItem('sushiro-bookmarks') || '[]'));

  /* ============ 示範數據(官方 API 唔通時用) ============ */
  const DEMO_STORES = [
    { id: 1001, name: '壽司郎 旺角店', address: '旺角彌敦道 610 號荷李活商業中心', area: '九龍', storeStatus: 'OPEN', wait: 42 },
    { id: 1002, name: '壽司郎 銅鑼灣店', address: '銅鑼灣軒尼詩道 489 號銅鑼灣廣場一期', area: '香港島', storeStatus: 'OPEN', wait: 18 },
    { id: 1003, name: '壽司郎 沙田店', address: '沙田新城市廣場一期', area: '新界', storeStatus: 'OPEN', wait: 7 },
    { id: 1004, name: '壽司郎 荃灣店', address: '荃灣愉景新城', area: '新界', storeStatus: 'CLOSED', wait: 0 },
    { id: 1005, name: '壽司郎 尖沙咀店', address: '尖沙咀彌敦道 132 號美麗華廣場', area: '九龍', storeStatus: 'OPEN', wait: 63 },
  ];

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

  async function fetchJson(url, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  async function fetchStoresAny() {
    if (apiMode === null || apiMode === 'server') {
      try {
        const r = await fetchJson(new URL('api/stores', location.href));
        if (r && Array.isArray(r.stores)) { apiMode = 'server'; return r; }
      } catch { /* 落一個來源 */ }
    }
    const upstream = `${SUSHIPASS}/info/storelist?latitude=22.32&longitude=114.17&numresults=100&region=HK`;
    const order = typeof apiMode === 'number' ? [apiMode, ...CORS_PROXIES.keys()] : [...CORS_PROXIES.keys()];
    for (const i of [...new Set(order)]) {
      try {
        const data = await fetchJson(CORS_PROXIES[i](upstream));
        if (Array.isArray(data)) { apiMode = i; return { updatedAt: Date.now(), stores: data }; }
      } catch { /* 試下一個 */ }
    }
    throw new Error('all sources failed');
  }

  /* ============ 分店列表 ============ */
  function waitClass(store) {
    if (store.storeStatus !== 'OPEN') return 'wait-closed';
    if (store.wait >= 30) return 'wait-high';
    if (store.wait >= 10) return 'wait-mid';
    return 'wait-low';
  }

  function visibleStores() {
    const q = $search.value.trim().toLowerCase();
    const area = $area.value;
    const out = stores.filter(s =>
      (!area || s.area === area) &&
      (!q || s.name.toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q))
    );
    const mode = $sort.value;
    out.sort((a, b) => {
      const bm = (bookmarks.has(b.id) ? 1 : 0) - (bookmarks.has(a.id) ? 1 : 0);
      if (bm) return bm;
      const openDiff = (a.storeStatus === 'OPEN' ? 0 : 1) - (b.storeStatus === 'OPEN' ? 0 : 1);
      if (openDiff) return openDiff;
      if (mode === 'wait-desc') return b.wait - a.wait;
      if (mode === 'name') return a.name.localeCompare(b.name, 'zh-HK');
      return a.wait - b.wait;
    });
    return out;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); observer.unobserve(e.target); }
    }
  }, { threshold: 0.05 });

  function renderSummary() {
    const open = stores.filter(s => s.storeStatus === 'OPEN');
    if (!open.length) { $chips.innerHTML = ''; return; }
    const min = open.reduce((a, b) => (a.wait <= b.wait ? a : b));
    const total = open.reduce((n, s) => n + s.wait, 0);
    $chips.innerHTML = `
      <span>營業中 <b>${open.length}</b> 間</span>
      <span>最快:<b>${escapeHtml(min.name.replace(/^壽司郎\s*/, ''))}</b> 等 <b>${min.wait}</b> 組</span>
      <span>全港合共 <b>${total}</b> 組等緊</span>`;
  }

  function render() {
    renderSummary();
    const list = visibleStores();
    $list.innerHTML = '';
    if (!list.length) {
      $list.innerHTML = '<p class="empty-msg">冇符合嘅分店</p>';
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
          <div class="num">${isOpen ? store.wait : '—'}</div>
          <div class="unit">${isOpen ? '組等候' : '休息中'}</div>
        </div>
        <div class="store-info">
          <div class="store-name">
            <span class="status-dot ${isOpen ? 'open' : 'closed'}"></span>
            <span>${escapeHtml(store.name)}</span>
          </div>
          <div class="store-addr">${escapeHtml(store.address || '')}</div>
        </div>
        <div class="card-actions">
          <button class="mini-btn track">追蹤籌號</button>
          <button class="mini-btn bookmark ${bookmarks.has(store.id) ? 'active' : ''}">★ 置頂</button>
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

      if (expanded.has(store.id)) attachQueuePanel(card, store._queue);
      shell.appendChild(card);
      $list.appendChild(shell);

      if (firstRender) observer.observe(shell);
      else shell.classList.add('in');
    });
    firstRender = false;
  }

  function attachQueuePanel(card, queue) {
    const panel = document.createElement('div');
    panel.className = 'queue-panel';
    if (queue === undefined) panel.textContent = '載入籌號中…';
    else if (!queue || !queue.length) panel.textContent = '而家冇叫緊嘅籌號';
    else panel.innerHTML = `叫緊嘅籌號:<div class="queue-numbers">${queue.map(n => `<span>${escapeHtml(n)}</span>`).join('')}</div>`;
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
      const base = demoCalledBase(storeId);
      return store && store.wait ? [base, base + 3, base + 7] : [];
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

  async function load(manual = false) {
    if (manual) $refresh.classList.add('spinning');
    try {
      const payload = await fetchStoresAny();
      stores = (payload.stores || []).map(s => ({ ...s, _queue: undefined }));
      demoMode = false;
      $demoBadge.classList.add('hidden');
      $updatedAt.textContent = `更新於 ${new Date(payload.updatedAt).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (err) {
      if (!stores.length) {
        stores = DEMO_STORES.map(s => ({ ...s }));
        demoMode = true;
        $demoBadge.classList.remove('hidden');
        $updatedAt.textContent = 'API 連接唔到 · 示範數據';
      } else {
        $updatedAt.textContent = `更新失敗,顯示上次數據`;
      }
    }
    populateAreaFilter();
    render();
    $refresh.classList.remove('spinning');
  }

  /* ============ 我的籌號追蹤 ============ */
  let tracking = JSON.parse(localStorage.getItem('sushiro-tracking') || 'null');
  let trackTimer = null;
  let audioCtx = null;

  // 示範模式:每間店一個會慢慢行前嘅「而家叫到」號碼
  const demoCalled = new Map();
  function demoCalledBase(storeId) {
    if (!demoCalled.has(storeId)) {
      const seed = tracking && tracking.storeId === storeId ? tracking.ticket - 12 : 100;
      demoCalled.set(storeId, seed);
    }
    return demoCalled.get(storeId);
  }
  function demoAdvance(storeId) {
    const cur = demoCalledBase(storeId);
    const next = cur + 1 + Math.floor(Math.random() * 2);
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
      startCalled: null, lastCalled: null,
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
    trackTimer = setInterval(pollTracking, demoMode ? TRACK_MS_DEMO : TRACK_MS);
  }

  function parseCalled(queue) {
    if (!queue || !queue.length) return null;
    const nums = queue.map(v => parseInt(String(v).replace(/\D/g, ''), 10)).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : null;
  }

  async function pollTracking() {
    if (!tracking) return;
    let called = null;
    if (demoMode) {
      called = demoAdvance(tracking.storeId);
    } else {
      const queue = await fetchQueue(tracking.storeId);
      called = parseCalled(queue);
    }
    if (called !== null) {
      tracking.lastCalled = called;
      if (tracking.startCalled === null) tracking.startCalled = Math.min(called, tracking.ticket);
    }
    const remaining = tracking.lastCalled === null ? null : tracking.ticket - tracking.lastCalled;

    if (remaining !== null && remaining <= 0 && !tracking.notifiedArrived) {
      tracking.notifiedArrived = true;
      notify('🍣 到你喇!', `${tracking.storeName} 已經叫到 ${tracking.lastCalled} 號,快啲去門口!`);
      document.title = '🔔 到你喇! — 壽司郎';
    } else if (remaining !== null && remaining > 0 && remaining <= tracking.threshold && !tracking.notifiedNear) {
      tracking.notifiedNear = true;
      notify('🚶 好出發喇!', `${tracking.storeName} 仲差 ${remaining} 組就到你(你係 ${tracking.ticket} 號)`);
      document.title = `仲差 ${remaining} 組 — 壽司郎`;
    } else if (remaining !== null && remaining > 0) {
      document.title = `仲差 ${remaining} 組 — 壽司郎`;
    }
    saveTracking();
    renderIsland();
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
      const eta = remaining * 3;
      statusHtml = `<div class="tracker-status">而家叫到 <b>${lastCalled}</b> · 仲差 <b>${remaining}</b> 組${near ? ' · 好出發喇 🚶' : ` · 粗略估計 ~${eta} 分鐘`}</div>`;
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

  /* ============ 事件 ============ */
  $search.addEventListener('input', render);
  $area.addEventListener('change', render);
  $sort.addEventListener('change', render);
  $refresh.addEventListener('click', () => load(true));

  /* ============ 啟動 ============ */
  load().then(() => {
    if (tracking) {
      armTrackTimer();
      pollTracking();
      renderIsland();
    }
  });
  setInterval(load, REFRESH_MS);
})();
