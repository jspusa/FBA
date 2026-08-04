const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../fba-core.js');

test('parses quoted key-value CSV exports', () => {
  const result = core.parseCsvMetrics(`"貨件 ID","FBA197PY7WRK"
"包裝箱","120"
"單位數量","8,400"`);
  assert.equal(result.shipmentId, 'FBA197PY7WRK');
  assert.equal(result.cartons, 120);
  assert.equal(result.units, 8400);
});

test('parses header and data CSV exports', () => {
  const result = core.parseCsvMetrics(`Shipment ID,Boxes,Total Units
FBA197PY7WRK,120,8400`);
  assert.deepEqual(
    { shipmentId: result.shipmentId, cartons: result.cartons, units: result.units },
    { shipmentId: 'FBA197PY7WRK', cartons: 120, units: 8400 }
  );
});

test('parses BOL labels despite punctuation and spacing differences', () => {
  const result = core.parseBolMetrics(`BILL OF LADING NUMBER: FBA197PY7WRK
DATE: 07/24/2026
TOTAL CARTONS: 120
TOTAL UNITS 8400
NUM. STACKABLE PALLETS 4
NUM. UNSTACKABLE PALLETS 1`);
  assert.equal(result.shipmentId, 'FBA197PY7WRK');
  assert.equal(result.shipmentDate, '2026-07-24');
  assert.equal(result.cartons, 120);
  assert.equal(result.units, 8400);
  assert.equal(result.palletCount, 5);
});

test('parses Chinese and English shipment blocks', () => {
  const result = core.parseShipmentText(`貨件編號：FBA197PY7WRK
包裝箱：61
重量：4270 磅

Shipment ID: FBA197PY7WS2
Boxes: 59
Weight: 4130 lbs`);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { shipment: 'FBA197PY7WRK', cartons: 61, weight: 4270 });
  assert.deepEqual(result[1], { shipment: 'FBA197PY7WS2', cartons: 59, weight: 4130 });
});

test('recognizes explicit Inventory update headers and expiry pairs', () => {
  const headers = ['箱入數', 'SKU', '總箱數', '總包數', 'EXPIRE', 'QTY', 'Expiration Date', 'Quantity'];
  const result = core.detectInventoryColumns(headers, []);
  assert.deepEqual(
    {
      skuIdx: result.skuIdx,
      packIdx: result.packIdx,
      totalCartonsIdx: result.totalCartonsIdx,
      totalPacksIdx: result.totalPacksIdx,
      expiryPairs: result.expiryPairs,
      inferred: result.inferred
    },
    {
      skuIdx: 1,
      packIdx: 0,
      totalCartonsIdx: 2,
      totalPacksIdx: 3,
      expiryPairs: [{ expiryIdx: 4, qtyIdx: 5 }, { expiryIdx: 6, qtyIdx: 7 }],
      inferred: []
    }
  );
});

test('infers a blank case-pack header in the legacy Inventory layout', () => {
  const rows = [
    ['', '8/4/26', '', '', '', ''],
    ['', 'SKU', '箱數', '總包數', 'EXPIRE', 'QTY'],
    [100, 'TTS05AM-1', 14, 1400, '8/26', 14],
    [90, 'TTR01AM-4', 0, 0, '', ''],
    [120, 'TTR05AM-1', 8, 960, '9/27', 8]
  ];
  const result = core.detectInventoryColumns(rows[1], rows);
  assert.equal(result.skuIdx, 1);
  assert.equal(result.packIdx, 0);
  assert.equal(result.totalCartonsIdx, 2);
  assert.deepEqual(result.expiryPairs, [{ expiryIdx: 4, qtyIdx: 5 }]);
  assert.deepEqual(result.inferred.map(item => ({ field: item.field, column: item.column })), [
    { field: '箱入數', column: 'A' }
  ]);
});

test('reports the exact missing Inventory column and accepted headers', () => {
  const rows = [
    ['', '', '', '', ''],
    ['SKU', '總箱數', '總包數', 'EXPIRE', 'QTY'],
    ['TTS05AM-1', 14, 1400, '8/26', 14]
  ];
  assert.throws(
    () => core.detectInventoryColumns(rows[1], rows),
    error => {
      assert.equal(error.code, 'INVENTORY_MISSING_COLUMNS');
      assert.deepEqual(error.missingColumns, ['箱入數']);
      assert.match(error.message, /缺少必要欄位：箱入數/);
      assert.match(error.message, /Case Pack/);
      assert.match(error.message, /A=SKU/);
      return true;
    }
  );
});

test('does not infer a blank Inventory column when its data is not numeric', () => {
  const rows = [
    ['', '', '', '', '', ''],
    ['', 'SKU', '總箱數', '總包數', 'EXPIRE', 'QTY'],
    ['warehouse-a', 'TTS05AM-1', 14, 1400, '8/26', 14],
    ['warehouse-b', 'TTR05AM-1', 8, 960, '9/27', 8]
  ];
  assert.throws(
    () => core.detectInventoryColumns(rows[1], rows),
    error => error.code === 'INVENTORY_MISSING_COLUMNS' && error.missingColumns.includes('箱入數')
  );
});

test('does not treat an alphanumeric identifier as numeric inference evidence', () => {
  const rows = [
    ['', '', '', '', '', ''],
    ['', 'SKU', '總箱數', '總包數', 'EXPIRE', 'QTY'],
    ['A100', 'TTS05AM-1', 14, 1400, '8/26', 14],
    ['B090', 'TTR05AM-1', 8, 960, '9/27', 8]
  ];
  assert.throws(
    () => core.detectInventoryColumns(rows[1], rows),
    error => error.code === 'INVENTORY_MISSING_COLUMNS' && error.missingColumns.includes('箱入數')
  );
});

test('reports all blocking Inventory headers in one message', () => {
  const rows = [
    ['', '', ''],
    ['SKU', '總包數', '備註'],
    ['TTS05AM-1', 1400, 'sample']
  ];
  assert.throws(
    () => core.detectInventoryColumns(rows[1], rows),
    error => {
      assert.deepEqual(error.missingColumns, ['箱入數', '總箱數', 'EXPIRE／效期']);
      assert.match(error.message, /缺少必要欄位：箱入數/);
      assert.match(error.message, /總箱數/);
      assert.match(error.message, /EXPIRE／效期/);
      return true;
    }
  );
});
