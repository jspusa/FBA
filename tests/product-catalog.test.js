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

  assert.equal(result.schemaVersion, 3);
  assert.match(result.catalogVersion, /^2026-08-(?:25|28)(?:\.\d+)?$/);
  assert.ok(Object.keys(result.catalog).length >= 307);
  assert.ok(result.catalog.GTBL05);
  assert.equal(Object.hasOwn(result.catalog, 'EZD040-3'), false, 'incomplete products cannot seed new work');
  assert.equal(snapshot.products.find(product => product.productSku === 'EZD040-3')?.newWorkEligible, false);
  assert.ok(snapshot.products.every(product => product.currentPackagingVersion && product.newWorkPackagingDefaultVersion));
  assert.ok(snapshot.products.every(product => Array.isArray(product.packagingVersions) && product.packagingVersions.length));
  assert.ok(snapshot.products.some(product => product.packagingVersions.length > 1), 'immutable historical versions must be shipped to the browser');
  assert.doesNotMatch(JSON.stringify(snapshot), /sourceSheet|"source"\s*:/, 'public FBA snapshot must not expose raw workbook provenance');

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
    source: '內建產品資料庫',
  });
  assert.deepEqual(result.catalog['7GTBD057AB'], {
    units: 24,
    length: 20,
    width: 16,
    height: 12,
    weight: 27,
    source: '內建產品資料庫',
  });
  const approved = snapshot.products.find(product => product.productSku === '7GTBD057AB');
  const unmapped = snapshot.products.find(product => product.productSku === '7UNMAPPED');
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(approved.entryType, 'approved-order-sku');
  assert.equal(approved.canonicalProductSku, 'GTBL05');
  assert.equal(approved.newWorkPackagingDefaultVersion, '2026-08-28.2');
  assert.deepEqual(approved.packagingVersions[0], {
    packagingVersion: '2026-08-28.2', effectiveFrom: '2026-08-28', effectiveTo: null,
    unitsPerCarton: 24, cartonDimensionsIn: [20, 16, 12], grossWeightLb: 27,
  });
  assert.equal(unmapped.entryType, 'unmapped-legacy-order-sku');
  assert.equal(unmapped.canonicalProductSku, null);
  assert.equal(unmapped.newWorkEligible, true);
  assert.equal(unmapped.packagingVersions[0].unitsPerCarton, 50);
});

test('schema v3 snapshot retains every owner history, declares current/default, and excludes retired owners only from new work', () => {
  const historical = {
    version:'2026-08-25',
    effectiveFrom:'2026-08-25',
    effectiveTo:'2026-08-27',
    unitsPerCarton:24,
    cartonDimensionsCm:[50.8, 40.64, 30.48],
    grossWeightLb:27,
  };
  const next = {
    ...historical,
    version:'2026-08-28.5',
    effectiveTo:null,
    unitsPerCarton:30,
    cartonDimensionsCm:[58.42, 35.56, 35.56],
    grossWeightLb:35,
  };
  const catalog = {
    schemaVersion:3,
    catalogVersion:'2026-08-28.5',
    products:[{
      productSku:'ACTIVE01',
      lifecycle:'active',
      approvedOrderSkus:['ACTIVE01', '7ACTIVE01'],
      newOrderPackagingDefaultVersion:'2026-08-25',
      packagingVersions:[historical, next],
    }, {
      productSku:'RETIRED01',
      lifecycle:'retired',
      approvedOrderSkus:['RETIRED01', '7RETIRED01'],
      newOrderPackagingDefaultVersion:'2026-08-28.5',
      packagingVersions:[historical, next],
    }],
    orderSkuAliases:[{
      orderSku:'7ACTIVE01',
      canonicalProductSku:'ACTIVE01',
      lifecycle:'approved',
      newOrderPackagingDefaultVersion:'2026-08-28.5',
      packagingVersions:[historical, next],
    }, {
      orderSku:'7RETIRED01',
      canonicalProductSku:'RETIRED01',
      lifecycle:'approved',
      newOrderPackagingDefaultVersion:'2026-08-28.5',
      packagingVersions:[historical, next],
    }],
  };

  const snapshot = adapter.projectCanonicalCatalog(catalog);
  assert.equal(snapshot.schemaVersion, 3);
  const active = snapshot.products.find(product => product.productSku === 'ACTIVE01');
  const activeAlias = snapshot.products.find(product => product.productSku === '7ACTIVE01');
  const retired = snapshot.products.find(product => product.productSku === 'RETIRED01');
  const retiredAlias = snapshot.products.find(product => product.productSku === '7RETIRED01');
  assert.equal(active.newWorkPackagingDefaultVersion, '2026-08-25');
  assert.equal(active.currentPackagingVersion, '2026-08-25');
  assert.equal(active.newWorkEligible, true);
  assert.deepEqual(active.packagingVersions.map(version => version.packagingVersion), ['2026-08-25', '2026-08-28.5']);
  assert.equal(activeAlias.newWorkPackagingDefaultVersion, '2026-08-28.5');
  assert.equal(activeAlias.currentPackagingVersion, '2026-08-28.5');
  assert.equal(activeAlias.newWorkEligible, true);
  assert.equal(retired.newWorkEligible, false);
  assert.equal(retiredAlias.newWorkEligible, false);
  assert.equal(retired.packagingVersions.length, 2, 'retired identity/history remains readable');
  assert.equal(snapshot.products.some(product => Object.hasOwn(product, 'sourceSheet')), false, 'public snapshot must not expose source sheet names');
  assert.equal(snapshot.products.some(product => product.packagingVersions.some(version => Object.hasOwn(version, 'sourceSheet'))), false);

  const legacy = adapter.createLegacyCatalog(snapshot);
  assert.deepEqual(Object.keys(legacy.catalog).sort(), ['7ACTIVE01', 'ACTIVE01']);
  assert.equal(legacy.catalog.ACTIVE01.units, 24, 'new work uses the declared default, even when it is not the latest version');
});

test('an incomplete alias default is history-readable but excluded from FBA new work', () => {
  const historical = {
    version:'2026-08-28.4', effectiveFrom:'2026-08-28', effectiveTo:null,
    unitsPerCarton:24, cartonDimensionsCm:[50.8, 40.64, 30.48], grossWeightLb:27,
  };
  const incomplete = {
    ...historical,
    version:'2026-08-29',
    effectiveFrom:'2026-08-29',
    unitsPerCarton:null,
    cartonDimensionsCm:null,
  };
  const snapshot = adapter.projectCanonicalCatalog({
    schemaVersion:3,
    catalogVersion:'2026-08-29',
    products:[{
      productSku:'ACTIVE01', lifecycle:'active', approvedOrderSkus:['ACTIVE01', '7ACTIVE01'],
      newOrderPackagingDefaultVersion:'2026-08-28.4', packagingVersions:[historical],
    }],
    orderSkuAliases:[{
      orderSku:'7ACTIVE01', canonicalProductSku:'ACTIVE01', lifecycle:'approved',
      newOrderPackagingDefaultVersion:'2026-08-29', packagingVersions:[historical, incomplete],
    }],
  });

  const alias = snapshot.products.find(product => product.productSku === '7ACTIVE01');
  assert.equal(alias.entryType, 'approved-order-sku');
  assert.equal(alias.canonicalProductSku, 'ACTIVE01');
  assert.equal(alias.lifecycle, 'incomplete-packaging');
  assert.equal(alias.newWorkEligible, false);
  assert.deepEqual(alias.packagingVersions.map(version => [version.packagingVersion, version.unitsPerCarton]), [
    ['2026-08-28.4', 24],
    ['2026-08-29', null],
  ]);
  const legacy = adapter.createLegacyCatalog(snapshot);
  assert.equal(Object.hasOwn(legacy.catalog, '7ACTIVE01'), false, 'incomplete default cannot seed new work');
  assert.equal(legacy.catalog.ACTIVE01.units, 24);
});

test('an incomplete Product without FBA carton facts is history-readable but excluded from new work', () => {
  const historical = {
    version:'2026-08-28.4', effectiveFrom:'2026-08-28', effectiveTo:null,
    unitsPerCarton:24, cartonDimensionsCm:[50.8, 40.64, 30.48], grossWeightLb:27,
  };
  const snapshot = adapter.projectCanonicalCatalog({
    schemaVersion:3,
    catalogVersion:'2026-08-29',
    products:[{
      productSku:'INCOMPLETE01', lifecycle:'incomplete', approvedOrderSkus:['INCOMPLETE01'],
      newOrderPackagingDefaultVersion:'2026-08-29',
      packagingVersions:[historical, {
        ...historical, version:'2026-08-29', effectiveFrom:'2026-08-29',
        unitsPerCarton:null, cartonDimensionsCm:null, grossWeightLb:null,
      }],
    }],
    orderSkuAliases:[],
  });

  const product = snapshot.products[0];
  assert.equal(product.lifecycle, 'incomplete');
  assert.equal(product.newWorkEligible, false);
  assert.deepEqual(product.packagingVersions.map(version => [version.packagingVersion, version.unitsPerCarton]), [
    ['2026-08-28.4', 24],
    ['2026-08-29', null],
  ]);
  assert.equal(Object.hasOwn(adapter.createLegacyCatalog(snapshot).catalog, 'INCOMPLETE01'), false);
});

test('a product default without shipment weight remains available to the established FBA repair flow', () => {
  const historical = {
    version:'2026-08-28.4', effectiveFrom:'2026-08-28', effectiveTo:null,
    unitsPerCarton:24, cartonDimensionsCm:[50.8, 40.64, 30.48], grossWeightLb:27,
  };
  const snapshot = adapter.projectCanonicalCatalog({
    schemaVersion:3,
    catalogVersion:'2026-08-29',
    products:[{
      productSku:'ACTIVE01', lifecycle:'incomplete', approvedOrderSkus:['ACTIVE01'],
      newOrderPackagingDefaultVersion:'2026-08-29',
      packagingVersions:[historical, {
        ...historical, version:'2026-08-29', effectiveFrom:'2026-08-29', grossWeightLb:null,
      }],
    }],
    orderSkuAliases:[],
  });
  const product = snapshot.products[0];
  assert.equal(product.lifecycle, 'active');
  assert.equal(product.newWorkEligible, true);
  assert.deepEqual(product.packagingVersions.map(version => [version.packagingVersion, version.grossWeightLb]), [
    ['2026-08-28.4', 27],
    ['2026-08-29', null],
  ]);
  const legacy = adapter.createLegacyCatalog(snapshot);
  assert.equal(Object.hasOwn(legacy.catalog, 'ACTIVE01'), true);
  assert.equal(legacy.catalog.ACTIVE01.weight, null);
});

test('schema v2 and v3 canonical packaging history requires explicit version identities', () => {
  assert.throws(
    () => adapter.projectCanonicalCatalog({
      schemaVersion:3,
      catalogVersion:'2026-08-29',
      products:[{
        productSku:'ACTIVE01', lifecycle:'active', approvedOrderSkus:['ACTIVE01'],
        newOrderPackagingDefaultVersion:'2026-08-29',
        packagingVersions:[{
          version:'', effectiveFrom:'2026-08-29', effectiveTo:null,
          unitsPerCarton:24, cartonDimensionsCm:[50.8, 40.64, 30.48], grossWeightLb:27,
        }],
      }],
      orderSkuAliases:[],
    }),
    error => error instanceof adapter.CatalogValidationError && error.code === 'INVALID_PACKAGING_VERSION',
  );
});

test('schema v3 keeps overlapping historical dates and uses the explicit default as current without guessing from effectiveTo', () => {
  const snapshot = adapter.projectCanonicalCatalog({
    schemaVersion:3,
    catalogVersion:'2026-08-28.6',
    products:[{
      productSku:'OVERLAP01', lifecycle:'active', approvedOrderSkus:['OVERLAP01'],
      newOrderPackagingDefaultVersion:'V2',
      packagingVersions:[
        { version:'V1', effectiveFrom:'2026-08-01', effectiveTo:null, unitsPerCarton:10, cartonDimensionsCm:[50,40,30], grossWeightLb:20 },
        { version:'V2', effectiveFrom:'2026-08-20', effectiveTo:null, unitsPerCarton:12, cartonDimensionsCm:[50,40,30], grossWeightLb:22 },
      ],
    }],
    orderSkuAliases:[],
  });
  const owner = snapshot.products[0];
  assert.deepEqual(owner.packagingVersions.map(version => version.packagingVersion), ['V1', 'V2']);
  assert.equal(owner.currentPackagingVersion, 'V2');
  assert.equal(owner.newWorkPackagingDefaultVersion, 'V2');
  assert.equal(adapter.createLegacyCatalog(snapshot).catalog.OVERLAP01.units, 12);
});

test('schema v3 public snapshot rejects raw workbook source evidence', () => {
  const snapshot = {
    schemaVersion:3, catalogVersion:'2026-08-28.6', projection:'fba-inbound',
    products:[{
      productSku:'PRIVATE01', entryType:'product', canonicalProductSku:'PRIVATE01', lifecycle:'active', newWorkEligible:true,
      currentPackagingVersion:'V1', newWorkPackagingDefaultVersion:'V1', sourceSheet:'AMZ 所有SKU',
      packagingVersions:[{ packagingVersion:'V1', effectiveFrom:'2026-08-28', effectiveTo:null, unitsPerCarton:10, cartonDimensionsIn:[20,16,12], grossWeightLb:20 }],
    }],
  };
  assert.throws(
    () => adapter.validateFbaSnapshot(snapshot),
    error => error instanceof adapter.CatalogValidationError && error.code === 'PRIVATE_SOURCE_EVIDENCE',
  );
  delete snapshot.products[0].sourceSheet;
  snapshot.products[0].packagingVersions[0].source = { sheet:'AMZ 所有SKU', row:2 };
  assert.throws(
    () => adapter.validateFbaSnapshot(snapshot),
    error => error instanceof adapter.CatalogValidationError && error.code === 'PRIVATE_SOURCE_EVIDENCE',
  );
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
          version:'2026-08-28.3',
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
          version:'2026-08-28.2',
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
          version:'2026-08-28.2',
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

test('migration coverage blocks removal or mutation of a named immutable historical packaging version', () => {
  const version = (packagingVersion, unitsPerCarton) => ({
    packagingVersion, unitsPerCarton, cartonDimensionsIn:[20, 16, 12], grossWeightLb:27,
  });
  const previous = {
    products:[{
      productSku:'PRODUCT-1', entryType:'product', newWorkPackagingDefaultVersion:'V2',
      packagingVersions:[version('V1', 30), version('V2', 24)],
    }],
  };
  const mutated = {
    products:[{
      productSku:'PRODUCT-1', entryType:'product', newWorkPackagingDefaultVersion:'V2',
      packagingVersions:[version('V1', 31), version('V2', 24), version('V3', 20)],
    }],
  };
  assert.deepEqual(analyzeLegacyCoverage(previous, mutated).packagingDataLoss, [{
    sku:'PRODUCT-1', fields:['packagingVersions[V1].unitsPerCarton'],
  }]);

  const removed = {
    products:[{
      productSku:'PRODUCT-1', entryType:'product', newWorkPackagingDefaultVersion:'V2',
      packagingVersions:[version('V2', 24), version('V3', 20)],
    }],
  };
  assert.deepEqual(analyzeLegacyCoverage(previous, removed).packagingDataLoss, [{
    sku:'PRODUCT-1', fields:['packagingVersions[V1]'],
  }]);
});
