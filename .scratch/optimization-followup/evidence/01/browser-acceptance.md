# 01 隔離假資料瀏覽器驗收

日期：2026-09-20

## 隔離條件

- build：本票 `npm.cmd run gate` 產生的 `dist/`。
- origin：`http://127.0.0.1:4175`，只綁 loopback。
- 第一輪 fixture 的所有 `/api/*` 都在本機攔截；Gemini 固定拒絕，未定義 API 固定 404，不存在轉送真實服務的 fallback。
- 本票複製 fixture 到 `evidence/01/preview-fixtures.mjs`，只新增 `RETRY` 一次性失敗場景、fixture 自身 favicon 204，並因檔案位置更深而把 dist 路徑調整為 `../../../../dist/`。第一輪歷史 fixture 保持原樣。
- 未呼叫真實 AI；庫存頁使用獨立 origin 的空 localStorage，未寫入真實投資組合。

## 實際操作

| 路徑 | 實測結果 |
|---|---|
| 市場初始載入 | 通過。`2330.TW`、`台積電（驗收假資料）`、價格 `150.39` 實際顯示。 |
| 週期切換 | 通過。點「週」後按鈕進入 active 狀態，network 取得本機 `/api/yahoo/chart?symbol=2330.TW&interval=1wk&range=5y`。 |
| 圖表縮放 | 通過操作。實際點擊「放大 (+)」且輸入被頁面接受；元件沒有公開數字型 zoom state，因此本票不宣稱量到縮放比例。 |
| 鍵盤搜尋 | 通過。輸入 `AAP`，清單顯示 `AAPL / Apple（驗收假資料）`；ArrowDown + Enter 選取後顯示 `AAPL` 與價格 `150.39`。 |
| 持續失敗 | 通過。`FAIL` 顯示 `role=alert` 的「模擬行情暫時無法取得」與「重試」控制；重試再次送出同一本機 503。 |
| 一次失敗後重試 | 通過。`RETRY` 第一次本機 chart 回 503，顯示「模擬首次行情失敗」；點「重試」後同一代碼成功顯示 `RETRY（驗收假資料）`、價格 `150.39`。 |
| 故障後恢復正常標的 | 通過。FAIL 後輸入 `2330`，畫面重新顯示 `2330.TW`。 |
| 我的庫存 | 通過。切頁後顯示「我的庫存」與空清單提示；未新增、匯入或改寫任何持股。 |
| 基本面 | 通過。切頁後顯示基本面內容與 `AI 基本面解讀` 控制；network 的 FinMind 請求全部落在 `127.0.0.1:4175/api/finmind`。未點 AI。 |

## Network 與 console

瀏覽器 network 捕捉到的應用 API 全部位於 `http://127.0.0.1:4175/api/...`，包含 FinMind、Yahoo search/chart；未觀察到真實行情或 AI API 網域。

第一輪本票操作曾捕捉到：

- `FAIL` 的兩筆 503：預期故障注入。
- `favicon.ico` 404：舊 fixture 自身資源噪音；本票專屬 fixture 已改回 204，不改產品。
- Recharts 在 lazy chart 初掛載時輸出數筆 width/height `-1` warning；屬 warning，未見 uncaught JavaScript exception。本票不處理此既有 UI 診斷，避免跨入後續票範圍。

## Review 修正後 fresh rerun

獨立 review 指出保存到 `evidence/01/` 後 dist 相對路徑應再多上兩層。修正為 `../../../../dist/` 後，**直接用保存版** `evidence/01/preview-fixtures.mjs` 啟動 `127.0.0.1:4175`，重新跑主要矩陣：

- `2330.TW` 初始市場頁成功，週線切換成功並送出本機 `interval=1wk` 請求；實際點擊「放大 (+)」。
- 鍵盤輸入 `AAP`，清單顯示 `AAPL / Apple（驗收假資料）`，ArrowDown + Enter 後載入 AAPL。
- `RETRY` 第一次 chart 為預期 503；畫面出現「模擬首次行情失敗」，點「重試」後同一代碼成功顯示 `RETRY（驗收假資料）` 與價格 `150.39`。
- 「我的庫存」仍為隔離 origin 的空清單，沒有新增／匯入真實持股。
- 「基本面」成功載入，FinMind 請求全落在本機 `/api/finmind`；沒有點 AI。

fresh network 中所有應用 API 都是 `http://127.0.0.1:4175/api/...`。保存版 fixture 的實際請求序列另存為可提交的 `preview-rerun-requests.txt`；啟動過程沒有 stderr 輸出。

fresh console：只有 `RETRY` 故障注入的 503 error 與 lazy chart 掛載時既有 Recharts width/height `-1` warning；**沒有 favicon 404、沒有 uncaught JavaScript exception**。故障注入 503 依手冊獨立列出，不冒充正常情境錯誤。
