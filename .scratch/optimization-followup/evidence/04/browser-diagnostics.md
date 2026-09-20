# 04 瀏覽器診斷與證據範圍

日期：2026-09-20。瀏覽器 Chrome 153，專屬 origin `http://127.0.0.1:4178`。

## 實際驗收

18 個 hook 公開介面案例、1 個正式 App 重疊更新案例及 1 次 Desktop 原生按鈕操作，均通過。`candidate-evidence.json` 逐案核對 `passed:true`、相同 hook 原始碼 SHA-256、相同正式 build 的 index SHA-256 及 `uncaught:0`。

hook 案例以 esbuild 在記憶體建置真實 hook 與 snapshot hook；不替換 React、報價服務或金融工具。正式 App 案例與原生操作使用 Vite `dist/`，並未以 hook 宿主代替正式 UI 驗收。原生操作的 viewport 與完整讀值保存於 `manual-refresh.json`。

## Console

最終 18 案前清理診斷 buffer；最終讀取 `level:all` 得到 12 筆訊息，皆為案例刻意注入的 HTTP 503，沒有其他 console 訊息。這 12 筆分別來自舊／新失敗、force 重疊、匯率失敗及空庫存表單案例；各案 `requests` 記錄了實際 503 對應的股票與請求序號。該次 console 回傳 `dropped:0`、`truncated:false`。各案的 `error`／`unhandledrejection` 捕捉亦為 0。

建立假站時曾因同時扣住六筆 HTTP 回應而阻塞控制路由，停止該版本服務時產生 connection reset/refused；之後改為只扣住美股與匯率、台股即時回覆，再從新頁面重跑。這些建立驗收工具時的錯誤不計為產品修正後正常路徑結果，也沒有作為通過證據。

## Network 與隔離

最終 network 取樣的 Yahoo chart 與 FinMind 請求皆為同源 `/api/...`，與逐案 JSON 的假站實際請求相符。長時間附接的 network 歷史 buffer 回報 `dropped:899`；因此不把 Desktop buffer 宣稱成整輪完整封包紀錄。每案 `requests` 是假伺服器直接保存，完整性不依賴該 buffer；未知應用 API／AI 固定拒絕且沒有轉送路徑，CSP 與 fetch 邊界限制同源。

本票只核對假資料的價格／報價日期／取得時間／匯率／快照歸屬，不宣稱真實行情延遲或第 12 票跨尺寸整合矩陣已驗證。結束程序與分頁的結果另存 `cleanup.json`。
