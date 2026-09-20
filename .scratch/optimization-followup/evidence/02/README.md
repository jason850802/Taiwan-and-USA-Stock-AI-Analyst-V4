# 02 基本面請求歸屬驗收

固定比較點：`ade5dca1e7106c90430efc35b50ba4adaaae8b42`（第 01 票最終基準）。開始時工作區乾淨；`before.json` 另記錄 claim／驗收工具建立後的狀態與 44 個既有測試、snapshot、package／lock 檔案雜湊。

## 可重跑入口

在專案根目錄執行 `node .scratch/optimization-followup/evidence/02/validate.mjs gate` 產生正式 build，接著執行 `node .scratch/optimization-followup/evidence/02/fixture-server.mjs`。假站只綁 `http://127.0.0.1:4176`；所有 `/api` 在本機回覆，未定義端點拒絕，CSP 限制網路只可同源。啟動輸出會列 PID，結束只停止這個程序。

在該 origin 的瀏覽器頁面，每個案例先重新整理，再執行：

```js
await (await import('/__fixture/browser-cases.mjs')).runCase('race', 'green');
```

也可直接開 `http://127.0.0.1:4176/?suite=green`，依序執行全部 11 個案例；每個案例會重新載入正式 App，成功才前進，失敗停在該頁。每案結果寫入 `green-<案例>.json`。等待輪詢僅用於 HTTP／畫面就緒，不用毫秒延遲決定回應先後。

`browser-cases.mjs` 是建置後瀏覽器行為測試，操作真實 App DOM 與同源 HTTP 假回應；不存取 React 私有狀態、不替換產品服務、沒有增加 DOM 測試套件。它不是 Vitest 測試數的一部分；實際鍵盤／點擊另用 Desktop 工具驗收並記錄。

每次重新整理只清除 **4176 專屬測試 origin** 的 localStorage／sessionStorage，並固定無參數 `new Date()` 與 `Date.now()` 為 `2026-09-20T04:00:00Z`。不碰正式網站、3000 開發站或 4175 第一票假站的儲存。

基本面每次七個 dataset 請求只扣住估值回應；其餘假資料即時回覆，避免 HTTP/1.1 六連線上限阻塞測試控制。測試透過 `/__fixture/release` 精確決定先後與成功／失敗，不靠固定延遲猜競態。合成 AI 僅回應本票固定假資料，沒有真實模型請求。

bootstrap 在假站的 FinMind URL 加上唯一 `__fixtureRequest` 參數，讓 A→B→A 的兩筆相同 URL 不被瀏覽器排程合併；服務輸入的股票代碼與 dataset 不變，伺服器忽略這個驗收參數。假站 HTML 移除外部 Google Fonts link，使用系統字型；產品 index.html 與正式 build 均未修改。

## 修改前結果

- `before.txt`：完整 gate，40 個測試檔、727 項測試通過；build、金鑰掃描與 package gate 通過。
- `red-race.json`：先釋放 B（6488），再釋放 A（2330）。搜尋欄為 6488，但頁面被覆寫為 2330／2026-09-17／PER 11.11，案例失敗。
- `red-retry.json`：B 失敗後按重試，實際送出 `fund:2330:2`，並顯示 A 第二次資料；案例失敗。
- `red-ai-success.json`：A 尚在生成 AI 時切到 B，B 繼承 A 的 loading，無法生成自己的報告；案例失敗。
- `red-cache-return.json`：Standards 覆核後新增的重現。A2 先成功、A1 後回，切離再回 A 從服務快取讀回 A1 的 11.11；`cache-red.txt` 中新增服務測試有 2 個預期失敗，既有測試未改。

## 修正後行為矩陣

| 案例 | 實際驗證 |
|---|---|
| race | A 慢、B 快，最後仍為 6488／2026-09-18／PER 22.22 |
| retry | B 等待與失敗均標示 6488；重試確實請求 B，完成後 PER 32.22 |
| ai-success | A 背景完成不清除 B 的 AI loading；B 報告只屬於 B；回 A 沿用成功報告且不重打 AI |
| ai-failure | A 背景失敗不污染 B；回 A 可重試成功 |
| same-symbol-early-error | A→B→A，舊 A 先失敗仍保持新 A 等待；新 A 完成後數值 21.11 |
| same-symbol-late-success | 新 A 先成功，舊 A 後成功及 B 失敗皆不覆寫新 A |
| cache-return | 舊 A1 晚回後，切離再回 A 仍讀到 A2 的 21.11，雙層快取不倒退 |
| old-success-pending | 舊 A 成功／finally 不清除 B 的等待狀態 |
| unmount | 基本面卸載、重掛載後，舊請求錯誤不影響新面板 |
| ai-return-pending | AI 生成中 A→B→A，仍顯示 A 進行中狀態且僅一筆 A AI 請求 |
| ai-unmount | 卸載前 A 的 AI 失敗不改變重掛載後 B 的 AI 狀態 |

以上 11 案皆在快取修正後的正式 build、Chrome 153 重跑通過，完整 UI 讀值與請求序列見各 `green-*.json`。這 11 案與 Vitest 的 731 項分開計數；731 包含原有 727 項及新增的 4 項服務測試。

`manual-keyboard-retry.json` 另保存 Desktop 真實 fill／Enter／click 的驗收：A 已顯示 → B 等待 → B 503 → 點重試 B → 6488／2026-09-18／32.22；等待時沒有舊數字或 AI 按鈕。真正點擊 AI 前未下載 gemini chunk，點後取得本機合成 6488 報告。

手動驗收 viewport 為 1536×639、scrollWidth 1528；本票沒有宣稱已完成第 12 票的跨尺寸整合矩陣。最終 console／network 範圍、預期故障與緩衝區限制見 `browser-diagnostics.md`。

## 機械驗證

- `gate.txt`：快取修正後完整 gate；41 個 Vitest 測試檔／731 項全綠、tsc、build、金鑰掃描與 package gate 通過。
- `cache-green.txt`：4 項新增服務測試通過；透過公開 getTwFundamentals 驗證兩種回應順序、記憶體與 sessionStorage 再讀、新請求失敗後重試、不同股票互不失效。
- `unchanged.json`：44 個原有測試／snapshot／package／lock 檔案 SHA-256 全部未變。
- `bundle.txt`：首屏 raw 283.30 KiB／gzip 92.85 KiB；相較 01 的 283.17／92.82 KiB，增加 0.13／0.03 KiB，遠低於 5% 調查門檻。新增差異來自 FinMind 快取發布身分守衛。
- Git 對固定點的提示詞、AI 快取鍵／有效期、金融設定與 package／lock 差異為空；FinMind 僅調整基本面快取發布順序，不改資料整理、數值計算、429 退避、快取鍵或跨日有效期。

執行 Node 為 v26.4.0。快取修正後重跑的最終假站 PID 25520 與測試分頁已關閉，4176 沒有殘留 listener；見 `cleanup.json`。

## 已確認原因與修正

基本面完成時未核對請求先後，且重試採用上次成功代碼；AI 只有共用 loading/error。修正為基本面請求序號與目前請求代碼，加上每股 AI 身分、loading、error。取消不是正確性的必要條件，本票保留服務網路／429 退避、快取鍵與有效期；舊請求仍可完成，但不再任意寫回目前畫面。

Standards 另指出同股舊回應會覆寫服務快取。主入口現以每個原有 cache key 的請求身分保護 memory／sessionStorage 發布；舊呼叫仍回覆原有資料，快取只由最新請求更新，成功或失敗皆清理請求身分。

## 範圍

產品修改限定基本面面板的請求歸屬及載入／錯誤回饋，以及 FinMind 基本面快取的發布身分守衛。財報整理、估值計算、AI 提示詞、服務快取鍵與有效期保持原樣。第 03 票未啟動。

獨立覆核與處置見 [code-review.md](code-review.md)：Standards 1 項已關閉，Spec 0 項，最終兩軸 OPEN 0／NEW 0。本票完成後停止。
