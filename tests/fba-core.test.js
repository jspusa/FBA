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
