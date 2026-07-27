# 01 — 備份下載

**What to build:** 使用者在庫存頁按下「備份」，瀏覽器立刻下載一個 JSON 檔，
裡面是他目前全部的**本體資料**（持股、交易流水、匯入紀錄、已實現帳本、每日快照），
自帶 schema 版本與匯出時間，檔名帶日期時間可直接排序。打開檔案人看得懂。
**可重建資料**（收盤價快取、AI 分析快取）不在裡面——那些丟了會自己回來。

詞彙照 `CONTEXT.md`：叫「備份」不叫匯出。規格見 `.scratch/portfolio-backup/spec.md`，
邊界決策見 `docs/adr/0001-portfolio-backup-restore-overwrite.md`。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 庫存頁工具列有「備份」按鈕，與既有的「匯入對帳單」同一排、同一套 Button 樣式
- [ ] 按下後下載單一 JSON 檔，檔名帶日期時間且可直接依檔名排序
- [ ] 檔案含 schema 版本欄位與 ISO 8601 匯出時間欄位
- [ ] 檔案含五把本體資料 key 的內容，值以解析後的 JSON 形式存放（非字串轉義），檔案人類可讀
- [ ] 收盤價快取與 AI 分析快取（含所有該前綴的條目）不出現在檔案中
- [ ] 某把 key 在 storage 中缺席時，檔案中該 key 亦缺席（不得寫成 `null` 或空值）
- [ ] 庫存為空時按鈕仍可按，或明確禁用並說明原因——不得按了沒反應
- [ ] 備份模組是**純模組**：Storage 由呼叫端注入（比照 `utils/persistentStore.ts` 的作法），
      模組頂層不觸碰 `localStorage`，Node 測試環境可安全 import
- [ ] 備份模組**不 import 任何領域型別**——它只認 key 名字，搬的是原始 JSON 值。
      理由是備份必須存「現場實際有什麼」而非「現行 decode() 肯收什麼」
- [ ] 本體資料的 key 清單集中在備份模組內一處定義，是本功能唯一的 key 來源
- [ ] 下載走瀏覽器原生 Blob ＋ object URL，用完釋放；**不得安裝任何新套件**（專案紅線）
- [ ] 測試：可重建資料不進備份、缺席 key 不長出空值、信封含版本與時間欄位、
      五把 key 的真實形狀 fixture 都收得進去
- [ ] 測試沿用 `utils/persistentStore.test.ts` 的記憶體 Storage stub 與斷言風格，不另創寫法
- [ ] `npm run gate` 全綠，既有測試零修改
