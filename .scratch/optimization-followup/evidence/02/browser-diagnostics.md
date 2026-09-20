# 02 瀏覽器診斷與隔離範圍

2026-09-20，Chrome 153，專屬 origin `http://127.0.0.1:4176`。

首次候選的完整矩陣於本機 20:38:04～20:38:42 重新執行，10 案全數通過。以下先保留該輪診斷；本文末尾記錄 Standards 快取修正後的 11 案重跑。每案 JSON 另有完整實際 UI 文字、dataset／股票／次數／HTTP 結果，以及所載入的 build chunk 名稱。

## Console

Desktop console 從 cursor 9098 後讀取，結果 `truncated=false`、`dropped=0`。只出現以下 6 筆刻意的 503 注入，沒有其他 error 或未捕捉 JavaScript 例外：

| 序號 | 端點／場景 |
|---:|---|
| 9787 | FinMind 6488 估值第一次失敗，驗證重試仍為 B |
| 10479 | 合成 Gemini A 失敗，驗證不清除 B 的 AI loading |
| 10884 | FinMind 舊 A 估值先失敗，新 A 仍等待 |
| 11288 | FinMind 舊 B 估值後失敗，已完成的新 A 不被改寫 |
| 11991 | FinMind 卸載前 A 失敗，重掛載面板不受影響 |
| 12637 | 合成 Gemini 卸載前 A 失敗，B 的 AI 狀態不受影響 |

另有 6 筆既有 Recharts `width(-1)/height(-1)` warning，出現在卸載案例切回市場圖表時（11932～11934、12578～12580）。本票沒有修改市場圖表。

初期假站以 CSP 阻擋 Google Fonts 產生的 error，已由假站 HTML 移除外部字型 link 處理；上列最終重跑已無該 error。原始產品 HTML 沒有變動，也未允許測試站連外取字型。

## Network

Desktop 保留的 API 請求均為 `127.0.0.1:4176` 的 FinMind、Yahoo 或合成 Gemini，沒有真實 API URL。核對到的同代碼兩次請求包含舊 A 503（11995）與新 A 200（12007）；最後的舊 A 合成 AI 503（12640）與 B 合成 AI 200（12651）亦符合案例順序。

Desktop network 的歷史緩衝區曾丟棄 1835 筆事件，已沿回傳 cursor 讀至 12651；不能把它描述成全部歷史請求的完整封包紀錄。各案例的 `requests` 則在 fake server 按次序直接記錄，不依賴 Desktop 緩衝區，並逐案保存到 JSON。

隔離由假站程式與 `connect-src 'self'` 同時約束：所有應用 `/api` 在 loopback 回覆，未定義 API 拒絕；沒有轉送實作。AI 回應為固定合成字串，未送真實模型。儲存清空僅作用於 4176 的假資料 origin，未操作真實庫存。

## Standards 修正後的最終重跑

同一份保存版 fixture 配合最新 build 重跑 11 案，包含新增的 `cache-return`，均通過。該案例再次回 A 時仍顯示 2330／2026-09-17／21.11，詳 `green-cache-return.json`；修正前的 11.11 錯值留在 `red-cache-return.json`。

這輪開始前清除舊 console 診斷 buffer，最後讀取 `truncated=false`、`dropped=0`。只有 7 筆預期 503（序號 1020、1716、2112、2516、2918、3663、4259）；多出的一筆屬新增 `cache-return` 沿用舊 B 失敗的情境。沒有非預期 console error 或未捕捉 JavaScript 例外。先前 network 緩衝區限制仍明列於上節，未將逐案假站 request 紀錄冒稱為完整封包擷取。
