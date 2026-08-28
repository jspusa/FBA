const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const alignment = require('../catalog-alignment-status.js');
const alignmentUi = require('../catalog-alignment-ui.js');

const supplyHash = 'a'.repeat(64);
const fbaHash = 'b'.repeat(64);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function hashPublicContent(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function manifest(site, overrides = {}) {
  const expectedPublicContentHashes = { supply:supplyHash, fba:fbaHash };
  return {
    schemaVersion:1,
    catalogVersion:'2026-08-28.5',
    site,
    publicContentHash:expectedPublicContentHashes[site],
    expectedPublicContentHashes,
    ...overrides,
  };
}

test('FBA consumes the compact Catalog Alignment manifest without a full peer catalog', () => {
  const supply = manifest('supply');
  const fba = manifest('fba');
  assert.deepEqual(alignment.evaluateCatalogAlignmentManifests(fba, supply), {
    state:'aligned',
    catalogVersion:'2026-08-28.5',
    localSite:'fba',
    peerSite:'supply',
    issues:[],
  });
  assert.deepEqual(Object.keys(alignment.validateCatalogAlignmentManifest(fba)).sort(), [
    'catalogVersion',
    'expectedPublicContentHashes',
    'publicContentHash',
    'schemaVersion',
    'site',
  ]);
});

test('checked-in FBA manifest hashes the exact standalone FBA projection', () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'catalog-alignment.json'), 'utf8'));
  const projection = JSON.parse(fs.readFileSync(path.join(root, 'catalog', 'fba-product-catalog.snapshot.json'), 'utf8'));

  assert.equal(manifest.site, 'fba');
  assert.equal(manifest.catalogVersion, projection.catalogVersion);
  assert.equal(manifest.publicContentHash, hashPublicContent(projection));
  assert.equal(manifest.publicContentHash, manifest.expectedPublicContentHashes.fba);
});

test('FBA keeps partial deployment red until the peer version and expected hashes match', () => {
  const fba = manifest('fba');
  const staleSupply = manifest('supply', {
    catalogVersion:'2026-08-28.4',
    expectedPublicContentHashes:{ supply:'c'.repeat(64), fba:'d'.repeat(64) },
    publicContentHash:'c'.repeat(64),
  });
  const result = alignment.evaluateCatalogAlignmentManifests(fba, staleSupply);

  assert.equal(result.state, 'failed');
  assert.deepEqual(result.issues.map(item => item.code), [
    'catalog-version-mismatch',
    'expected-public-content-hash-mismatch',
  ]);
});

test('FBA consumer has no network call, notification integration, or peer product payload', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'catalog-alignment-status.js'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /products|orderSkuAliases/);
  assert.doesNotMatch(source, /email|line|notification/i);
});

test('an old local FBA build sees the newer Supply compact manifest and requests only an FBA retry', async () => {
  const storageValues = new Map();
  const storage = {
    getItem:key => storageValues.get(key) || null,
    setItem:(key, value) => storageValues.set(key, value),
  };
  const oldFba = manifest('fba', {
    catalogVersion:'2026-08-28.9',
    expectedPublicContentHashes:{ supply:'c'.repeat(64), fba:'d'.repeat(64) },
    publicContentHash:'d'.repeat(64),
  });
  const newSupply = manifest('supply', { catalogVersion:'2026-08-28.10' });
  const requests = [];
  const controller = alignmentUi.createCatalogAlignmentController({
    site:'fba',
    localManifestUrl:'./catalog-alignment.json',
    peerManifestUrl:'../Supply/catalog-alignment.json',
    storage,
    now:() => '2026-08-28T08:00:00.000Z',
    fetchImpl:async url => {
      requests.push(url);
      return { ok:true, status:200, json:async () => url.startsWith('./') ? oldFba : newSupply };
    },
  });

  const status = await controller.refresh();
  assert.equal(status.state, 'failed');
  assert.deepEqual(status.retrySites, ['fba']);
  assert.deepEqual(requests, ['./catalog-alignment.json', '../Supply/catalog-alignment.json']);
});

test('all FBA pages load the local and peer compact manifest UI contract', () => {
  const htmlFiles = ['index.html', 'inbound-plan.html', 'shipment.html', 'sorter.html', 'email.html'];
  for (const file of htmlFiles) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    assert.match(source, /catalog-alignment-status\.css/, file);
    assert.match(source, /catalog-alignment-status\.js/, file);
    assert.match(source, /catalog-alignment-ui\.js/, file);
    assert.match(source, /data-local-manifest="\.\/catalog-alignment\.json"/, file);
    assert.match(source, /data-peer-manifest="\.\.\/Supply\/catalog-alignment\.json"/, file);
    assert.doesNotMatch(source, /data-peer-manifest="[^\"]*(?:product-data|product-catalog)/, file);
  }
});
