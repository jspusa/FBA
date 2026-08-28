const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('browser build attaches the packaging assignment API and reloads its local ledger', () => {
  const values = new Map();
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const context = vm.createContext({ localStorage, Date, JSON, Object, Array, String, Number, Boolean, Error, Map, Set });
  const source = fs.readFileSync(path.resolve(__dirname, '../packaging-assignment.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'packaging-assignment.js' });

  const api = context.FBAPackagingAssignment;
  assert.ok(api, 'browser global is missing');
  const ledger = api.createLedger(localStorage, { batchId: 'browser-batch', now: '2026-08-28T12:00:00Z' });
  ledger.assignCurrent({
    rowKey: 'row-1', sku: 'GTBL05',
    current: {
      packagingVersion: '2026-08-28.4', catalogVersion: '2026-08-28.4',
      facts: { unitsPerCarton: 30, lengthIn: 20, widthIn: 16, heightIn: 16, grossWeightLb: 35 },
    },
  });

  const afterReload = api.createLedger(localStorage, { batchId: 'browser-batch' });
  assert.equal(afterReload.get('row-1').packagingVersion, '2026-08-28.4');
  assert.equal(afterReload.get('row-1').facts.unitsPerCarton, 30);
});

test('browser seam keeps old packaging across insert/reorder/box/manual edits and gives the new default only to a true new row', () => {
  const values = new Map();
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const context = vm.createContext({ localStorage, Date, JSON, Object, Array, String, Number, Boolean, Error, Map, Set });
  for (const file of ['packaging-assignment.js', 'inbound-row-identity.js']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, `../${file}`), 'utf8'), context, { filename:file });
  }
  const Packaging = context.FBAPackagingAssignment;
  const Identity = context.FBAInboundRowIdentity;
  const oldCurrent = {
    sku:'GTBL05', packagingVersion:'2026-08-28.4', catalogVersion:'2026-08-28.4',
    facts:{ unitsPerCarton:30, lengthIn:20, widthIn:16, heightIn:16, grossWeightLb:35 },
  };
  const newCurrent = {
    sku:'GTBL05', packagingVersion:'2026-09-10.1', catalogVersion:'2026-09-10.1',
    facts:{ unitsPerCarton:24, lengthIn:20, widthIn:16, heightIn:12, grossWeightLb:27 },
  };
  const identity = Identity.createStore(localStorage, { batchId:'browser-seam' });
  const first = identity.reconcile([
    { sku:'GTBL05', expiryKey:'2027-01-01', boxes:10, manualQuantity:null },
    { sku:'GTBL05', expiryKey:'2027-02-01', boxes:20, manualQuantity:600 },
  ]);
  const ledger = Packaging.createLedger(localStorage, { batchId:'browser-seam' });
  first.forEach(row => ledger.assignCurrent({ rowKey:row.rowId, sku:row.sku, current:oldCurrent }));
  localStorage.setItem('fba-workspace:quantity-choices', JSON.stringify({ [first[0].rowId]:'manual' }));
  localStorage.setItem('fba-workspace:inbound-reviewed', JSON.stringify({ [first[1].rowId]:true }));

  const changed = Identity.createStore(localStorage, { batchId:'browser-seam' }).reconcile([
    { sku:'NEW-SKU', expiryKey:'2027-03-01', boxes:5, manualQuantity:null },
    { sku:'GTBL05', expiryKey:'2027-02-01', boxes:20, manualQuantity:600 },
    { sku:'GTBL05', expiryKey:'2027-01-01', boxes:12, manualQuantity:360 },
  ]);
  const afterCatalogUpdate = Packaging.createLedger(localStorage, { batchId:'browser-seam' });
  changed.forEach(row => afterCatalogUpdate.assignCurrent({ rowKey:row.rowId, sku:row.sku, current:newCurrent }));

  assert.equal(changed[1].rowId, first[1].rowId);
  assert.equal(changed[2].rowId, first[0].rowId);
  assert.equal(afterCatalogUpdate.get(changed[1].rowId).packagingVersion, '2026-08-28.4');
  assert.equal(afterCatalogUpdate.get(changed[2].rowId).packagingVersion, '2026-08-28.4');
  assert.equal(afterCatalogUpdate.get(changed[0].rowId).packagingVersion, '2026-09-10.1');
  assert.equal(JSON.parse(localStorage.getItem('fba-workspace:quantity-choices'))[changed[2].rowId], 'manual');
  assert.equal(JSON.parse(localStorage.getItem('fba-workspace:inbound-reviewed'))[changed[1].rowId], true);
});

test('browser cold migration can resolve a retained historical candidate after the catalog default changes', () => {
  const values = new Map();
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const context = vm.createContext({ localStorage, Date, JSON, Object, Array, String, Number, Boolean, Error, Map, Set });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../packaging-assignment.js'), 'utf8'), context, { filename:'packaging-assignment.js' });
  const Packaging = context.FBAPackagingAssignment;
  const index = Packaging.createCatalogIndex({
    schemaVersion:3, catalogVersion:'2026-09-10.1', products:[{
      productSku:'GTBL05', entryType:'product', canonicalProductSku:'GTBL05', lifecycle:'active', newWorkEligible:true,
      currentPackagingVersion:'2026-09-10.1', newWorkPackagingDefaultVersion:'2026-09-10.1',
      packagingVersions:[
        { packagingVersion:'2026-08-28.4', unitsPerCarton:30, cartonDimensionsIn:[20,16,16], grossWeightLb:35 },
        { packagingVersion:'2026-09-10.1', unitsPerCarton:24, cartonDimensionsIn:[20,16,12], grossWeightLb:27 },
      ],
    }],
  });
  const ledger = Packaging.createLedger(localStorage, { batchId:'cold-browser' });
  const migrated = ledger.migrateLegacy({
    rowKey:'stable-row', sku:'GTBL05', knownFacts:{ unitsPerCarton:30 }, candidates:index.GTBL05.candidates,
    fallbackFacts:index.GTBL05.facts, catalogVersion:'2026-09-10.1',
  });
  assert.equal(migrated.packagingVersion, '2026-08-28.4');
  assert.equal(Packaging.createLedger(localStorage, { batchId:'cold-browser' }).get('stable-row').packagingVersion, '2026-08-28.4');
});
