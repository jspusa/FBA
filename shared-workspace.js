(() => {
  const PAGE = location.pathname.split('/').pop() || 'index.html';
  const FORM_KEY = `fba-workspace:form:${PAGE}`;
  const SHARED_INBOUND_KEY = 'fba-workspace:inbound-data';
  const SORTER_SUMMARY_KEY = 'fba-workspace:sorter-summary';
  const BATCH_META_KEY = 'fba-workspace:batch-meta';
  const CLEAR_KEY = 'fba-workspace:clear-at';
  const SEEN_CLEAR_KEY = `fba-workspace:seen-clear-at:${PAGE}`;
  const SORTER_DB = 'fba-workspace';
  const RESTOCK_DB = 'fba-restock-files';
  const RESTOCK_STORE = 'files';
  let isClearing = false;

  const makeId = () => globalThis.crypto?.randomUUID?.()
    || `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const readJson = (key, fallback = null) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  };
  const ensureBatchMeta = () => {
    const existing = readJson(BATCH_META_KEY);
    if (existing?.id) return existing;
    const meta = { id: makeId(), createdAt: Date.now(), updatedAt: Date.now() };
    localStorage.setItem(BATCH_META_KEY, JSON.stringify(meta));
    return meta;
  };
  const batchMeta = ensureBatchMeta();

  const openRestockDb = () => new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('瀏覽器不支援檔案暫存'));
    const request = indexedDB.open(RESTOCK_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RESTOCK_STORE)) db.createObjectStore(RESTOCK_STORE, { keyPath: 'kind' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const restockRequest = async (mode, action) => {
    const db = await openRestockDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(RESTOCK_STORE, mode);
        const store = tx.objectStore(RESTOCK_STORE);
        const request = action(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  };
  window.FBAWorkspaceFiles = {
    async save(kind, file) {
      if (!file || !['helium', 'inventory'].includes(kind)) return;
      await restockRequest('readwrite', store => store.put({
        kind, batchId: batchMeta.id, name: file.name, type: file.type,
        lastModified: file.lastModified, blob: file
      }));
    },
    async remove(kind) { await restockRequest('readwrite', store => store.delete(kind)); },
    async loadAll() {
      const records = await restockRequest('readonly', store => store.getAll()).catch(() => []);
      return records.reduce((result, record) => {
        if (record.batchId === batchMeta.id && record.blob) {
          result[record.kind] = new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified });
        }
        return result;
      }, {});
    }
  };

  const fields = () => [...document.querySelectorAll('input:not([type="file"]), textarea, select')]
    .filter(el => el.id && !el.matches('[data-no-persist]'));
  const read = el => (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
  const write = (el, value) => {
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = Boolean(value);
    else el.value = value ?? '';
  };
  const save = () => {
    const state = {};
    fields().forEach(el => { state[el.id] = read(el); });
    localStorage.setItem(FORM_KEY, JSON.stringify({ batchId: batchMeta.id, state, updatedAt: Date.now() }));
    const inbound = document.getElementById('pasteInput');
    if (inbound) localStorage.setItem(SHARED_INBOUND_KEY, JSON.stringify({ batchId: batchMeta.id, value: inbound.value, updatedAt: Date.now() }));
    batchMeta.updatedAt = Date.now();
    localStorage.setItem(BATCH_META_KEY, JSON.stringify(batchMeta));
  };
  const clearCurrentPage = () => {
    fields().forEach(el => {
      if (!el.matches('[data-preserve-on-new-batch]')) write(el, el.type === 'checkbox' || el.type === 'radio' ? false : '');
    });
    document.querySelectorAll('input[type="file"]').forEach(el => { el.value = ''; });
  };
  const deleteSorterDatabase = () => new Promise(resolve => {
    if (!globalThis.indexedDB) return resolve();
    const request = indexedDB.deleteDatabase(SORTER_DB);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
  const deleteRestockDatabase = () => new Promise(resolve => {
    if (!globalThis.indexedDB) return resolve();
    const request = indexedDB.deleteDatabase(RESTOCK_DB);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
  const reloadAfterClear = () => { isClearing = true; clearCurrentPage(); location.reload(); };
  const startNewBatch = async () => {
    if (!window.confirm('確定要開始新批次嗎？目前批次的入庫資料、確認狀態、FBA 檔案與分析結果都會清除，且無法復原。')) return;
    isClearing = true;
    Object.keys(localStorage).filter(key => key.startsWith('fba-workspace:')).forEach(key => localStorage.removeItem(key));
    await Promise.all([deleteSorterDatabase(), deleteRestockDatabase()]);
    localStorage.setItem(CLEAR_KEY, String(Date.now()));
    reloadAfterClear();
  };
  const ensureResetButton = () => {
    let button = document.getElementById('clearWorkspaceBtn');
    if (!button) {
      const header = document.querySelector('.header-inner');
      if (!header) return null;
      button = document.createElement('button'); button.id = 'clearWorkspaceBtn'; button.className = 'clear-workspace'; button.type = 'button'; header.appendChild(button);
    }
    button.textContent = '開始新批次'; return button;
  };
  const style = document.createElement('style');
  style.textContent = `
    .clear-workspace{appearance:none;border:1px solid rgba(36,138,61,.2);cursor:pointer;flex:0 0 auto;padding:8px 12px;border-radius:10px;background:#e8f7ed;color:#176b2c;font-size:12px;font-weight:700;transition:.18s ease;white-space:nowrap}
    .clear-workspace:hover{background:#d9f1e1;transform:translateY(-1px)}
    .workspace-source{margin-top:10px;padding:10px 12px;border-radius:12px;background:#f5f7fb;color:#667085;font-size:12px;line-height:1.45}
    .workspace-source.ok{background:#e8f7ed;color:#176b2c}.workspace-source.warn{background:#fff4df;color:#8a4b00}`;
  document.head.appendChild(style);
  ensureResetButton()?.addEventListener('click', startNewBatch);
  window.addEventListener('storage', event => { if (event.key === CLEAR_KEY && event.newValue) reloadAfterClear(); });
  const latestClear = localStorage.getItem(CLEAR_KEY);
  if (latestClear && sessionStorage.getItem(SEEN_CLEAR_KEY) !== latestClear) {
    sessionStorage.setItem(SEEN_CLEAR_KEY, latestClear); clearCurrentPage();
  }
  const savedForm = readJson(FORM_KEY, {});
  const savedState = savedForm?.batchId ? (savedForm.batchId === batchMeta.id ? savedForm.state || {} : {}) : savedForm;
  fields().forEach(el => { if (Object.prototype.hasOwnProperty.call(savedState || {}, el.id)) write(el, savedState[el.id]); });

  const emailData = document.getElementById('emailData');
  const sharedInbound = readJson(SHARED_INBOUND_KEY);
  if (emailData && sharedInbound?.batchId === batchMeta.id && sharedInbound.value?.trim()) emailData.value = sharedInbound.value;
  else if (emailData && typeof localStorage.getItem(SHARED_INBOUND_KEY) === 'string') {
    const legacy = localStorage.getItem(SHARED_INBOUND_KEY) || '';
    if (legacy.trim() && !legacy.trim().startsWith('{')) emailData.value = legacy;
  }
  if (emailData) {
    const source = document.getElementById('workspaceSource');
    const summary = readJson(SORTER_SUMMARY_KEY); const current = summary?.batchId === batchMeta.id;
    if (current && summary?.pickupDate && Number.isInteger(summary?.truckCount) && summary.truckCount > 0) {
      document.getElementById('pickupDate').value = summary.pickupDate;
      document.getElementById('truckCount').value = summary.truckCount;
      if (source) {
        const time = summary.updatedAt ? new Date(summary.updatedAt).toLocaleString('zh-TW', { hour12: false }) : '時間不明';
        const ids = Array.isArray(summary.shipmentIds) && summary.shipmentIds.length ? ` · ${summary.shipmentIds.join('、')}` : '';
        source.className = 'workspace-source ok'; source.textContent = `已帶入本批次 FBA 整理摘要：${summary.pickupDate} · ${summary.truckCount} 車${ids} · 更新 ${time}`;
      }
    } else if (source) {
      source.className = 'workspace-source warn'; source.textContent = '尚未取得本批次的 FBA 整理摘要；請先完成 FBA 整理，或手動填寫日期與車數後再次確認。';
    }
  }
  fields().forEach(el => { el.addEventListener('input', save); el.addEventListener('change', save); });
  fields().forEach(el => el.dispatchEvent(new Event('input', { bubbles: true })));
  window.addEventListener('pagehide', () => { if (!isClearing) save(); });
  window.dispatchEvent(new CustomEvent('fba-workspace-ready', { detail: { batchId: batchMeta.id } }));
})();
