const assert = require('node:assert/strict');
const test = require('node:test');

const affectedWorkModule = import('../catalog-affected-work.mjs');

function readOnlyStorage(storageKey, value) {
  let reads = 0;
  return {
    getItem(key) {
      reads += 1;
      return key === storageKey ? value : null;
    },
    setItem() { throw new Error('collector must not write'); },
    removeItem() { throw new Error('collector must not remove'); },
    reads() { return reads; },
  };
}

const plan = {
  schemaVersion:1,
  entries:[{
    id:'product:ABC01', entryType:'product', sku:'ABC01', changeType:'updated',
    fields:[{ field:'standardFactory', before:'VN', after:'TW' }],
    before:{ approvedOrderSkus:['ABC01', '7ABCD013AB'] },
    after:{ approvedOrderSkus:['ABC01', '7ABCD013AB'] },
  }, {
    id:'order-sku-alias:7ABCD013AB', entryType:'order-sku-alias', sku:'7ABCD013AB', changeType:'updated',
    fields:[{ field:'canonicalProductSku', before:'ABC01', after:'OTHER01' }],
  }, {
    id:'product:UNRELATED', entryType:'product', sku:'UNRELATED', changeType:'updated',
    fields:[{ field:'lifecycle', before:'active', after:'retired' }],
  }],
};

test('FBA projects only related assignment identities, including stable rowId and review state', async () => {
  const {
    collectAffectedWork,
    FBA_PACKAGING_LEDGER_STORAGE_KEY,
  } = await affectedWorkModule;
  const storage = readOnlyStorage(FBA_PACKAGING_LEDGER_STORAGE_KEY, JSON.stringify({
    schemaVersion:1,
    batchId:'private-batch',
    assignments:{
      'fba-row-private-batch-1':{
        rowId:'fba-row-private-batch-1',
        sku:'7ABCD013AB',
        packagingVersion:'2026-08-28.4',
        kind:'catalog-version',
        reviewRequired:false,
        facts:{ unitsPerCarton:12096 },
        privateNote:'DO-NOT-EXPORT',
      },
      'fba-row-private-batch-2':{
        rowId:'fba-row-private-batch-2',
        sku:'OTHER02',
        packagingVersion:null,
        kind:'historical-imported',
        reviewRequired:true,
        facts:{ unitsPerCarton:777 },
      },
    },
  }));

  const result = collectAffectedWork({ site:'fba', storage, plan });

  const expected = [{
    rowId:'fba-row-private-batch-1',
    sku:'7ABCD013AB',
    packagingVersion:'2026-08-28.4',
    kind:'catalog-version',
    reviewRequired:false,
  }];
  assert.deepEqual(result.entries[0].affectedWork, expected, 'factory changes include work owned through an approved alias');
  assert.deepEqual(result.entries[1].affectedWork, expected, 'alias changes include only rows that use that alias');
  assert.deepEqual(result.entries[2].affectedWork, []);
  assert.equal(result.storageStatus, 'ok');
  assert.equal(storage.reads(), 1);

  const publicJson = JSON.stringify(result);
  for (const forbidden of ['12096', '777', 'DO-NOT-EXPORT', 'facts', 'privateNote']) {
    assert.equal(publicJson.includes(forbidden), false, `${forbidden} must not escape compact local state`);
  }
});

test('FBA malformed JSON and legacy quantity-bearing row keys fail safe', async () => {
  const {
    collectAffectedWork,
    FBA_PACKAGING_LEDGER_STORAGE_KEY,
  } = await affectedWorkModule;
  const malformed = collectAffectedWork({
    site:'fba',
    storage:readOnlyStorage(FBA_PACKAGING_LEDGER_STORAGE_KEY, '{not json'),
    plan,
  });
  assert.equal(malformed.storageStatus, 'invalid');
  assert.deepEqual(malformed.entries.map(entry => entry.affectedWork), [[], [], []]);

  const legacy = collectAffectedWork({
    site:'fba',
    storage:readOnlyStorage(FBA_PACKAGING_LEDGER_STORAGE_KEY, JSON.stringify({
      schemaVersion:1,
      assignments:{
        '0|7ABCD013AB|12096|private-expiry':{
          rowKey:'0|7ABCD013AB|12096|private-expiry',
          sku:'7ABCD013AB', packagingVersion:null, kind:'historical-imported', reviewRequired:true,
        },
      },
    })),
    plan,
  });
  assert.equal(legacy.entries[1].affectedWork[0].rowId, null);
  assert.equal(JSON.stringify(legacy).includes('12096'), false);
  assert.equal(JSON.stringify(legacy).includes('private-expiry'), false);
});
