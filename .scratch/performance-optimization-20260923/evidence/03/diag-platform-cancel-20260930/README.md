# 03 平台取消診斷（2026-09-30，非正式證據）

依 diagnosing-bugs 流程，從 r3 第 11 筆 trace（客戶端收到首段就取消，伺服器仍送完五段＋done）出發的診斷紀錄。**這裡是 session 暫存工具的原樣副本與原始輸出，不是依本案正式規則（提交版工具、雜湊綁定、新 run-id）產生的驗收證據**；正式平台驗收另行執行。結論與處置見 [03 票面](../../../issues/03-daily-dev-entry.md)「2026-09-30 平台取消診斷」一節。

## 檔案

| 檔案 | 內容 |
|---|---|
| `cancel-loop.mjs` | 診斷迴圈：送「首段 delta 即斷線」（或第 6 參數指定毫秒數斷線）的串流請求，再以 `vercel logs --deployment <id> --json --expand` 撈同請求的平台紀錄判紅／綠。用法見檔頭 |
| `diag-prepare.mjs`、`diag-fixture.cjs` | 診斷 Preview 包：同一份已提交的 `api/gemini-stream.ts` 打成三個路由（開旗標／開旗標＋多記事件／不開旗標），假 CLI 20 段 × 600 ms |
| `diag03-prepare.json`、`diag03-deployment.json` | 打包清單（handler SHA-256、各路由 `.vc-config.json`、bundle SHA-256）與部署結果 `dpl_FzbxAMKRgK7Bvfz4CCvQdRTqc6Tx` |
| `diag-r3-recheck.json` | r3（無旗標、5 段）回歸：3/3 紅 |
| `diag-A-rerun.json` | 開旗標、產品碼原樣：3/3 停（斷線後約 0.85 秒，20 段只送 1 段） |
| `diag-A-early-cancel.json` | 開旗標、送出 400 ms 就斷線：3/3 停（1 筆 48 ms 即停，2 筆在首段寫出後約 200 ms） |
| `diag-A2-rerun.json` | 開旗標＋多記 req error/close、res error：3/3 停，平台同一刻發出 res 'close'（finished=false）、req 'aborted'、req 'error'（aborted／ECONNRESET） |
| `diag-B-control.json` | 不開旗標（對照）：3/3 跑滿 12.6 秒到 done |
| `diag-A-flag-on.json`、`diag-A2-flag-on-events.json`、`diag-raw-logs.jsonl` | 第一輪（請求未間隔、舊版解析器）：平台事件沒有 trace 而被漏讀，三筆又在同一實例重疊而互混。**已被上列 rerun 取代**，留作「事件混入他筆」的原始紀錄 |

最早兩次對 r3 的重現（tag `diag03-munygl7x` 1 筆、`diag03-munyhb4l` 3 筆，皆紅）只輸出到終端、未存檔，結果記在 03 票面。

## 重現注意

- 平台 runtime logs 保留期很短（隔天就撈不到 r3 的紀錄），探針跑完要當場撈。
- 請求之間留 ≥15 秒：平台觸發的事件跑在請求的 async context 之外、記不到 trace，只能依同一筆平台請求紀錄歸屬；Fluid 同實例並行時會混入他筆。
- 腳本內含本機絕對路徑；要重跑請複製到暫存目錄，並使用已登入、看得到 `chuan0802` 範圍的 Vercel CLI。
- 診斷包清除所有後端秘密環境值、只用假 CLI 與固定上游；打包後逐一比對 `.env` 秘密名的值，0 命中。
