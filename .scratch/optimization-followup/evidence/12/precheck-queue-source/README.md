# 排程前版本啟動參數診斷

這批頁面使用 `suite=before` 名稱，但第一次啟站遺漏 `--baseline`，實際 `source` 是 working-tree、`queueSha256` 不是 null。來源檢查發現後停止該次假站，原始結果全部保留於此，不列入最終前後比較。

正式前版本必須用 `node .scratch/optimization-followup/evidence/12/replay-server.mjs 05 --baseline` 啟動；頁面參數只決定案例和輸出名稱，不會選擇產品來源。修正參數後從 sample0 重新收集完整21份前版本樣本，摘要工具也核對固定04提交及空 queue 指紋。
