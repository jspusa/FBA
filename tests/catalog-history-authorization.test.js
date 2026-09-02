'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  publicCatalogSha256,
  reviewedHistoryReplacementSkus,
  stableJson,
} = require('../scripts/catalog-history-authorization.js');

function fixture() {
  const sourceCatalog = {
    schemaVersion:3,
    catalogVersion:'2026-09-02',
    products:[{
      productSku:'GTP03',
      packagingVersions:[{ version:'2026-09-02', unitsPerCarton:90 }],
    }],
    orderSkuAliases:[],
  };
  const plan = {
    schemaVersion:1,
    candidate:{ catalogVersion:'2026-09-02', sha256:publicCatalogSha256(sourceCatalog) },
    duplicateResolution:{
      schemaVersion:1,
      policy:{
        schemaVersion:1,
        match:{ cartonDimensionsCm:[50, 40, 30] },
        overrides:{},
        replacePackagingHistory:true,
      },
      resolutions:[{
        sku:'GTP03',
        criteria:{ cartonDimensionsCm:[50, 40, 30] },
        sourceSheet:'2026',
        sourceRow:19,
        removedVersionIds:['2026-08-28.5'],
      }],
    },
    entries:[{
      id:'product:GTP03',
      sku:'GTP03',
      selectable:true,
      fields:[{
        field:'packagingHistoryVersions',
        before:['2026-08-28.5'],
        after:['2026-09-02'],
      }],
    }],
  };
  plan.planSha256 = crypto.createHash('sha256').update(stableJson(plan)).digest('hex');
  return { plan, sourceCatalog };
}

test('FBA history replacement is derived from the exact signed and selected decision', () => {
  const { plan, sourceCatalog } = fixture();
  assert.deepEqual(reviewedHistoryReplacementSkus({
    plan,
    sourceCatalog,
    selectedEntryIds:['product:GTP03'],
  }), [{ sku:'GTP03', removedVersionIds:['2026-08-28.5'] }]);
});

test('FBA rejects an unselected or tampered history replacement decision', () => {
  const { plan, sourceCatalog } = fixture();
  assert.throws(
    () => reviewedHistoryReplacementSkus({ plan, sourceCatalog, selectedEntryIds:[] }),
    /未在已選取的審核計畫中/,
  );

  const tampered = structuredClone(plan);
  tampered.duplicateResolution.resolutions[0].removedVersionIds = ['made-up-version'];
  assert.throws(
    () => reviewedHistoryReplacementSkus({
      plan:tampered,
      sourceCatalog,
      selectedEntryIds:['product:GTP03'],
    }),
    /雜湊不正確/,
  );
});
