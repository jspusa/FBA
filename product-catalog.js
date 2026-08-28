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

  function validateIdentity(product, productSku, index) {
    let identity = {};
    if (product.entryType == null && product.canonicalProductSku == null) return identity;
    if (!['product', 'approved-order-sku', 'unmapped-legacy-order-sku'].includes(product.entryType)) {
      fail('INVALID_ENTRY_TYPE', `${productSku} 的 entryType 無效`, { productSku, entryType: product.entryType, index });
    }
    if (product.entryType === 'unmapped-legacy-order-sku') {
      if (!productSku.startsWith('7') || product.canonicalProductSku != null) {
        fail('INVALID_ORDER_SKU', `${productSku} 的 unmapped legacy Order SKU 必須以 7 開頭且不可指定 Product SKU`, { productSku });
      }
      return { entryType: product.entryType, canonicalProductSku: null };
    }
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
    return { entryType: product.entryType, canonicalProductSku };
  }

  function validatePackagingFacts(input, label) {
    const unitsPerCarton = input.unitsPerCarton;
    if (unitsPerCarton != null && !isPositiveInteger(unitsPerCarton)) {
      fail('INVALID_PRODUCT', `${label} 的 unitsPerCarton 必須是正整數或 null`, { field: 'unitsPerCarton' });
    }
    let cartonDimensionsIn = null;
    if (input.cartonDimensionsIn != null) {
      if (!Array.isArray(input.cartonDimensionsIn) || input.cartonDimensionsIn.length !== 3 || input.cartonDimensionsIn.some(value => !isPositive(value))) {
        fail('INVALID_PRODUCT', `${label} 的 cartonDimensionsIn 必須是三個正數或 null`, { field: 'cartonDimensionsIn' });
      }
      cartonDimensionsIn = Object.freeze([...input.cartonDimensionsIn]);
    }
    const grossWeightLb = input.grossWeightLb;
    if (grossWeightLb != null && !isPositive(grossWeightLb)) {
      fail('INVALID_PRODUCT', `${label} 的 grossWeightLb 必須是正數或 null`, { field: 'grossWeightLb' });
    }
    return { unitsPerCarton, cartonDimensionsIn, grossWeightLb };
  }

  function validateFbaSnapshot(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      fail('INVALID_DOCUMENT', 'FBA 產品快照必須是物件');
    }
    if (![1, 2, 3].includes(input.schemaVersion)) {
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

      if (input.schemaVersion === 3) {
        if (Object.hasOwn(product, 'sourceSheet')) {
          fail('PRIVATE_SOURCE_EVIDENCE', `${productSku} 的公開快照不可包含 sourceSheet`, { productSku });
        }
        const identity = validateIdentity(product, productSku, index);
        if (typeof product.newWorkEligible !== 'boolean') {
          fail('INVALID_PRODUCT', `${productSku} 缺少明確 newWorkEligible`, { productSku, field: 'newWorkEligible' });
        }
        const lifecycle = String(product.lifecycle || '').trim();
        if (!lifecycle) fail('INVALID_PRODUCT', `${productSku} 缺少 lifecycle`, { productSku, field: 'lifecycle' });
        if (!Array.isArray(product.packagingVersions) || !product.packagingVersions.length) {
          fail('INVALID_PACKAGING_VERSION', `${productSku} 缺少包裝版本歷史`, { productSku });
        }
        const versionIds = new Set();
        const packagingVersions = product.packagingVersions.map((version, versionIndex) => {
          if (!version || typeof version !== 'object' || Array.isArray(version)) {
            fail('INVALID_PACKAGING_VERSION', `${productSku} 的 packagingVersions[${versionIndex}] 無效`, { productSku, versionIndex });
          }
          if (Object.hasOwn(version, 'sourceSheet') || Object.hasOwn(version, 'source')) {
            fail('PRIVATE_SOURCE_EVIDENCE', `${productSku} 的公開包裝歷史不可包含原始工作表證據`, { productSku, versionIndex });
          }
          const packagingVersion = String(version.packagingVersion || '').trim();
          if (!packagingVersion || versionIds.has(packagingVersion)) {
            fail('INVALID_PACKAGING_VERSION', `${productSku} 的包裝版本號缺少或重複`, { productSku, packagingVersion });
          }
          versionIds.add(packagingVersion);
          return Object.freeze({
            packagingVersion,
            effectiveFrom: version.effectiveFrom == null ? null : String(version.effectiveFrom),
            effectiveTo: version.effectiveTo == null ? null : String(version.effectiveTo),
            ...validatePackagingFacts(version, `${productSku} ${packagingVersion}`),
          });
        });
        const currentPackagingVersion = String(product.currentPackagingVersion || '').trim();
        const newWorkPackagingDefaultVersion = String(product.newWorkPackagingDefaultVersion || '').trim();
        if (!versionIds.has(currentPackagingVersion)) {
          fail('INVALID_PACKAGING_VERSION', `${productSku} 的 currentPackagingVersion 不存在`, { productSku, currentPackagingVersion });
        }
        if (!versionIds.has(newWorkPackagingDefaultVersion)) {
          fail('INVALID_PACKAGING_VERSION', `${productSku} 的 newWorkPackagingDefaultVersion 不存在`, { productSku, newWorkPackagingDefaultVersion });
        }
        return Object.freeze({
          productSku,
          ...identity,
          lifecycle,
          newWorkEligible: product.newWorkEligible,
          currentPackagingVersion,
          newWorkPackagingDefaultVersion,
          packagingVersions: Object.freeze(packagingVersions),
        });
      }

      const { unitsPerCarton, cartonDimensionsIn, grossWeightLb } = validatePackagingFacts(product, productSku);
      const sourceSheet = String(product.sourceSheet || '').trim();
      if (!sourceSheet) fail('INVALID_PRODUCT', `${productSku} 缺少 sourceSheet`, { productSku, field: 'sourceSheet' });
      const packagingVersion = product.packagingVersion == null ? null : String(product.packagingVersion).trim();
      if (input.schemaVersion === 2 && !packagingVersion) {
        fail('INVALID_PRODUCT', `${productSku} 缺少新訂單預設包裝版本`, { productSku, field: 'packagingVersion' });
      }

      const identity = validateIdentity(product, productSku, index);

      return Object.freeze({
        productSku,
        ...identity,
        ...(packagingVersion ? { packagingVersion } : {}),
        unitsPerCarton,
        cartonDimensionsIn,
        grossWeightLb,
        sourceSheet,
      });
    });

    return Object.freeze({
      schemaVersion: input.schemaVersion,
      catalogVersion: input.catalogVersion,
      projection: 'fba-inbound',
      products: Object.freeze(products),
    });
  }

  function createLegacyCatalog(snapshot) {
    const validated = validateFbaSnapshot(snapshot);
    const catalog = Object.create(null);
    for (const product of validated.products) {
      if (validated.schemaVersion === 3 && !product.newWorkEligible) continue;
      const selected = validated.schemaVersion === 3
        ? product.packagingVersions.find(version => version.packagingVersion === product.newWorkPackagingDefaultVersion)
        : product;
      const dimensions = selected.cartonDimensionsIn;
      catalog[product.productSku] = Object.freeze({
        units: selected.unitsPerCarton,
        length: dimensions?.[0] ?? null,
        width: dimensions?.[1] ?? null,
        height: dimensions?.[2] ?? null,
        weight: selected.grossWeightLb,
        source: validated.schemaVersion === 3 ? '內建產品資料庫' : product.sourceSheet,
      });
    }
    return Object.freeze({ schemaVersion: validated.schemaVersion, catalogVersion: validated.catalogVersion, catalog: Object.freeze(catalog) });
  }

  function projectPackagingOwner(owner, sku, canonicalSchemaVersion, identity, lifecycle, newWorkEligible) {
    const versions = Array.isArray(owner?.packagingVersions) ? owner.packagingVersions : [];
    if (!versions.length) fail('INVALID_PACKAGING_VERSION', `${sku} 缺少包裝版本歷史`, { sku });
    const usedVersions = new Set();
    const packagingVersions = versions.map((packaging, index) => {
      let packagingVersion = String(packaging?.version || '').trim();
      if (!packagingVersion && canonicalSchemaVersion >= 2) {
        fail('INVALID_PACKAGING_VERSION', `${sku} 的 packagingVersions[${index}]缺少版本號`, { sku, index });
      }
      if (!packagingVersion) packagingVersion = `legacy-${sku}-${index + 1}`;
      if (usedVersions.has(packagingVersion)) {
        fail('INVALID_PACKAGING_VERSION', `${sku} 的包裝版本號重複`, { sku, packagingVersion });
      }
      usedVersions.add(packagingVersion);
      const dimensionsCm = packaging?.cartonDimensionsCm;
      const cartonDimensionsIn = Array.isArray(dimensionsCm) && dimensionsCm.length === 3
        ? dimensionsCm.map(value => Math.round(value / 2.54))
        : null;
      const grossWeightLb = isPositive(packaging?.grossWeightLb)
        ? Math.round(packaging.grossWeightLb)
        : (isPositive(packaging?.grossWeightKg) ? Math.round(packaging.grossWeightKg * 2.2046226218) : null);
      return {
        packagingVersion,
        effectiveFrom: packaging?.effectiveFrom == null ? null : String(packaging.effectiveFrom),
        effectiveTo: packaging?.effectiveTo == null ? null : String(packaging.effectiveTo),
        unitsPerCarton: packaging?.unitsPerCarton ?? null,
        cartonDimensionsIn,
        grossWeightLb,
      };
    });
    let currentPackagingVersion;
    let newWorkPackagingDefaultVersion;
    if (canonicalSchemaVersion === 3) {
      newWorkPackagingDefaultVersion = String(owner?.newOrderPackagingDefaultVersion || '').trim();
      currentPackagingVersion = newWorkPackagingDefaultVersion;
    } else {
      const currentCandidates = versions
        .map((version, index) => ({ version, projected: packagingVersions[index] }))
        .filter(item => item.version && item.version.effectiveTo == null);
      if (currentCandidates.length !== 1) {
        fail('INVALID_PACKAGING_VERSION', `${sku} 必須剛好有一個目前有效的包裝版本`, { sku, currentVersionCount: currentCandidates.length });
      }
      currentPackagingVersion = currentCandidates[0].projected.packagingVersion;
      newWorkPackagingDefaultVersion = currentPackagingVersion;
    }
    if (!usedVersions.has(newWorkPackagingDefaultVersion)) {
      fail('INVALID_PACKAGING_VERSION', `${sku} 的新工作預設包裝版本不存在`, { sku, newWorkPackagingDefaultVersion });
    }
    return {
      productSku: sku,
      ...identity,
      lifecycle,
      newWorkEligible,
      currentPackagingVersion,
      newWorkPackagingDefaultVersion,
      packagingVersions,
    };
  }

  function completeNewWorkPackaging(owner) {
    const versions = Array.isArray(owner?.packagingVersions) ? owner.packagingVersions : [];
    const selected = versions.find(packaging => packaging?.version === owner?.newOrderPackagingDefaultVersion)
      || versions.find(packaging => packaging?.effectiveTo == null);
    return isPositiveInteger(selected?.unitsPerCarton)
      && Array.isArray(selected.cartonDimensionsCm)
      && selected.cartonDimensionsCm.length === 3
      && selected.cartonDimensionsCm.every(isPositive);
  }

  function projectCanonicalCatalog(catalog) {
    if (!catalog || typeof catalog !== 'object' || ![1, 2, 3].includes(catalog.schemaVersion) || !Array.isArray(catalog.products)) {
      fail('INVALID_CANONICAL_CATALOG', 'canonical product catalog 必須是 schemaVersion 1、2 或 3 且包含 products');
    }
    if (catalog.schemaVersion >= 2 && !Array.isArray(catalog.orderSkuAliases)) {
      fail('INVALID_CANONICAL_CATALOG', 'canonical product catalog schemaVersion 2 或 3 必須包含 orderSkuAliases');
    }
    const products = [];
    const canonicalProductSkus = new Set();
    const newWorkProductSkus = new Set();
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
      const retired = product.lifecycle === 'retired';
      const newWorkEligible = !retired && completeNewWorkPackaging(product);
      if (newWorkEligible) newWorkProductSkus.add(productSku);
      products.push(projectPackagingOwner(
        product,
        productSku,
        catalog.schemaVersion,
        { entryType: 'product', canonicalProductSku: productSku },
        retired ? 'retired' : (newWorkEligible ? 'active' : 'incomplete'),
        newWorkEligible,
      ));

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
          products.push(projectPackagingOwner(
            product,
            orderSku,
            catalog.schemaVersion,
            { entryType: 'approved-order-sku', canonicalProductSku: productSku },
            retired ? 'retired-owner' : 'approved',
            !retired,
          ));
        }
      }
    }

    if (catalog.schemaVersion >= 2) {
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
        if (alias.lifecycle === 'unmapped-legacy') {
          if (alias.canonicalProductSku != null || approvedOrderSkuOwners.has(orderSku)) {
            fail('ORDER_SKU_OWNER_MISMATCH', `${orderSku} 是 unmapped legacy，不可指定或由 Product SKU 核准`, { orderSku, canonicalProductSku: alias.canonicalProductSku });
          }
          projectedOrderSkuOwners.set(orderSku, null);
          products.push(projectPackagingOwner(
            alias,
            orderSku,
            catalog.schemaVersion,
            { entryType: 'unmapped-legacy-order-sku', canonicalProductSku: null },
            'unmapped-legacy',
            completeNewWorkPackaging(alias),
          ));
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
        const ownerEligible = newWorkProductSkus.has(canonicalProductSku);
        const packagingEligible = completeNewWorkPackaging(alias);
        const newWorkEligible = ownerEligible && packagingEligible;
        products.push(projectPackagingOwner(
          alias,
          orderSku,
          catalog.schemaVersion,
          { entryType: 'approved-order-sku', canonicalProductSku },
          newWorkEligible ? 'approved' : (ownerEligible ? 'incomplete-packaging' : 'retired-owner'),
          newWorkEligible,
        ));
      }

      for (const [orderSku, canonicalProductSku] of approvedOrderSkuOwners) {
        if (projectedOrderSkuOwners.get(orderSku) !== canonicalProductSku) {
          fail('ORDER_SKU_OWNER_MISMATCH', `${orderSku} 已由 Product SKU 核准，但 orderSkuAliases 缺少相同 owner`, { orderSku, canonicalProductSku });
        }
      }
    }
    return validateFbaSnapshot({ schemaVersion: 3, catalogVersion: catalog.catalogVersion, projection: 'fba-inbound', products });
  }

  return Object.freeze({ CatalogValidationError, validateFbaSnapshot, createLegacyCatalog, projectCanonicalCatalog });
});
