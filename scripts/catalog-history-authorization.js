'use strict';

const crypto = require('node:crypto');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
}

function publicCatalogSha256(catalog) {
  const snapshot = clone(catalog);
  for (const owner of [...(snapshot.products || []), ...(snapshot.orderSkuAliases || [])]) {
    for (const packaging of owner.packagingVersions || []) delete packaging.source;
  }
  return sha256(snapshot);
}

function ownerForSku(catalog, sku) {
  if (sku.startsWith('7')) return (catalog.orderSkuAliases || []).find(alias => alias.orderSku === sku) || null;
  return (catalog.products || []).find(product => product.productSku === sku) || null;
}

function reviewedHistoryReplacementSkus({ plan, sourceCatalog, selectedEntryIds }) {
  if (!plan || Number(plan.schemaVersion) !== 1 || !Array.isArray(plan.entries)) {
    throw new Error('歷史箱規清除需要有效的已簽署變更計畫');
  }
  const unsigned = clone(plan);
  const planSha256 = unsigned.planSha256;
  delete unsigned.planSha256;
  if (!planSha256 || sha256(unsigned) !== planSha256) throw new Error('已簽署變更計畫的雜湊不正確');
  if (plan.candidate?.sha256 !== publicCatalogSha256(sourceCatalog)) {
    throw new Error('已簽署變更計畫與 canonical product catalog 不一致');
  }
  const decision = plan.duplicateResolution;
  if (!decision || Number(decision.schemaVersion) !== 1 || decision.policy?.replacePackagingHistory !== true
    || !Array.isArray(decision.resolutions)) {
    throw new Error('已簽署變更計畫未核准歷史箱規清除');
  }
  const selected = new Set((selectedEntryIds || []).map(String));
  const resolutions = new Map();
  for (const resolution of decision.resolutions) {
    const sku = String(resolution?.sku || '').trim().toUpperCase();
    if (!sku || resolutions.has(sku)) throw new Error(`重複 SKU 解決決策含有重複或無效 SKU：${sku || '(空白)'}`);
    const removedVersionIds = [...new Set((resolution.removedVersionIds || []).map(String))];
    if (!removedVersionIds.length) continue;
    const entryId = `${sku.startsWith('7') ? 'order-sku-alias' : 'product'}:${sku}`;
    const entry = plan.entries.find(item => item.id === entryId);
    const historyField = entry?.fields?.find(field => field.field === 'packagingHistoryVersions');
    const owner = ownerForSku(sourceCatalog, sku);
    const expectedCriteria = { ...(decision.policy.match || {}), ...(decision.policy.overrides?.[sku] || {}) };
    if (!entry || !entry.selectable || !selected.has(entryId) || !historyField || !owner) {
      throw new Error(`${sku} 的歷史箱規清除未在已選取的審核計畫中`);
    }
    if (stableJson(historyField.before || []) !== stableJson(removedVersionIds)
      || stableJson(historyField.after || []) !== stableJson(owner.packagingVersions.map(item => item.version))
      || stableJson(resolution.criteria || {}) !== stableJson(expectedCriteria)
      || !resolution.sourceSheet || !Number.isInteger(Number(resolution.sourceRow))) {
      throw new Error(`${sku} 的歷史箱規清除證據與已簽署計畫不一致`);
    }
    resolutions.set(sku, true);
  }
  for (const entry of plan.entries.filter(item => selected.has(item.id))) {
    if (entry.fields?.some(field => field.field === 'packagingHistoryVersions') && !resolutions.has(entry.sku)) {
      throw new Error(`${entry.sku} 的歷史箱規清除缺少重複資料決策`);
    }
  }
  return [...resolutions.keys()].map(sku => ({
    sku,
    removedVersionIds:decision.resolutions.find(item => item.sku === sku).removedVersionIds.map(String),
  }));
}

module.exports = Object.freeze({ publicCatalogSha256, reviewedHistoryReplacementSkus, stableJson });
