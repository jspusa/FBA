const assert = require('node:assert/strict');
const test = require('node:test');

const Packaging = require('../packaging-assignment.js');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); },
  };
}

const current = (version, units = 30) => ({
  sku: 'GTBL05',
  packagingVersion: version,
  catalogVersion: version,
  facts: { unitsPerCarton: units, lengthIn: 20, widthIn: 16, heightIn: 16, grossWeightLb: 35 },
  sourceSheet: 'AMZ 所有SKU',
});

test('new inbound work pins the FBA-confirmed current packaging version and facts', () => {
  const storage = memoryStorage();
  const ledger = Packaging.createLedger(storage, { batchId: 'batch-1', now: '2026-08-28T12:00:00Z' });
  const assignment = ledger.assignCurrent({ rowKey: 'row-1', sku: 'GTBL05', current: current('2026-08-28.4') });

  assert.equal(assignment.kind, 'catalog-version');
  assert.equal(assignment.packagingVersion, '2026-08-28.4');
  assert.equal(assignment.catalogVersion, '2026-08-28.4');
  assert.equal(assignment.facts.unitsPerCarton, 30);
  assert.equal(assignment.reviewRequired, false);
  assert.match(storage.snapshot()[Packaging.DEFAULT_STORAGE_KEY], /2026-08-28\.4/);
});

test('a later catalog default never recalculates existing work and only reports newer available', () => {
  const storage = memoryStorage();
  const oldLedger = Packaging.createLedger(storage, { batchId: 'batch-1', now: '2026-08-28T12:00:00Z' });
  oldLedger.assignCurrent({ rowKey: 'row-1', sku: 'GTBL05', current: current('2026-08-28.4', 30) });

  const reloaded = Packaging.createLedger(storage, { batchId: 'batch-1', now: '2026-09-10T12:00:00Z' });
  const pinned = reloaded.get('row-1');
  const comparison = reloaded.compare('row-1', current('2026-09-10.1', 24));

  assert.equal(pinned.packagingVersion, '2026-08-28.4');
  assert.equal(pinned.facts.unitsPerCarton, 30);
  assert.equal(comparison.newerAvailable, true);
  assert.equal(comparison.current.packagingVersion, '2026-09-10.1');
  assert.equal(comparison.factsChanged, true);
});

test('legacy work deterministically matches a version only when supplied facts identify exactly one candidate', () => {
  const storage = memoryStorage();
  const ledger = Packaging.createLedger(storage, { batchId: 'legacy', now: '2026-08-28T12:00:00Z' });
  const assignment = ledger.migrateLegacy({
    rowKey: 'known-row',
    sku: 'GTBL05',
    knownFacts: { unitsPerCarton: 30 },
    candidates: [current('2026-08-25', 24), current('2026-08-28.4', 30)],
    fallbackFacts: current('2026-08-28.4', 30).facts,
    catalogVersion: '2026-08-28.4',
  });

  assert.equal(assignment.kind, 'catalog-version');
  assert.equal(assignment.packagingVersion, '2026-08-28.4');
  assert.equal(assignment.migrationMethod, 'known-facts-exact-match');
  assert.equal(assignment.reviewRequired, false);
});

test('unknown, unmatched, or ambiguous legacy facts stay Historical Imported Packaging and require review', () => {
  const storage = memoryStorage();
  const ledger = Packaging.createLedger(storage, { batchId: 'legacy', now: '2026-08-28T12:00:00Z' });
  const fallback = current('2026-08-28.4', 30).facts;
  const unknown = ledger.migrateLegacy({
    rowKey: 'unknown-row', sku: 'GTBL05', knownFacts: {}, candidates: [current('2026-08-28.4', 30)],
    fallbackFacts: fallback, catalogVersion: '2026-08-28.4',
  });
  const unmatched = ledger.migrateLegacy({
    rowKey: 'unmatched-row', sku: 'GTBL05', knownFacts: { unitsPerCarton: 27 }, candidates: [current('2026-08-28.4', 30)],
    fallbackFacts: fallback, catalogVersion: '2026-08-28.4',
  });
  const ambiguous = ledger.migrateLegacy({
    rowKey: 'ambiguous-row', sku: 'GTBL05', knownFacts: { unitsPerCarton: 30 },
    candidates: [current('2026-08-25', 30), current('2026-08-28.4', 30)],
    fallbackFacts: fallback, catalogVersion: '2026-08-28.4',
  });

  for (const assignment of [unknown, unmatched, ambiguous]) {
    assert.equal(assignment.kind, 'historical-imported');
    assert.equal(assignment.packagingVersion, null, 'unknown history must never be promoted to a real version');
    assert.equal(assignment.reviewRequired, true);
  }
  assert.equal(unmatched.facts.unitsPerCarton, 27, 'known historical facts are retained over fallback facts');
});

test('review, reload, explicit reassignment, and clear preserve an immutable assignment trail', () => {
  const storage = memoryStorage();
  const ledger = Packaging.createLedger(storage, { batchId: 'batch-1', now: '2026-08-28T12:00:00Z' });
  const historical = ledger.migrateLegacy({
    rowKey: 'row-1', sku: 'GTBL05', knownFacts: {}, candidates: [current('2026-08-28.4')],
    fallbackFacts: current('2026-08-28.4').facts, catalogVersion: '2026-08-28.4',
  });
  const reviewed = ledger.review('row-1');
  assert.equal(reviewed.assignmentId, historical.assignmentId);
  assert.equal(reviewed.reviewRequired, false);
  assert.equal(reviewed.kind, 'historical-imported');

  const reassigned = ledger.reassignCurrent({ rowKey: 'row-1', sku: 'GTBL05', current: current('2026-09-01.1', 24) });
  assert.notEqual(reassigned.assignmentId, historical.assignmentId);
  assert.equal(reassigned.supersedesAssignmentId, historical.assignmentId);
  assert.equal(ledger.history().length, 1);
  assert.equal(ledger.history()[0].facts.unitsPerCarton, 30);

  const reloaded = Packaging.createLedger(storage, { batchId: 'batch-1' });
  assert.equal(reloaded.get('row-1').facts.unitsPerCarton, 24);
  reloaded.clear();
  assert.equal(storage.getItem(Packaging.DEFAULT_STORAGE_KEY), null);
});

test('catalog index retains the FBA-confirmed version and alias identity', () => {
  const index = Packaging.createCatalogIndex({
    catalogVersion: '2026-08-28.4',
    products: [{
      productSku: '7GTBD057AB', entryType: 'approved-order-sku', canonicalProductSku: 'GTBL05',
      packagingVersion: '2026-08-28.4', unitsPerCarton: 24,
      cartonDimensionsIn: [20, 16, 12], grossWeightLb: 27, sourceSheet: 'aliases',
    }],
  });
  assert.equal(index['7GTBD057AB'].packagingVersion, '2026-08-28.4');
  assert.equal(index['7GTBD057AB'].canonicalProductSku, 'GTBL05');
  assert.equal(index['7GTBD057AB'].facts.unitsPerCarton, 24);
});

test('catalog index exposes full owner history for cold migration while retired owners are not eligible for new work', () => {
  const index = Packaging.createCatalogIndex({
    schemaVersion: 3,
    catalogVersion: '2026-09-10.1',
    products: [{
      productSku: 'GTBL05', entryType: 'product', canonicalProductSku: 'GTBL05', lifecycle: 'active', newWorkEligible: true,
      currentPackagingVersion: '2026-09-10.1', newWorkPackagingDefaultVersion: '2026-09-10.1',
      packagingVersions: [
        { packagingVersion: '2026-08-28.4', unitsPerCarton: 30, cartonDimensionsIn: [20, 16, 16], grossWeightLb: 35 },
        { packagingVersion: '2026-09-10.1', unitsPerCarton: 24, cartonDimensionsIn: [20, 16, 12], grossWeightLb: 27 },
      ],
    }, {
      productSku: 'RETIRED01', entryType: 'product', canonicalProductSku: 'RETIRED01', lifecycle: 'retired', newWorkEligible: false,
      currentPackagingVersion: '2026-08-28.4', newWorkPackagingDefaultVersion: '2026-08-28.4',
      packagingVersions: [
        { packagingVersion: '2026-08-25', unitsPerCarton: 12, cartonDimensionsIn: [20, 16, 12], grossWeightLb: 20 },
        { packagingVersion: '2026-08-28.4', unitsPerCarton: 10, cartonDimensionsIn: [20, 16, 12], grossWeightLb: 18 },
      ],
    }],
  });
  assert.equal(index.GTBL05.packagingVersion, '2026-09-10.1');
  assert.deepEqual(index.GTBL05.candidates.map(item => item.packagingVersion), ['2026-08-28.4', '2026-09-10.1']);
  assert.equal(index.RETIRED01.newWorkEligible, false);
  assert.deepEqual(index.RETIRED01.candidates.map(item => item.packagingVersion), ['2026-08-25', '2026-08-28.4']);

  const storage = memoryStorage();
  const ledger = Packaging.createLedger(storage, { batchId: 'cold-retained-history', now: '2026-09-10T12:00:00Z' });
  const migrated = ledger.migrateLegacy({
    rowKey: 'stable-row', sku: 'GTBL05', knownFacts: { unitsPerCarton: 30 }, candidates: index.GTBL05.candidates,
    fallbackFacts: index.GTBL05.facts, catalogVersion: '2026-09-10.1',
  });
  assert.equal(migrated.kind, 'catalog-version');
  assert.equal(migrated.packagingVersion, '2026-08-28.4');
  assert.equal(Packaging.createLedger(storage, { batchId: 'cold-retained-history' }).get('stable-row').packagingVersion, '2026-08-28.4');
});

test('an incomplete default blocks new work but keeps old candidates for cold migration', () => {
  const index = Packaging.createCatalogIndex({
    schemaVersion:3,
    catalogVersion:'2026-09-10.2',
    products:[{
      productSku:'7GTBD057AB', entryType:'approved-order-sku', canonicalProductSku:'GTBL05',
      lifecycle:'incomplete-packaging', newWorkEligible:false,
      currentPackagingVersion:'2026-09-10.2', newWorkPackagingDefaultVersion:'2026-09-10.2',
      packagingVersions:[
        { packagingVersion:'2026-08-28.4', unitsPerCarton:24, cartonDimensionsIn:[20, 16, 12], grossWeightLb:27 },
        { packagingVersion:'2026-09-10.2', unitsPerCarton:null, cartonDimensionsIn:null, grossWeightLb:null },
      ],
    }],
  });
  const owner = index['7GTBD057AB'];
  assert.ok(owner, 'incomplete owner identity must remain indexed');
  assert.equal(owner.newWorkEligible, false);
  assert.equal(owner.packagingVersion, '2026-09-10.2');
  assert.equal(owner.facts.unitsPerCarton, null);
  assert.deepEqual(owner.candidates.map(item => item.packagingVersion), ['2026-08-28.4']);

  const storage = memoryStorage();
  const ledger = Packaging.createLedger(storage, { batchId:'incomplete-cold', now:'2026-09-10T12:00:00Z' });
  assert.throws(
    () => ledger.assignCurrent({ rowKey:'new-row', sku:'7GTBD057AB', current:owner }),
    /沒有可指派的 FBA 確認包裝版本/,
  );
  const known = ledger.migrateLegacy({
    rowKey:'known-old-row', sku:'7GTBD057AB', knownFacts:{ unitsPerCarton:24 },
    candidates:owner.candidates, fallbackFacts:owner.candidates[0].facts, catalogVersion:'2026-09-10.2',
  });
  assert.equal(known.kind, 'catalog-version');
  assert.equal(known.packagingVersion, '2026-08-28.4');

  const unknown = ledger.migrateLegacy({
    rowKey:'unknown-old-row', sku:'7GTBD057AB', knownFacts:{},
    candidates:owner.candidates, fallbackFacts:owner.candidates[0].facts, catalogVersion:'2026-09-10.2',
  });
  assert.equal(unknown.kind, 'historical-imported');
  assert.equal(unknown.migrationMethod, 'unknown-or-unmatched-facts');
  assert.equal(unknown.reviewRequired, true);
});

test('an incomplete Product keeps repair identity and complete history without becoming new work', () => {
  const index = Packaging.createCatalogIndex({
    schemaVersion:3,
    catalogVersion:'2026-09-10.2',
    products:[{
      productSku:'INCOMPLETE01', entryType:'product', canonicalProductSku:'INCOMPLETE01',
      lifecycle:'incomplete', newWorkEligible:false,
      currentPackagingVersion:'2026-09-10.2', newWorkPackagingDefaultVersion:'2026-09-10.2',
      packagingVersions:[
        { packagingVersion:'2026-08-28.4', unitsPerCarton:24, cartonDimensionsIn:[20, 16, 12], grossWeightLb:27 },
        { packagingVersion:'2026-09-10.2', unitsPerCarton:null, cartonDimensionsIn:null, grossWeightLb:null },
      ],
    }],
  });
  const owner = index.INCOMPLETE01;
  assert.ok(owner, 'incomplete Product remains available to repair and migration');
  assert.equal(owner.newWorkEligible, false);
  assert.equal(owner.facts.unitsPerCarton, null);
  assert.deepEqual(owner.candidates.map(item => item.packagingVersion), ['2026-08-28.4']);

  const storage = memoryStorage();
  const ledger = Packaging.createLedger(storage, { batchId:'incomplete-product-cold', now:'2026-09-10T12:00:00Z' });
  const migrated = ledger.migrateLegacy({
    rowKey:'known-old-row', sku:'INCOMPLETE01', knownFacts:{ unitsPerCarton:24 },
    candidates:owner.candidates, fallbackFacts:owner.candidates[0].facts, catalogVersion:'2026-09-10.2',
  });
  assert.equal(migrated.kind, 'catalog-version');
  assert.equal(migrated.packagingVersion, '2026-08-28.4');
});

test('a missing-weight default keeps its owner and old candidates available for the repair flow', () => {
  const index = Packaging.createCatalogIndex({
    schemaVersion:3,
    catalogVersion:'2026-09-10.3',
    products:[{
      productSku:'ACTIVE01', entryType:'product', canonicalProductSku:'ACTIVE01',
      lifecycle:'active', newWorkEligible:true,
      currentPackagingVersion:'2026-09-10.3', newWorkPackagingDefaultVersion:'2026-09-10.3',
      packagingVersions:[
        { packagingVersion:'2026-08-28.4', unitsPerCarton:24, cartonDimensionsIn:[20, 16, 12], grossWeightLb:27 },
        { packagingVersion:'2026-09-10.3', unitsPerCarton:24, cartonDimensionsIn:[20, 16, 12], grossWeightLb:null },
      ],
    }],
  });
  assert.ok(index.ACTIVE01);
  assert.equal(index.ACTIVE01.facts.grossWeightLb, null);
  assert.equal(index.ACTIVE01.newWorkEligible, false, 'assignment waits for the established weight repair step');
  assert.deepEqual(index.ACTIVE01.candidates.map(item => item.packagingVersion), ['2026-08-28.4']);
});
