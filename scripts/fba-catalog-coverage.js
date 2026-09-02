'use strict';

function analyzeLegacyCoverage(previous, projected) {
  const selectedPackaging = (product, preferredVersion = null) => {
    if (!Array.isArray(product?.packagingVersions)) return product;
    const target = preferredVersion
      || product.newWorkPackagingDefaultVersion
      || product.currentPackagingVersion;
    return product.packagingVersions.find(version => version.packagingVersion === target) || null;
  };
  const packagingHistory = product => Array.isArray(product?.packagingVersions)
    ? product.packagingVersions
    : [product];
  const pushUnique = (fields, field) => { if (!fields.includes(field)) fields.push(field); };
  const projectedEntries = new Map(projected.products.map(product => [product.productSku, product]));
  const projectedProducts = new Set(
    projected.products
      .filter(product => product.entryType === 'product')
      .map(product => product.productSku),
  );
  const projectedApprovedAliases = new Set(
    projected.products
      .filter(product => product.entryType === 'approved-order-sku')
      .map(product => product.productSku),
  );
  const projectedLegacyOrderSkus = new Set(
    projected.products
      .filter(product => ['approved-order-sku', 'unmapped-legacy-order-sku'].includes(product.entryType))
      .map(product => product.productSku),
  );
  const packagingDataLoss = [];
  for (const previousProduct of previous.products) {
    const projectedProduct = projectedEntries.get(previousProduct.productSku);
    if (!projectedProduct) continue;
    const fields = [];
    const previousHasExplicitHistory = Array.isArray(previousProduct?.packagingVersions);
    for (const previousPackaging of packagingHistory(previousProduct)) {
      const previousVersion = previousPackaging?.packagingVersion || previousProduct.packagingVersion || null;
      const projectedPackaging = selectedPackaging(projectedProduct, previousVersion);
      const versionPrefix = previousVersion ? `packagingVersions[${previousVersion}].` : '';
      if (!projectedPackaging && previousVersion) {
        pushUnique(fields, `packagingVersions[${previousVersion}]`);
        continue;
      }
      const compareField = (field, previousValue, projectedValue) => {
        if (previousVersion && previousValue !== projectedValue) pushUnique(fields, `${versionPrefix}${field}`);
        else if (Number.isFinite(previousValue) && previousValue > 0
          && !(Number.isFinite(projectedValue) && projectedValue > 0)) pushUnique(fields, field);
      };
      if (previousHasExplicitHistory) {
        compareField('effectiveFrom', previousPackaging?.effectiveFrom ?? null, projectedPackaging?.effectiveFrom ?? null);
        compareField('effectiveTo', previousPackaging?.effectiveTo ?? null, projectedPackaging?.effectiveTo ?? null);
      }
      compareField('unitsPerCarton', previousPackaging?.unitsPerCarton, projectedPackaging?.unitsPerCarton);
      for (let index = 0; index < 3; index += 1) {
        compareField(`cartonDimensionsIn[${index}]`, previousPackaging?.cartonDimensionsIn?.[index], projectedPackaging?.cartonDimensionsIn?.[index]);
      }
      compareField('grossWeightLb', previousPackaging?.grossWeightLb, projectedPackaging?.grossWeightLb);
    }
    if (fields.length) packagingDataLoss.push(Object.freeze({ sku: previousProduct.productSku, fields: Object.freeze(fields) }));
  }

  return Object.freeze({
    missingProductSkus: Object.freeze(previous.products
      .filter(product => !product.productSku.startsWith('7'))
      .map(product => product.productSku)
      .filter(productSku => !projectedProducts.has(productSku))),
    missingApprovedOrderSkus: Object.freeze(previous.products
      .filter(product => product.entryType === 'approved-order-sku')
      .map(product => product.productSku)
      .filter(orderSku => !projectedApprovedAliases.has(orderSku))),
    missingLegacyOrderSkus: Object.freeze(previous.products
      .filter(product => product.productSku.startsWith('7') && product.entryType !== 'approved-order-sku')
      .map(product => product.productSku)
      .filter(orderSku => !projectedLegacyOrderSkus.has(orderSku))),
    packagingDataLoss: Object.freeze(packagingDataLoss),
  });
}

function unauthorizedPackagingDataLoss(packagingDataLoss, packagingHistoryReplacements = []) {
  const authorized = new Map((packagingHistoryReplacements || []).map(item => [
    String(item?.sku || '').trim().toUpperCase(),
    new Set((item?.removedVersionIds || []).map(String)),
  ]));
  return (packagingDataLoss || []).filter(loss => {
    const versions = authorized.get(String(loss?.sku || '').trim().toUpperCase());
    if (!versions) return true;
    return !(loss.fields || []).every(field => {
      const match = String(field).match(/^packagingVersions\[([^\]]+)\]$/);
      return Boolean(match && versions.has(match[1]));
    });
  });
}

module.exports = Object.freeze({ analyzeLegacyCoverage, unauthorizedPackagingDataLoss });
