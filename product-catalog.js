(function initFbaProductCatalog(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FBAProductCatalog = api;
})(typeof globalThis === 'object' ? globalThis : this, function createFbaProductCatalogApi() {
  'use strict';

  class CatalogValidationError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'CatalogValidationError';
      this.code = code;
      this.details = details;
    }
  }

  const fail = (code, message, details) => {
    throw new CatalogValidationError(code, message, details);
  };
  const normalizeSku = value => String(value ?? '').trim().toUpperCase();
  const isPositive = value => Number.isFinite(value) && value > 0;
  const isPositiveInteger = value => Number.isInteger(value) && value > 0;
  const datePattern = /^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/;

  function validateFbaSnapshot(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      fail('INVALID_DOCUMENT', 'FBA 產品快照必須是物件');
    }
    if (input.schemaVersion !== 1) {
      fail('UNSUPPORTED_SCHEMA_VERSION', `不支援 FBA 產品快照 schemaVersion ${input.schemaVersion}`, { schemaVersion: input.schemaVersion });
    }
    if (input.projection !== 'fba-inbound') {
      fail('INVALID_PROJECTION', 'FBA 產品快照 projection 必須是 fba-inbound', { projection: input.projection });
    }
    if (!datePattern.test(String(input.catalogVersion || ''))) {
      fail('INVALID_DOCUMENT', 'FBA 產品快照 catalogVersion 必須是 YYYY-MM-DD 或 YYYY-MM-DD.N');
    }
    if (!Array.isArray(input.products)) fail('INVALID_DOCUMENT', 'FBA 產品快照 products 必須是陣列');

    const seen = new Set();
    const products = input.products.map((product, index) => {
      if (!product || typeof product !== 'object' || Array.isArray(product)) {
        fail('INVALID_PRODUCT', `products[${index}] 必須是物件`, { index });
      }
      const productSku = normalizeSku(product.productSku);
      if (!productSku || productSku !== product.productSku) {
        fail('INVALID_PRODUCT_SKU', `products[${index}] 的 Product SKU 必須是已正規化的大寫字串`, { index, productSku: product.productSku });
      }
      if (seen.has(productSku)) {
        fail('DUPLICATE_PRODUCT_SKU', `Product SKU 重複：${productSku}`, { productSku });
      }
      seen.add(productSku);

      const unitsPerCarton = product.unitsPerCarton;
      if (unitsPerCarton != null && !isPositiveInteger(unitsPerCarton)) {
        fail('INVALID_PRODUCT', `${productSku} 的 unitsPerCarton 必須是正整數或 null`, { productSku, field: 'unitsPerCarton' });
      }

      let cartonDimensionsIn = null;
      if (product.cartonDimensionsIn != null) {
        if (!Array.isArray(product.cartonDimensionsIn) || product.cartonDimensionsIn.length !== 3 || product.cartonDimensionsIn.some(value => !isPositive(value))) {
          fail('INVALID_PRODUCT', `${productSku} 的 cartonDimensionsIn 必須是三個正數或 null`, { productSku, field: 'cartonDimensionsIn' });
        }
        cartonDimensionsIn = Object.freeze([...product.cartonDimensionsIn]);
      }

      const grossWeightLb = product.grossWeightLb;
      if (grossWeightLb != null && !isPositive(grossWeightLb)) {
        fail('INVALID_PRODUCT', `${productSku} 的 grossWeightLb 必須是正數或 null`, { productSku, field: 'grossWeightLb' });
      }
      const sourceSheet = String(product.sourceSheet || '').trim();
      if (!sourceSheet) fail('INVALID_PRODUCT', `${productSku} 缺少 sourceSheet`, { productSku, field: 'sourceSheet' });

      let identity = {};
      if (product.entryType != null || product.canonicalProductSku != null) {
        if (!['product', 'approved-order-sku', 'unmapped-legacy-order-sku'].includes(product.entryType)) {
          fail('INVALID_ENTRY_TYPE', `${productSku} 的 entryType 無效`, { productSku, entryType: product.entryType });
        }
        if (product.entryType === 'unmapped-legacy-order-sku') {
          if (!productSku.startsWith('7') || product.canonicalProductSku != null) {
            fail('INVALID_ORDER_SKU', `${productSku} 的 unmapped legacy Order SKU 必須以 7 開頭且不可指定 Product SKU`, { productSku });
          }
          identity = { entryType: product.entryType, canonicalProductSku: null };
        } else {
          const canonicalProductSku = normalizeSku(product.canonicalProductSku);
          if (!canonicalProductSku || canonicalProductSku.startsWith('7')) {
            fail('INVALID_CANONICAL_PRODUCT_SKU', `${productSku} 的 canonicalProductSku 無效`, { productSku, canonicalProductSku: product.canonicalProductSku });
          }
          if (product.entryType === 'product' && canonicalProductSku !== productSku) {
            fail('INVALID_CANONICAL_PRODUCT_SKU', `${productSku} 的 Product SKU 身分不一致`, { productSku, canonicalProductSku });
          }
          if (product.entryType === 'approved-order-sku' && !productSku.startsWith('7')) {
            fail('INVALID_ORDER_SKU', `${productSku} 的已核准 Order SKU 必須以 7 開頭`, { productSku });
          }
          identity = { entryType: product.entryType, canonicalProductSku };
        }
      }

      return Object.freeze({ productSku, ...identity, unitsPerCarton, cartonDimensionsIn, grossWeightLb, sourceSheet });
    });

    return Object.freeze({
      schemaVersion: 1,
      catalogVersion: input.catalogVersion,
      projection: 'fba-inbound',
      products: Object.freeze(products),
    });
  }

  function createLegacyCatalog(snapshot) {
    const validated = validateFbaSnapshot(snapshot);
    const catalog = Object.create(null);
    for (const product of validated.products) {
      const dimensions = product.cartonDimensionsIn;
      catalog[product.productSku] = Object.freeze({
        units: product.unitsPerCarton,
        length: dimensions?.[0] ?? null,
        width: dimensions?.[1] ?? null,
        height: dimensions?.[2] ?? null,
        weight: product.grossWeightLb,
        source: product.sourceSheet,
      });
    }
    return Object.freeze({ schemaVersion: validated.schemaVersion, catalogVersion: validated.catalogVersion, catalog: Object.freeze(catalog) });
  }

  function projectCurrentPackaging(packagingVersions, sku) {
    const versions = Array.isArray(packagingVersions) ? packagingVersions : [];
    const current = versions.filter(version => version && version.effectiveTo == null);
    if (current.length !== 1) {
      fail('INVALID_PACKAGING_VERSION', `${sku} 必須剛好有一個目前有效的包裝版本`, { sku, currentVersionCount: current.length });
    }
    const packaging = current[0];
    const dimensionsCm = packaging.cartonDimensionsCm;
    const cartonDimensionsIn = Array.isArray(dimensionsCm) && dimensionsCm.length === 3
      ? dimensionsCm.map(value => Math.round(value / 2.54))
      : null;
    const grossWeightLb = isPositive(packaging.grossWeightLb)
      ? Math.round(packaging.grossWeightLb)
      : (isPositive(packaging.grossWeightKg) ? Math.round(packaging.grossWeightKg * 2.2046226218) : null);
    return {
      unitsPerCarton: packaging.unitsPerCarton ?? null,
      cartonDimensionsIn,
      grossWeightLb,
      sourceSheet: String(packaging.source?.sheet || 'canonical product catalog'),
    };
  }

  function projectCanonicalCatalog(catalog) {
    if (!catalog || typeof catalog !== 'object' || ![1, 2].includes(catalog.schemaVersion) || !Array.isArray(catalog.products)) {
      fail('INVALID_CANONICAL_CATALOG', 'canonical product catalog 必須是 schemaVersion 1 或 2 且包含 products');
    }
    if (catalog.schemaVersion === 2 && !Array.isArray(catalog.orderSkuAliases)) {
      fail('INVALID_CANONICAL_CATALOG', 'canonical product catalog schemaVersion 2 必須包含 orderSkuAliases');
    }
    const products = [];
    const canonicalProductSkus = new Set();
    const approvedOrderSkuOwners = new Map();
    for (const product of catalog.products) {
      const productSku = normalizeSku(product.productSku);
      if (!productSku || productSku !== product.productSku) {
        fail('INVALID_PRODUCT_SKU', 'canonical Product SKU 必須是已正規化的大寫字串', { productSku: product.productSku });
      }
      if (productSku.startsWith('7')) {
        fail('ORDER_SKU_AS_PRODUCT_SKU', `${productSku} 是 Order SKU，不可作為 canonical Product SKU`, { productSku });
      }
      if (canonicalProductSkus.has(productSku)) {
        fail('DUPLICATE_PRODUCT_SKU', `canonical Product SKU 重複：${productSku}`, { productSku });
      }
      canonicalProductSkus.add(productSku);
      const projectedPackaging = projectCurrentPackaging(product.packagingVersions, productSku);
      products.push({ productSku, entryType: 'product', canonicalProductSku: productSku, ...projectedPackaging });

      const approvedOrderSkus = Array.isArray(product.approvedOrderSkus) ? product.approvedOrderSkus : [];
      for (const inputOrderSku of approvedOrderSkus) {
        const orderSku = normalizeSku(inputOrderSku);
        if (!orderSku || orderSku !== inputOrderSku) {
          fail('INVALID_ORDER_SKU', `${productSku} 的 approvedOrderSkus 必須是已正規化的大寫字串`, { productSku, orderSku: inputOrderSku });
        }
        if (orderSku === productSku) continue;
        if (!orderSku.startsWith('7')) {
          fail('INVALID_ORDER_SKU', `${productSku} 的非自身 approved Order SKU 必須以 7 開頭`, { productSku, orderSku });
        }
        const owner = approvedOrderSkuOwners.get(orderSku);
        if (owner && owner !== productSku) {
          fail('DUPLICATE_ORDER_SKU', `${orderSku} 同時核准給 ${owner} 與 ${productSku}`, { orderSku, owners: [owner, productSku] });
        }
        approvedOrderSkuOwners.set(orderSku, productSku);
        if (catalog.schemaVersion === 1) {
          products.push({ productSku: orderSku, entryType: 'approved-order-sku', canonicalProductSku: productSku, ...projectedPackaging });
        }
      }
    }

    if (catalog.schemaVersion === 2) {
      const projectedOrderSkuOwners = new Map();
      for (const alias of catalog.orderSkuAliases) {
        const orderSku = normalizeSku(alias?.orderSku);
        if (!orderSku || orderSku !== alias.orderSku || !orderSku.startsWith('7')) {
          fail('INVALID_ORDER_SKU', 'orderSkuAliases.orderSku 必須是已正規化且以 7 開頭的字串', { orderSku: alias?.orderSku });
        }
        if (projectedOrderSkuOwners.has(orderSku)) {
          fail('DUPLICATE_ORDER_SKU', `Order SKU alias 重複：${orderSku}`, { orderSku });
        }
        if (!['approved', 'unmapped-legacy'].includes(alias.lifecycle)) {
          fail('INVALID_ORDER_SKU_LIFECYCLE', `${orderSku} 的 lifecycle 無效`, { orderSku, lifecycle: alias.lifecycle });
        }
        const projectedPackaging = projectCurrentPackaging(alias.packagingVersions, orderSku);
        if (alias.lifecycle === 'unmapped-legacy') {
          if (alias.canonicalProductSku != null || approvedOrderSkuOwners.has(orderSku)) {
            fail('ORDER_SKU_OWNER_MISMATCH', `${orderSku} 是 unmapped legacy，不可指定或由 Product SKU 核准`, { orderSku, canonicalProductSku: alias.canonicalProductSku });
          }
          projectedOrderSkuOwners.set(orderSku, null);
          products.push({ productSku: orderSku, entryType: 'unmapped-legacy-order-sku', canonicalProductSku: null, ...projectedPackaging });
          continue;
        }

        const canonicalProductSku = normalizeSku(alias.canonicalProductSku);
        if (!canonicalProductSku || canonicalProductSku.startsWith('7') || !canonicalProductSkus.has(canonicalProductSku)) {
          fail('ORDER_SKU_OWNER_MISMATCH', `${orderSku} 的 canonical Product SKU 不存在`, { orderSku, canonicalProductSku: alias.canonicalProductSku });
        }
        if (approvedOrderSkuOwners.get(orderSku) !== canonicalProductSku) {
          fail('ORDER_SKU_OWNER_MISMATCH', `${orderSku} 的 owner 與 products.approvedOrderSkus 不一致`, { orderSku, canonicalProductSku, approvedOwner: approvedOrderSkuOwners.get(orderSku) || null });
        }
        projectedOrderSkuOwners.set(orderSku, canonicalProductSku);
        products.push({ productSku: orderSku, entryType: 'approved-order-sku', canonicalProductSku, ...projectedPackaging });
      }

      for (const [orderSku, canonicalProductSku] of approvedOrderSkuOwners) {
        if (projectedOrderSkuOwners.get(orderSku) !== canonicalProductSku) {
          fail('ORDER_SKU_OWNER_MISMATCH', `${orderSku} 已由 Product SKU 核准，但 orderSkuAliases 缺少相同 owner`, { orderSku, canonicalProductSku });
        }
      }
    }
    return validateFbaSnapshot({ schemaVersion: 1, catalogVersion: catalog.catalogVersion, projection: 'fba-inbound', products });
  }

  return Object.freeze({ CatalogValidationError, validateFbaSnapshot, createLegacyCatalog, projectCanonicalCatalog });
});
