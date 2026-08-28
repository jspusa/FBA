# FBA 工作區

這是一套在瀏覽器中執行的 FBA 出貨工具，流程包含入庫計畫、棧板估算、文件整理、運輸資訊與 Email 草稿。

目前正式版本：V15.2。

## 使用方式

1. 從 `index.html` 進入工作區。
2. 依序完成入庫計畫、棧板估算、文件整理與運輸資訊。
3. 在 Email 草稿頁確認資料來源與更新時間，再複製寄出。
4. 開始另一批貨件前按「開始新批次」，清除瀏覽器中的表單、摘要與文件快取。

檔案在瀏覽器本機解析，不會由本專案上傳到伺服器。頁面狀態會保存在目前瀏覽器的 localStorage 與 IndexedDB；共用或公用電腦使用完畢後請開始新批次並關閉頁面。

文件整理器支援常見的 Amazon CSV、箱標 PDF 與 BOL PDF。系統會將已確認的不一致標成紅色，無法解析或需要人工確認的項目標成橘色。

## 開發與測試

需要 Node.js 22 或相容版本：

```bash
npm test
```

GitHub Actions 會在 push 與 pull request 時執行相同測試。

### 共用產品資料

平常直接把既有產品資訊原始 Excel 丟到「備用：更新產品資訊資料庫」即可，不必新增或維護 `產品主檔` 工作表。系統只讀取 `AMZ 所有SKU`、`2026`、`罐頭`，保留每個 SKU 第一筆完整箱規，並把結果存在 `jspusa.github.io` 的同源瀏覽器空間；重新整理後仍會保留，Supply 也會自動採用同一份資料。

`catalog/fba-product-catalog.snapshot.json` 與 `inbound-plan.html` 的內嵌 catalog 仍是未上傳原始檔時的安全備援，因此任一網站暫時離線不會使另一站失效。按「恢復內建資料」才會移除瀏覽器共用版本。

發布新的內建備援時，才需要由 canonical Product Catalog 更新 FBA 投影：

```bash
npm run generate:catalog -- --source ../Supply/catalog/product-catalog.json
npm test
```

產生器會拒絕重複 Product SKU、無目前有效包裝版本或不支援的 schemaVersion，避免包裝資料被靜默覆蓋。

canonical Product SKU 不得以 `7` 開頭。schema v2 的 `orderSkuAliases` 是 FBA legacy Order SKU lookup 與其專屬包裝的來源；`approved` alias 的 owner 必須與 Product 的 `approvedOrderSkus` 一致，`unmapped-legacy` alias 則保留 `canonicalProductSku: null`，不冒充 Product SKU。更新前會分別檢查既有 Product SKU、已核准 alias 與其他 legacy Order SKU是否仍被保留；既有正值的箱入數、任一外箱尺寸或重量也不可退化為空值。有 migration blocker 時不會改寫目前可用的 FBA snapshot；正值更新成另一個正值則視為有意更新。
