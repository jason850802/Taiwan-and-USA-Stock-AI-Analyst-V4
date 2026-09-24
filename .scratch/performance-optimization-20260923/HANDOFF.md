# 第二輪效能優化交接

> 2026-09-24 覆核後更新：下方 03 區塊是首輪快照，其 `resolved`、最終來源與下一票 04 的說法已撤回。現況以 [PLAN](PLAN.md)、[03 票面](issues/03-daily-dev-entry.md) 與 [03 覆核後增補](evidence/03/ADDENDUM-20260924.md) 為準；03 維持 OPEN。

## 01 — 固定目前基線並拆出主要等待（2026-09-23，Claude Code Opus 5.5）

**實際瓶頸**：本機 `vercel dev` 每支 API 請求都 fork 一個新子程序，子程序先花約 1.7～2.1 秒載入 dev-server 模組圖、再載入 handler；而且因為程序每次都是新的，Yahoo cookie＋crumb 握手（約 1.5 秒）每支報價都重做。真上游單支報價 TTFB 中位 4045.7 ms，其中派送 2224.5 ms、握手 1511.9 ms、Yahoo chart 本身只有 292.3 ms。
**下一個行動**：執行 02——在不改契約的前提下，讓同一套正式 handler 在長駐本機程序內處理請求，分開量「派送消失」與「握手共用」兩個收益。

| 欄位 | 內容 |
|---|---|
| 本票／狀態／來源與最終 commit | 01／resolved（分支結果＝驗證長駐；效能結果＝B1 判紅，全案 OPEN）。計畫保存 `4ca3c3c`；本票工作在其後的單一提交（訊息開頭 `perf(01)`）。產品＝`30dfdb2`＝`6eee87e` 產品內容，未改 |
| 這次真正改變的等待來源、採用與未採用分支 | 本票只量測，**沒有改變任何產品等待**。採用分支：驗證同 handler 長駐原型（派送 1836.1 ms、占 45.4%；握手 1511.9 ms、占 37.4%，13/13 未共享）。未採用：跳過長駐、直接轉上游或前端段（驗收協定 3.5 的兩個條件都不成立） |
| 使用者可感知的 before→after | 沒有 after。before（B1，本輪執行，API 層一批）：十檔＋FX 首價 4096.6 ms、全價 16221.1 ms，13/13 成功；上一輪 v5 App 可見全價 16637.7 ms（證據核對）。App 可見的 B1 正式成績留給 07 |
| 各段時間與 browser／provider 請求數、重試、peak、快取 | 見 [REPORT](evidence/01/REPORT.md) 第 5、6 節。真上游 browser API 14、outbound 40（cookie 13／crumb 13／chart 13／FinMind 1），重試 0、上游錯誤 0，peak 3；Node client 無 HTTP 快取，每支請求都是新子程序（13 個實例） |
| 正確性、FX、沿用窗、取消／世代、P1／S1、本體五鍵 | 產品碼、金融語意、三槽、peak=3、快取沿用窗、package／lock、測試收錄全部未動。本票沒有操作 App，未碰真帳本、本體五鍵與真 AI；使用者的 3000／3001 服務未碰 |
| 固定測試、真行情、正式 App、完整 gate、雙軸覆核 | 工具自測 46/46；固定上游 r3 有效並判紅 exit 1；真行情 real-r2 有效 exit 0；正式 App 未量（不在本票範圍）；Standards＋Spec 由兩個未參與實作的子代理覆核，處置見票面 Comments；完整 gate 在本檔定稿後於隔離 checkout 執行，結果記在本票提交訊息 |
| 證據入口、日常啟停／重跑命令、回復方式 | 證據：[evidence/01/README.md](evidence/01/README.md)（正式＝`b1-fixed-20260923-r3`、`b1-real-20260923-r2`）。重跑與判紅命令見 REPORT 第 8 節；runtime／log 在 `%LOCALAPPDATA%\Temp\perf-opt-20260923\<run-id>\`（不提交）。日常入口沒有變更（仍是 `npx vercel dev --listen 3001` 加 `npm run dev`）。回復：本票只新增／修改 `.scratch/performance-optimization-20260923/` 下的檔案，`git revert` 該提交即可，不影響產品 |
| 仍 OPEN 的具體原因、不可控下限與已嘗試措施 | PLAN 第 3 節全部目標 OPEN：B1 的 OPTIONS warm 中位約 1.83 秒（目標 ≤150 ms）、固定 GET 本機成本 1836.1 ms（目標 ≤200 ms），尚無候選。不可控下限（真上游單次延遲）：chart 292.3、cookie 636.9、crumb 874.8 ms。E0 仍不可量（未重跑）；舊 v5 FAIL 與舊 01～03 OPEN 保留 |
| 下一票名稱、前置是否滿足、下一個可直接執行動作 | 02 驗證同 handler 長駐本機原型；前置 01 已滿足。見下方「給 02 的具體起點」 |

### 給 02 的具體起點

1. **TypeScript 載入方式先定**（PLAN：不新增套件、先核對既有工具）。本地可用的既有相依：`vite` 6.4.1（有 SSR 模組載入）、`vite-node` 3.2.4（隨 vitest）、`esbuild` 0.25.12；專案 **沒有** `tsx`（tsx 4.21.0 只在全域 Vercel CLI 內）。Node 26 原生型別剝除不會把 handler 裡的 `./_lib/guard.js` 對到 `.ts`，要另外驗。
2. **介面卡**：正式 handler 期望 `@vercel/node` dev-server 加上的 helpers（`req.query`、`res.status().json()` 等，見全域 CLI 的 `@vercel/node/dist/dev-server.mjs` 的 `addHelpers`）。原型必須逐項對等，並用固定請求對目前入口做 differential。
3. **重用本票工具**：`b1-breakdown.mjs` 目前只會起 B1。02 需要加 C 模式（起原型服務、綁定來源），並沿用同一套 OPTIONS／固定 GET 協定與判定器，才能直接和本票 B1 的 1836.1 ms 比。探針的 parent／child 角色是針對 vercel dev 的程序結構設計的；長駐原型是單一程序，要新增角色，並確認 cookie／crumb 只在第一次出現。
4. **固定 GET 量法沿用**：直連、探針下、扣固定等待（REPORT §2 第 4 點）；另報經 Vite 與探針開銷。
5. 小工具欠帳：real 模式 `runner-result.json` 的 `meaning` 措辭（exit 0 在 real 模式只代表有效）。

## 02 — 驗證同 handler 的長駐本機 API 原型（2026-09-24，Claude Code Opus 5.5）

**實際瓶頸**：01 找到的兩個「每支請求都重做」的成本，原型都能移出暖請求的路徑——本機派送（每請求 fork＋載入模組圖）從約 1.9 秒降到約 0.02 秒，Yahoo 握手從每支報價一次變成每個子程序每 10 分鐘一次；59 個契約案例中 58 個與 B1 完全等價、1 個是長駐造成的已知差異（限流封鎖沿用）。**但日常入口還沒換，使用者現在的等待沒有改變**；剩下的冷成本是每條路由第一支請求約 2 秒啟動、報價路由第一次握手約 1.5 秒。另外取消契約兩個入口都 FAIL：`@vercel/node` dev-server 轉給 handler 時沒帶 abort signal，用戶端斷線傳不到 provider。
**下一個行動**：執行 03——先讓日常入口的取消能傳到 provider（採用的前提），再把候選接成只作用在 vercel dev 程序的可維護日常入口（開／停／重載／錯誤可控、版本鎖退路、Vite 代理接通），最後用正式 App 量十檔與 K 線的使用者可見時間。

| 欄位 | 內容 |
|---|---|
| 本票／狀態／來源與最終 commit | 02／resolved（分支結果＝長駐原型可行，作 03 候選；效能結果＝空 OPTIONS 與固定 GET 本機目標對候選 PASS，App 可見目標 OPEN）。本票工作在 `5b7a430` 之後的單一提交（訊息開頭 `perf(02)`）。產品＝`30dfdb2` 產品內容，未改 |
| 這次真正改變的等待來源、採用與未採用分支 | 候選 C 在暖請求上移除了「每請求 fork＋載入模組圖」的派送與「每支報價重做握手」；日常入口未換，所以使用者等待尚未改變。採用：經 vercel dev 的 builder 接縫讓同一 handler 子程序長駐（契約等價來自沿用原碼）。未採用：自寫長駐 API server（vite-node／esbuild／Node 型別剝除）——要另寫 adapter 才能對等，沒有必要；「不實作分支」條件不成立（01 已證） |
| 使用者可感知的 before→after（來源、樣本、成功／失敗、時間口徑） | 尚無使用者可感知的 after（日常入口沒換、未量 App）。API 層（本輪執行，同日同工具，真行情各 14 支 browser API、14/14 成功，client 單調時鐘）：單支報價 TTFB 中位 4240.4 → 309.5 ms（候選冷 1 支 3887.4）；十檔＋FX 三槽批次首價 4241.1 → 244.1、全價 16643.4 → 1243.5 ms（候選這批已暖，口徑為批次起點起算）。App 可見口徑留給 03 |
| 各段時間與 browser／provider 請求數、重試、peak、快取 | 見 [02 REPORT](evidence/02/REPORT.md) 第 3 節。固定上游：空 OPTIONS warm 中位 1863.1／1870.5 → 17.5／17.3 ms；本機成本 1886.8 → 20.6 ms；派送 2311.9 → 16.2 ms。真行情：派送 2288.3 → 15.5 ms（暖）；cookie→crumb 1462.0 ms ×13 → 1469.4 ms ×1；chart 280.1／281.1 ms。browser API 14／14；outbound 40／16；上游錯誤與重試 0；peak 3／3；Node client 無 HTTP 快取；服務報價的子程序實例 13 → 1 |
| 正確性、FX、沿用窗、取消／世代、P1／S1、本體五鍵 | 產品碼、金融語意、FX、三槽、快取沿用窗、package／lock 全未動。契約對等 58 案完全等價＋1 案已知差異（含 FX 代號 URL 編碼、併發不串台、401／429 重試上限、TTL、pending join、三支同時 401、遲到的 401）。取消契約：兩入口都 FAIL（用戶端斷線傳到 dev-server 代理層就停，handler 與 provider 照常跑完；既有缺陷，阻擋 03 採用）。P1／S1 未動；未操作 App，未碰真帳本、本體五鍵與真 AI；使用者的 3000／3001 服務未碰 |
| 固定測試、真行情、正式 App、完整 gate、雙軸覆核各自結果 | 自測 01 46/46、02 95/95；固定上游候選 exit 0（達標）、B1 exit 1（判紅，預期）；真行情 B1／候選皆 exit 0（有效）；對等 exit 0；重載 exit 0；正式 App 未量（不在本票範圍）；完整 gate 在隔離 checkout 執行，結果記在本票提交訊息；雙軸覆核兩輪，處置見票面 Comments |
| 證據入口、日常啟停／重跑命令、回復方式 | 證據：[evidence/02/README.md](evidence/02/README.md)。重跑命令見 REPORT 第 8 節；runtime／log 在 `%LOCALAPPDATA%\Temp\perf-opt-20260923\<run-id>\`（不提交）。日常入口沒有變更（仍是 `npx vercel dev --listen 3001` 加 `npm run dev`）；候選的日常啟停由 03 定義。回復：本票只新增／修改 `.scratch/performance-optimization-20260923/` 下的檔案，`git revert` 該提交即可 |
| 仍 OPEN 的具體原因、不可控下限與已嘗試措施 | PLAN 第 3 節的十檔冷庫存、K 線冷載入、暖回訪仍 OPEN：候選尚未成為日常入口，無法量正式 App。取消契約 FAIL（兩入口相同）：`@vercel/node` 5.8.23 `dev-server.mjs` 以 `undiciRequest(url, { body, headers, method })` 轉給 handler、沒帶 abort signal，trace 顯示斷線停在 devProxy 層。冷成本：每路由約 2 秒啟動、首次握手約 1.5 秒。不可控下限（真上游單次，候選本批）：chart 中位 281.1、cookie 613.3、crumb 855.5 ms。已做：長駐原型、停用時等在途請求、只認內容變更的失效。E0 仍不可量；舊 v5 FAIL 與舊 01～03 OPEN 保留 |
| 下一票名稱、前置是否滿足、下一個可直接執行動作 | 03 接入可維護的日常入口；前置（02 原型與 parity 通過）已滿足，但採用前必須先修好取消契約。下一個動作：在函式子程序補上「用戶端斷線 → 中止轉給 handler 的請求」，用對等比對的取消案例先轉紅再轉綠；接著寫只在 vercel dev 程序環境加 `--require` 的啟動器，並驗 Vite 代理 `http://localhost:3001` 能連到只綁 `127.0.0.1` 的服務。見下方「給 03 的具體起點」 |

### 給 03 的具體起點

1. **啟動器**：`NODE_OPTIONS` 只給 vercel dev 那一個程序（例如以小啟動器 spawn 全域 `vc.js dev` 並只在它的環境加 `--require <原型>`）；不要讓同一個 shell 的其他 node 程序都帶著它。啟停只作用於自己 spawn 的 PID（可沿用量測工具共用模組的 owned PID 核對）。
2. **連線**：Vite 代理目前是 `http://localhost:3001`；候選只綁 `127.0.0.1`。先驗 localhost 解析（IPv6 優先時）與 handler 看到的 `x-forwarded-for` 形狀。
3. **退路**：原型有版本鎖（vercel 55.0.0／@vercel/node 5.8.23），CLI 更新後會拒絕啟用；日常入口要能退回一般 vercel dev，並把原因顯示給使用者。
4. **冷成本**：可評估啟動後預熱各路由（例如對每條路由送一次空 OPTIONS），讓剛開機的第一批十檔不必等子程序啟動；握手只能在第一次真報價時做。
5. **正式 App 量測**：十檔冷庫存、K 線冷載入、暖回訪以正式 App 可見口徑、B1／C 交錯配對量；02 的 API 層數字只作方向。
6. **取消契約（採用前必修）**：spec 要求取消後不殘留本次工作，PLAN 列為硬門檻。兩入口目前都不會把斷線傳到 provider，真 CLI 會跑完才停；根因在 dev-server 轉給 handler 時沒帶 abort signal（02 REPORT §7 第 1 點）。原型只作用在父程序，修正要落在函式子程序那一側。

## 03 — 候選接入日常入口（2026-09-24，Codex）

**實際改變**：日常單一命令啟動 Vercel＋Vite，同 handler 長駐候選開始服務正式 App。函式子程序補上斷線橋接，正式假 AI 串流與 Yahoo chart 都能在用戶端取消後停掉本次工作；五條正式函式在回報 ready 前以 OPTIONS 預熱。沒有更動金融語意、三槽、package／lock、正式 Vercel 部署設定或真帳本。

| 欄位 | 結果 |
|---|---|
| 本票／分支／狀態 | 03／採用候選／resolved；全案 OPEN，下一票 04。提交見本票 `perf(03)` commit；沒有 push、部署或發版 |
| 固定資料 API | 最終來源 `daily03-cost-20260924-r5`，身分綁定的正式日常前端代理：暖 OPTIONS 20/20 為 204，中位 15.364 ms、最大 18.168；暖 GET 20/20 為 200，中位 61.766 ms、最大 81.295。與 02 直接 B1↔C 協定分開，不冒充 App 可見時間 |
| 取消與共享狀態 | 假 AI 首段後斷線：代理／handler 皆中止，假 CLI 第 1 段後 kill、無 done；Yahoo chart A 中止後 `AbortError`、並行 B 200。單人 cookie 握手取消會中止上游；兩人共用時 A 取消，B 成功 200。Yahoo search、FinMind 假上游及非串流假 CLI 取消亦通過；Gemini API 以假 SDK 驗 `abortSignal`。延遲限流中斷線五條路由均未再啟動行情或 AI 上游，LF 最終來源 `guard03-20260924-r2` 5/5 PASS |
| 正式 App 與環境 | 新來源下台股 `2330.TW`、美股 `AAPL`、K 線、隔離測試庫存及假 AI 五段報告均可見；外部偽造 Origin 403。測試使用固定上游與假 provider，沒有真行情／真 AI；庫存只存新測試來源，未碰真帳本 |
| 重載與啟停 | 最終十一檔來源隔離 `C:/pfv7` 十步重載矩陣 `reload03-allroutes-20260924-r8` 全綠，包含語法錯誤不回舊碼、環境變更、刪路由、串流中改碼；元件／CSS HMR 各有 update。相同 `4431/4432` 兩次啟停，最終 `4561/4562` 五路由預熱 204 並 stop；埠衝突不接管其他服務，控制管道失聯而舊 listener 仍在時拒絕另起服務 |
| gate 與覆核 | 最終隔離 gate `--require-env`：tsc 0 錯、Vitest 827/827、build 成功、金鑰掃描乾淨、package／lock 無差異；獨立 Standards／Spec 處置見 03 REVIEW |
| 證據及命令 | [03 索引](evidence/03/README.md)、[03 REPORT](evidence/03/REPORT.md)；日常 `node .scratch/performance-optimization-20260923/tools/daily-dev.mjs start`，`status`，`stop`。工具有版本鎖，失效時報錯並停候選，不自動服務舊碼 |
| 仍 OPEN 與下一步 | 正式 App 十檔冷庫存／K 線／暖回訪 B1↔C，以及 fresh B0↔C 舊 05 雙 40% 尚未量；正式部署未驗。04 先在現日常入口重測單次真報價與 FX 的握手、chart 與冷／暖成本，再只處理仍可控制的重複工作，維持三槽 |

03 的來源綁定：基準 `6a7b029`，最終十一個候選產品／測試實體檔在主工作樹與隔離 checkout 逐檔 SHA-256 相同，原始位元組與 Git index blob 亦逐檔一致；FinMind／Yahoo search 已依 `.gitattributes` 正規化為 LF。原始 run 各自記錄工具與來源雜湊。前端程序 env 改採必要系統變數及公開 `VITE_` 白名單，後端金鑰不進 Vite 程序。`C:/pfv7` 的 `node_modules` junction 保留，隔離測試建的 `.env`／`.vercel` 已刪。舊 02 取消 FAIL 是當時版本的有效歷史，03 新 run 才能判新入口已修復。
