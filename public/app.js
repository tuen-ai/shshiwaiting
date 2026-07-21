/* 壽司郎排隊追蹤器 — 前端邏輯 */
(() => {
  const REFRESH_MS = 60 * 1000;

  const $list = document.getElementById('storeList');
  const $updatedAt = document.getElementById('updatedAt');
  const $search = document.getElementById('searchBox');
  const $area = document.getElementById('areaFilter');
  const $sort = document.getElementById('sortBy');
  const $refresh = document.getElementById('refreshBtn');
  const $demoBadge = document.getElementById('demoBadge');

  let stores = [];
  let demoMode = false;
  const expanded = new Set();
  const bookmarks = new Set(JSON.parse(localStorage.getItem('sushiro-bookmarks') || '[]'));

  // 官方 API 唔通(例如地區封鎖)時嘅示範數據,等 UI 都可以睇到
  const DEMO_STORES = [
    { id: 1001, name: '壽司郎 旺角店', address: '旺角彌敦道 610 號荷李活商業中心', area: '九龍', storeStatus: 'OPEN', wait: 42 },
    { id: 1002, name: '壽司郎 銅鑼灣店', address: '銅鑼灣軒尼詩道 489 號銅鑼灣廣場一期', area: '香港島', storeStatus: 'OPEN', wait: 18 },
    { id: 1003, name: '壽司郎 沙田店', address: '沙田新城市廣場一期', area: '新界', storeStatus: 'OPEN', wait: 7 },
    { id: 1004, name: '壽司郎 荃灣店', address: '荃灣愉景新城', area: '新界', storeStatus: 'CLOSED', wait: 0 },
    { id: 1005, name: '壽司郎 尖沙咀店', address: '尖沙咀彌敦道 132 號美麗華廣場', area: '九龍', storeStatus: 'OPEN', wait: 63 },
  ];

  function waitClass(store) {
    if (store.storeStatus !== 'OPEN') return 'wait-closed';
    if (store.wait >= 30) return 'wait-high';
    if (store.wait >= 10) return 'wait-mid';
    return 'wait-low';
  }

  function saveBookmarks() {
    localStorage.setItem('sushiro-bookmarks', JSON.stringify([...bookmarks]));
  }

  function visibleStores() {
    const q = $search.value.trim().toLowerCase();
    const area = $area.value;
    let out = stores.filter(s =>
      (!area || s.area === area) &&
      (!q || s.name.toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q))
    );
    const mode = $sort.value;
    out.sort((a, b) => {
      const bm = (bookmarks.has(b.id) ? 1 : 0) - (bookmarks.has(a.id) ? 1 : 0);
      if (bm) return bm;
      const aOpen = a.storeStatus === 'OPEN' ? 0 : 1;
      const bOpen = b.storeStatus === 'OPEN' ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      if (mode === 'wait-desc') return b.wait - a.wait;
      if (mode === 'name') return a.name.localeCompare(b.name, 'zh-HK');
      return a.wait - b.wait;
    });
    return out;
  }

  function render() {
    const list = visibleStores();
    $list.innerHTML = '';
    if (!list.length) {
      $list.innerHTML = '<p class="empty-msg">冇符合嘅分店</p>';
      return;
    }
    for (const store of list) {
      const card = document.createElement('div');
      card.className = 'store-card' + (expanded.has(store.id) ? ' expanded' : '');
      card.dataset.id = store.id;

      const isOpen = store.storeStatus === 'OPEN';
      card.innerHTML = `
        <div class="wait-badge ${waitClass(store)}">
          <div class="num">${isOpen ? store.wait : '—'}</div>
          <div class="unit">${isOpen ? '組等候' : '休息中'}</div>
        </div>
        <div class="store-info">
          <div class="store-name">
            <span>${escapeHtml(store.name)}</span>
            <span class="status-tag ${isOpen ? 'status-open' : 'status-closed'}">${isOpen ? '營業中' : '已關閉'}</span>
          </div>
          <div class="store-addr">${escapeHtml(store.address || '')}</div>
        </div>
        <button class="bookmark-btn ${bookmarks.has(store.id) ? 'active' : ''}" title="置頂">★</button>
      `;

      card.querySelector('.bookmark-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        bookmarks.has(store.id) ? bookmarks.delete(store.id) : bookmarks.add(store.id);
        saveBookmarks();
        render();
      });

      card.addEventListener('click', () => toggleQueue(store, card));

      if (expanded.has(store.id)) {
        attachQueuePanel(card, store, store._queue);
      }
      $list.appendChild(card);
    }
  }

  function attachQueuePanel(card, store, queue) {
    const panel = document.createElement('div');
    panel.className = 'queue-panel';
    if (queue === undefined) {
      panel.textContent = '載入籌號中…';
    } else if (!queue || !queue.length) {
      panel.textContent = '而家冇叫緊嘅籌號';
    } else {
      panel.innerHTML = `叫緊嘅籌號:<div class="queue-numbers">${queue.map(n => `<span>${escapeHtml(String(n))}</span>`).join('')}</div>`;
    }
    card.appendChild(panel);
  }

  async function toggleQueue(store, card) {
    if (expanded.has(store.id)) {
      expanded.delete(store.id);
      render();
      return;
    }
    expanded.add(store.id);
    render();
    if (demoMode) {
      store._queue = store.wait ? [store.wait + 100, store.wait + 103, store.wait + 107] : [];
      render();
      return;
    }
    try {
      const res = await fetch(`/api/queue/${store.id}`);
      const data = await res.json();
      store._queue = data.storeQueue || [];
    } catch {
      store._queue = null;
    }
    render();
  }

  function populateAreaFilter() {
    const areas = [...new Set(stores.map(s => s.area).filter(Boolean))].sort();
    const current = $area.value;
    $area.innerHTML = '<option value="">全部地區</option>' +
      areas.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    $area.value = current;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function load(manual = false) {
    if (manual) $refresh.classList.add('spinning');
    try {
      const res = await fetch('/api/stores');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      stores = (payload.stores || []).map(s => ({ ...s, _queue: undefined }));
      demoMode = false;
      $demoBadge.classList.add('hidden');
      $updatedAt.textContent = `更新時間:${new Date(payload.updatedAt).toLocaleTimeString('zh-HK')}`;
    } catch (err) {
      if (!stores.length) {
        stores = DEMO_STORES.map(s => ({ ...s }));
        demoMode = true;
        $demoBadge.classList.remove('hidden');
        $updatedAt.textContent = '官方 API 暫時連接唔到,顯示示範數據';
      } else {
        $updatedAt.textContent = `更新失敗(${err.message}),顯示上次數據`;
      }
    }
    populateAreaFilter();
    render();
    $refresh.classList.remove('spinning');
  }

  $search.addEventListener('input', render);
  $area.addEventListener('change', render);
  $sort.addEventListener('change', render);
  $refresh.addEventListener('click', () => load(true));

  load();
  setInterval(load, REFRESH_MS);
})();
