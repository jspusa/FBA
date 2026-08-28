const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const Identity = require('../inbound-row-identity.js');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); },
  };
}

const row = (sku, expiryKey, boxes, manualQuantity = null) => ({ sku, expiryKey, boxes, manualQuantity });

test('stable row ids survive insert-before, reorder, box edits, and manual quantity edits; only a true new row gets a new id', () => {
  const storage = memoryStorage();
  const firstStore = Identity.createStore(storage, { batchId: 'batch-1' });
  const initial = firstStore.reconcile([
    row('SKU-A', '2027-01-01', 10),
    row('SKU-B', '2027-02-01', 20, 200),
  ]);
  const ids = Object.fromEntries(initial.map(item => [item.sku, item.rowId]));

  const reloaded = Identity.createStore(storage, { batchId: 'batch-1' });
  const changed = reloaded.reconcile([
    row('SKU-C', '2027-03-01', 4),
    row('SKU-B', '2027-02-01', 20, 200),
    row('SKU-A', '2027-01-01', 12, 120),
  ]);
  const bySku = Object.fromEntries(changed.map(item => [item.sku, item]));

  assert.equal(bySku['SKU-A'].rowId, ids['SKU-A']);
  assert.equal(bySku['SKU-B'].rowId, ids['SKU-B']);
  assert.notEqual(bySku['SKU-C'].rowId, ids['SKU-A']);
  assert.notEqual(bySku['SKU-C'].rowId, ids['SKU-B']);
  assert.equal(bySku['SKU-C'].identityStatus, 'new');
});

test('duplicate SKU/expiry rows use exact facts deterministically and refuse ambiguous reassignment', () => {
  const storage = memoryStorage();
  const store = Identity.createStore(storage, { batchId: 'duplicates' });
  const initial = store.reconcile([
    row('DUP', '2027-01-01', 10, 100),
    row('DUP', '2027-01-01', 20, 200),
  ]);

  const reordered = store.reconcile([
    row('DUP', '2027-01-01', 20, 200),
    row('DUP', '2027-01-01', 10, 100),
  ]);
  assert.deepEqual(reordered.map(item => item.rowId), [initial[1].rowId, initial[0].rowId]);

  const ambiguous = store.reconcile([
    row('DUP', '2027-01-01', 11, 110),
    row('DUP', '2027-01-01', 21, 210),
  ]);
  assert.ok(ambiguous.every(item => item.identityStatus === 'review-required'));
  assert.ok(ambiguous.every(item => !initial.some(previous => previous.rowId === item.rowId)), 'ambiguous rows must not silently inherit either prior assignment');
  const afterReload = Identity.createStore(storage, { batchId: 'duplicates' }).reconcile([
    row('DUP', '2027-01-01', 11, 110),
    row('DUP', '2027-01-01', 21, 210),
  ]);
  assert.deepEqual(afterReload.map(item => item.rowId), ambiguous.map(item => item.rowId));
  assert.ok(afterReload.every(item => item.identityStatus === 'review-required'), 'identity review cannot disappear merely because the same ambiguous text rendered again');
  assert.ok(afterReload.every(item => item.previousRowIds.length === 2));
});

test('browser build exposes the same stable identity store and reload behavior', () => {
  const storage = memoryStorage();
  const context = vm.createContext({ localStorage: storage, JSON, Object, Array, String, Number, Boolean, Error, Map, Set, Date });
  const source = fs.readFileSync(path.resolve(__dirname, '../inbound-row-identity.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'inbound-row-identity.js' });
  const first = context.FBAInboundRowIdentity.createStore(storage, { batchId: 'browser' }).reconcile([row('SKU-A', '2027-01-01', 10)])[0];
  const afterReload = context.FBAInboundRowIdentity.createStore(storage, { batchId: 'browser' }).reconcile([row('SKU-A', '2027-01-01', 12)])[0];
  assert.equal(afterReload.rowId, first.rowId);
});

test('identical duplicate rows keep deterministic ids across repeated renders instead of churning', () => {
  const storage = memoryStorage();
  const store = Identity.createStore(storage, { batchId:'identical-duplicates' });
  const input = [
    row('DUP', '2027-01-01', 10, 100),
    row('DUP', '2027-01-01', 10, 100),
  ];
  const first = store.reconcile(input);
  const second = store.reconcile(input);
  const third = Identity.createStore(storage, { batchId:'identical-duplicates' }).reconcile(input);
  assert.deepEqual(second.map(item => item.rowId), first.map(item => item.rowId));
  assert.deepEqual(third.map(item => item.rowId), first.map(item => item.rowId));
});
