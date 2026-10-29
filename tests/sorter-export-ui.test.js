const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const exporter = require('../sorter-export.js');

function mountedExporter({ findings = [], picker, priorZip = false, downloadError, handoffStorageFailure = false } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../sorter.html'), 'utf8');
  const elements = {};
  for (const match of source.matchAll(/\bid="([^"]+)"/g)) {
    const classes = new Set();
    elements[match[1]] = {
      disabled:false, checked:false, textContent:'', innerHTML:'', listeners:new Map(),
      classList:{ add:name => classes.add(name), remove:(...names) => names.forEach(name => classes.delete(name)), contains:name => classes.has(name) },
      addEventListener(name, callback) { this.listeners.set(name, callback); },
      scrollIntoView() {},
    };
  }
  const local = new Map(), session = new Map(), navigations = [], downloads = [];
  const storage = map => ({ getItem:key => map.get(key) ?? null, setItem:(key,value) => map.set(key,value), removeItem:key => map.delete(key) });
  const folders = new Map([['FBA123', { files:new Map([['BOL-FBA123.pdf', new Blob(['bill'])]]) }]]);
  const summary = { batchId:'batch-1', pickupDate:'2026-11-06', truckCount:1, totalCartons:24, shipmentIds:['FBA123'] };
  if(priorZip) local.set('export', JSON.stringify({ batchId:'batch-1' }));
  let pickerCalls = 0;
  class Zip {
    file() {}
    async generateAsync() { return new Blob(['zip']); }
  }
  const context = vm.createContext({
    els:elements, folders, window:picker ? { showDirectoryPicker:options => { pickerCalls++; return picker(options); } } : {},
    FBASorterExport:exporter, JSZip:Zip,
    localStorage:storage(local), sessionStorage:{ ...storage(session), setItem:(key,value) => { if(handoffStorageFailure && key === 'handoff') throw new Error('Storage unavailable'); session.set(key,value); } },
    SORTER_SUMMARY_KEY:'summary', SORTER_HANDOFF_KEY:'handoff', SORTER_EXPORT_KEY:'export',
    currentBatchId:() => 'batch-1', normalizeShipmentDate:value => value,
    renderOperationalSummary:() => local.set('summary', JSON.stringify(summary)),
    scheduleWorkspaceSave:() => {}, getExportFindings:() => findings,
    findingHtml:item => item.message,
    saveAs:(blob,filename) => { if(downloadError) throw downloadError; downloads.push(filename); },
    location:{ assign:url => navigations.push(url) },
  });
  const refresh = source.slice(source.indexOf('  function hideExportWarningPanel()'), source.indexOf('  function refreshTree()'));
  const output = source.slice(source.indexOf('  // ====== Export files ======'), source.indexOf('  function clearByType(type)'));
  const start = source.indexOf("  els.btnExport.addEventListener('click'");
  const end = source.indexOf('  els.detailFilesBody.addEventListener', start);
  vm.runInContext(`let exportInProgress = false; let pendingExportFormat = 'zip'; ${refresh}\n${output}\n${source.slice(start, end)}\nrefreshExportState();`, context);
  return {
    elements, local, session, navigations, downloads, folders,
    pickerCalls:() => pickerCalls,
    click:id => elements[id].listeners.get('click')(),
  };
}

function writableParent({ fail = false } = {}) {
  const written = [];
  let output;
  const shipment = { getFileHandle:async filename => ({ createWritable:async () => ({
    write:async bytes => { written.push({ filename, bytes:Buffer.from(bytes) }); },
    close:async () => { if(fail) throw new Error('Disk full'); }, abort:async () => {},
  }) }) };
  return {
    written,
    getDirectoryHandle:async (name, options) => {
      if(!output && !options?.create) throw Object.assign(new Error('Missing'), { name:'NotFoundError' });
      output ||= { name, getDirectoryHandle:async () => shipment };
      return output;
    },
  };
}

test('folder button writes classified output, stays on sorter, and still allows ZIP', async () => {
  const parent = writableParent();
  const page = mountedExporter({ picker:async () => parent });
  await page.click('btnExportFolder');
  assert.equal(page.pickerCalls(), 1);
  assert.equal(parent.written[0].filename, 'BOL-FBA123.pdf');
  assert.equal(parent.written[0].bytes.toString(), 'bill');
  assert.match(page.elements.exportStatus.textContent, /FBA_2026-11-06.*1 個檔案/);
  assert.equal(page.navigations.length, 0);
  assert.equal(page.local.has('export'), false);
  assert.equal(JSON.parse(page.local.get('handoff')).pickupDate, '2026-11-06');
  assert.equal(page.elements.btnExport.disabled, false);
  await page.click('btnExport');
  assert.equal(page.downloads.length, 1);
  assert.deepEqual(page.navigations, ['email.html?v=154']);
});

test('a previous ZIP export does not block folder output, but existing warning confirmation still gates it', async () => {
  const page = mountedExporter({ priorZip:true, findings:[{ message:'Needs review', level:'warning' }], picker:async () => writableParent() });
  assert.equal(page.elements.btnExport.disabled, true);
  assert.equal(page.elements.btnExportFolder.disabled, false);
  await page.click('btnExportFolder');
  assert.equal(page.pickerCalls(), 0);
  assert.equal(page.elements.exportWarningPanel.classList.contains('is-hidden'), false);
  await page.click('btnConfirmRiskExport');
  assert.equal(page.pickerCalls(), 0);
  page.elements.confirmRiskExport.checked = true;
  await page.click('btnConfirmRiskExport');
  assert.equal(page.pickerCalls(), 1);
  assert.equal(page.navigations.length, 0);
});

test('unsupported browser and cancelled picker leave export and email state untouched', async () => {
  for(const picker of [undefined, async () => { throw Object.assign(new Error('Cancelled'), { name:'AbortError' }); }]) {
    const page = mountedExporter({ picker });
    await page.click('btnExportFolder');
    assert.equal(page.local.has('handoff'), false);
    assert.equal(page.session.has('handoff'), false);
    assert.equal(page.local.has('export'), false);
    assert.equal(page.navigations.length, 0);
    assert.match(page.elements.exportStatus.textContent, /不支援|已取消/);
    assert.equal(page.elements.btnExportFolder.disabled, false);
  }
});

test('file close and ZIP download failures never mark an export or navigate to email', async () => {
  const folder = mountedExporter({ picker:async () => writableParent({ fail:true }) });
  await folder.click('btnExportFolder');
  assert.match(folder.elements.exportStatus.textContent, /未完成.*0\/1.*Disk full/);
  const zip = mountedExporter({ downloadError:new Error('Download blocked') });
  await zip.click('btnExport');
  for(const page of [folder, zip]) {
    assert.equal(page.local.has('handoff'), false);
    assert.equal(page.session.has('handoff'), false);
    assert.equal(page.local.has('export'), false);
    assert.equal(page.navigations.length, 0);
    assert.equal(page.elements.btnExport.disabled, false);
  }
});


test('completed output remains successful if email handoff storage fails, with no partial handoff left behind', async () => {
  const page = mountedExporter({ picker:async () => writableParent(), handoffStorageFailure:true });
  await page.click('btnExportFolder');
  assert.match(page.elements.exportStatus.textContent, /已儲存.*無法更新出貨通知/);
  assert.equal(page.local.has('handoff'), false);
  assert.equal(page.session.has('handoff'), false);
  assert.equal(page.local.has('export'), false);
  assert.equal(page.navigations.length, 0);
});
