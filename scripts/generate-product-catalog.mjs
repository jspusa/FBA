import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { projectCanonicalCatalog, validateFbaSnapshot } = require('../product-catalog.js');
const { analyzeLegacyCoverage } = require('./fba-catalog-coverage.js');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = path.join(repoRoot, 'catalog', 'fba-product-catalog.snapshot.json');
const inboundPath = path.join(repoRoot, 'inbound-plan.html');
const beginMarker = '/* BEGIN GENERATED PRODUCT CATALOG — run npm run generate:catalog */';
const endMarker = '/* END GENERATED PRODUCT CATALOG */';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function renderGeneratedBlock(snapshot) {
  return `${beginMarker}\nconst BUILTIN_CATALOG_SNAPSHOT=${JSON.stringify(snapshot)};\nconst BUILTIN_CATALOG_ADAPTER=window.FBAProductCatalog.createLegacyCatalog(BUILTIN_CATALOG_SNAPSHOT);\nconst BUILTIN_CATALOG=BUILTIN_CATALOG_ADAPTER.catalog;\n${endMarker}`;
}

function renderInbound(source, snapshot) {
  const start = source.indexOf(beginMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('找不到完整的產品主檔 generated block');
  const block = renderGeneratedBlock(snapshot);
  return `${source.slice(0, start)}${block}${source.slice(end + endMarker.length)}`;
}

function assertLegacyCoverage(previous, projected) {
  const { missingProductSkus, missingApprovedOrderSkus, missingLegacyOrderSkus, packagingDataLoss } = analyzeLegacyCoverage(previous, projected);

  const blockers = [];
  if (missingProductSkus.length) blockers.push(`缺少既有 Product SKU (${missingProductSkus.length})：${missingProductSkus.join(', ')}`);
  if (missingApprovedOrderSkus.length) blockers.push(`缺少已核准 Order SKU alias (${missingApprovedOrderSkus.length})：${missingApprovedOrderSkus.join(', ')}`);
  if (missingLegacyOrderSkus.length) blockers.push(`缺少既有 7 字頭 legacy Order SKU (${missingLegacyOrderSkus.length})：${missingLegacyOrderSkus.join(', ')}`);
  if (packagingDataLoss.length) {
    blockers.push(`既有正值包裝欄位將變成空值 (${packagingDataLoss.length} SKU)：${packagingDataLoss.map(loss => `${loss.sku}[${loss.fields.join(',')}]`).join(', ')}`);
  }
  if (blockers.length) throw new Error(`canonical product catalog 尚不可取代既有 FBA snapshot：\n- ${blockers.join('\n- ')}`);
}

const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
if (sourceIndex >= 0 && !args[sourceIndex + 1]) throw new Error('--source 必須指定 canonical product catalog 路徑');

let snapshot;
if (sourceIndex >= 0) {
  snapshot = projectCanonicalCatalog(readJson(path.resolve(process.cwd(), args[sourceIndex + 1])));
  if (fs.existsSync(snapshotPath)) {
    const previous = validateFbaSnapshot(readJson(snapshotPath));
    assertLegacyCoverage(previous, snapshot);
  }
} else {
  snapshot = validateFbaSnapshot(readJson(snapshotPath));
}

const originalInbound = fs.readFileSync(inboundPath, 'utf8');
const generatedInbound = renderInbound(originalInbound, snapshot);
const serializedSnapshot = `${JSON.stringify(snapshot, null, 2)}\n`;

if (args.includes('--check')) {
  if (generatedInbound !== originalInbound) {
    console.error('inbound-plan.html 的內建產品主檔不是由 FBA snapshot 最新產生');
    process.exitCode = 1;
  }
  if (fs.readFileSync(snapshotPath, 'utf8') !== serializedSnapshot) {
    console.error('FBA snapshot 尚未以標準格式產生');
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(snapshotPath, serializedSnapshot);
  fs.writeFileSync(inboundPath, generatedInbound);
}
