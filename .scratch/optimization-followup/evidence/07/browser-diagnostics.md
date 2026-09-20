# 07 瀏覽器觀測與清理

14 份正式 profile 與 1 份故障結果的 `metrics.errors` 均為空。Desktop debugger 在最後故障頁捕捉到的 console error 清單為空（`truncated=false`、`dropped=0`）；只代表 attach 後該緩衝區，不追認未捕捉的歷史訊息。

最後故障頁實際 DOM 顯示 `OVERSIZE`、20,000 棒、末價 `2099.5301637643834`，頁面標題 PASS。quota、拒絕存取、壞 JSON 和循環序列化失敗為測試注入；沒有錯誤外洩為 uncaught，sentinel 全保留。

API 請求全部在瀏覽器合成 fetch 邊界終止，未知 API 拒絕；server 也拒絕所有 `/api` fallback。`connect-src 'self'` 限定此量測 origin。沒有真實 AI／市場請求，也沒有瀏覽真實庫存。

首次校正站 PID 26508 已停止，修正版 PID 14080 在最後樣本及診斷完成後停止；本回合建立的兩個 4180 分頁均關閉。`cleanup.json` 記錄 listener=0。
