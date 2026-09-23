# 第二輪效能優化交接

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
