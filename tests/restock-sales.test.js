const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('../vendor/xlsx.full.min.js');
const FBACore = require('../fba-core.js');

const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function loadRestock(extra = {}) {
  const script = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('const REQUIRED_HELIUM_COLS'));
  const beforeBindings = script.slice(0, script.indexOf("    bindRestockDrop('dropHelium'"));
  assert.ok(beforeBindings.length > 1000);
  const exposed = ['state','parseBusinessReport','parseHelium','processInventory','businessMetric',
    'businessCoverage','businessCoverageText','salesCoverageNote','inboundMonthFormula',
    'createSheet','createExcelJsWorkbook','isHiddenOutputHeader','isHiddenOutputColumn'];
  const context = vm.createContext({window:{FBACore}, XLSX, console, ...extra});
  vm.runInContext(beforeBindings.replace('(function(){', 'globalThis.restock=(function(){') +
    `return {${exposed.join(',')}};})();`, context);
  return context.restock;
}
const businessHeaders = ['SKU','已訂購單位數量','訂購產品銷售額'];
const heliumHeaders = ['SKU','Days of Supply','Reorder Units','Sellable Inventory','Inbound'];
const inventoryRows = [[], ['SKU','總箱數','EXPIRE','QTY','箱入數'],
  ['SYNTH-KNOWN',10,'12/31/2099',10,12],['SYNTH-MISSING',10,'12/31/2099',10,12],['SYNTH-ZERO',10,'12/31/2099',10,12]];
function buildFixture(api) {
  const data = api.parseBusinessReport([businessHeaders,['SYNTH-KNOWN',30,'US$300'],['SYNTH-ZERO',0,'US$0']]).data;
  const helium = api.parseHelium([heliumHeaders,
    ['SYNTH-KNOWN',60,240,30,30],['SYNTH-MISSING',60,240,30,30],['SYNTH-ZERO',60,240,30,30]]);
  api.state.businessData = data;
  api.state.sheets = api.processInventory(helium,inventoryRows,{},data).sheets;
  return api.state.sheets['主工作表'];
}
function rowFor(sheet, sku) { return sheet.rows.find(row => row[0] === sku); }
function valueFor(sheet, sku, header) { return rowFor(sheet,sku)[sheet.headers.indexOf(header)]; }
function addressFor(sheet, sku, header) {
  return XLSX.utils.encode_cell({r:sheet.rows.indexOf(rowFor(sheet,sku))+1,c:sheet.headers.indexOf(header)});
}

// A lightweight ExcelJS-compatible model tests the exact production exporter,
// including its formula cache and column settings, without adding dependencies.
class FakeSheet {
  constructor(name) { this.name=name; this.cells=new Map(); this.columns=new Map(); this.rows=new Map(); }
  getCell(row,col) { const k=`${row}:${col}`; if(!this.cells.has(k)) this.cells.set(k,{}); return this.cells.get(k); }
  getColumn(col) { if(!this.columns.has(col)) this.columns.set(col,{}); return this.columns.get(col); }
  getRow(row) { if(!this.rows.has(row)) this.rows.set(row,{}); return this.rows.get(row); }
  mergeCells() {}
}
class FakeWorkbook {
  constructor() { this.calcProperties={}; this.sheets=[]; }
  addWorksheet(name) { const s=new FakeSheet(name); this.sheets.push(s); return s; }
}

test('Business Report preserves Chinese units and merges repeated SKU rows, not B2B columns', () => {
  const api=loadRestock();
  const rows=[['SKU','已訂購單位數量','訂購商品數量 - B2B','訂購產品銷售額'],
    ['SYNTH-A','1,234',999,'US$2,468.00'],['SYNTH-A',6,10,'US$12.00']];
  const result=api.parseBusinessReport(rows);
  assert.equal(result.rawRows,2); assert.equal(result.data['SYNTH-A'].units,1240);
  assert.equal(result.data['SYNTH-A'].sales,2480);
});
test('Business Report supports English and Simplified Chinese headers', () => {
  const api=loadRestock();
  for(const headers of [['SKU','Units Ordered','Ordered Product Sales'],['SKU','已订购单位数量','订购产品销售额']]) {
    assert.equal(api.parseBusinessReport([headers,['SYNTH-A',12,'$24']]).data['SYNTH-A'].units,12);
  }
});
test('missing SKU and a measured zero are not interchangeable', () => {
  const api=loadRestock(), data=api.parseBusinessReport([businessHeaders,['SYNTH-ZERO',0,'US$0']]).data;
  assert.equal(api.businessMetric('SYNTH-MISSING',data).units,null);
  assert.equal(api.businessMetric('SYNTH-ZERO',data).units,0);
  assert.equal(api.businessMetric('constructor',{}).units,null);
});
test('invalid or blank report units are rejected instead of silently becoming zero', () => {
  const api=loadRestock();
  for(const units of ['',null,'N/A','bad',-1]) assert.throws(()=>api.parseBusinessReport([businessHeaders,['SYNTH-A',units,'$10']]),/不能當成 0/);
});
test('coverage counts unique SKUs and reports unknown rather than inferred sales', () => {
  const api=loadRestock(), data=api.parseBusinessReport([businessHeaders,['SYNTH-A',6,'$60'],['SYNTH-B',0,'$0']]).data;
  const coverage=api.businessCoverage(data,['SYNTH-A','SYNTH-B','SYNTH-C','SYNTH-C']);
  assert.equal(coverage.expected,3); assert.equal(coverage.matched,2); assert.equal(coverage.totalUnits,6);
  assert.equal(coverage.zeroSales,1); assert.deepEqual(Array.from(coverage.missing),['SYNTH-C']);
  assert.match(api.businessCoverageText(coverage,'主工作表'),/1 個 SKU 未提供銷量，不能視為 0/);
});
test('restock month checks use real report units and preserve blank unknowns', () => {
  const api=loadRestock(), sheet=buildFixture(api);
  assert.equal(valueFor(sheet,'SYNTH-KNOWN','過去30天銷量'),30);
  assert.equal(valueFor(sheet,'SYNTH-KNOWN','入庫月數驗算'),6);
  assert.equal(valueFor(sheet,'SYNTH-MISSING','過去30天銷量'),'');
  assert.equal(valueFor(sheet,'SYNTH-MISSING','入庫月數驗算'),'');
  assert.equal(valueFor(sheet,'SYNTH-ZERO','過去30天銷量'),0);
  assert.equal(valueFor(sheet,'SYNTH-ZERO','入庫月數驗算'),'');
  assert.equal(valueFor(sheet,'SYNTH-MISSING','入庫計畫'),10);
});
test('monthly formulas guard missing, text and zero denominators', () => {
  const api=loadRestock(), sheet=buildFixture(api), formula=api.inboundMonthFormula(sheet.headers,2);
  assert.match(formula,/NOT\(ISNUMBER\(/); assert.match(formula,/<=0\),"",/);
  assert.equal(api.inboundMonthFormula(['SKU'],2),'');
});
test('SheetJS month formula caches are blank when there is no report row', () => {
  const api=loadRestock(), sheet=buildFixture(api), ws=api.createSheet('主工作表',sheet,true);
  const missing=ws[addressFor(sheet,'SYNTH-MISSING','入庫月數驗算')];
  assert.equal(missing.v,''); assert.equal(missing.t,'str'); assert.match(missing.f,/ISNUMBER/);
  assert.equal(ws[addressFor(sheet,'SYNTH-KNOWN','入庫月數驗算')].v,6);
});
test('ExcelJS exporter preserves unknown sales, blank caches and explanatory notes', () => {
  const api=loadRestock({ExcelJS:{Workbook:FakeWorkbook}}), sheet=buildFixture(api), wb=api.createExcelJsWorkbook();
  const ws=wb.sheets.find(s=>s.name==='主工作表');
  const cell=(sku,h)=>ws.getCell(sheet.rows.indexOf(rowFor(sheet,sku))+2,sheet.headers.indexOf(h)+1);
  assert.equal(cell('SYNTH-MISSING','過去30天銷量').value,null);
  assert.equal(cell('SYNTH-MISSING','入庫月數驗算').value.result,'');
  assert.equal(cell('SYNTH-ZERO','過去30天銷量').value,0);
  assert.equal(cell('SYNTH-ZERO','入庫月數驗算').value.result,'');
  assert.equal(cell('SYNTH-KNOWN','入庫月數驗算').value.result,6);
  assert.match(cell('SYNTH-MISSING','入庫月數驗算').note,/銷量未知而非 0/);
  assert.equal(wb.calcProperties.fullCalcOnLoad,true);
});
test('blank inbound plans do not export phantom zeros for units, AWD or months', () => {
  const api=loadRestock({ExcelJS:{Workbook:FakeWorkbook}}), sheet=buildFixture(api);
  const row=rowFor(sheet,'SYNTH-KNOWN');
  for(const h of ['入庫計畫','入庫包數','AWD板數','入庫月數驗算']) row[sheet.headers.indexOf(h)]='';
  const ws=api.createExcelJsWorkbook().sheets.find(s=>s.name==='主工作表');
  for(const h of ['入庫包數','AWD板數','入庫月數驗算']) {
    assert.equal(ws.getCell(sheet.rows.indexOf(row)+2,sheet.headers.indexOf(h)+1).value.result,'');
  }
});
test('AWD stays yellow with a one-decimal formula but is hidden by default in both exports', () => {
  const api=loadRestock({ExcelJS:{Workbook:FakeWorkbook}}), sheet=buildFixture(api), col=sheet.headers.indexOf('AWD板數');
  assert.equal(api.state.showAwd,false); assert.equal(api.isHiddenOutputColumn('主工作表',sheet.headers,col),true);
  const ws=api.createSheet('主工作表',sheet,true);
  assert.equal(ws['!cols'][col].hidden,true);
  const cell=ws[addressFor(sheet,'SYNTH-KNOWN','AWD板數')];
  assert.equal(cell.z,'0.0'); assert.match(cell.f,/\/24\)/); assert.equal(cell.s.fill.fgColor.rgb,'FEF3C7');
  assert.equal(api.createExcelJsWorkbook().sheets[0].getColumn(col+1).hidden,true);
  api.state.showAwd=true;
  assert.equal(api.isHiddenOutputColumn('主工作表',sheet.headers,col),false);
  assert.equal(api.createExcelJsWorkbook().sheets[0].getColumn(col+1).hidden,false);
});
test('omitting the optional Business Report still allows inventory processing', () => {
  const api=loadRestock(), helium=api.parseHelium([heliumHeaders,['SYNTH-KNOWN',60,240,30,30]]);
  const sheet=api.processInventory(helium,inventoryRows,{},{}).sheets['主工作表'];
  assert.ok(sheet.rows.length); assert.equal(sheet.headers.includes('過去30天銷量'),false);
  assert.equal(sheet.headers.includes('入庫月數驗算'),false);
});
test('UI exposes AWD toggle and coverage warnings without changing inbound-mode detection', () => {
  assert.match(source,/id="toggleAwdBtn"[^>]*aria-pressed="false"/);
  assert.match(source,/state\.showAwd=!state\.showAwd/);
  assert.match(source,/renderTable\(state.activeSheet\); createWorkbookFromState\(\)/);
  assert.match(source,/business-sales-coverage/);
  assert.match(source,/id="businessCoverageNotice"/);
  assert.match(source,/20260911-sales-fix/);
});

module.exports={loadRestock};
