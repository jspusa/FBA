const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const adapter = require('../product-catalog.js');
const { analyzeLegacyCoverage } = require('../scripts/fba-catalog-coverage.js');

test('checked-in FBA snapshot adapts to the existing inbound catalog shape', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalog/fba-product-catalog.snapshot.json'), 'utf8'));
  const result = adapter.createLegacyCatalog(snapshot);

  assert.equal(result.schemaVersion, 1);
  assert.match(result.catalogVersion, /^2026-08-(?:25|28)(?:\.\d+)?$/);
  assert.ok(Object.keys(result.catalog).length >= 307);
  assert.ok(result.catalog['EZD040-3']);

  const augustPackaging = {
    '1ABRD002A0': [42, 20, 16, 12, 37],
    GTAL01: [38, 20, 16, 16, 44],
    GTB05: [100, 23, 14, 14, 29],
    GTBL01: [30, 20, 16, 16, 35],
    GTBL03: [30, 20, 16, 16, 35],
    GTBL05: [30, 20, 16, 16, 35],
    GTCL01: [30, 20, 16, 16, 35],
    GTP03: [100, 23, 14, 14, 26],
    GTP05: [100, 23, 14, 14, 29],
    GTPL01: [30, 20, 16, 16, 35],
    GTPL03: [30, 20, 16, 16, 35],
    GTPL05: [30, 20, 16, 16, 35],
    GTRL01: [30, 20, 16, 16, 35],
    GTRL03: [30, 20, 16, 16, 35],
    GTSL01: [30, 20, 16, 16, 35],
  };
  for (const [productSku, expected] of Object.entries(augustPackaging)) {
    const product = result.catalog[productSku];
    assert.deepEqual(
      [product.units, product.length, product.width, product.height, product.weight],
      expected,
      `${productSku} must retain the audited 2026-08-25 FBA packaging`,
    );
  }
});

test('FBA snapshot rejects duplicate Product SKUs instead of silently overwriting packaging', () => {
  const product = {
    productSku: 'GTBL05',
    unitsPerCarton: 30,
    cartonDimensionsIn: [20, 16, 16],
    grossWeightLb: 35,
    sourceSheet: 'AMZ 所有SKU',
  };
  assert.throws(
    () => adapter.validateFbaSnapshot({
      schemaVersion: 1,
      catalogVersion: '2026-08-25',
      projection: 'fba-inbound',
      products: [product, { ...product }],
    }),
    error => error instanceof adapter.CatalogValidationError && error.code === 'DUPLICATE_PRODUCT_SKU',
  );
});

test('schema v2 projects Product SKUs and each Order SKU alias with its own packaging', () => {
  const snapshot = adapter.projectCanonicalCatalog({
    schemaVersion: 2,
    catalogVersion: '2026-08-28.2',
    products: [{
      productSku: 'GTBL05',
      approvedOrderSkus: ['GTBL05', '7GTBD057AB'],
      packagingVersions: [{
        version: '2026-08-25',
        effectiveFrom: '2026-08-25',
        effectiveTo: null,
        unitsPerCarton: 30,
        cartonDimensionsCm: [50.8, 40.64, 40.64],
        grossWeightKg: 15.8757,
        grossWeightLb: null,
        source: { sheet: 'AMZ 所有SKU', row: 42 },
      }],
    }],
    orderSkuAliases: [{
      orderSku: '7GTBD057AB',
      canonicalProductSku: 'GTBL05',
      lifecycle: 'approved',
      packagingVersions: [{
        version: '2026-08-28.2',
        effectiveFrom: '2026-08-28',
        effectiveTo: null,
        unitsPerCarton: 24,
        cartonDimensionsCm: [50, 40, 30],
        grossWeightKg: null,
        grossWeightLb: 27,
        source: { sheet: 'legacy aliases', row: 7 },
      }],
    }, {
      orderSku: '7UNMAPPED',
      canonicalProductSku: null,
      lifecycle: 'unmapped-legacy',
      packagingVersions: [{
        version: '2026-08-28.2',
        effectiveFrom: '2026-08-28',
        effectiveTo: null,
        unitsPerCarton: 50,
        cartonDimensionsCm: [50, 40, 30],
        grossWeightKg: null,
        grossWeightLb: 17,
      }],
    }],
  });
  const result = adapter.createLegacyCatalog(snapshot);

  assert.equal(snapshot.catalogVersion, '2026-08-28.2');
  assert.deepEqual(result.catalog.GTBL05, {
    units: 30,
    length: 20,
    width: 16,
    height: 16,
    weight: 35,
    source: 'AMZ 所有SKU',
  });
  assert.deepEqual(result.catalog['7GTBD057AB'], {
    units: 24,
    length: 20,
    width: 16,
    height: 12,
    weight: 27,
    source: 'legacy aliases',
  });
  assert.deepEqual(snapshot.products.find(product => product.productSku === '7GTBD057AB'), {
    productSku: '7GTBD057AB',
    entryType: 'approved-order-sku',
    canonicalProductSku: 'GTBL05',
    unitsPerCarton: 24,
    cartonDimensionsIn: [20, 16, 12],
    grossWeightLb: 27,
    sourceSheet: 'legacy aliases',
  });
  assert.deepEqual(snapshot.products.find(product => product.productSku === '7UNMAPPED'), {
    productSku: '7UNMAPPED',
    entryType: 'unmapped-legacy-order-sku',
    canonicalProductSku: null,
    unitsPerCarton: 50,
    cartonDimensionsIn: [20, 16, 12],
    grossWeightLb: 17,
    sourceSheet: 'canonical product catalog',
  });
});

test('canonical catalog rejects a 7-prefixed Order SKU as a Product SKU', () => {
  assert.throws(
    () => adapter.projectCanonicalCatalog({
      schemaVersion: 2,
      catalogVersion: '2026-08-28.2',
      products: [{
        productSku: '7GTBD057AB',
        approvedOrderSkus: ['7GTBD057AB'],
        packagingVersions: [{
          effectiveTo: null,
          unitsPerCarton: 24,
          cartonDimensionsCm: [50, 40, 30],
          grossWeightLb: 27,
        }],
      }],
      orderSkuAliases: [],
    }),
    error => error instanceof adapter.CatalogValidationError && error.code === 'ORDER_SKU_AS_PRODUCT_SKU',
  );
});

test('schema v2 rejects a non-self approved Order SKU that does not start with 7', () => {
  assert.throws(
    () => adapter.projectCanonicalCatalog({
      schemaVersion: 2,
      catalogVersion: '2026-08-28.3',
      products: [{
        productSku: 'GTBL05',
        approvedOrderSkus: ['GTBL05', 'GTBL05-ALT'],
        packagingVersions: [{
          effectiveTo: null,
          unitsPerCarton: 30,
          cartonDimensionsCm: [50, 40, 40],
          grossWeightLb: 35,
        }],
      }],
      orderSkuAliases: [],
    }),
    error => error instanceof adapter.CatalogValidationError && error.code === 'INVALID_ORDER_SKU',
  );
});

test('schema v2 rejects an approved alias whose owner disagrees with approvedOrderSkus', () => {
  assert.throws(
    () => adapter.projectCanonicalCatalog({
      schemaVersion: 2,
      catalogVersion: '2026-08-28.2',
      products: [{
        productSku: 'GTBL05',
        approvedOrderSkus: ['GTBL05'],
        packagingVersions: [{
          effectiveTo: null,
          unitsPerCarton: 30,
          cartonDimensionsCm: [50, 40, 40],
          grossWeightLb: 35,
        }],
      }],
      orderSkuAliases: [{
        orderSku: '7GTBD057AB',
        canonicalProductSku: 'GTBL05',
        lifecycle: 'approved',
        packagingVersions: [{
          effectiveTo: null,
          unitsPerCarton: 24,
          cartonDimensionsCm: [50, 40, 30],
          grossWeightLb: 27,
        }],
      }],
    }),
    error => error instanceof adapter.CatalogValidationError && error.code === 'ORDER_SKU_OWNER_MISMATCH',
  );
});

test('migration coverage reports Product SKUs, approved aliases, and unmapped legacy aliases separately', () => {
  const packaging = {
    unitsPerCarton: 24,
    cartonDimensionsIn: [20, 16, 12],
    grossWeightLb: 27,
    sourceSheet: 'fixture',
  };
  const previous = {
    products: [
      { productSku: 'PRODUCT-1', ...packaging },
      { productSku: 'PRODUCT-2', ...packaging },
      { productSku: '7APPROVED', entryType: 'approved-order-sku', canonicalProductSku: 'PRODUCT-1', ...packaging },
      { productSku: '7UNMAPPED', ...packaging },
    ],
  };
  const projected = {
    products: [
      { productSku: 'PRODUCT-1', entryType: 'product', canonicalProductSku: 'PRODUCT-1', ...packaging },
    ],
  };

  assert.deepEqual(analyzeLegacyCoverage(previous, projected), {
    missingProductSkus: ['PRODUCT-2'],
    missingApprovedOrderSkus: ['7APPROVED'],
    missingLegacyOrderSkus: ['7UNMAPPED'],
    packagingDataLoss: [],
  });
});

test('migration coverage accepts intentional alias packaging changes when the alias is preserved', () => {
  const previous = {
    products: [{
      productSku: '7GTBD057AB',
      unitsPerCarton: 24,
      cartonDimensionsIn: [20, 16, 12],
      grossWeightLb: 27,
      sourceSheet: 'legacy',
    }],
  };
  const projected = {
    products: [{
      productSku: '7GTBD057AB',
      entryType: 'approved-order-sku',
      canonicalProductSku: 'GTBL05',
      unitsPerCarton: 30,
      cartonDimensionsIn: [20, 16, 16],
      grossWeightLb: 35,
      sourceSheet: 'canonical',
    }],
  };

  assert.deepEqual(analyzeLegacyCoverage(previous, projected), {
    missingProductSkus: [],
    missingApprovedOrderSkus: [],
    missingLegacyOrderSkus: [],
    packagingDataLoss: [],
  });
});

test('migration coverage blocks positive packaging data becoming null', () => {
  const previous = {
    products: [{
      productSku: 'PRODUCT-1',
      unitsPerCarton: 30,
      cartonDimensionsIn: [20, 16, 12],
      grossWeightLb: 34,
    }],
  };
  const projected = {
    products: [{
      productSku: 'PRODUCT-1',
      entryType: 'product',
      canonicalProductSku: 'PRODUCT-1',
      unitsPerCarton: 30,
      cartonDimensionsIn: [20, 16, 12],
      grossWeightLb: null,
    }],
  };

  assert.deepEqual(analyzeLegacyCoverage(previous, projected).packagingDataLoss, [{
    sku: 'PRODUCT-1',
    fields: ['grossWeightLb'],
  }]);
});

test('migration coverage allows a positive packaging value to change to another positive value', () => {
  const previous = {
    products: [{
      productSku: 'PRODUCT-1',
      unitsPerCarton: 30,
      cartonDimensionsIn: [20, 16, 12],
      grossWeightLb: 34,
    }],
  };
  const projected = {
    products: [{
      productSku: 'PRODUCT-1',
      entryType: 'product',
      canonicalProductSku: 'PRODUCT-1',
      unitsPerCarton: 36,
      cartonDimensionsIn: [21, 17, 13],
      grossWeightLb: 35,
    }],
  };

  assert.deepEqual(analyzeLegacyCoverage(previous, projected).packagingDataLoss, []);
});
