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
| [第二輪補證總覽（2026-09-25）](ACCEPTANCE-20260925.md) | 原 localhost:3000 App、依賴重載、生命週期、部署路徑靜態核對、啟動器孤兒修正與 03 逐項判定 |
| [第二輪增量獨立雙軸覆核](REVIEW-20260925.md) | `c789bda..5997b92`：Standards PASS（2 條判斷題）；Spec 本輪增量 PASS、整張票 FAIL（4 條應修、1 條可接受），執行者逐條查證；發現待處置，建議處置交 Codex |
| [原 3000 正式 App r3](app03-localhost3000-20260925-r3/raw.json) | 修正孤兒後的啟動器：桌面＋窄版各 14 步 28/28 PASS；逐步五鍵、截圖、請求分類；停止後整棵 12 程序樹 0 殘留 |
| [生命週期原始紀錄 r3](life03-localhost3000-20260925-r3/raw.json) | 修正後綠燈：8 情境（含 vercel／Vite 只結束自身的崩潰、監督程序崩潰由看門程序清樹、看門程序也失效時 `recover` 清樹）全 PASS，結尾殘留清理 0 個 |
| [生命週期紅燈 r2](life03-red-localhost3000-20260925-r2/raw.json) | 最終版驗收工具配修正前啟動器（`94848ac`）：5/8，`crash-vercel`、`crash-supervisor`、`crash-supervisor-no-watchdog` 留下孤兒而 FAIL（工具結尾已清除） |
| [生命週期紅燈 r1](life03-red-localhost3000-20260925-r1/raw.json) | 同上但用加建立時間守衛前的中間版工具，結論相同，只留時序 |
| [失聯狀態保護回歸](stale03-20260925-r2/raw.json) | 修正後啟動器：舊 listener 存活且控制管道失聯時仍拒絕另起、保留舊狀態 |
| [失聯復原回歸](recover03-20260925-r3/raw.json) | 修正後 `recover`：清掉核對過的 owned 程序，錯誤建立時間的重用 PID 不殺，相容無程序樹的舊狀態檔 |
| [修正後日常入口成本](daily03-cost-20260925-r2/raw.json) | 固定上游：暖 OPTIONS、固定 GET 各 20/20，中位 15.48／77.89 ms |
| [原 3000 正式 App r2](app03-localhost3000-20260925-r2/raw.json) | 修正前啟動器：隔離資料目錄、桌面＋窄版各 14 步 28/28 PASS；逐步五鍵 before／after、截圖、請求分類 |
| [原 3000 正式 App r1](app03-localhost3000-20260925-r1/raw.json) | 失敗歷史：判定器當時未實作協定 §4 的 2y 例外、缺完成時刻，窄版 1 步 FAIL；不追認 |
| [依賴刪除／恢復重載](reload03-deps-20260925-r1/raw.json) | 隔離 checkout 12 步 B1／候選對照，含刪除與恢復共用依賴，`diffs=[]`、`problems=[]` |
| [生命週期原始紀錄 r2](life03-localhost3000-20260925-r2/raw.json) | 修正前：原 3000／3001 日常命令、核對整棵子孫樹：兩次啟停、雙埠衝突、vercel／Vite 崩潰（當時以 `/T` 模擬）與恢復 PASS；**監督程序崩潰留下內部 Vite＋esbuild 孤兒，FAIL**（工具結尾已清除） |
| [生命週期原始紀錄 r1](life03-localhost3000-20260925-r1/raw.json) | 失敗歷史：報 7/7 PASS，但殘留檢查漏了 vercel 內部開發伺服器，`crash-supervisor` 判定作廢；其留下的孤兒事後查到並清除 |
| [部署路徑靜態核對](deploy03-static-20260925-r1/raw.json) | 部署設定零差異、路由不變、本機預載隔離、03 前後正式前端建置逐檔相同；正式平台行為不在可證範圍 |
| [來源清單 r6](SOURCE-MANIFEST-20260925-r6.json) | 26 檔實體 SHA-256 與 Git blob（含修正孤兒後的 `daily-dev.mjs` 與更新後的驗收工具） |
| [來源清單 r5](SOURCE-MANIFEST-20260925-r5.json) | 修正啟動器前、生命週期工具第一次修正後的 26 檔清單，僅作時序 |
| [來源清單 r4](SOURCE-MANIFEST-20260925-r4.json) | 修正生命週期工具前的 26 檔清單，僅作時序 |

開發期保留：`cancel03-red-20260924-r1`～`r3` 是啟動或假 AI 設定未成立，不能當取消紅燈；`cancel03-green-20260924-r1` 因未處理上游 body `AbortError` 造成子程序退出，`r2` 修正後綠燈、`r3` 增加產品來源雜湊後重跑；`reload03-20260924-r1` 的長串流缺假 CLI 測試旗標而回 500。`reload03-allroutes-20260924-r4` 在跑時來源檔有變更，清理身分檢查判紅；`r5`～`r7` 是其後版本，定稿以 LF 最終來源的 `r8` 為準。`guard03-20260924-r1` 與搜尋／FinMind 先前 run 的程式換行位元組不同於最後提交，只保留歷史。以上舊 run 不作最終來源 PASS，保留查錯歷史。

執行時的 runtime、fixture 與日誌在 `%LOCALAPPDATA%\Temp\perf-opt-20260923\`；未提交任何 `.env` 複本。正式部署、真行情與真 AI 均不屬於上述固定資料證據。

2026-09-25 第二輪另有四次 App 冒煙（`app03-smoke-*`，4741～4748 埠）與三次生命週期冒煙（`life03-smoke-*`，4761～4766 埠；第三次是修正啟動器後的 8/8），用來除錯工具，證據只留在 runtime、不作正式判定；第一次生命週期冒煙同樣留下一個孤兒內部 Vite，已與 r1 的一併清除。
