# 05 量測方法

使用正式 hook 與真 HTTP 假站。HTTP 峰值在伺服器依連線請求開始／回應完成計數，不以 worker 數代替；瀏覽器自己的 HTTP/1.1 六連線限制會讓修改前峰值上限約為 6。

可重跑基準：以 `node .scratch/optimization-followup/evidence/05/fixture-server.mjs --baseline` 啟動，esbuild 只在記憶體中載入固定點 `0366f5f` 的產品原始碼；不 checkout、不覆蓋工作區。相依套件沿用未更動的 package/lock。此模式只供 hook 宿主；正式 App 一律驗目前 dist，兩種證據分開。

首檔／全部可見時間從第一筆 fetch 發起算到 MutationObserver 觀察 hook 公開 DOM 輸出，不從 `/__fixture/state` 診斷 HTTP 回來後才開始計時。初版工具曾採後者，30 檔的診斷請求被瀏覽器排隊，出現首檔約 0 ms 的失真值；在產品修改前修正觀測起點並重跑整批，未將該失真值用於前後效能結論。

資料集：1、10、30 檔合成美股，加 1 個匯率；單檔 TEST005 在首次一般載入故障注入。假延遲 80 ms，時間固定 2026-09-20T04:00:00Z，瀏覽器版本與 viewport 隨 JSON 保存。每種數量首輪冷初始化另列；第 1 輪作暖機，第 2～6 輪取中位數。每輪清空此專屬 origin 的儲存且重新載入模組，確保行情為冷快取；暖機只暖瀏覽器與建置工具，不把快取命中混入網路量測。
