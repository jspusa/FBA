(function initFbaInboundRowIdentity(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FBAInboundRowIdentity = api;
})(typeof globalThis === 'object' ? globalThis : this, function createFbaInboundRowIdentityApi() {
  'use strict';

  const SCHEMA_VERSION = 1;
  const DEFAULT_STORAGE_KEY = 'fba-workspace:inbound-row-identities:v1';
  const normalizeSku = value => String(value ?? '').trim().toUpperCase();
  const normalizeExpiry = value => String(value ?? '').trim();
  const normalizePositiveInteger = value => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const freeze = value => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  };
  const anchorKey = row => `${row.sku}\u0000${row.expiryKey}`;
  const exactKey = row => `${anchorKey(row)}\u0000${row.boxes}\u0000${row.manualQuantity ?? ''}`;

  function normalizeRow(input, index) {
    const sku = normalizeSku(input?.sku);
    const expiryKey = normalizeExpiry(input?.expiryKey);
    const boxes = normalizePositiveInteger(input?.boxes);
    const manualQuantity = input?.manualQuantity == null || input.manualQuantity === ''
      ? null
      : normalizePositiveInteger(input.manualQuantity);
    if (!sku || !expiryKey || boxes == null || (input?.manualQuantity != null && input.manualQuantity !== '' && manualQuantity == null)) {
      throw new Error(`第 ${index + 1} 筆入庫列無法建立穩定身分`);
    }
    return { sku, expiryKey, boxes, manualQuantity };
  }

  function groups(items, keyOf) {
    const result = new Map();
    items.forEach(item => {
      const key = keyOf(item);
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(item);
    });
    return result;
  }

  function createStore(storage, options = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new Error('入庫列身分需要可用的瀏覽器儲存空間');
    }
    const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
    const batchId = String(options.batchId || '');
    let state;
    try { state = JSON.parse(storage.getItem(storageKey) || 'null'); } catch { state = null; }
    if (!state || state.schemaVersion !== SCHEMA_VERSION || String(state.batchId || '') !== batchId || !Array.isArray(state.rows)) {
      state = { schemaVersion: SCHEMA_VERSION, batchId, sequence: 0, rows: [] };
    }
    const persist = () => storage.setItem(storageKey, JSON.stringify(state));
    const nextId = () => {
      state.sequence = Number(state.sequence || 0) + 1;
      return `fba-row-${batchId || 'batch'}-${state.sequence}`;
    };

    return freeze({
      storageKey,
      batchId,
      reconcile(inputRows) {
        if (!Array.isArray(inputRows)) throw new Error('入庫列必須是陣列');
        const current = inputRows.map((input, index) => ({ ...normalizeRow(input, index), inputIndex: index }));
        const previous = state.rows.map((input, previousIndex) => ({
          ...normalizeRow(input, previousIndex),
          rowId: String(input.rowId || ''),
          identityReviewRequired: Boolean(input.identityReviewRequired),
          previousRowIds: Array.isArray(input.previousRowIds) ? input.previousRowIds.map(String) : [],
          previousIndex,
        }));
        const resolved = new Array(current.length);
        const usedPrevious = new Set();

        const matchUniqueGroups = (keyOf, { matchEqualDuplicateGroups = false } = {}) => {
          const currentGroups = groups(current.filter(item => !resolved[item.inputIndex]), keyOf);
          const previousGroups = groups(previous.filter(item => item.rowId && !usedPrevious.has(item.rowId)), keyOf);
          for (const [key, currentGroup] of currentGroups) {
            const previousGroup = previousGroups.get(key) || [];
            const unique = currentGroup.length === 1 && previousGroup.length === 1;
            const equalDuplicateGroup = matchEqualDuplicateGroups && currentGroup.length > 1 && currentGroup.length === previousGroup.length;
            if (!unique && !equalDuplicateGroup) continue;
            currentGroup.forEach((item, groupIndex) => {
              const prior = previousGroup[groupIndex];
              resolved[item.inputIndex] = {
                ...item,
                rowId: prior.rowId,
                identityStatus: prior.identityReviewRequired ? 'review-required' : 'matched',
                identityReviewRequired: prior.identityReviewRequired,
                previousRowIds: prior.previousRowIds,
              };
              usedPrevious.add(prior.rowId);
            });
          }
        };

        matchUniqueGroups(exactKey, { matchEqualDuplicateGroups:true });
        matchUniqueGroups(anchorKey);

        const unmatchedByAnchor = groups(current.filter(item => !resolved[item.inputIndex]), anchorKey);
        const availablePreviousByAnchor = groups(previous.filter(item => item.rowId && !usedPrevious.has(item.rowId)), anchorKey);
        for (const [key, currentGroup] of unmatchedByAnchor) {
          const priorIds = (availablePreviousByAnchor.get(key) || []).map(item => item.rowId).sort();
          const ambiguous = priorIds.length > 0;
          currentGroup.forEach(item => {
            resolved[item.inputIndex] = {
              ...item,
              rowId: nextId(),
              identityStatus: ambiguous ? 'review-required' : 'new',
              identityReviewRequired: ambiguous,
              previousRowIds: ambiguous ? priorIds : [],
            };
          });
        }

        const output = resolved.map(({ inputIndex, ...item }) => item);
        state.rows = output.map(({ identityStatus, ...item }) => clone(item));
        persist();
        return freeze(output);
      },
      entries() { return freeze(clone(state.rows)); },
      clear() { storage.removeItem(storageKey); },
    });
  }

  return freeze({ SCHEMA_VERSION, DEFAULT_STORAGE_KEY, createStore });
});
