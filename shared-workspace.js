(() => {
  const PAGE = location.pathname.split('/').pop() || 'index.html';
  const FORM_KEY = `fba-workspace:form:${PAGE}`;
  const SHARED_INBOUND_KEY = 'fba-workspace:inbound-data';
  const SORTER_SUMMARY_KEY = 'fba-workspace:sorter-summary';
  const BATCH_META_KEY = 'fba-workspace:batch-meta';
  const CLEAR_KEY = 'fba-workspace:clear-at';
  const VALUE_MODE_KEY = 'fba-workspace:value-mode';
  const BRO_MODE_KEY = 'fba-workspace:bro-mode';
  const BUSINESS_REPORT_KEY = 'fba-workspace:business-report';
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
      if (!file || !['helium', 'inventory', 'business'].includes(kind)) return;
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

  const valueModeEnabled = () => localStorage.getItem(VALUE_MODE_KEY) === 'open';
  const broModeEnabled = () => localStorage.getItem(BRO_MODE_KEY) === 'open';
  const nightModeEnabled = () => valueModeEnabled() || broModeEnabled();
  const notifyValueMode = () => window.dispatchEvent(new CustomEvent('fba-value-mode-changed', { detail: { enabled: valueModeEnabled() } }));
  const notifyBroMode = () => window.dispatchEvent(new CustomEvent('fba-bro-mode-changed', { detail: { enabled: broModeEnabled() } }));
  const playValueTransition = (opening, label = '') => {
    document.body.classList.toggle('fba-night', nightModeEnabled());
    document.body.classList.remove('fba-value-shake');
    void document.body.offsetWidth;
    document.body.classList.add('fba-value-shake');
    let overlay = document.getElementById('fbaDoorTransition');
    if (overlay) overlay.remove();
    overlay = document.createElement('div'); overlay.id = 'fbaDoorTransition'; overlay.className = `fba-door-transition ${opening ? 'opening' : 'closing'}`;
    overlay.innerHTML = `<div class="fba-door left"><span></span></div><div class="fba-secret-mark">${label || (opening ? '芝麻開門' : '芝麻關門')}</div><div class="fba-door right"><span></span></div>`;
    document.body.appendChild(overlay);
    if (navigator.vibrate) navigator.vibrate(opening ? [90, 45, 150, 45, 90] : [150, 55, 100]);
    setTimeout(() => { overlay.remove(); document.body.classList.remove('fba-value-shake'); }, 1350);
  };
  window.FBAValueMode = {
    isEnabled: valueModeEnabled,
    setEnabled(enabled) {
      const changed = valueModeEnabled() !== Boolean(enabled);
      if (enabled) localStorage.setItem(VALUE_MODE_KEY, 'open');
      else localStorage.removeItem(VALUE_MODE_KEY);
      if (changed) playValueTransition(Boolean(enabled));
      else document.body.classList.toggle('fba-night', nightModeEnabled());
      notifyValueMode();
    },
    getBusinessReport() {
      const report = readJson(BUSINESS_REPORT_KEY);
      return report?.batchId === batchMeta.id ? report : null;
    },
    saveBusinessReport(items, fileName = '') {
      localStorage.setItem(BUSINESS_REPORT_KEY, JSON.stringify({ batchId: batchMeta.id, items, fileName, updatedAt: Date.now() }));
    },
    clearBusinessReport() { localStorage.removeItem(BUSINESS_REPORT_KEY); }
  };
  window.FBABroMode = {
    isEnabled: broModeEnabled,
    setEnabled(enabled) {
      const changed = broModeEnabled() !== Boolean(enabled);
      if (enabled) localStorage.setItem(BRO_MODE_KEY, 'open');
      else localStorage.removeItem(BRO_MODE_KEY);
      if (changed) playValueTransition(Boolean(enabled), enabled ? 'BRO MODE' : 'BACK TO WORK');
      else document.body.classList.toggle('fba-night', nightModeEnabled());
      notifyBroMode();
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
  const clearThisPage = async () => {
    if (!window.confirm('確定要清除此頁面嗎？只會清除目前頁面的輸入與結果，其他四頁會保留。')) return;
    isClearing = true;
    localStorage.removeItem(FORM_KEY);
    if (PAGE === 'index.html') {
      localStorage.removeItem(BUSINESS_REPORT_KEY);
      await deleteRestockDatabase();
    } else if (PAGE === 'inbound-plan.html') {
      localStorage.removeItem(SHARED_INBOUND_KEY);
      localStorage.removeItem('fba-workspace:inbound-reviewed');
      localStorage.removeItem('fba-workspace:quantity-choices');
    } else if (PAGE === 'sorter.html') {
      localStorage.removeItem(SORTER_SUMMARY_KEY);
      await deleteSorterDatabase();
    }
    location.reload();
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
  const ensurePageClearButton = resetButton => {
    if (!resetButton?.parentElement) return null;
    let actions = resetButton.closest('.workspace-header-actions');
    if (!actions) {
      actions = document.createElement('div'); actions.className = 'workspace-header-actions';
      resetButton.parentElement.insertBefore(actions, resetButton); actions.appendChild(resetButton);
    }
    let button = document.getElementById('clearPageBtn');
    if (!button) {
      button = document.createElement('button'); button.id = 'clearPageBtn'; button.className = 'clear-page'; button.type = 'button'; button.textContent = '清除此頁面'; actions.insertBefore(button, resetButton);
    }
    return button;
  };
  const style = document.createElement('style');
  style.textContent = `
    .clear-workspace{appearance:none;border:1px solid rgba(36,138,61,.2);cursor:pointer;flex:0 0 auto;padding:8px 12px;border-radius:10px;background:#e8f7ed;color:#176b2c;font-size:12px;font-weight:700;transition:.18s ease;white-space:nowrap}
    .clear-workspace:hover{background:#d9f1e1;transform:translateY(-1px)}
    .workspace-header-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:max-content}
    .clear-page{appearance:none;border:1px solid rgba(0,0,0,.09);cursor:pointer;flex:0 0 auto;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.82);color:#52525b;font-size:12px;font-weight:700;transition:.18s ease;white-space:nowrap}
    .clear-page:hover{background:#fff;transform:translateY(-1px);box-shadow:0 7px 18px rgba(0,0,0,.08)}
    .workspace-source{margin-top:10px;padding:10px 12px;border-radius:12px;background:#f5f7fb;color:#667085;font-size:12px;line-height:1.45}
    .workspace-source.ok{background:#e8f7ed;color:#176b2c}.workspace-source.warn{background:#fff4df;color:#8a4b00}
    .private-value-action[hidden],.private-value-panel[hidden]{display:none!important}
    html{scroll-behavior:smooth}
    body{background-image:radial-gradient(circle at 12% 0%,rgba(0,113,227,.055),transparent 32%),radial-gradient(circle at 92% 8%,rgba(124,58,237,.045),transparent 29%);background-attachment:fixed}
    .card,.tool-card,.upload-card,.auto-detect-card,.advanced-panel{transition:transform .24s ease,box-shadow .24s ease,border-color .24s ease,background-color .3s ease}
    .btn,button,a,.drop,.dropzone,input,textarea,select,summary{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease,background-color .18s ease,color .18s ease}
    .btn:active,button:active{transform:scale(.98)}
    .page-tools{display:flex;justify-content:flex-end;margin:-18px 0 18px}
    .advanced-toggle{display:inline-flex!important;align-items:center!important;gap:9px!important;padding:10px 16px!important;border:1px solid rgba(0,0,0,.09)!important;background:rgba(255,255,255,.86)!important;color:#3a3a3c!important;box-shadow:0 8px 24px rgba(0,0,0,.07)!important;backdrop-filter:blur(16px)}
    .advanced-toggle::before{content:'⚙';font-size:14px}.advanced-toggle::after{content:'⌄';font-size:15px;line-height:1;transition:transform .2s ease}.advanced-toggle.active::after{transform:rotate(180deg)}
    .advanced-toggle:hover{transform:translateY(-2px)!important;box-shadow:0 12px 30px rgba(0,0,0,.11)!important}
    details>summary:hover{background-color:rgba(0,113,227,.045)!important}
    .drop:hover,.dropzone:hover{box-shadow:inset 0 0 0 1px rgba(0,113,227,.12),0 12px 28px rgba(0,0,0,.045)}
    body.fba-ui-ready main>.hero,body.fba-ui-ready main>.page-hero{animation:fbaUiRise .48s cubic-bezier(.22,.8,.35,1) both}
    body.fba-ui-ready main .upload-card,body.fba-ui-ready main>.card,body.fba-ui-ready main .tool-card,body.fba-ui-ready main .auto-detect-card{animation:fbaUiRise .52s cubic-bezier(.22,.8,.35,1) both}
    body.fba-ui-ready main .upload-card:nth-child(2){animation-delay:.055s}body.fba-ui-ready main .upload-card:nth-child(3){animation-delay:.11s}
    @keyframes fbaUiRise{from{opacity:0;transform:translateY(12px) scale(.993)}to{opacity:1;transform:translateY(0) scale(1)}}
    body.fba-night{--bg:#070503!important;--card:#12100e!important;--text:#fff7ed!important;--muted:#c4a991!important;--line:#4a2d18!important;--soft:#1d1712!important;--accent:#f97316!important;--blue:#f97316!important;--green:#f59e0b!important;background:#070503!important;color:#fff7ed!important;color-scheme:dark;transition:background .45s ease,color .45s ease}
    body.fba-night header,body.fba-night .site-header{background:rgba(5,6,8,.94)!important;border-color:#29303d!important}
    body.fba-night .card,body.fba-night article,body.fba-night .tool-card,body.fba-night .upload-card,body.fba-night .action-card,body.fba-night .preflight-panel,body.fba-night .result-body,body.fba-night .email-preview,body.fba-night .private-value-panel,body.fba-night .advanced-panel,body.fba-night .drawer-section,body.fba-night .amazon-review,body.fba-night .amazon-next-step{background:#12100e!important;color:#fff7ed!important;border-color:#4a2d18!important;box-shadow:0 18px 48px rgba(0,0,0,.48)!important}
    body.fba-night input,body.fba-night textarea,body.fba-night select,body.fba-night table,body.fba-night th,body.fba-night td,body.fba-night .drop,body.fba-night .dropzone,body.fba-night .tool-table-wrap{background:#0d0a08!important;color:#fff7ed!important;border-color:#4a2d18!important}
    body.fba-night ::selection{background:#fde68a!important;color:#111827!important}
    body.fba-night .confirm-panel{background:#1a120c!important;border-color:#7c3f12!important;color:#fff7ed!important}
    body.fba-night .confirm-panel.complete{background:#2b180c!important;border-color:#f97316!important;color:#ffedd5!important;box-shadow:0 0 0 3px rgba(249,115,22,.12)!important}
    body.fba-night .confirm-check,body.fba-night .confirm-check span,body.fba-night .confirm-check strong{color:#f8fafc!important}
    body.fba-night .confirm-panel.complete .confirm-check,body.fba-night .confirm-panel.complete .confirm-check span,body.fba-night .confirm-panel.complete .confirm-check strong{color:#ffedd5!important}
    body.fba-night .btn:not(.primary),body.fba-night button:not(.primary):not(.top-tab):not(.inner-tab){background:#21170f!important;color:#fed7aa!important;border:1px solid #9a4d15!important;box-shadow:0 5px 18px rgba(249,115,22,.1)!important}
    body.fba-night .btn:not(.primary):hover,body.fba-night button:not(.primary):not(.top-tab):not(.inner-tab):hover{background:#3a1f0d!important;border-color:#fb923c!important;color:#fff7ed!important}
    body.fba-night .primary,body.fba-night .flash-button,body.fba-night .top-tab.active,body.fba-night .inner-tab.active{background:linear-gradient(135deg,#fb923c,#ea580c)!important;color:#1b0b02!important;border-color:#fdba74!important;box-shadow:0 8px 24px rgba(249,115,22,.28)!important}
    body.fba-night .primary:disabled,body.fba-night button:disabled{background:#332820!important;color:#8f7764!important;border-color:#4a3a2e!important;box-shadow:none!important}
    body.fba-night a{color:#fb923c}body.fba-night .hint,body.fba-night .small,body.fba-night .note,body.fba-night .result-guide,body.fba-night .field-help{color:#c4a991!important}
    body.fba-night .top-tabs{background:#17100b!important;border:1px solid #3f2817!important}body.fba-night .top-tab{color:#d6b79d!important}body.fba-night .top-tab:hover{background:#2b180c!important;color:#fff7ed!important}
    body.fba-night input:focus,body.fba-night textarea:focus,body.fba-night select:focus{outline:3px solid rgba(249,115,22,.24)!important;border-color:#f97316!important}
    body.fba-night .workspace-source.ok,body.fba-night .review-progress.done{background:#2b180c!important;color:#fdba74!important;border-color:#9a4d15!important}
    .fba-door-transition{position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;display:flex;align-items:stretch;background:rgba(0,0,0,.18)}
    .fba-door{position:absolute;top:0;bottom:0;width:50.5%;background:linear-gradient(90deg,#090b10,#1c2230 48%,#090b10);border:1px solid #454f64;box-shadow:0 0 80px rgba(0,0,0,.9);display:grid;place-items:center}
    .fba-door.left{left:0}.fba-door.right{right:0;transform:scaleX(-1)}.fba-door span{width:18px;height:18px;border-radius:50%;background:#d6b85f;box-shadow:0 0 18px #f7dc82;position:absolute;right:24px}
    .fba-secret-mark{position:absolute;z-index:2;left:50%;top:50%;transform:translate(-50%,-50%);padding:15px 24px;border:1px solid rgba(255,255,255,.3);border-radius:999px;background:rgba(0,0,0,.76);color:#fff;font-weight:900;letter-spacing:.28em;white-space:nowrap;box-shadow:0 0 45px rgba(139,92,246,.7)}
    .fba-door-transition.opening .left{animation:fbaDoorOpenLeft 1.2s cubic-bezier(.7,0,.2,1) forwards}.fba-door-transition.opening .right{animation:fbaDoorOpenRight 1.2s cubic-bezier(.7,0,.2,1) forwards}
    .fba-door-transition.closing .left{transform:translateX(-101%);animation:fbaDoorCloseLeft 1.2s cubic-bezier(.7,0,.2,1) forwards}.fba-door-transition.closing .right{transform:translateX(101%) scaleX(-1);animation:fbaDoorCloseRight 1.2s cubic-bezier(.7,0,.2,1) forwards}
    .fba-value-shake{animation:fbaShake .52s ease-in-out}
    @keyframes fbaDoorOpenLeft{to{transform:translateX(-101%)}}@keyframes fbaDoorOpenRight{to{transform:translateX(101%) scaleX(-1)}}
    @keyframes fbaDoorCloseLeft{to{transform:translateX(0)}}@keyframes fbaDoorCloseRight{to{transform:translateX(0) scaleX(-1)}}
    @keyframes fbaShake{0%,100%{transform:translate(0)}20%{transform:translate(-5px,2px)}40%{transform:translate(5px,-2px)}60%{transform:translate(-3px,1px)}80%{transform:translate(3px,-1px)}}
    body.fba-night .advanced-toggle{background:rgba(23,27,35,.9)!important;color:#eef2ff!important;border-color:#343c4b!important}
    body.fba-night .drawer-section summary{background:#171b23!important;color:#eef2ff!important}
    @media(max-width:680px){.page-tools{margin:-8px 0 14px}.advanced-toggle{width:100%;justify-content:center}.workspace-header-actions{width:100%;justify-content:flex-end}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.fba-door-transition .fba-door,.fba-value-shake,body.fba-ui-ready main>.hero,body.fba-ui-ready main>.page-hero,body.fba-ui-ready main .upload-card,body.fba-ui-ready main>.card,body.fba-ui-ready main .tool-card,body.fba-ui-ready main .auto-detect-card{animation-duration:.01ms!important}}
    `;
  document.head.appendChild(style);
  document.body.classList.toggle('fba-night', nightModeEnabled());
  requestAnimationFrame(() => document.body.classList.add('fba-ui-ready'));
  const resetButton = ensureResetButton();
  resetButton?.addEventListener('click', startNewBatch);
  ensurePageClearButton(resetButton)?.addEventListener('click', clearThisPage);
  window.addEventListener('storage', event => {
    if (event.key === CLEAR_KEY && event.newValue) reloadAfterClear();
    if (event.key === VALUE_MODE_KEY) { document.body.classList.toggle('fba-night', nightModeEnabled()); notifyValueMode(); }
    if (event.key === BRO_MODE_KEY) { document.body.classList.toggle('fba-night', nightModeEnabled()); notifyBroMode(); }
  });
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
  notifyValueMode();
  notifyBroMode();
})();
