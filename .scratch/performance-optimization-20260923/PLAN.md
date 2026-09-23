# 第二輪：降低實際等待時間的效能優化 PLAN

建立：2026-09-23。狀態：**規劃完成，等待採用；尚未實作或重新量測。**

起點：`E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4`，分支 `codex/reacceptance-fixes-p1-s1`，核對 HEAD `30dfdb2`。產品基線含 `e9fa1a2`、`2bd91f4`、`6eee87e`，全部保留。

## 1. 這次要完成的結果

讓日常本機入口的十檔庫存與 K 線，冷載入也有可感知的速度改善；使用者不必靠測試專用頁面、快取命中或提高併發取得好數字。每張實作票都必須降低已量出的等待來源，或明確證明該分支不適用。測試通過、文件完成與速度達標分開判定。

先讀 [現況稽核](STATUS-AUDIT.md)。上輪完成的名稱解耦已把台股價格 body→可見由 2382.9 ms 降到 1.9 ms，但單支報價 HTTP 仍約 4.1 秒；十檔＋FX 的 11 支請求在三槽內分約四波完成。主要工作應移向本機入口與上游請求鏈。

本次使用者要求的是計畫。本文及票據不是已完成的修復；採用後由 GPT6 SOL 或 Claude Code OPUS5.5 依同一組規格逐票執行，不依模型名稱放寬驗收。

## 2. 採用的技術路線

**分段量測 → 同 handler 長駐本機原型 → 日常入口整合 → 單次報價成本 → K 線必要路徑 → 正式 App 保護 → 有界真行情 → 最終交接。**

首選候選是保留正式 API handler／guard 的長駐本機執行方式。原型必須先證明兩件事：降低每次 invocation 的固定成本，以及使既有 Yahoo cookie／crumb 的 pending／10 分鐘世代快取真正跨本機請求重用。這兩種收益要各自量測；尚未量得之前不稱已確定的效能根因。

Yahoo 正常冷握手是 cookie、crumb、chart 三次 outbound；本機程序若每請求重建，11 支 Yahoo API 可能各做一次握手。長駐後若既有快取可安全重用，同窗預期由約 33 支降為 13 支 Yahoo outbound（共享握手 2 支＋chart 11 支）。這是可否證預測，不是本輪已量得的結果；401／429、取消與世代變更必須另驗。

採用前不得直接替換預設入口。先建立可停止、可對照的原型；只有 API 契約、共享狀態、更新與故障隔離都通過，才讓日常開發入口使用它。Vercel 正式部署入口保留。使用現有依賴與 Node 能力，不新增套件、不改 package／lock；先核對既有工具能否安全載入正式 TypeScript handler，不把轉譯及路由語意留給臨場猜測。

## 3. 前瞻目標與基線

以下是本計畫提出的工程目標，**在採用後的第一票、看候選結果前凍結**；不是 SLA 或保證。若上游條件使目標不可達，需給分段數據與不可控下限，保持未達標，不降低目標湊綠。

| 項目 | 新目標 | 判定 |
|---|---|---|
| 空 OPTIONS 本機成本 | 每路由 warm 中位數 ≤150 ms、每筆 ≤500 ms，全部 204 | 每入口兩次獨立啟動，各 route cold 1＋交錯 warm 10 對；不報 p95 |
| 固定上游 GET | 扣除明示 fixture 等待後，本機入口＋handler 成本中位 ≤200 ms，且比目前入口下降 ≥80% | 同來源、同 payload、同固定回應，至少五輪；扣除只用同一時鐘的實際等待區間 |
| 十檔冷庫存 | 首價中位 ≤2.5 秒、全部有效價格＋FX ≤10 秒，且相對同期目前入口各改善 ≥40% | 正式 App 可見庫存面板，三組交錯 B1／C；成功率不下降，HTTP peak≤3；全量包含每檔有效價與有效 FX |
| K 線冷載入 | 第一批有效 K 線可見中位 ≤3 秒、完整必要資料 ≤3.5 秒，且兩者相對同期目前入口改善 ≥30% | 正式 App 可見圖表，十檔三組配對、台／美分列；hook 時間僅供診斷 |
| 暖回訪 | 沿用窗內不增加非預期 chart 請求，切股／切週期仍正確 | 固定十檔及真 App 可見面板；名稱／搜尋分開計數 |
| 正確性 | 最終固定輸出與基線相同，所有既有測試不改期望且通過 | OHLC、成交量、日期、指標、FX、P1／S1、本體五鍵與取消契約皆是硬門檻 |

基線定義：

- **B1（主要比較）**：本輪開始時含 `30dfdb2` 產品內容、從實際主工作區用日常命令啟動的 Vercel 入口。若為隔離而改用副本，必須先證明等價。歷史 formal E2 是以 placeholder 重建非產品樹的隔離環境，其約 1.8 秒只作選路參考，不是本輪 B1 成績。新方案要證明比「使用者現在拿到的版本」快。
- **C（候選）**：相同產品資料契約，加上本輪選定修復；服務來源與工具身分逐輪綁定。
- **B0（舊目標重驗專用）**：`444d6b1` 的原產品路徑，加上該提交已有的 E2 排除設定與 Vercel 日常入口，僅在最終有界驗收重建 fresh 同期配對；B0 不是拿掉排除設定的 E0。前端與後端各核對當時來源，不把候選 code 偷渡進 B0。
- **歷史 v5**：只供規劃、工具重播與趨勢，不直接參與新 PASS。原首價／全價雙 40% 若要關舊 05，必須用 fresh B0↔C 沿用原正式 hook 的量測口徑驗，不拿 App 的 B1↔C 替代。兩項試驗分開記錄與計入預算。
- **E0**：原 full root 啟動逾時另列「可用性／無法量化」。保留原失敗；新計畫不依賴成功 E0 才能優化 B1。不得延長 90 秒、補排除失敗列或反覆啟動以湊舊 50%。

第一票可修正量測定義中的矛盾，但不能在看候選成績後降低上述目標。相對與絕對門檻均列，避免只接近一個同樣慢的 clean。

## 4. 工作票與依賴

| 順序／票 | 核心交付 | 前置／分支 |
|---|---|---|
| [01 固定基線與等待分解](issues/01-baseline-and-critical-path.md) | 一張可對帳的等待圖、最小可判紅命令、明確選路 | 唯一可先做票；不再重建大型驗收框架 |
| [02 驗證長駐本機 API 原型](issues/02-persistent-api-prototype.md) | 同 handler 的低成本執行證據，完整契約差異表 | 01 證實本機固定成本顯著時做；若不顯著，寫證據結案不實作 |
| [03 接入可維護的日常入口](issues/03-daily-dev-entry.md) | 開／停／重載／錯誤可控，正式 App 接入同一候選 | 02 原型及 parity 通過才採用；否則保留原入口，清楚記失敗原因 |
| [04 降低單次報價與重複上游工作](issues/04-quote-request-cost.md) | 真正減少 quote／FX 的 TTFB 或重複 outbound | 03 選路結論；維持三槽，先測已有握手重用效果再改碼 |
| [05 縮短 K 線安全可控路徑](issues/05-chart-critical-path.md) | 名稱／上游／資料處理／繪圖各段有數字，修改可證實的阻塞 | 04；與報價共用模組，序列實作避免互改 |
| [06 正式 App 與本體保護驗收](issues/06-app-and-storage-acceptance.md) | 桌面／窄版完整使用者路徑、每操作五鍵 raw 與預期差異 | 05；先用固定資料完成正確性再打真上游 |
| [07 有界真行情與目標裁定](issues/07-real-market-acceptance.md) | fresh B0／B1／C、小樣本原值與明確 PASS／FAIL | 06；不與其他負載測試同時跑 |
| [08 最終覆核、舊票對帳與交接](issues/08-final-review-and-handoff.md) | 每個效能目標的裁定、完整 gate、日常命令、清理及精確提交 | 07；未達目標不得標全案完成 |

預設每次執行一票，完成固定交接後停止。允許同票的只讀探索與獨立覆核平行；會修改共用檔案的實作不平行。遇上游／權限阻斷可以繼續不依賴它的固定測試，不為了關票跳過未完成 gate。

**票據生命週期與效能判定分開。** 原型／選路／驗收票完成預定實驗並得出可核對的否證或 FAIL，可以把該項工作標 resolved，但同列必須寫「分支否證」或「效能未過」。實作缺功能或缺證據仍不能 resolved。全案 spec 只看第 3 節數值目標與正確性是否全部通過，不能由八張工作票結束推論全案達標；08 也必須能交付不達標的完整報告。

## 5. 避免再次只做驗收工具

- 沿用原案的 raw schema、固定探針與比較器；新增的計時只填補「handler 入口之前」及「server→provider」缺口。每個欄位必須回答一個瓶頸假設。
- 第一票限一個完整執行 session：完成來源核對、固定資料分段、B1 一輪有界現況後必須產出選路決定。工具若仍不能回答主要時間落點，回報具體缺口，不新增多代 v1～vN 全矩陣。
- E0 不就緒保留為獨立問題；已有相同失敗兩次以上，不再原樣重跑。只有發現具體啟動層錯誤並改正了量測方法，才開新 run 驗證該錯誤，不能把它列成每票必跑前置。
- 每個候選先跑固定上游／契約，再選一個做真行情。連續兩次同一修法沒有降低目標段，停止該分支並回到時間分解。
- 名稱優先序、增加快取、memo 圖表、升級工具鏈、增加 worker，均不得只靠直覺進入實作。本輪 v5 顯示 quote body→visible 已很小，應先消除秒級 TTFB。

## 6. 重要契約與禁止項

遵守 [規格](spec.md) 與 [共同驗收](acceptance.md)。既有金融／匯率／費率／損益、OHLC、成交量、交易日、快取沿用窗、force、P1／S1、守門序及三槽皆保留。FinMind PV 失敗沿用已核准的降級顯示＋10 分鐘短快取；不要依舊 REPORT 前半段恢復成拒絕發布。

本機長駐不代表放寬守門：重用現有 route handler、CORS、來源檢查、secret、限流、SSE、timeout、錯誤狀態及取消語意。不得以開放 origin、跳過 Redis／rate limit、硬回 204、fake chart 或共用跨請求 response 取得好數字。外部真 AI 禁止，AI route 只用假 provider 驗契約。

本輪不改 queue 預設 3、peak=3 測試，不改 package／lock／Vitest 範圍，不升級依賴，不換 provider，不新增批次 API 來藏內部併發。若三槽與現有上游下確實無法達目標，先交每段成本、理論及實測下限；調併發／新增 readiness／金融語意須另有明確決策。

## 7. 工作區與執行環境

- 先核目前 HEAD、index、tracked／untracked、skip-worktree、既有工作樹與服務。不能只讀 git status 就認為沒有變更；目前大量 skip-worktree 及實體缺檔。
- 不清全域 skip-worktree、不全樹 restore、不 `git add .`／`reset --hard`／`git clean`。遇缺檔先 `git show HEAD:<path>` 唯讀讀取；完整驗證用隔離 checkout。
- `C:\pfv7` 在前輪仍指向 `6eee87e`；下一輪 gate 必須同步本輪候選／票 commit 及未提交變更並驗來源 manifest，不能拿舊 checkout 的綠燈驗新產品。
- `C:\pfv7\node_modules` 是 junction，保留。若需移除工作樹，先核對 link 與 target，先以 `rmdir` 僅拆 junction，再處理經核對的工作樹；本計畫不要求刪工作樹。
- runtime 及 logs 放 watcher 外；不要將完整主工作區連同 `.scratch/runtime` 再複製進自己。禁止提交 runtime。
- 主 `.env` 只由後端讀取；前輪 runtime 的 14 份 `.env` 已刪除。新工具優先用程序環境傳遞；若必須複本，僅限本案受控目錄，正常／失敗停止均逐檔刪 `.env`，不刪目錄及 log；禁止記秘密值及其雜湊。
- 不碰 `.scratch/reacceptance-fixes/HANDOFF.md`、真帳本、真本體五鍵、Skills 鏡像、`.planning/`。所有文件／註解／提交繁體中文。

## 8. 舊 OPEN 如何處理

新計畫的來源與目標獨立記錄，不能直接把舊票打勾。舊 01～03 保留「E0 暖基準無法取得，原 50% 未證實」；這個歷史限制不再阻斷新的 B1→C 實作。若未來要以取代／終止方式整理舊票，必須明列舊條件未通過，不能寫 resolved／效能 PASS。

舊 05 只有 fresh B0↔C 的原雙 40% 與正確性都過才可 resolved。新十檔目標另以 B1↔C 判，兩者都報。舊 06 已完成的 correctness 不重做；新的 K 線速度目標在新票判。舊 07 的五鍵缺口由新 06 補，原前置門檻未滿仍保留未完成，不能用新報告偷改舊判定。

## 9. 交付與接手

執行者從 [可直接貼上的提示詞](EXECUTION-PROMPTS.md) 開始。每票交付：實際改變、受影響等待段、固定／真行情 before→after、正確性、gate／雙軸覆核、來源及 raw 路徑、單票 commit、啟停及回復方式、仍 OPEN 的原因。

最後必須有使用者可直接使用的日常啟動／停止命令與可見 App 成績；只有原型或探針變快不算產品完成。不得 push、部署或發版。

## 10. 探索入口（依目前來源核對，不視為固定行號）

- 舊案：`../performance-fix-20260922/RESULTS.md`、`HANDOFF-20260923.md`、`evidence/05/true-market-paired-20260923-v5/`、`evidence/07/true-market-07-20260923-v4/`。
- 本機環境：根 `.vercelignore`、`vite.config.ts`；`../performance-diagnosis-20260922/backend-review.md`；本機安裝的 Vercel Node dev invocation 原始碼及版本。
- 正式路由：`api/yahoo/chart.ts`、`api/yahoo/search.ts`、`api/finmind.ts`、`api/gemini.ts`、`api/gemini-stream.ts`、`api/_lib/guard.ts`、`api/_lib/yahoo.ts`、`api/_lib/ratelimit.ts`。
- 前端路徑：`components/portfolio/useHoldingPrices.ts`、`holdingPriceQueue.ts`、`services/yahoo.ts`、`services/stockDirectory.ts`、`services/quoteCache.ts`、`App.tsx`、K 線圖表與相關 hooks。

上述名稱是探索提示；票據以行為描述為準。沒有實測支持的架構分支保持條件式，不為了把計畫全部打勾而實作。
