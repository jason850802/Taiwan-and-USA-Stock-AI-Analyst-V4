# 03 證據索引

正式判定見 [REPORT.md](REPORT.md)。原始 run 以唯一代號保存，沒有覆寫既有檔案。

| 證據 | 用途與結果 |
|---|---|
| [取消前紅燈](cancel03-red-20260924-r4/raw.json) | 用戶端斷線後，舊入口假 AI 仍輸出五段；有效紅燈 |
| [假 AI 取消綠燈](cancel03-green-20260924-r4/raw.json) | 最終來源下，候選代理與 handler 都收到中止，假 CLI 在第一段後被終止，沒有完成事件 |
| [Yahoo chart 取消綠燈](chart03-green-20260924-r1/raw.json) | A 中止後 chart 拋 `AbortError`、沒有完成回應；B 同時成功 200 |
| [chart 取消定稿](chart03-final-20260924-r4/raw.json) | 最終來源下，A 的 chart 中止，B 同時成功 200 |
| [單人握手取消](chart03-cookie-20260924-r3/raw.json) | A 在 cookie 階段斷線時，中止該次上游 fetch，沒有進入 chart |
| [共享握手取消](chart03-shared-cookie-20260924-r3/raw.json) | A 斷線後 B 沿用同一握手並成功 200；A 沒有進入 chart |
| [日常入口固定成本](daily-cost03-20260924-r1/raw.json) | 從 Vite 同源代理量 20 支暖 OPTIONS 與 20 支暖固定 GET，全部成功 |
| [修訂後日常入口成本](daily03-cost-20260924-r3/raw.json) | 環境白名單版的同源代理，暖 OPTIONS 與固定 GET 各 20/20 成功 |
| [身分綁定的日常入口成本](daily03-cost-20260924-r5/raw.json) | 最終來源下，原始檔記錄啟動器、前後相同 owned PID 與同源代理暖成本，各 20/20 成功 |
| [失聯狀態保護](stale03-20260924-r1/raw.json) | 舊 listener 存活而控制管道失聯時拒絕另起服務，舊狀態保留 |
| [隔離重載矩陣](reload03-20260924-r2/raw.json) | 十步通過；改碼、語法錯誤、環境、刪路由與串流中改碼；測試檔逐位元組還原 |
| [修訂後隔離重載矩陣](reload03-final-20260924-r3/raw.json) | 更新握手來源後十步重跑通過，`diffs=[]`、`problems=[]` |
| [全路由定稿重載矩陣](reload03-allroutes-20260924-r8/raw.json) | LF 最終十一檔來源綁定，B1／C 十步重載與清理結果 |
| [限流等待中取消](guard03-20260924-r2/raw.json) | LF 最終來源五條正式路由先進入延遲限流再斷線，沒有啟動行情或 AI 上游，5/5 PASS |
| [搜尋取消](route03-search-20260924-r3/raw.json) | 斷線後 Yahoo search 假上游 `AbortError` |
| [FinMind 取消](route03-finmind-20260924-r3/raw.json) | 斷線後 FinMind 假上游 `AbortError` |
| [非串流 AI 取消](route03-gemini-20260924-r3/raw.json) | 假 CLI 被終止、無完成事件；沒有真 AI |
| [元件與 CSS HMR](hmr03-20260924-r1/raw.json) | `App.tsx` 與 `index.css` 各收到 Vite update，原檔逐位元組還原 |
| [日常啟停及 App 實測](LIFECYCLE.md) | 兩次重啟、埠衝突、同源驗證、台美股、隔離庫存與假 AI 畫面觀察 |
| [獨立雙軸覆核](REVIEW.md) | 初輪缺口、修正及定稿判定 |

開發期保留：`cancel03-red-20260924-r1`～`r3` 是啟動或假 AI 設定未成立，不能當取消紅燈；`cancel03-green-20260924-r1` 因未處理上游 body `AbortError` 造成子程序退出，`r2` 修正後綠燈、`r3` 增加產品來源雜湊後重跑；`reload03-20260924-r1` 的長串流缺假 CLI 測試旗標而回 500。`reload03-allroutes-20260924-r4` 在跑時來源檔有變更，清理身分檢查判紅；`r5`～`r7` 是其後版本，定稿以 LF 最終來源的 `r8` 為準。`guard03-20260924-r1` 與搜尋／FinMind 先前 run 的程式換行位元組不同於最後提交，只保留歷史。以上舊 run 不作最終來源 PASS，保留查錯歷史。

執行時的 runtime、fixture 與日誌在 `%LOCALAPPDATA%\Temp\perf-opt-20260923\`；未提交任何 `.env` 複本。正式部署、真行情與真 AI 均不屬於上述固定資料證據。
