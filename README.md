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

平常直接使用程式內建產品資料，不需要上傳產品資訊 Excel。Jasper 只維護既有原始 Excel；發布時由 Supply 的匯入工具直接讀取 `AMZ 所有SKU`、`2026`、`罐頭`，再生成 Supply 與 FBA 各自的內建版本，不必新增或維護 `產品主檔` 工作表。

「備用：臨時測試產品資訊」只供發布前驗證；正式內建版本更新後會清除較舊的瀏覽器測試覆蓋。`catalog/fba-product-catalog.snapshot.json` 與 `inbound-plan.html` 的內嵌 catalog 才是日常正式來源。

正常發布由 Supply 的 `npm run catalog:release` 一次編排，產生這個 repository 的 snapshot 與 `inbound-plan.html` 內嵌資料。Pages 部署後可執行 `npm run verify:live:catalog -- --version <catalog-version>`，直接核對公開 snapshot 與共用載入程式是否等於本機版本。

發布新的內建資料時，由 canonical Product Catalog 更新 FBA 投影：

```bash
npm run generate:catalog -- --source ../Supply/catalog/product-catalog.json
npm test
```

產生器會拒絕重複 Product SKU、無目前有效包裝版本或不支援的 schemaVersion，避免包裝資料被靜默覆蓋。

canonical Product SKU 不得以 `7` 開頭。schema v2 的 `orderSkuAliases` 是 FBA legacy Order SKU lookup 與其專屬包裝的來源；`approved` alias 的 owner 必須與 Product 的 `approvedOrderSkus` 一致，`unmapped-legacy` alias 則保留 `canonicalProductSku: null`，不冒充 Product SKU。更新前會分別檢查既有 Product SKU、已核准 alias 與其他 legacy Order SKU是否仍被保留；既有正值的箱入數、任一外箱尺寸或重量也不可退化為空值。有 migration blocker 時不會改寫目前可用的 FBA snapshot；正值更新成另一個正值則視為有意更新。
