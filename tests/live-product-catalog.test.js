const assert = require('node:assert/strict');
const test = require('node:test');

const snapshot = {
  schemaVersion:1,
  catalogVersion:'2026-08-28.5',
  projection:'fba-inbound',
  products:[{
    productSku:'ABC01', entryType:'product', canonicalProductSku:'ABC01',
    unitsPerCarton:24, cartonDimensionsIn:[20, 16, 12], grossWeightLb:29,
    sourceSheet:'AMZ 所有SKU',
  }],
};

test('live verifier reads and compares the generated FBA snapshot', async () => {
  const { parseLiveCatalog, verifyLiveCatalog } = await import('../scripts/verify-live-product-catalog.mjs');
  const html = `before\nconst BUILTIN_CATALOG_SNAPSHOT=${JSON.stringify(snapshot)};\nconst BUILTIN_CATALOG_ADAPTER=window.FBAProductCatalog.createLegacyCatalog(BUILTIN_CATALOG_SNAPSHOT);\nafter`;
  assert.deepEqual(parseLiveCatalog(html), snapshot);
  assert.deepEqual(verifyLiveCatalog({ html, expectedSnapshot:snapshot, expectedVersion:'2026-08-28.5' }), snapshot);
  assert.throws(
    () => verifyLiveCatalog({ html, expectedSnapshot:snapshot, expectedVersion:'2026-08-28.6' }),
    /expected 2026-08-28.6/,
  );
});
