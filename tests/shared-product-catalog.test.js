const assert = require('node:assert/strict');
const test = require('node:test');

const api = require('../shared-product-catalog.js');

function rawWorkbook() {
  const top = Array(23).fill('');
  const headers = Array(23).fill('');
  top[2] = '產地'; top[4] = '包數/箱'; top[17] = '紙箱規格'; top[18] = '箱/棧板'; top[21] = '每箱產品的毛重';
  headers[1] = 'SKU'; headers[22] = 'GW (lb)';
  const newer = Array(23).fill('');
  const stale = Array(23).fill('');
  newer[1] = 'GTBL05'; newer[2] = '越南'; newer[4] = 30; newer[17] = '50*40*40'; newer[18] = 30; newer[22] = 35;
  stale[1] = 'GTBL05'; stale[2] = '越南'; stale[4] = 24; stale[17] = '50*40*30'; stale[18] = 42; stale[22] = 29;
  return { SheetNames:['AMZ 所有SKU'], Sheets:{ 'AMZ 所有SKU':{ rows:[top, headers, newer, stale] } } };
}

test('shared raw parser keeps the first complete duplicate for FBA', () => {
  const payload = api.createPayload(rawWorkbook(), { utils:{ sheet_to_json:sheet => sheet.rows } }, { sourceFile:'raw.xlsx', updatedAt:'2026-08-28T00:00:00Z', baseCatalogVersion:'2026-08-28.4' });
  const result = api.applyToFbaCatalog({}, payload);

  assert.equal(payload.stats.duplicateConflicts, 1);
  assert.deepEqual(result.catalog.GTBL05, {
    units:30, length:20, width:16, height:16, weight:35, source:'raw.xlsx · AMZ 所有SKU',
  });
});

test('shared raw payload survives refresh through the common origin storage key', () => {
  const payload = api.createPayload(rawWorkbook(), { utils:{ sheet_to_json:sheet => sheet.rows } }, { sourceFile:'raw.xlsx', updatedAt:'2026-08-28T00:00:00Z', baseCatalogVersion:'2026-08-28.4' });
  const values = new Map();
  const storage = {
    getItem:key => values.get(key) || null,
    setItem:(key, value) => values.set(key, value),
    removeItem:key => values.delete(key),
  };

  api.saveToStorage(payload, storage);
  assert.equal(api.loadFromStorage(storage).sourceFile, 'raw.xlsx');
  assert.equal(values.has('jspusa:shared-product-catalog:v2'), true);
  assert.equal(api.isCompatibleWithBuiltIn(api.loadFromStorage(storage), '2026-08-28.4'), true);
  assert.equal(api.isCompatibleWithBuiltIn(api.loadFromStorage(storage), '2026-08-28.5'), false);
  api.removeFromStorage(storage);
  assert.equal(api.loadFromStorage(storage), null);
});
