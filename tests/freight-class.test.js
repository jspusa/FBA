const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../freight-class.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'shipment.html'), 'utf8');

const breaks = [[1,400,300],[2,300,250],[4,250,175],[6,175,125],[8,125,100],[10,100,92.5],[12,92.5,85],[15,85,70],[22.5,70,65],[30,65,60],[35,60,55],[50,55,50]];
for (const [boundary, below, at] of breaks) {
  test(`standard bracket at ${boundary} uses unrounded density`, () => {
    assert.equal(api.classFromDensity(boundary - 0.000001), below);
    assert.equal(api.classFromDensity(boundary), at);
    assert.equal(api.classFromDensity(boundary + 0.000001), at);
  });
}

test('invalid or missing density is not silently classified', () => {
  for (const value of [0, -1, NaN, Infinity, null, undefined, '', '12']) assert.equal(api.classFromDensity(value), null);
  assert.equal(api.classFromDensity(0.1), 400);
  assert.equal(api.classFromDensity(1000), 50);
});

test('72-inch estimate includes assumed tare once and leaves source weight unchanged', () => {
  const item = Object.freeze({ cartons: 90, weight: 2520 });
  assert.deepEqual(api.estimateShipmentClass(item, 30), { freightClass: 92.5, pallets: 3, grossWeightPerPallet: 880 });
  assert.equal(item.weight, 2520);
  assert.equal(api.DEFAULTS.heightIn, 72);
});

test('does not secretly use 66 inches when the displayed height is 72', () => {
  const item = { cartons: 30, weight: 840 };
  assert.equal(api.estimateShipmentClass(item, 30, { heightIn: 72 }).freightClass, 92.5);
  assert.equal(api.estimateShipmentClass(item, 30, { heightIn: 66 }).freightClass, 85);
  assert.equal(api.estimateShipmentClass({ cartons: 30, weight: 839.9 }, 30, { heightIn: 66 }).freightClass, 92.5);
});

test('capacity changes and a partial last pallet reuse the existing ceil count', () => {
  assert.deepEqual(api.estimateShipmentClass({ cartons: 90, weight: 2520 }, 24), { freightClass: 100, pallets: 4, grossWeightPerPallet: 670 });
  assert.deepEqual(api.estimateShipmentClass({ cartons: 91, weight: 2548 }, 30), { freightClass: 100, pallets: 4, grossWeightPerPallet: 677 });
});

test('invalid shipment values, capacity and dimensions produce no class', () => {
  for (const item of [null, {}, { cartons: 0, weight: 500 }, { cartons: 1.5, weight: 500 }, { cartons: 30, weight: 0 }, { cartons: 30, weight: NaN }, { cartons: 30, weight: Infinity }, { cartons: 30, weight: -1 }]) assert.equal(api.estimateShipmentClass(item, 30), null);
  for (const capacity of [0, -1, 1.5, 1000, NaN, Infinity]) assert.equal(api.estimateShipmentClass({ cartons: 30, weight: 840 }, capacity), null);
  for (const options of [{ heightIn: 0 }, { widthIn: NaN }, { lengthIn: Infinity }, { palletTareLb: -1 }, { heightIn: 1e308 }]) assert.equal(api.estimateShipmentClass({ cartons: 30, weight: 840 }, 30, options), null);
});

function pageHarness(parsed, estimator = api) {
  const elements = Object.fromEntries(['shipmentText','cartonsPerPallet','shipmentCard','shipmentSummary','shipmentStatus','shipmentTable'].map(id => [id, { value: '', textContent: '', innerHTML: '', className: '', style: {}, listeners: {}, addEventListener(name, cb) { this.listeners[name] = cb; }, querySelectorAll() { return []; } }]));
  elements.cartonsPerPallet.value = '30';
  let timer;
  const window = { FBACore: { parseShipmentText: () => parsed }, FBAFreightClass: estimator };
  const context = vm.createContext({ window, document: { getElementById: id => elements[id] }, localStorage: { getItem: () => null }, navigator: {}, setTimeout(fn) { timer = fn; return 1; }, clearTimeout() { timer = undefined; } });
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) if (match[1].trim()) vm.runInContext(match[1], context);
  return { elements, input(value = 'Amazon shipment text') { elements.shipmentText.value = value; elements.shipmentText.listeners.input(); if (timer) timer(); }, capacity(value) { elements.cartonsPerPallet.value = String(value); elements.cartonsPerPallet.listeners.input(); if (timer) timer(); } };
}

test('page shows only estimated class, preserves weight copy value and 72-inch height', () => {
  const page = pageHarness([{ shipment: 'FBA-DEMO', cartons: 90, weight: 2520 }]);
  page.input();
  const output = page.elements.shipmentTable.innerHTML;
  assert.match(output, />預估等級</);
  assert.match(output, />類別 92\.5</);
  assert.match(output, />72<\/td>/);
  assert.match(output, /data-copy-weight="840"/);
  assert.match(output, /colspan="5">補貨作業區/);
  assert.equal((output.match(/<td\b/g) || []).length, 8);
  assert.doesNotMatch(output, /密度|density|ft³|ft3/i);
  page.capacity(24);
  assert.match(page.elements.shipmentTable.innerHTML, />類別 100</);
  assert.match(page.elements.shipmentTable.innerHTML, /data-copy-weight="630"/);
});

test('each shipment is classified independently and IDs remain escaped', () => {
  const page = pageHarness([{ shipment: '<img src=x>', cartons: 30, weight: 600 }, { shipment: 'B', cartons: 30, weight: 1000 }]);
  page.input();
  const output = page.elements.shipmentTable.innerHTML;
  assert.match(output, /類別 100/);
  assert.match(output, /類別 85/);
  assert.match(output, /&lt;img src=x&gt;/);
  assert.doesNotMatch(output, /<img/);
});

test('clearing or invalid input does not leave a stale estimate visible', () => {
  const page = pageHarness([{ shipment: 'A', cartons: 30, weight: 840 }]);
  page.input();
  page.capacity(0);
  assert.equal(page.elements.shipmentTable.innerHTML, '');
  assert.equal(page.elements.shipmentCard.style.display, 'none');
  page.capacity(30);
  page.input('');
  assert.equal(page.elements.shipmentTable.innerHTML, '');
  assert.equal(page.elements.shipmentCard.style.display, 'none');
});

test('a missing estimator does not break the existing weight workflow', () => {
  const page = pageHarness([{ shipment: 'A', cartons: 30, weight: 840 }], undefined);
  // Explicitly use null, since undefined selects the harness default.
  const withoutModule = pageHarness([{ shipment: 'A', cartons: 30, weight: 840 }], null);
  withoutModule.input();
  assert.match(withoutModule.elements.shipmentTable.innerHTML, /無法估算/);
  assert.match(withoutModule.elements.shipmentTable.innerHTML, /data-copy-weight="840"/);
});

test('UI does not require a new input or continue to recommend fixed class 85', () => {
  assert.match(html, /freight-class\.js\?v=20260908a/);
  assert.match(html, /id="freightEstimateNote"/);
  assert.match(html, /48 × 40 × 72/);
  assert.match(html, /40 lb／板/);
  assert.doesNotMatch(html, /<strong>類別 85<\/strong>/);
  assert.equal((html.match(/<input\b/g) || []).length, 1);
  assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/gi,''), /密度|density/i);
});
