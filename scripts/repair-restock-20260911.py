from pathlib import Path
import hashlib

p = Path('index.html')
s = p.read_text()
assert hashlib.sha1(b'blob ' + str(len(s.encode())).encode() + b'\0' + s.encode()).hexdigest() == '6ff66a127820589995f34c9b1f62caf9c2d392b7', 'index.html changed; reconcile before applying'

def replace(old, new, count=1):
    global s
    actual = s.count(old)
    assert actual == count, f'Expected {count} occurrences, found {actual}: {old[:100]}'
    s = s.replace(old, new)

replace('<title>計算入庫數量</title>', '<title>計算入庫數量</title>\n  <meta name="fba-restock-version" content="20260911-sales-fix" />')
replace('<div class="hint">同一 SKU 的不同父 ASIN 會自動加總</div>', '<div class="hint">請匯出近 30 天、全部 SKU；同一 SKU 的不同父 ASIN 會自動加總</div>')
replace('<div class="result-actions"><button id="downloadBtn"', '<div class="result-actions"><button id="toggleAwdBtn" class="btn secondary" type="button" aria-pressed="false">顯示 AWD板數</button><button id="downloadBtn"')
replace('<div id="summary" class="tool-pills"></div>', '<div id="summary" class="tool-pills"></div>\n      <div id="businessCoverageNotice" class="preflight-warnings hidden" aria-live="polite"></div>')
replace('黃色 AWD板數＝入庫計畫 ÷ 24，顯示到小數點後一位，方便辨認是否為整板。Business Report 未提供時，兩種月數與營業額欄位會自動隱藏。', '黃色 AWD板數＝入庫計畫 ÷ 24，顯示到小數點後一位；網頁與 Excel 預設隱藏，可按「顯示 AWD板數」開啟。報表未涵蓋的 SKU 不會填成 0，相關月數保持空白；需補上有效的近 30 天銷量及入庫計畫才能驗算。未上傳 Business Report 時，兩種月數與營業額欄位會自動隱藏。')
replace('emailHtml:"", businessData:{} };', 'emailHtml:"", businessData:{}, showAwd:false };')
replace('const data={}; let rawRows=0;', 'const data=Object.create(null); let rawRows=0;')
replace("const units=Math.max(0,toNumber(row[idx['已訂購單位數量']])), sales=Math.max(0,toCurrencyNumber(row[idx['訂購產品銷售額']]));", "const rawUnits=row[idx['已訂購單位數量']];\n        if(!isNumericLike(rawUnits)||toNumber(rawUnits)<0) throw new Error(`Business Report 第 ${r+1} 列（${sku}）的已訂購單位數量不是有效的非負數字；請重新匯出，不能當成 0。`);\n        const units=toNumber(rawUnits), sales=Math.max(0,toCurrencyNumber(row[idx['訂購產品銷售額']]));")
replace("    const businessMetric=(sku,businessData=state.businessData)=>businessData?.[sku]||{units:0,sales:0,unitPrice:0,rows:0};", """    function businessMetric(sku,businessData=state.businessData){
      // A missing report row is unknown, not a measured zero-sales row.
      return Object.prototype.hasOwnProperty.call(businessData||{},sku)?businessData[sku]:{units:null,sales:null,unitPrice:null,rows:0};
    }
    function businessCoverage(businessData,expectedSkus){
      const reportSkus=Object.keys(businessData||{}), expected=[...new Set(expectedSkus||[])];
      const matched=expected.filter(sku=>businessMetric(sku,businessData).units!=null);
      const missing=expected.filter(sku=>businessMetric(sku,businessData).units==null);
      return {reportCount:reportSkus.length,totalUnits:reportSkus.reduce((sum,sku)=>sum+toNumber(businessData[sku].units),0),expected:expected.length,matched:matched.length,missing,zeroSales:matched.filter(sku=>businessMetric(sku,businessData).units===0).length};
    }
    function businessCoverageText(coverage,label){
      const base=`Business Report 已讀取 ${coverage.reportCount} 個 SKU／${coverage.totalUnits.toLocaleString('en-US')} 包；${label} ${coverage.matched}／${coverage.expected} 個 SKU 有對應銷量。`;
      if(coverage.missing.length) return `${base} ${coverage.missing.length} 個 SKU 未提供銷量，不能視為 0，相關月數保持空白。請確認匯出帳號、站點、近 30 天日期範圍及 SKU／品牌篩選。`;
      return base+(coverage.zeroSales?` 其中 ${coverage.zeroSales} 個 SKU 在報表中明列銷量為 0，無法計算月數。`:'');
    }
    function salesCoverageNote(metric){
      if(metric.units==null) return 'Business Report 未包含此 SKU，銷量未知而非 0。請使用正確帳號、站點、近 30 天且未篩選 SKU 的報表；補上有效銷量後即可驗算。';
      if(metric.units===0) return 'Business Report 明列此 SKU 銷量為 0；無法以 0 作為月數分母，月數保持空白。';
      return '';
    }
    function inboundMonthFormula(headers,excelRow){
      const index=h=>headers.indexOf(h);
      const required=['入庫包數','過去30天銷量','入項','可售庫存'];
      if(required.some(h=>index(h)===-1)) return '';
      const [units,sales,inbound,sellable]=required.map(h=>`${colLetter(index(h))}${excelRow}`);
      return `IF(OR(${units}="",NOT(ISNUMBER(${sales})),${sales}<=0),"",(${inbound}+${sellable}+${units})/${sales})`;
    }""")
replace("if(h==='過去30天銷量') return metric.units||0;", "if(h==='過去30天銷量') return metric.units??'';")
replace("function isHiddenOutputHeader(h){ return", "function isHiddenOutputHeader(h){ if(h==='AWD板數') return !state.showAwd; return")
replace("awdPalletsIdx=headers.indexOf('AWD板數'), packIdx=headers.indexOf('箱入數');", "awdPalletsIdx=headers.indexOf('AWD板數'), inboundMonthIdx=headers.indexOf('入庫月數驗算'), packIdx=headers.indexOf('箱入數');")
# SheetJS path: retain formula caches as actual blank strings, and include the live month formula.
replace("cell={f:`IF(${colLetter(planIdx)}${r+1}=\\\"\\\",\\\"\\\",ROUND(${colLetter(planIdx)}${r+1}*${colLetter(packIdx)}${r+1},0))`,t:'n',z:'0'};", "cell={f:`IF(${colLetter(planIdx)}${r+1}=\\\"\\\",\\\"\\\",ROUND(${colLetter(planIdx)}${r+1}*${colLetter(packIdx)}${r+1},0))`,v:isNumericLike(row[c])?Math.round(toNumber(row[c])):'',t:isNumericLike(row[c])?'n':'str',z:'0'};")
replace("v:isNumericLike(row[c])?toNumber(row[c]):0,t:'n',z:'0.0'};", "v:isNumericLike(row[c])?toNumber(row[c]):'',t:isNumericLike(row[c])?'n':'str',z:'0.0'};")
replace("          } else if(c===usSum&&usInb!==-1&&usSell!==-1&&usTotal!==-1){", "          } else if(c===inboundMonthIdx&&inboundMonthFormula(headers,r+1)){\n            cell={f:inboundMonthFormula(headers,r+1),v:isNumericLike(row[c])?toNumber(row[c]):'',t:isNumericLike(row[c])?'n':'str',z:'0.0'};\n          } else if(c===usSum&&usInb!==-1&&usSell!==-1&&usTotal!==-1){")
# ExcelJS export path: empty formula results must not be cached as numeric 0.
replace("const result=isNumericLike(row[c])?Math.round(toNumber(row[c])):0;", "const result=isNumericLike(row[c])?Math.round(toNumber(row[c])):'';")
replace("const result=isNumericLike(row[c])?toNumber(row[c]):0;", "const result=isNumericLike(row[c])?toNumber(row[c]):'';", count=2)
replace('formula:`IF(OR(${colLetter(inboundUnitsIdx)}${currentRow}="",${colLetter(sales30Idx)}${currentRow}=0),"",(${colLetter(usInb)}${currentRow}+${colLetter(usSell)}${currentRow}+${colLetter(inboundUnitsIdx)}${currentRow})/${colLetter(sales30Idx)}${currentRow})`', 'formula:inboundMonthFormula(headers,currentRow)')
replace('            applyExcelJsStyle(cell,excelJsRowStyle(name,headers,row,c,highlightMain));', "            if(['過去30天銷量','後台月數驗算','入庫月數驗算'].includes(h)){\n              const note=salesCoverageNote(businessMetric(row[headers.indexOf('SKU')]));\n              if(note) cell.note=note;\n            }\n            applyExcelJsStyle(cell,excelJsRowStyle(name,headers,row,c,highlightMain));")
# Coverage is checked before generation and remains conspicuous next to the results.
replace("      const requiredValid=isValidCheck(helium)&&isValidCheck(inventory);", """      if(isValidCheck(business)&&isValidCheck(helium)){
        const coverage=businessCoverage(business.businessData,helium.skus);
        if(coverage.missing.length){
          pairDiagnostics.push({id:'business-sales-coverage',kind:'diagnostic',label:'Business Report 銷量未完整對應',source:'Business Report',sku:'—',location:business.file?.name||'Business Report',detail:businessCoverageText(coverage,'Helium'),handling:'未提供銷量不填 0；可整理庫存，但缺資料的 SKU 無法驗算月數'});
          $('auditBusiness').dataset.state='warn'; $('auditBusiness').querySelector('.audit-icon').textContent='!';
          $('auditBusinessText').textContent=`銷量對應 ${coverage.matched}／${coverage.expected} 個 SKU · ${coverage.missing.length} 個未提供`;
          $('auditBusinessText').title=businessCoverageText(coverage,'Helium');
        }
      }
      const requiredValid=isValidCheck(helium)&&isValidCheck(inventory);""")
replace("      const warningBox=$('preflightWarnings'); warningBox.innerHTML=''; warningBox.classList.add('hidden');", """      const warningBox=$('preflightWarnings'); warningBox.innerHTML=''; warningBox.classList.add('hidden');
      const salesWarning=pairDiagnostics.find(item=>item.id==='business-sales-coverage');
      if(salesWarning){ warningBox.textContent=salesWarning.detail; warningBox.classList.remove('hidden'); }""")
replace("        state.activeSheet='主工作表';\n        if(!silent){", """        state.activeSheet='主工作表';
        if(!silent){
          const mainSheet=state.sheets['主工作表'];
          const coverage=businessCoverage(state.businessData,mainSheet.rows.map(row=>row[mainSheet.headers.indexOf('SKU')]));
          const notice=$('businessCoverageNotice');
          notice.textContent=coverage.reportCount?businessCoverageText(coverage,'主工作表'):'';
          notice.classList.toggle('hidden',!coverage.reportCount);""")
replace("setStatus('整理完成。請往下預覽，或直接下載整理完成的 Excel。',false,'ok');", "setStatus(coverage.reportCount&&coverage.missing.length?`整理完成；主工作表有 ${coverage.missing.length} 個 SKU 未提供銷量，月數驗算保持空白，請確認 Business Report。`:'整理完成。請往下預覽，或直接下載整理完成的 Excel。',false,coverage.reportCount&&coverage.missing.length?'ready':'ok');")
replace("detail:`${skus.size} 個 SKU · ${parsed.rawRows} 筆來源列${zeroSales?` · ${zeroSales} 個無銷售資料`:''}`", "detail:`${skus.size} 個 SKU · ${parsed.rawRows} 筆來源列 · ${Object.values(parsed.data).reduce((sum,item)=>sum+item.units,0).toLocaleString('en-US')} 包${zeroSales?` · ${zeroSales} 個銷量或銷售額為 0`:''}`")
replace("    $('runBtn').addEventListener('click', run);", """    $('toggleAwdBtn').addEventListener('click',()=>{
      state.showAwd=!state.showAwd;
      $('toggleAwdBtn').setAttribute('aria-pressed',String(state.showAwd));
      $('toggleAwdBtn').textContent=state.showAwd?'隱藏 AWD板數':'顯示 AWD板數';
      if(state.sheets){ renderTable(state.activeSheet); createWorkbookFromState(); }
    });
    $('runBtn').addEventListener('click', run);""")
p.write_text(s)
print('Applied guarded restock sales and AWD visibility repair')
