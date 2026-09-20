# 05 庫存載入併發上限

固定比較點：`0366f5fb1d58d963323cc9d519f49ec87217a048`。工作區從 04 的乾淨提交接續，使用者已授權自動依序完成 05～12。

## 實作與範圍

`useHoldingPrices` 的同一 hook 實例持有一個 `holdingPriceQueue`，一般與手動重疊更新共用三個槽位。它使用既有 `runWithConcurrency` 執行已選取批次；active 槽位由同一佇列持有，沒有每次刷新另開三條線。股票與匯率共享上限，匯率優先在首批取得機會。

排隊的同 key 舊意圖可被較新意圖替換，舊等待者立即結束；已開始工作仍占槽到實際完成，04 的身分守衛控制發布。移除及卸載取消尚未開始的工作。快取回填留在佇列外，force 期間的一般讀取仍等待既有有效意圖。價格／匯率失敗政策、60 分鐘匯率窗、股票沿用窗、快照與金融計算均不變。

控制範圍是這個庫存載入 hook 的生命週期，不宣稱涵蓋其他頁面、其他 hook 實例、其他瀏覽器或後端的所有請求。

## 修改前證據與測試

`red-load-30-0.json` 在修改前真實 hook 量到 HTTP 峰值 6，明確未通過最多 3 的斷言。伺服器計數以 HTTP 實際到達與完成為準，並非自報 worker 數。

新增 `holdingPriceQueue.test.ts` 六個公開排程案例：重疊三輪、匯率首批、排隊替換、取消/清空等待者、單檔失敗、空槽即時補入。相關 Vitest 與型別紀錄分別在 `tests.txt`／`types.txt`；全 gate 在 `gate.txt`。`unchanged.json` 核對本票起點的 46 個既有測試／snapshot／package/lock 均不變。

## 假資料瀏覽器與量測

`before-load-*`／`after-load-*` 包含 1、10、30 檔各七輪：冷初始化、暖機、五次量測。固定假延遲 80 ms，單檔故障包含在測量中。原始峰值、請求順序／數量、首檔與全部完成時間、瀏覽器與 viewport 都隨 JSON 保存。五次中位數與最差樣本彙整於 `comparison.json`，方法及曾修正的觀測起點見 `measurement-method.md`。

最新重跑的前後量測數值見 [measurement-results.md](measurement-results.md)，由完整原始樣本自動產出，與 `comparison.json` 同源。

單檔的數十毫秒差異包含瀏覽器排程與當次負載，不宣稱精確歸因。30 檔全量時間增加是限流的直接取捨；峰值與匯率排程位置則由實際 HTTP 記錄支持。重疊兩次刷新所有最後意圖成功，沒有每次另增三個槽位。

`green-overlap-30-0.json`、`green-remove-30-0.json`、`green-unmount-30-0.json`、`green-cache-30-0.json`、`green-duplicate-30-0.json`、`green-retry-30-0.json` 是實際 hook 邊界的六種瀏覽器情境。排隊移除不再送出、卸載不再啟動其餘工作、快取立即顯示、重複代碼不重送、單檔可重試，並控制重疊 force 的最後值。

`green-app-30-0.json` 另驗正式 Vite build 的 30 檔庫存重疊兩次更新，每檔最後為合成價格 300、匯率 32。`manual-refresh-30.json` 是 Desktop 原生點擊「更新報價」，實際 30 檔均更新為 400、匯率 33，HTTP 峰值仍為 3。hook 宿主、正式 App、原生輸入分開記錄，互不冒充。

限制併發會延長全部完成時間，不能只報峰值下降當成全面提速。這些數字僅代表本機固定假延遲與當次瀏覽器，不代表真實行情網站延遲保證。

## 重跑

```powershell
node .scratch/optimization-followup/evidence/check.mjs 05 gate
node .scratch/optimization-followup/evidence/05/fixture-server.mjs
```

在 4179 專屬 origin 開 `/harness?suite=after&n=1&sample=0&matrix=1` 可重跑整組；`/harness?suite=green&n=30&scenario=overlap&behaviors=1&delay=150` 跑六種行為；`/?suite=green&n=30&scenario=overlap&delay=150` 跑正式 App。

要重跑修改前，先停止自己的假站，再以同命令加 `--baseline` 啟動並使用 `suite=before`。只在記憶體編譯固定點產品，不改工作區。收齊樣本後執行 `node .scratch/optimization-followup/evidence/05/summarize.mjs`。

所有應用 API 由 loopback 假站終止，未知 API／AI 拒絕；只清理 4179 的合成儲存。預期 TEST005 的 503 與非預期例外分開，逐案 `uncaught` 必須為空；此票不做真實 AI、真實持股或跨尺寸最終驗收。

`verify-browser.mjs` 核對 21 個修正後量測樣本、6 個 hook 行為、正式 App 與原生輸入共 29 份結果的通過狀態、HTTP 峰值、逐案 hook／queue／build 一致性、未捕捉例外、console.error 及非預期 HTTP 失敗。review 要求補上 queue 綁定後，所有修正後案例都重新執行，沒有直接替舊結果補蓋新雜湊。`fixture-server.mjs` 於啟動時讀入 hook 與 queue 原始碼，編譯與綁定使用同一份位元組。

## 覆核

獨立 Standards／Spec 結果於 `code-review.md` 保存：兩軸各自完整覆核均 OPEN:0，未要求追加產品修正。程式、測試、工具及證據皆納入本票單一最終提交。
