'use strict';

function analyzeLegacyCoverage(previous, projected) {
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
    if (Number.isFinite(previousProduct.unitsPerCarton) && previousProduct.unitsPerCarton > 0
      && !(Number.isFinite(projectedProduct.unitsPerCarton) && projectedProduct.unitsPerCarton > 0)) {
      fields.push('unitsPerCarton');
    }
    for (let index = 0; index < 3; index += 1) {
      const previousValue = previousProduct.cartonDimensionsIn?.[index];
      const projectedValue = projectedProduct.cartonDimensionsIn?.[index];
      if (Number.isFinite(previousValue) && previousValue > 0
        && !(Number.isFinite(projectedValue) && projectedValue > 0)) {
        fields.push(`cartonDimensionsIn[${index}]`);
      }
    }
    if (Number.isFinite(previousProduct.grossWeightLb) && previousProduct.grossWeightLb > 0
      && !(Number.isFinite(projectedProduct.grossWeightLb) && projectedProduct.grossWeightLb > 0)) {
      fields.push('grossWeightLb');
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

module.exports = Object.freeze({ analyzeLegacyCoverage });
