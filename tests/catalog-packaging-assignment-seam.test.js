const assert = require('node:assert/strict');
const test = require('node:test');

const Catalog = require('../product-catalog.js');
const Packaging = require('../packaging-assignment.js');

const OLD_VERSION = '2026-08-28.1';
const NEW_VERSION = '2026-08-29.1';
const ALIAS_SKU = '7GTBD057AB';

function packaging(version, unitsPerCarton, grossWeightLb = 35, effectiveTo = null) {
  return {
    version,
    effectiveFrom:version.slice(0, 10),
    effectiveTo,
    unitsPerCarton,
    cartonsPerPallet:40,
    cartonDimensionsCm:[50.8, 40.64, 30.48],
    grossWeightKg:null,
    grossWeightLb,
    orderUnit:{ kind:'single', units:1 },
    source:{ sheet:'AMZ 所有SKU', row:8 },
  };
}

function canonicalCatalog(catalogVersion, defaultVersion) {
  const productVersions = catalogVersion === OLD_VERSION
    ? [packaging(OLD_VERSION, 30)]
    : [packaging(OLD_VERSION, 30, 35, '2026-08-28'), packaging(NEW_VERSION, 24, 27)];
  const aliasVersions = catalogVersion === OLD_VERSION
    ? [packaging(OLD_VERSION, 24, 27)]
    : [packaging(OLD_VERSION, 24, 27, '2026-08-28'), packaging(NEW_VERSION, 20, 24)];
  return {
    schemaVersion:3,
    catalogVersion,
    products:[{
      productSku:'GTBL05',
      productName:'GTBL05',
      origin:'VN',
      standardFactory:'VN',
      lifecycle:'active',
      approvedOrderSkus:['GTBL05', ALIAS_SKU],
      newOrderPackagingDefaultVersion:defaultVersion,
      packagingVersions:productVersions,
    }],
    orderSkuAliases:[{
      orderSku:ALIAS_SKU,
      canonicalProductSku:'GTBL05',
      lifecycle:'approved',
      newOrderPackagingDefaultVersion:defaultVersion,
      packagingVersions:aliasVersions,
    }],
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem:key => values.has(key) ? values.get(key) : null,
    setItem:(key, value) => values.set(key, String(value)),
    removeItem:key => values.delete(key),
  };
}

test('FBA catalog updates affect only new assignments while new, known legacy, historical, and alias work retain persisted facts', () => {
  const oldSnapshot = Catalog.projectCanonicalCatalog(canonicalCatalog(OLD_VERSION, OLD_VERSION));
  const oldIndex = Packaging.createCatalogIndex(oldSnapshot);
  const storage = memoryStorage();
  const ledger = Packaging.createLedger(storage, {
    batchId:'cross-feature-batch',
    now:'2026-08-28T10:00:00.000Z',
  });

  const newWork = ledger.assignCurrent({
    rowKey:'new-before-update',
    sku:'GTBL05',
    current:oldIndex.GTBL05,
  });
  const knownLegacy = ledger.migrateLegacy({
    rowKey:'known-legacy',
    sku:'GTBL05',
    knownFacts:{ unitsPerCarton:30 },
    candidates:oldIndex.GTBL05.candidates,
    fallbackFacts:oldIndex.GTBL05.facts,
    catalogVersion:oldSnapshot.catalogVersion,
    sourceSheet:'legacy inbound workbook',
  });
  const historical = ledger.migrateLegacy({
    rowKey:'historical-imported',
    sku:'GTBL05',
    knownFacts:{ unitsPerCarton:27 },
    candidates:oldIndex.GTBL05.candidates,
    fallbackFacts:oldIndex.GTBL05.facts,
    catalogVersion:oldSnapshot.catalogVersion,
    sourceSheet:'legacy inbound workbook',
  });
  const reviewedHistorical = ledger.review('historical-imported');
  const aliasWork = ledger.assignCurrent({
    rowKey:'alias-before-update',
    sku:ALIAS_SKU,
    current:oldIndex[ALIAS_SKU],
  });

  assert.deepEqual({
    newWork:[newWork.kind, newWork.packagingVersion, newWork.facts.unitsPerCarton],
    knownLegacy:[knownLegacy.kind, knownLegacy.packagingVersion, knownLegacy.migrationMethod],
    historical:[reviewedHistorical.kind, reviewedHistorical.packagingVersion, reviewedHistorical.facts.unitsPerCarton, reviewedHistorical.reviewRequired],
    alias:[aliasWork.kind, aliasWork.packagingVersion, aliasWork.facts.unitsPerCarton],
  }, {
    newWork:['catalog-version', OLD_VERSION, 30],
    knownLegacy:['catalog-version', OLD_VERSION, 'known-facts-exact-match'],
    historical:['historical-imported', null, 27, false],
    alias:['catalog-version', OLD_VERSION, 24],
  });

  const newSnapshot = Catalog.projectCanonicalCatalog(canonicalCatalog(NEW_VERSION, NEW_VERSION));
  const newIndex = Packaging.createCatalogIndex(newSnapshot);
  const reloaded = Packaging.createLedger(storage, {
    batchId:'cross-feature-batch',
    now:'2026-08-29T10:00:00.000Z',
  });
  const afterUpdate = reloaded.assignCurrent({
    rowKey:'new-after-update',
    sku:'GTBL05',
    current:newIndex.GTBL05,
  });

  assert.deepEqual({
    oldNewWork:[reloaded.get('new-before-update').packagingVersion, reloaded.get('new-before-update').facts.unitsPerCarton],
    oldKnown:[reloaded.get('known-legacy').packagingVersion, reloaded.get('known-legacy').facts.unitsPerCarton],
    oldHistorical:[reloaded.get('historical-imported').kind, reloaded.get('historical-imported').facts.unitsPerCarton],
    oldAlias:[reloaded.get('alias-before-update').packagingVersion, reloaded.get('alias-before-update').facts.unitsPerCarton],
    newWork:[afterUpdate.packagingVersion, afterUpdate.facts.unitsPerCarton],
    oldComparison:reloaded.compare('new-before-update', newIndex.GTBL05).newerAvailable,
    historicalComparison:reloaded.compare('historical-imported', newIndex.GTBL05).newerAvailable,
    aliasComparison:reloaded.compare('alias-before-update', newIndex[ALIAS_SKU]).newerAvailable,
  }, {
    oldNewWork:[OLD_VERSION, 30],
    oldKnown:[OLD_VERSION, 30],
    oldHistorical:['historical-imported', 27],
    oldAlias:[OLD_VERSION, 24],
    newWork:[NEW_VERSION, 24],
    oldComparison:true,
    historicalComparison:true,
    aliasComparison:true,
  });
});
