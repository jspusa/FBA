(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FBACore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const normalizeLabel = value => String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000_\-:：/\\()[\].#]+/g, '');

  const toNumber = value => {
    if (value == null) return null;
    const cleaned = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!cleaned) return null;
    const number = Number(cleaned[0]);
    return Number.isFinite(number) ? number : null;
  };

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;
    const source = String(text ?? '').replace(/^\uFEFF/, '');

    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') {
          value += '"';
          index++;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        row.push(value.trim());
        value = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && source[index + 1] === '\n') index++;
        row.push(value.trim());
        if (row.some(cell => cell !== '')) rows.push(row);
        row = [];
        value = '';
      } else {
        value += char;
      }
    }
    row.push(value.trim());
    if (row.some(cell => cell !== '')) rows.push(row);
    return rows;
  }

  const FIELD_ALIASES = {
    shipmentId: ['貨件id', '貨件編號', 'shipmentid', 'shipmentnumber', 'bolnumber', 'billofladingnumber'],
    cartons: ['包裝箱', '包裝箱數', '箱數', 'boxes', 'numberofboxes', 'cartons', 'totalcartons'],
    units: ['單位數量', '總單位數', 'units', 'totalunits', 'unitquantity']
  };

  const INVENTORY_FIELD_ALIASES = {
    sku: ['SKU'],
    pack: ['箱入數', '箱入数', '每箱數量', '每箱数量', 'Pack', 'Case Pack', 'Units per Case', 'Units per Carton'],
    totalCartons: ['總箱數', '总箱数', '箱數', '箱数', 'Total Cartons', 'Cartons', 'Boxes'],
    totalPacks: ['總包數', '总包数', 'Total Units', 'Total Packs'],
    expiry: ['EXPIRE', 'EXPIRY', 'EXPIRATION', 'Expiration Date', 'Exp Date', '效期', '有效期限', '到期日']
  };

  const INVENTORY_FIELD_LABELS = {
    sku: 'SKU',
    pack: '箱入數',
    totalCartons: '總箱數',
    expiry: 'EXPIRE／效期'
  };

  function fieldForLabel(value) {
    const normalized = normalizeLabel(value);
    return Object.keys(FIELD_ALIASES).find(field => FIELD_ALIASES[field].includes(normalized)) || null;
  }

  function cleanShipmentId(value) {
    const match = String(value ?? '').toUpperCase().match(/\bFBA[A-Z0-9]{5,}\b/);
    return match ? match[0] : String(value ?? '').trim() || null;
  }

  function parseCsvMetrics(text) {
    const rows = parseCsvRows(text);
    const result = { shipmentId: null, cartons: null, units: null, diagnostics: [] };

    // Amazon 匯出檔常見的「欄位,值」格式；不要求雙引號，並容許額外欄位。
    for (const row of rows.slice(0, 60)) {
      const field = fieldForLabel(row[0]);
      // 第二欄也是欄位名稱時代表這是標題列，不應誤當成 key/value 資料。
      if (!field || row.length < 2 || fieldForLabel(row[1]) || result[field] != null) continue;
      result[field] = field === 'shipmentId' ? cleanShipmentId(row[1]) : toNumber(row[1]);
    }

    // 也支援一般「標題列 + 資料列」格式。
    for (let index = 0; index < Math.min(rows.length, 30); index++) {
      const fields = rows[index].map(fieldForLabel);
      if (!fields.some(Boolean)) continue;
      const values = rows.slice(index + 1).find(row => row.some(cell => String(cell).trim() !== ''));
      if (!values) continue;
      fields.forEach((field, column) => {
        if (!field || result[field] != null) return;
        result[field] = field === 'shipmentId' ? cleanShipmentId(values[column]) : toNumber(values[column]);
      });
      break;
    }

    // 最後以寬鬆文字模式補足欄位，避免 Amazon 只改分隔符號就整份失效。
    const source = String(text ?? '');
    if (!result.shipmentId) result.shipmentId = cleanShipmentId(source.match(/\bFBA[A-Z0-9]{5,}\b/i)?.[0]);
    if (result.cartons == null) {
      result.cartons = toNumber(source.match(/(?:包裝箱(?:數)?|TOTAL\s+CARTONS?|NUMBER\s+OF\s+BOXES|CARTONS?|BOXES)\s*[:：,\-]?\s*"?([\d,]+)/i)?.[1]);
    }
    if (result.units == null) {
      result.units = toNumber(source.match(/(?:單位數量|總單位數|TOTAL\s+UNITS?|UNITS?)\s*[:：,\-]?\s*"?([\d,]+)/i)?.[1]);
    }

    if (!result.shipmentId) result.diagnostics.push('找不到 Shipment ID');
    if (result.cartons == null) result.diagnostics.push('找不到包裝箱數');
    if (result.units == null) result.diagnostics.push('找不到單位數量');
    return result;
  }

  function normalizeShipmentDate(value) {
    if (!value) return null;
    const source = String(value).trim();
    let match = source.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    match = source.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);
    if (match) return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    return null;
  }

  function parseBolMetrics(text) {
    const source = String(text ?? '').replace(/\s+/g, ' ').trim();
    const upper = source.toUpperCase();
    const shipmentId = cleanShipmentId(
      upper.match(/BILL\s+OF\s+LADING\s+(?:NUMBER|NO\.?|#)?\s*[:：#-]?\s*(FBA[A-Z0-9]+)/)?.[1]
      || upper.match(/\bFBA[A-Z0-9]{5,}\b/)?.[0]
    );
    const dateValue = upper.match(/(?:SHIPMENT\s+)?DATE\s*[:：#-]?\s*([0-9]{1,4}[-\/.][0-9]{1,2}[-\/.][0-9]{1,4})/)?.[1];
    const cartons = toNumber(upper.match(/TOTAL\s*(?:NO\.?\s+OF\s+)?CARTONS?\s*[:：#-]?\s*([\d,]+)/)?.[1]);
    const units = toNumber(upper.match(/TOTAL\s*(?:NO\.?\s+OF\s+)?UNITS?\s*[:：#-]?\s*([\d,]+)/)?.[1]);
    const stackable = toNumber(upper.match(/(?:NUM\.?|NUMBER\s+OF)?\s*STACKABLE\s+PALLETS?\s*[:：#-]?\s*([\d,]+)/)?.[1]);
    const unstackable = toNumber(upper.match(/(?:NUM\.?|NUMBER\s+OF)?\s*UNSTACKABLE\s+PALLETS?\s*[:：#-]?\s*([\d,]+)/)?.[1]);
    return {
      shipmentId,
      shipmentDate: normalizeShipmentDate(dateValue),
      cartons,
      units,
      palletCount: stackable != null && unstackable != null ? stackable + unstackable : null
    };
  }

  function parseShipmentText(text) {
    const source = String(text ?? '').replace(/\r/g, '');
    const anchors = [...source.matchAll(/(?:貨件編號\s*[:：#-]?\s*([A-Z0-9-]+)|SHIPMENT\s*(?:ID|#|NUMBER)?\s*[:：#-]?\s*([A-Z0-9-]+))/gi)];
    const rows = [];
    anchors.forEach((anchor, index) => {
      const start = anchor.index;
      const end = anchors[index + 1]?.index ?? source.length;
      const block = source.slice(start, end);
      const cartons = toNumber(block.match(/(?:包裝箱(?:數)?|CARTONS?|BOXES)\s*[:：#-]?\s*([\d,]+)/i)?.[1]);
      const weight = toNumber(block.match(/(?:重量|WEIGHT)\s*[:：#-]?\s*([\d,.]+)\s*(?:磅|LBS?|POUNDS?)/i)?.[1]);
      if (cartons != null && weight != null) {
        rows.push({ shipment: anchor[1] || anchor[2], cartons, weight });
      }
    });
    return rows;
  }

  const inventoryHeaderIndex = (headers, aliases) => {
    const normalized = headers.map(normalizeLabel);
    return aliases.map(normalizeLabel).map(alias => normalized.indexOf(alias)).find(index => index !== -1) ?? -1;
  };

  const isInventorySummarySku = value => [
    'newsku', 'total', 'totals', 'subtotal', 'grandtotal', '合計', '總計', '总计'
  ].includes(normalizeLabel(value));

  const isInventoryExpiryHeader = value => {
    const normalized = normalizeLabel(value);
    return normalized === 'expire'
      || normalized === 'expiry'
      || normalized === 'expiration'
      || normalized === 'expirationdate'
      || normalized === 'expdate'
      || normalized === '效期'
      || normalized === '有效期限'
      || normalized === '到期日'
      || normalized.includes('expire');
  };

  const isInventoryQtyHeader = value => {
    const normalized = normalizeLabel(value);
    return normalized === 'qty'
      || normalized === 'quantity'
      || normalized === '數量'
      || normalized === '数量';
  };

  const spreadsheetColumnName = index => {
    let value = Number(index) + 1;
    let name = '';
    while (value > 0) {
      value--;
      name = String.fromCharCode(65 + (value % 26)) + name;
      value = Math.floor(value / 26);
    }
    return name;
  };

  function numericInventoryColumnEvidence(rows, columnIndex, skuIndex) {
    if (!Array.isArray(rows) || columnIndex < 0 || skuIndex < 0) return { usable: false, sampled: 0 };
    let sampled = 0;
    let numeric = 0;
    let positive = 0;
    for (const row of rows.slice(2, 202)) {
      const sku = String(row?.[skuIndex] ?? '').trim();
      if (!sku || isInventorySummarySku(sku)) continue;
      const value = row?.[columnIndex];
      if (value == null || String(value).trim() === '') continue;
      sampled++;
      const rawNumber = typeof value === 'number'
        ? value
        : (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value).replace(/,/g, '').trim())
            ? Number(String(value).replace(/,/g, '').trim())
            : null);
      const number = Number.isFinite(rawNumber) ? rawNumber : null;
      if (number != null) {
        numeric++;
        if (number > 0) positive++;
      }
    }
    return {
      usable: sampled > 0 && numeric === sampled && positive > 0,
      sampled,
      numeric,
      positive
    };
  }

  function inventoryColumnsError(missingFields, headers) {
    const missingText = missingFields.map(field => {
      const aliases = INVENTORY_FIELD_ALIASES[field].join('、');
      return `${INVENTORY_FIELD_LABELS[field]}（可接受表頭：${aliases}）`;
    }).join('；');
    const visibleHeaders = headers
      .map((header, index) => String(header ?? '').trim() ? `${spreadsheetColumnName(index)}=${String(header).trim()}` : '')
      .filter(Boolean)
      .join('、');
    const error = new Error(
      `Inventory update 無法判讀，缺少必要欄位：${missingText}。`
      + `程式讀取 Excel 第 2 列作為表頭；目前辨識到：${visibleHeaders || '沒有可辨識的表頭'}。`
    );
    error.code = 'INVENTORY_MISSING_COLUMNS';
    error.missingColumns = missingFields.map(field => INVENTORY_FIELD_LABELS[field]);
    return error;
  }

  function detectInventoryColumns(headers, rows = []) {
    const sourceHeaders = Array.isArray(headers) ? headers.map(value => String(value ?? '')) : [];
    const inferred = [];
    const skuIdx = inventoryHeaderIndex(sourceHeaders, INVENTORY_FIELD_ALIASES.sku);
    let packIdx = inventoryHeaderIndex(sourceHeaders, INVENTORY_FIELD_ALIASES.pack);
    let totalCartonsIdx = inventoryHeaderIndex(sourceHeaders, INVENTORY_FIELD_ALIASES.totalCartons);
    const totalPacksIdx = inventoryHeaderIndex(sourceHeaders, INVENTORY_FIELD_ALIASES.totalPacks);
    const firstExpiryIdx = sourceHeaders.findIndex(isInventoryExpiryHeader);

    // Legacy Inventory exports sometimes leave A2 blank even though column A still
    // contains the case-pack value. Infer it only when the surrounding layout and
    // numeric data make the meaning unambiguous.
    if (packIdx === -1 && skuIdx > 0) {
      const candidate = skuIdx - 1;
      const evidence = numericInventoryColumnEvidence(rows, candidate, skuIdx);
      const hasInventoryLayout = (firstExpiryIdx > skuIdx || totalPacksIdx > skuIdx)
        && (totalCartonsIdx > skuIdx || numericInventoryColumnEvidence(rows, skuIdx + 1, skuIdx).usable);
      if (!normalizeLabel(sourceHeaders[candidate]) && evidence.usable && hasInventoryLayout) {
        packIdx = candidate;
        inferred.push({
          field: '箱入數',
          index: candidate,
          column: spreadsheetColumnName(candidate),
          reason: `${spreadsheetColumnName(candidate)} 欄表頭空白，但位於 SKU 左側且 ${evidence.sampled} 筆資料皆為數字`
        });
      }
    }

    if (totalCartonsIdx === -1 && skuIdx !== -1 && skuIdx + 1 < sourceHeaders.length) {
      const candidate = skuIdx + 1;
      const evidence = numericInventoryColumnEvidence(rows, candidate, skuIdx);
      const beforeExpiry = firstExpiryIdx === -1 || candidate < firstExpiryIdx;
      if (!normalizeLabel(sourceHeaders[candidate]) && evidence.usable && beforeExpiry) {
        totalCartonsIdx = candidate;
        inferred.push({
          field: '總箱數',
          index: candidate,
          column: spreadsheetColumnName(candidate),
          reason: `${spreadsheetColumnName(candidate)} 欄表頭空白，但位於 SKU 右側且 ${evidence.sampled} 筆資料皆為數字`
        });
      }
    }

    const missingFields = [];
    if (skuIdx === -1) missingFields.push('sku');
    if (packIdx === -1) missingFields.push('pack');
    if (totalCartonsIdx === -1) missingFields.push('totalCartons');
    if (firstExpiryIdx === -1) missingFields.push('expiry');
    if (missingFields.length) throw inventoryColumnsError(missingFields, sourceHeaders);

    const expiryPairs = [];
    for (let index = 0; index < sourceHeaders.length; index++) {
      if (!isInventoryExpiryHeader(sourceHeaders[index])) continue;
      let qtyIdx = -1;
      for (let next = index + 1; next < sourceHeaders.length && !isInventoryExpiryHeader(sourceHeaders[next]); next++) {
        if (isInventoryQtyHeader(sourceHeaders[next])) {
          qtyIdx = next;
          break;
        }
      }
      expiryPairs.push({ expiryIdx: index, qtyIdx });
    }

    return { skuIdx, packIdx, totalCartonsIdx, totalPacksIdx, expiryPairs, inferred };
  }

  return {
    normalizeLabel,
    toNumber,
    parseCsvRows,
    parseCsvMetrics,
    normalizeShipmentDate,
    parseBolMetrics,
    parseShipmentText,
    detectInventoryColumns,
    isInventoryExpiryHeader,
    isInventoryQtyHeader
  };
});
