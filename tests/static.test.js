const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['index.html', 'inbound-plan.html', 'shipment.html', 'sorter.html', 'email.html'];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unterminated function ${name}`);
}

function loadInlineFunction(file, name, globals = {}) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(`${extractFunction(read(file), name)};this.fn=${name};`, context, { filename: file });
  return context.fn;
}

test('all workflow pages load shared workspace behavior', () => {
  const expectedTabs = ['補貨整合', '入庫計畫', '棧板擷取', 'FBA 整理', '出貨通知'];
  for (const file of htmlFiles) {
    const source = read(file);
    assert.match(source, /<script src="shared-workspace\.js(?:\?v=[^"]+)?"><\/script>/, file);
    assert.match(source, /<link rel="stylesheet" href="workspace-shell\.css"\s*\/>/, file);
    assert.match(source, /id="clearWorkspaceBtn"/, file);
    assert.equal((source.match(/aria-current="page"/g) || []).length, 1, file);
    const nav = source.match(/<nav class="top-tabs"[\s\S]*?<\/nav>/)?.[0] || '';
    assert.deepEqual([...nav.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map(match => match[1]), expectedTabs, file);
  }
});

test('shared header keeps navigation centered and reset action green', () => {
  const source = read('workspace-shell.css');
  assert.match(source, /grid-template-columns:minmax\(210px,1fr\) auto minmax\(210px,1fr\)/);
  assert.match(source, /justify-self:center/);
  assert.match(source, /background:#e8f7ed!important/);
  assert.match(source, /color:#176b2c!important/);
});

test('FBA owns a stamped normal-light visual-system artifact', async () => {
  const source = read('workspace-shell.css');
  const { verifyVisualSystem } = await import('../scripts/visual-system-contract.mjs');
  const contract = verifyVisualSystem(source);
  assert.equal(contract.version, '1.0.0');
  assert.equal(contract.mode, 'normal-light');
  assert.match(contract.contentHash, /^[a-f0-9]{64}$/);
  assert.match(source, /--workspace-page:#f5f5f7/);
  assert.match(source, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(source, /fba-night|fba-door-transition|芝麻開門/);
});

test('workspace reset clears localStorage and IndexedDB', () => {
  const source = read('shared-workspace.js');
  assert.match(source, /localStorage\.removeItem/);
  assert.match(source, /const SORTER_DB = 'fba-workspace'/);
  assert.match(source, /indexedDB\.deleteDatabase\(SORTER_DB\)/);
});

test('inbound plan and email clear their linked page state together', () => {
  const source = read('shared-workspace.js');
  const inbound = read('inbound-plan.html');
  assert.match(source, /const LINKED_CLEAR_PAGES = \['inbound-plan\.html', 'email\.html'\]/);
  assert.match(source, /LINKED_CLEAR_PAGES\.includes\(PAGE\)/);
  assert.match(source, /localStorage\.removeItem\(`fba-workspace:form:\$\{page\}`\)/);
  assert.match(source, /formStateRequest\('readwrite', store => store\.delete\(page\)\)/);
  assert.match(source, /這兩頁的輸入與結果會一併清除，其他三頁會保留/);
  assert.match(source, /window\.FBAWorkspaceIsClearing = true/);
  assert.match(inbound, /if\(window\.FBAWorkspaceIsClearing\)return/);
});

test('workspace reset uses an accessible in-page confirmation instead of blocking native dialogs', () => {
  const source = read('shared-workspace.js');
  assert.doesNotMatch(source, /window\.confirm\(/);
  assert.match(source, /role="alertdialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /fba-confirm-cancel/);
  assert.match(source, /fba-confirm-accept/);
  assert.match(source, /event\.key === 'Escape'/);
});

test('email does not invent a truck count and reports its data source', () => {
  const source = read('email.html');
  assert.doesNotMatch(source, /id="truckCount"[^>]*value="5"/);
  assert.match(source, /id="workspaceSource"/);
});

test('email generator separates FBA and AWD messages and excludes departed recipients', () => {
  const source = read('email.html');
  assert.match(source, /id="buildFbaEmailBtn"[^>]*>產生FBA信件</);
  assert.match(source, /id="buildAwdEmailBtn"[^>]*>產生AWD信件</);
  assert.match(source, /\[For \$\{shipmentType\}\]/);
  assert.match(source, /maximum pallet height is 60 inches/);
  assert.match(source, /shipmentType==='AWD'/);
  assert.doesNotMatch(source, /ray\.chen@jasperpet\.com|>\s*Ray\s*</i);
  assert.match(source, /id="ccStatus"[^>]*>已預選 6 人</);
});

test('email table cannot float beside the Outlook signature and leaves one blank line', () => {
  const source = read('email.html');
  assert.doesNotMatch(source, /<table class="email-table"[^>]*\salign="left"/);
  assert.match(source, /const signatureSpacer='<p style="margin:0;clear:both;line-height:1\.7;">&nbsp;<\/p>'/);
  assert.match(source, /\$\{table\}\$\{signatureSpacer\}<\/div>`/);
});

test('sorter summary is batch-scoped and invalidated when unverifiable', () => {
  const source = read('sorter.html');
  assert.match(source, /batchId:\s*currentBatchId\(\)/);
  assert.match(source, /localStorage\.removeItem\(SORTER_SUMMARY_KEY\)/);
  assert.match(source, /add\('warning'/);
  assert.match(source, /add\('error'/);
});

test('shipment calculator exposes validation status and configurable capacity', () => {
  const source = read('shipment.html');
  assert.match(source, /id="shipmentStatus"/);
  assert.match(source, /id="cartonsPerPallet"/);
  assert.match(source, /<script src="fba-core\.js"><\/script>/);
});

test('inline JavaScript is syntactically valid', () => {
  for (const file of htmlFiles) {
    const source = read(file);
    const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1])
      .filter((script) => script.trim());
    scripts.forEach((script, index) => {
      assert.doesNotThrow(() => new vm.Script(script, { filename: `${file}:inline-${index + 1}` }));
    });
  }
});

test('restock page uses the shared Inventory column detector', () => {
  const source = read('index.html');
  assert.match(source, /<script src="fba-core\.js\?v=[^"]+"><\/script>/);
  assert.match(source, /window\.FBACore\.detectInventoryColumns\(headers,rows\)/);
  assert.doesNotMatch(source, /Inventory update 檔案缺欄位。/);
  assert.match(source, /缺少必要欄位：EXPIRE/);
});

test('prefilled inbound-plan cartons stay numeric in exported Excel', () => {
  const coerceCellValue = loadInlineFunction('index.html', 'coerceCellValue', {
    isNumericLike: (value) => !(value == null || value === '') && Number.isFinite(Number(String(value).replace(/,/g, '').trim())),
    toNumber: (value) => {
      if (value == null || value === '') return 0;
      const number = Number(String(value).replace(/,/g, '').trim());
      return Number.isFinite(number) ? number : 0;
    },
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(coerceCellValue('入庫計畫', 30))),
    { v: 30, t: 'n', z: '0' },
  );
});

test('under-five classification uses total eligible cartons, not the first expiry lot', () => {
  const source = read('index.html');
  const line = source.split('\n').find((candidate) => candidate.includes('underFive.push(eligibleRowStandard)'));
  assert.ok(line, 'Missing under-five classification branch');
  const expression = line.match(/if\((.*)\) underFive\.push\(eligibleRowStandard\)/)?.[1];
  assert.ok(expression, 'Unable to extract under-five classification expression');
  const classified = vm.runInNewContext(expression, {
    eligibleQty: 107,
    cappedToFirstExpiry: true,
    firstEligibleQty: 2,
  });
  assert.equal(classified, false);
});

test('email accepts an unambiguous headerless shipment row', () => {
  const parseData = loadInlineFunction('email.html', 'parseData', {
    parsePositiveInteger: (value, label) => {
      const raw = String(value ?? '').trim();
      const number = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isInteger(number) || number < 1) throw new Error(`${label}必須是正整數。`);
      return number;
    },
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(parseData('ATAL01\t30\t1260\t6/28'))),
    {
      rows: [{ sku: 'ATAL01', ctn: 30, quantity: 1260, expire: '6/28' }],
      totalCtn: 30,
      totalQuantity: 1260,
    },
  );
});

test('email keeps headered shipment parsing and rejects incomplete headers', () => {
  const parseData = loadInlineFunction('email.html', 'parseData', {
    parsePositiveInteger: (value, label) => {
      const raw = String(value ?? '').trim();
      const number = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isInteger(number) || number < 1) throw new Error(`${label}必須是正整數。`);
      return number;
    },
  });
  assert.equal(parseData('SKU\t入庫計畫\t入庫包數\tEXPIRE\nATAL01\t30\t1260\t6/28').totalQuantity, 1260);
  assert.throws(
    () => parseData('SKU\t入庫計畫\tEXPIRE\nATAL01\t30\t6/28'),
    /資料需要包含 SKU/,
  );
});

test('built-in catalog matches the exact 15-SKU facts for the checked release', () => {
  const source = read('inbound-plan.html');
  const document = JSON.parse(read('catalog/fba-product-catalog.snapshot.json'));
  const { catalog } = require('../product-catalog.js').createLegacyCatalog(document);
  const addedSkus = [
    '1AXXD002A0', '1GLTD011A0', '1MHTD017A0', '1MHTD027A0', '1MHTD037A0', '1MHTD047A0', '1MHTD057A0',
    '1VFPD010A0', '1VFPD018A0', '1VFPD050A0', '1VFPD058A0', '1VFRD010A0', '1VFSD010A0', '1VFSD018A0',
    '7ATRD013AB', '7ATSD010AB', '7ATSD017AB', '7ATSD019AB', '7GTBD013AB', '7GTBD017AB', '7GTBD037AB',
    '7GTBD053AB', '7GTBD057AB', '7GTPD013AB', '7GTPD017AB', '7GTPD037AB', '7GTPD053AB', '7GTPD057AB',
    '7GTRD013AB', '7GTRD017AB', '7GTRD037AB', '7GTSD013AB', '7GTSD017AB',
  ];
  const changedSkus = document.catalogVersion === '2026-09-02' ? {
    GTP03: { units: 90, length: 20, width: 16, height: 12, weight: 24, source: 'AMZ 所有SKU' },
    GTPL03: { units: 24, length: 20, width: 16, height: 12, weight: 29, source: 'AMZ 所有SKU' },
    GTBL03: { units: 28, length: 20, width: 16, height: 12, weight: 33, source: 'AMZ 所有SKU' },
    GTRL03: { units: 28, length: 20, width: 16, height: 12, weight: 33, source: 'AMZ 所有SKU' },
    GTCL01: { units: 28, length: 20, width: 16, height: 12, weight: 33, source: 'AMZ 所有SKU' },
    GTAL01: { units: 30, length: 20, width: 16, height: 12, weight: 35, source: 'AMZ 所有SKU' },
    GTP05: { units: 90, length: 20, width: 16, height: 12, weight: 26, source: 'AMZ 所有SKU' },
    GTPL05: { units: 24, length: 20, width: 16, height: 12, weight: 29, source: 'AMZ 所有SKU' },
    GTB05: { units: 90, length: 20, width: 16, height: 12, weight: 26, source: 'AMZ 所有SKU' },
    GTBL05: { units: 24, length: 20, width: 16, height: 12, weight: 29, source: 'AMZ 所有SKU' },
    GTSL01: { units: 24, length: 20, width: 16, height: 12, weight: 29, source: 'AMZ 所有SKU' },
    GTPL01: { units: 24, length: 20, width: 16, height: 12, weight: 29, source: 'AMZ 所有SKU' },
    GTBL01: { units: 26, length: 20, width: 16, height: 12, weight: 31, source: 'AMZ 所有SKU' },
    GTRL01: { units: 22, length: 20, width: 16, height: 12, weight: 26, source: 'AMZ 所有SKU' },
    '1ABRD002A0': { units: 36, length: 20, width: 16, height: 12, weight: 32, source: 'AMZ 所有SKU' },
  } : {
    GTP03: { units: 100, length: 23, width: 14, height: 14, weight: 26, source: 'AMZ 所有SKU' },
    GTPL03: { units: 30, length: 20, width: 16, height: 16, weight: 35, source: 'AMZ 所有SKU' },
    GTBL03: { units: 30, length: 20, width: 16, height: 16, weight: 35, source: 'AMZ 所有SKU' },
    GTRL03: { units: 30, length: 20, width: 16, height: 16, weight: 35, source: 'AMZ 所有SKU' },
    GTCL01: { units: 30, length: 20, width: 16, height: 16, weight: 35, source: 'AMZ 所有SKU' },
    GTAL01: { units: 38, length: 20, width: 16, height: 16, weight: 44, source: 'AMZ 所有SKU' },
    GTP05: { units: 100, length: 23, width: 14, height: 14, weight: 29, source: 'AMZ 所有SKU' },
    GTPL05: { units: 30, length: 20, width: 16, height: 16, weight: 35, source: 'AMZ 所有SKU' },
    GTB05: { units: 100, length: 23, width: 14, height: 14, weight: 29, source: 'AMZ 所有SKU' },
    GTBL05: { units: 30, length: 20, width: 16, height: 16, weight: 35, source: 'AMZ 所有SKU' },
    GTSL01: { units: 30, length: 20, width: 16, height: 16, weight: 35, source: 'AMZ 所有SKU' },
    GTPL01: { units: 30, length: 20, width: 16, height: 16, weight: 35, source: 'AMZ 所有SKU' },
    GTBL01: { units: 30, length: 20, width: 16, height: 16, weight: 35, source: 'AMZ 所有SKU' },
    GTRL01: { units: 30, length: 20, width: 16, height: 16, weight: 35, source: 'AMZ 所有SKU' },
    '1ABRD002A0': { units: 42, length: 20, width: 16, height: 12, weight: 37, source: 'AMZ 所有SKU' },
  };
  assert.ok(addedSkus.every((sku) => catalog[sku]), 'Missing one or more newly added SKUs');
  for (const [sku, product] of Object.entries(changedSkus)) {
    const actual = catalog[sku];
    assert.deepEqual(
      [actual.units, actual.length, actual.width, actual.height, actual.weight],
      [product.units, product.length, product.width, product.height, product.weight],
      sku,
    );
    assert.ok(actual.source, `${sku} must retain catalog provenance`);
  }
  assert.ok(Object.keys(catalog).length >= 307);
  assert.match(document.catalogVersion, /^(?:2026-08-28\.4|2026-09-02)$/);
  assert.equal(document.projection, 'fba-inbound');
  assert.match(source, /<script src="product-catalog\.js"><\/script>/);
  assert.match(source, /const BUILTIN_CATALOG_VERSION=BUILTIN_CATALOG_ADAPTER\.catalogVersion/);
});

test('catalog import loads the same persistent raw-file adapter used by Supply', () => {
  const source = read('inbound-plan.html');
  assert.match(source, /<script src="shared-product-catalog\.js"><\/script>/);
  assert.match(source, /SHARED_CATALOG_API\.saveToStorage\(payload,localStorage\)/);
  assert.match(source, /正式內建更新由發布流程完成/);
});

test('inbound rows load and preserve explicit packaging assignments through review and export', () => {
  const source = read('inbound-plan.html');
  const workspace = read('shared-workspace.js');
  assert.match(source, /<script src="packaging-assignment\.js"><\/script>/);
  assert.match(source, /<script src="inbound-row-identity\.js"><\/script>/);
  assert.match(source, /INBOUND_ROW_IDENTITIES\.reconcile/);
  assert.match(source, /rowKey=identity\.rowId/);
  assert.match(source, /PACKAGING_ASSIGNMENTS\.get\(rowKey\)/);
  assert.match(source, /PACKAGING_ASSIGNMENTS\.migrateLegacy/);
  assert.match(source, /candidates:owner\?\.candidates\|\|\[\]/);
  assert.match(source, /owner\?\.newWorkEligible/);
  assert.match(source, /PACKAGING_LEGACY_IMPORT_PENDING=Object\.keys\(PACKAGING_ASSIGNMENTS\.entries\(\)\)\.length===0\|\|INBOUND_ROW_IDENTITIES\.entries\(\)\.length===0/);
  assert.match(source, /packagingAssignment\.reviewRequired/);
  assert.match(source, /packagingAssignmentHtml\(r\.packagingAssignment\)/);
  assert.match(source, /merchantSkuHtml\(r\)/);
  assert.doesNotMatch(source, /class="packaging-newer"/);
  assert.match(source, /請先完成所有歷史包裝複查/);
  assert.match(workspace, /localStorage\.removeItem\('fba-workspace:packaging-assignments:v1'\)/);
  assert.match(workspace, /localStorage\.removeItem\('fba-workspace:inbound-row-identities:v1'\)/);
});

test('newer packaging notice stays behind the clickable SKU with a plain-language explanation', () => {
  const merchantSkuHtml = loadInlineFunction('inbound-plan.html', 'merchantSkuHtml', {
    escapeCatalogHtml: value => String(value),
  });
  const ordinary = merchantSkuHtml({
    sku: 'GTB01',
    packagingAssignment: { newerAvailable: false },
  });
  assert.match(ordinary, />GTB01</);
  assert.doesNotMatch(ordinary, /<details/);

  const historical = merchantSkuHtml({
    sku: 'GTBL05',
    packagingAssignment: {
      kind: 'historical-imported',
      newerAvailable: true,
      currentPackagingVersion: '2026-08-28.4',
    },
  });
  assert.match(historical, /<details class="sku-packaging-details">/);
  assert.match(historical, /這不是錯誤，也不需要處理/);
  assert.match(historical, /2026-08-28\.4/);
  assert.match(historical, /不會自動替換/);
});

test('temporary product override blocks source conflicts instead of using first-row-wins', () => {
  const conflictCount = loadInlineFunction('inbound-plan.html', 'catalogConflictCount');
  assert.equal(conflictCount({ stats: { duplicateConflicts: 2 }, conflicts: [] }), 2);
  assert.equal(conflictCount({ stats: { sourceConflicts: 3 }, conflicts: [] }), 3);
  assert.equal(conflictCount({ stats: {}, conflicts: [{}, {}, {}, {}] }), 4);
  const source = read('inbound-plan.html');
  assert.match(source, /已拒絕臨時套用/);
  assert.doesNotMatch(source, /重複衝突已保留第一筆完整資料/);
});
