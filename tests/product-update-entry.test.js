const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function signedPlan() {
  const plan = {
    schemaVersion:1,
    generatedAt:'2026-08-28T10:00:00.000Z',
    sourceFile:'raw-product.xlsx',
    baseline:{ catalogVersion:'2026-08-28.4', sha256:'a'.repeat(64) },
    candidate:{ catalogVersion:'2026-08-28.5', sha256:'b'.repeat(64) },
    stats:{
      productsBefore:1, productsAfter:1, aliasesBefore:1, aliasesAfter:1,
      added:0, updated:1, removed:0, changedEntries:1,
      safe:1, review:0, blocking:0, selected:1,
    },
    blockers:[],
    entries:[{
      id:'order-sku-alias:7ABCD013AB', kind:'catalog-change', entryType:'order-sku-alias',
      sku:'7ABCD013AB', changeType:'updated', risk:'safe', selectable:true, selected:true,
      fields:[{ field:'unitsPerCarton', before:24, after:30 }],
      before:{ unitsPerCarton:24 }, after:{ unitsPerCarton:30 },
      evidence:{ sources:[{ sheet:'Products', row:2, packagingVersion:'2026-08-28.5' }], impact:['fba-carton-projection'] },
    }],
  };
  plan.planSha256 = crypto.createHash('sha256').update(JSON.stringify(canonical(plan))).digest('hex');
  return plan;
}

test('FBA verifies a signed plan and creates only the public selection handoff', async () => {
  const ui = await import('../product-update-entry.mjs');
  const contract = await import('../catalog-update-handoff.mjs');
  const plan = signedPlan();
  const validated = await ui.validateCatalogChangePlanForReview(plan, { cryptoRef:crypto.webcrypto });
  assert.equal(validated.entries[0].selected, true);
  const handoff = contract.createCatalogUpdateHandoff(plan, [plan.entries[0].id], {
    confirmedAt:'2026-08-28T10:30:00.000Z',
  });
  assert.equal(handoff.selectedEntryIds[0], plan.entries[0].id);
  assert.doesNotMatch(JSON.stringify(handoff), /sourceFile|sourceRow|sourceSheet|before|after|raw-product/);

  const tampered = structuredClone(plan);
  tampered.entries[0].fields[0].after = 31;
  await assert.rejects(
    () => ui.validateCatalogChangePlanForReview(tampered, { cryptoRef:crypto.webcrypto }),
    error => error.code === 'PLAN_SIGNATURE_MISMATCH',
  );
});

test('all FBA pages load the same Product Update Entry without navigation or browser persistence', () => {
  const htmlFiles = ['index.html', 'inbound-plan.html', 'shipment.html', 'sorter.html', 'email.html'];
  for (const file of htmlFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /product-update-entry\.css/, file);
    assert.match(source, /vendor\/xlsx\.full\.min\.js/, file);
    assert.match(source, /shared-product-catalog\.js/, file);
    assert.match(source, /catalog-update-baseline\.js/, file);
    assert.match(source, /product-update-entry\.mjs" data-product-update-site="fba"/, file);
  }
  const source = fs.readFileSync(path.join(root, 'product-update-entry.mjs'), 'utf8');
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.setItem|indexedDB|location\.(?:reload|href)|fetch\s*\(/);
  assert.match(source, /cryptoRef\.subtle\.digest\('SHA-256'/);
  assert.match(source, /role="alertdialog"/);
  assert.match(source, /event\.key !== 'Tab'/);
  const css = fs.readFileSync(path.join(root, 'product-update-entry.css'), 'utf8');
  assert.match(css, /@media\(max-width:680px\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});

test('FBA local Catalog Update runtime matches its Supply-owned lock and publishes no canonical source rows', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'catalog-update-runtime-lock.json'), 'utf8'));
  assert.equal(lock.canonicalOwner, 'jspusa/Supply');
  for (const [file, expected] of Object.entries(lock.files)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    assert.equal(actual, expected, file);
  }
  const baseline = fs.readFileSync(path.join(root, 'catalog-update-baseline.js'), 'utf8');
  assert.doesNotMatch(baseline, /"source"\s*:|\/Users\//);
});

test('FBA can create the same signed plan directly from a raw workbook without storage', async () => {
  const planner = await import('../catalog-update-planner.mjs');
  const rawApi = require('../shared-product-catalog.js');
  const top = Array(23).fill('');
  const headers = Array(23).fill('');
  const row = Array(23).fill('');
  top[2] = '產地'; top[4] = '包數/箱'; top[17] = '紙箱規格'; top[18] = '箱/棧板'; top[21] = '每箱產品的毛重';
  headers[1] = 'SKU'; headers[22] = 'GW (lb)';
  row[1] = 'ABC01'; row[2] = '越南'; row[4] = 30; row[17] = '50*40*30'; row[18] = 42; row[22] = 29;
  const workbook = { SheetNames:['AMZ 所有SKU'], Sheets:{ 'AMZ 所有SKU':{ rows:[top, headers, row] } } };
  const xlsxRef = { read:() => workbook, utils:{ sheet_to_json:sheet => sheet.rows } };
  const baseline = {
    schemaVersion:3, catalogVersion:'2026-08-28.4',
    products:[{
      productSku:'ABC01', productName:'Product', origin:'VN', standardFactory:'VN', lifecycle:'active',
      approvedOrderSkus:['ABC01'], newOrderPackagingDefaultVersion:'2026-08-28.4',
      packagingVersions:[{
        version:'2026-08-28.4', effectiveFrom:'2026-08-28', effectiveTo:null,
        unitsPerCarton:24, cartonsPerPallet:42, cartonDimensionsCm:[50,40,30], grossWeightKg:null,
        grossWeightLb:29, orderUnit:{ kind:'single', units:1 },
      }],
    }], orderSkuAliases:[],
  };
  const result = await planner.planRawProductCatalogUpdate({
    workbookData:new Uint8Array([1]).buffer,
    sourceFile:'raw.xlsx', baselineCatalog:baseline, xlsxRef, rawCatalogApi:rawApi,
    generatedAt:'2026-08-29T01:02:03.000Z',
  });
  assert.equal(result.plan.candidate.catalogVersion, '2026-08-29');
  assert.equal(result.plan.entries[0].selected, true);
  assert.match(result.plan.planSha256, /^[a-f0-9]{64}$/);
});
