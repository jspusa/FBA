const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['index.html', 'inbound-plan.html', 'shipment.html', 'sorter.html', 'email.html'];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('all workflow pages load shared workspace behavior', () => {
  const expectedTabs = ['補貨整合', '入庫計畫', '棧板擷取', 'FBA 整理', '出貨通知'];
  for (const file of htmlFiles) {
    const source = read(file);
    assert.match(source, /<script src="shared-workspace\.js(?:\?v=[^"]+)?"><\/script>/, file);
    assert.match(source, /<link rel="stylesheet" href="workspace-shell\.css"\s*\/>/, file);
    assert.match(source, /id="clearWorkspaceBtn"/, file);
    assert.equal((source.match(/aria-current="page"/g) || []).length, 1, file);
    const nav = source.match(/<nav class="top-tabs"[\s\S]*?<\/nav>/)?.[0] || '';
    assert.deepEqual([...nav.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map(match => match[1]), expectedTabs, file);
  }
});

test('shared header keeps navigation centered and reset action green', () => {
  const source = read('workspace-shell.css');
  assert.match(source, /grid-template-columns:minmax\(210px,1fr\) auto minmax\(210px,1fr\)/);
  assert.match(source, /justify-self:center/);
  assert.match(source, /background:#e8f7ed!important/);
  assert.match(source, /color:#176b2c!important/);
});

test('workspace reset clears localStorage and IndexedDB', () => {
  const source = read('shared-workspace.js');
  assert.match(source, /localStorage\.removeItem/);
  assert.match(source, /const SORTER_DB = 'fba-workspace'/);
  assert.match(source, /indexedDB\.deleteDatabase\(SORTER_DB\)/);
});

test('inbound plan and email clear their linked page state together', () => {
  const source = read('shared-workspace.js');
  const inbound = read('inbound-plan.html');
  assert.match(source, /const LINKED_CLEAR_PAGES = \['inbound-plan\.html', 'email\.html'\]/);
  assert.match(source, /LINKED_CLEAR_PAGES\.includes\(PAGE\)/);
  assert.match(source, /localStorage\.removeItem\(`fba-workspace:form:\$\{page\}`\)/);
  assert.match(source, /formStateRequest\('readwrite', store => store\.delete\(page\)\)/);
  assert.match(source, /這兩頁的輸入與結果會一併清除，其他三頁會保留/);
  assert.match(source, /window\.FBAWorkspaceIsClearing = true/);
  assert.match(inbound, /if\(window\.FBAWorkspaceIsClearing\)return/);
});

test('email does not invent a truck count and reports its data source', () => {
  const source = read('email.html');
  assert.doesNotMatch(source, /id="truckCount"[^>]*value="5"/);
  assert.match(source, /id="workspaceSource"/);
});

test('sorter summary is batch-scoped and invalidated when unverifiable', () => {
  const source = read('sorter.html');
  assert.match(source, /batchId:\s*currentBatchId\(\)/);
  assert.match(source, /localStorage\.removeItem\(SORTER_SUMMARY_KEY\)/);
  assert.match(source, /add\('warning'/);
  assert.match(source, /add\('error'/);
});

test('shipment calculator exposes validation status and configurable capacity', () => {
  const source = read('shipment.html');
  assert.match(source, /id="shipmentStatus"/);
  assert.match(source, /id="cartonsPerPallet"/);
  assert.match(source, /<script src="fba-core\.js"><\/script>/);
});

test('inline JavaScript is syntactically valid', () => {
  for (const file of htmlFiles) {
    const source = read(file);
    const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1])
      .filter((script) => script.trim());
    scripts.forEach((script, index) => {
      assert.doesNotThrow(() => new vm.Script(script, { filename: `${file}:inline-${index + 1}` }));
    });
  }
});

test('restock page uses the shared Inventory column detector', () => {
  const source = read('index.html');
  assert.match(source, /<script src="fba-core\.js\?v=[^"]+"><\/script>/);
  assert.match(source, /window\.FBACore\.detectInventoryColumns\(headers,rows\)/);
  assert.doesNotMatch(source, /Inventory update 檔案缺欄位。/);
  assert.match(source, /缺少必要欄位：EXPIRE/);
});
