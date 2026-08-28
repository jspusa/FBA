(function initFbaPackagingAssignment(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FBAPackagingAssignment = api;
})(typeof globalThis === 'object' ? globalThis : this, function createFbaPackagingAssignmentApi() {
  'use strict';

  const SCHEMA_VERSION = 1;
  const DEFAULT_STORAGE_KEY = 'fba-workspace:packaging-assignments:v1';
  const FACT_FIELDS = Object.freeze([
    'unitsPerCarton',
    'lengthIn',
    'widthIn',
    'heightIn',
    'grossWeightLb',
  ]);

  const normalizeSku = value => String(value ?? '').trim().toUpperCase();
  const positive = value => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const freeze = value => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  };

  function normalizeFacts(input = {}, { partial = false } = {}) {
    const facts = {
      unitsPerCarton: positive(input.unitsPerCarton ?? input.units),
      lengthIn: positive(input.lengthIn ?? input.length),
      widthIn: positive(input.widthIn ?? input.width),
      heightIn: positive(input.heightIn ?? input.height),
      grossWeightLb: positive(input.grossWeightLb ?? input.weight),
    };
    if (!partial && FACT_FIELDS.some(field => facts[field] == null)) return null;
    return freeze(facts);
  }

  function factsEqual(left, right) {
    const a = normalizeFacts(left, { partial: true });
    const b = normalizeFacts(right, { partial: true });
    return FACT_FIELDS.every(field => a[field] === b[field]);
  }

  function knownFactsMatch(knownFacts, candidateFacts) {
    const known = normalizeFacts(knownFacts, { partial: true });
    const candidate = normalizeFacts(candidateFacts, { partial: true });
    const supplied = FACT_FIELDS.filter(field => known[field] != null);
    return supplied.length > 0 && supplied.every(field => known[field] === candidate[field]);
  }

  function createCatalogIndex(snapshot) {
    const index = Object.create(null);
    const catalogVersion = String(snapshot?.catalogVersion || '').trim() || null;
    for (const product of Array.isArray(snapshot?.products) ? snapshot.products : []) {
      const sku = normalizeSku(product?.productSku);
      if (!sku) continue;
      const history = Array.isArray(product?.packagingVersions) ? product.packagingVersions : null;
      const rawCandidates = history || [product];
      const rawFacts = (version, partial = false) => normalizeFacts({
        unitsPerCarton: version?.unitsPerCarton,
        lengthIn: version?.cartonDimensionsIn?.[0],
        widthIn: version?.cartonDimensionsIn?.[1],
        heightIn: version?.cartonDimensionsIn?.[2],
        grossWeightLb: version?.grossWeightLb,
      }, { partial });
      const candidates = rawCandidates.map(version => {
        const packagingVersion = String(version?.packagingVersion || '').trim();
        const facts = rawFacts(version);
        if (!packagingVersion || !facts) return null;
        return freeze({
          sku,
          packagingVersion,
          catalogVersion,
          facts,
          sourceSheet: null,
        });
      }).filter(Boolean);
      const defaultVersion = String(product?.newWorkPackagingDefaultVersion || product?.packagingVersion || '').trim();
      const defaultRaw = rawCandidates.find(version => String(version?.packagingVersion || '').trim() === defaultVersion);
      if (!defaultVersion || !defaultRaw) continue;
      const defaultCandidate = candidates.find(candidate => candidate.packagingVersion === defaultVersion);
      const declaredNewWorkEligible = history ? product?.newWorkEligible === true : true;
      index[sku] = freeze({
        sku,
        packagingVersion: defaultVersion,
        catalogVersion,
        facts: defaultCandidate?.facts || rawFacts(defaultRaw, true),
        sourceSheet: null,
        entryType: product?.entryType || null,
        canonicalProductSku: product?.canonicalProductSku ?? null,
        lifecycle: String(product?.lifecycle || '').trim() || null,
        newWorkEligible: declaredNewWorkEligible && Boolean(defaultCandidate),
        currentPackagingVersion: String(product?.currentPackagingVersion || defaultVersion).trim(),
        candidates: freeze(candidates),
      });
    }
    return freeze(index);
  }

  function normalizeCurrent(input, sku = '') {
    if (!input) return null;
    const facts = normalizeFacts(input.facts || input);
    const packagingVersion = String(input.packagingVersion || '').trim();
    if (!packagingVersion || !facts) return null;
    return freeze({
      sku: normalizeSku(input.sku || sku),
      packagingVersion,
      catalogVersion: String(input.catalogVersion || '').trim() || null,
      facts,
      sourceSheet: String(input.sourceSheet || '').trim() || null,
    });
  }

  function timestamp(now) {
    const value = typeof now === 'function' ? now() : now;
    const date = value == null ? new Date() : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function makeAssignment({
    assignmentId,
    rowKey,
    sku,
    kind,
    facts,
    baselineFacts = null,
    packagingVersion = null,
    catalogVersion = null,
    sourceSheet = null,
    assignedAt,
    assignmentReason,
    migrationMethod = null,
    reviewRequired = false,
    reviewedAt = null,
    supersedesAssignmentId = null,
  }) {
    const normalizedFacts = normalizeFacts(facts);
    const normalizedBaselineFacts = normalizeFacts(baselineFacts || facts);
    if (!normalizedFacts) throw new Error(`${normalizeSku(sku) || 'SKU'} 的包裝指派缺少完整箱入數、尺寸或重量`);
    if (!normalizedBaselineFacts) throw new Error(`${normalizeSku(sku) || 'SKU'} 的包裝比較基準不完整`);
    if (!['catalog-version', 'historical-imported'].includes(kind)) throw new Error('包裝指派類型無效');
    if (kind === 'catalog-version' && !String(packagingVersion || '').trim()) throw new Error('包裝版本指派缺少版本號');
    return freeze({
      schemaVersion: SCHEMA_VERSION,
      assignmentId,
      rowKey: String(rowKey || ''),
      sku: normalizeSku(sku),
      kind,
      facts: normalizedFacts,
      baselineFacts: normalizedBaselineFacts,
      packagingVersion: kind === 'catalog-version' ? String(packagingVersion).trim() : null,
      catalogVersion: String(catalogVersion || '').trim() || null,
      sourceSheet: String(sourceSheet || '').trim() || null,
      assignedAt,
      assignmentReason: String(assignmentReason || '').trim() || 'new-work-default',
      migrationMethod: migrationMethod || null,
      reviewRequired: Boolean(reviewRequired),
      reviewedAt: reviewedAt || null,
      supersedesAssignmentId: supersedesAssignmentId || null,
    });
  }

  function compareWithCurrent(assignment, currentInput) {
    const current = normalizeCurrent(currentInput, assignment?.sku);
    if (!assignment || !current) return freeze({ newerAvailable: false, current: null });
    const versionChanged = assignment.kind !== 'catalog-version'
      || assignment.packagingVersion !== current.packagingVersion;
    const factsChanged = !factsEqual(assignment.facts, current.facts);
    return freeze({
      newerAvailable: versionChanged || factsChanged,
      current,
      versionChanged,
      factsChanged,
    });
  }

  function createLedger(storage, options = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new Error('包裝指派需要可用的瀏覽器儲存空間');
    }
    const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
    const batchId = String(options.batchId || '');
    const now = options.now;
    let state;

    try { state = JSON.parse(storage.getItem(storageKey) || 'null'); } catch { state = null; }
    if (!state || state.schemaVersion !== SCHEMA_VERSION || String(state.batchId || '') !== batchId) {
      state = { schemaVersion: SCHEMA_VERSION, batchId, sequence: 0, assignments: {}, history: [], updatedAt: null };
    }

    const persist = () => {
      state.updatedAt = timestamp(now);
      storage.setItem(storageKey, JSON.stringify(state));
    };
    const nextId = () => {
      state.sequence = Number(state.sequence || 0) + 1;
      return `fba-packaging-${batchId || 'batch'}-${state.sequence}`;
    };
    const existing = rowKey => {
      const value = state.assignments[String(rowKey || '')];
      if (!value) return null;
      try { return makeAssignment(value); } catch { return null; }
    };
    const replace = (rowKey, assignment) => {
      const prior = existing(rowKey);
      if (prior) state.history.push(clone(prior));
      state.assignments[String(rowKey)] = clone(assignment);
      persist();
      return assignment;
    };
    const buildCurrent = ({ rowKey, sku, current, reason, migrationMethod = null, supersedesAssignmentId = null }) => {
      const normalized = normalizeCurrent(current, sku);
      if (!normalized) throw new Error(`${normalizeSku(sku)} 沒有可指派的 FBA 確認包裝版本`);
      return makeAssignment({
        assignmentId: nextId(), rowKey, sku, kind: 'catalog-version', facts: normalized.facts,
        packagingVersion: normalized.packagingVersion, catalogVersion: normalized.catalogVersion,
        sourceSheet: normalized.sourceSheet, assignedAt: timestamp(now), assignmentReason: reason,
        migrationMethod, reviewRequired: false, supersedesAssignmentId,
      });
    };
    const buildHistorical = ({ rowKey, sku, facts, baselineFacts = null, catalogVersion, sourceSheet, reason, migrationMethod, supersedesAssignmentId = null }) => makeAssignment({
      assignmentId: nextId(), rowKey, sku, kind: 'historical-imported', facts,
      baselineFacts: baselineFacts || facts,
      catalogVersion, sourceSheet, assignedAt: timestamp(now), assignmentReason: reason,
      migrationMethod, reviewRequired: true, supersedesAssignmentId,
    });

    return freeze({
      storageKey,
      batchId,
      get: existing,
      has(rowKey) { return Boolean(existing(rowKey)); },
      entries() { return freeze(Object.fromEntries(Object.entries(state.assignments).map(([key, value]) => [key, makeAssignment(value)]))); },
      history() { return freeze(state.history.map(value => makeAssignment(value))); },
      assignCurrent({ rowKey, sku, current, reason = 'new-work-default' }) {
        const prior = existing(rowKey);
        if (prior) return prior;
        const assignment = buildCurrent({ rowKey, sku, current, reason });
        state.assignments[String(rowKey)] = clone(assignment);
        persist();
        return assignment;
      },
      migrateLegacy({ rowKey, sku, knownFacts, candidates = [], fallbackFacts, catalogVersion = null, sourceSheet = null }) {
        const prior = existing(rowKey);
        if (prior) return prior;
        const normalizedKnown = normalizeFacts(knownFacts, { partial: true });
        const matches = candidates
          .map(candidate => normalizeCurrent(candidate, sku))
          .filter(Boolean)
          .filter(candidate => knownFactsMatch(normalizedKnown, candidate.facts));
        let assignment;
        if (matches.length === 1) {
          assignment = buildCurrent({
            rowKey, sku, current: matches[0], reason: 'legacy-deterministic-match',
            migrationMethod: 'known-facts-exact-match',
          });
        } else {
          const fallback = normalizeFacts(fallbackFacts);
          if (!fallback) throw new Error(`${normalizeSku(sku)} 的歷史包裝資料不完整，無法安全匯入`);
          const merged = Object.fromEntries(FACT_FIELDS.map(field => [field, normalizedKnown[field] ?? fallback[field]]));
          assignment = buildHistorical({
            rowKey, sku, facts: merged, catalogVersion, sourceSheet,
            reason: 'legacy-import', migrationMethod: matches.length > 1 ? 'ambiguous-known-facts' : 'unknown-or-unmatched-facts',
          });
        }
        state.assignments[String(rowKey)] = clone(assignment);
        persist();
        return assignment;
      },
      reassignCurrent({ rowKey, sku, current, reason = 'explicit-reassignment' }) {
        const prior = existing(rowKey);
        const assignment = buildCurrent({
          rowKey, sku, current, reason,
          supersedesAssignmentId: prior?.assignmentId || null,
        });
        return replace(rowKey, assignment);
      },
      reassignHistorical({ rowKey, sku, facts, baselineFacts = null, catalogVersion = null, sourceSheet = null, reason = 'explicit-historical-reassignment' }) {
        const prior = existing(rowKey);
        const assignment = buildHistorical({
          rowKey, sku, facts, baselineFacts: baselineFacts || prior?.baselineFacts || prior?.facts || facts, catalogVersion, sourceSheet, reason,
          migrationMethod: 'explicit-user-choice', supersedesAssignmentId: prior?.assignmentId || null,
        });
        return replace(rowKey, assignment);
      },
      review(rowKey) {
        const prior = existing(rowKey);
        if (!prior) throw new Error('找不到要複查的包裝指派');
        if (!prior.reviewRequired) return prior;
        const reviewed = makeAssignment({ ...clone(prior), reviewRequired: false, reviewedAt: timestamp(now) });
        state.assignments[String(rowKey)] = clone(reviewed);
        persist();
        return reviewed;
      },
      compare(rowKey, current) { return compareWithCurrent(existing(rowKey), current); },
      clear() { storage.removeItem(storageKey); },
    });
  }

  return freeze({
    SCHEMA_VERSION,
    DEFAULT_STORAGE_KEY,
    FACT_FIELDS,
    normalizeFacts,
    factsEqual,
    knownFactsMatch,
    createCatalogIndex,
    compareWithCurrent,
    createLedger,
  });
});
