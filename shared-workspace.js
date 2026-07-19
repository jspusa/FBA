(() => {
  const PAGE = location.pathname.split('/').pop() || 'index.html';
  const FORM_KEY = `fba-workspace:form:${PAGE}`;
  const SHARED_INBOUND_KEY = 'fba-workspace:inbound-data';

  const fields = () => [...document.querySelectorAll('input:not([type="file"]), textarea, select')]
    .filter(el => el.id && !el.matches('[data-no-persist]'));
  const read = el => (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
  const write = (el, value) => {
    if(el.type === 'checkbox' || el.type === 'radio') el.checked = Boolean(value);
    else el.value = value ?? '';
  };
  const save = () => {
    const state = {};
    fields().forEach(el => { state[el.id] = read(el); });
    localStorage.setItem(FORM_KEY, JSON.stringify(state));
    const inbound = document.getElementById('pasteInput');
    if(inbound) localStorage.setItem(SHARED_INBOUND_KEY, inbound.value);
  };

  let state = {};
  try { state = JSON.parse(localStorage.getItem(FORM_KEY) || '{}'); } catch {}
  fields().forEach(el => {
    if(Object.prototype.hasOwnProperty.call(state, el.id)) write(el, state[el.id]);
  });

  // 入庫計畫是出貨通知的共同資料來源；第一次開啟通知時直接帶入。
  const emailData = document.getElementById('emailData');
  const sharedInbound = localStorage.getItem(SHARED_INBOUND_KEY);
  if(emailData && sharedInbound?.trim()) emailData.value = sharedInbound;
  if(emailData){
    try {
      const summary = JSON.parse(localStorage.getItem('fba-workspace:sorter-summary') || 'null');
      if(summary?.pickupDate) document.getElementById('pickupDate').value = summary.pickupDate;
      if(Number.isInteger(summary?.truckCount) && summary.truckCount > 0) document.getElementById('truckCount').value = summary.truckCount;
    } catch {}
  }

  fields().forEach(el => {
    el.addEventListener('input', save);
    el.addEventListener('change', save);
  });
  // 讓各頁既有的預覽/確認狀態依還原後的內容重新計算。
  fields().forEach(el => el.dispatchEvent(new Event('input', { bubbles:true })));
  window.addEventListener('pagehide', save);
})();
