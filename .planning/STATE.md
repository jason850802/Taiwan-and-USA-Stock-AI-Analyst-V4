---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: complete
stopped_at: Phase 4 merged to main (684453d) — milestone complete
last_updated: "2026-07-10T00:55:00+08:00"
last_activity: 2026-07-10 - Completed quick task 260710-w7y: 修正上櫃股 .TW/.TWO 後綴剝除 bug（真環境部署驗收發現）
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 7
  completed_plans: 7
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-01)

**Core value:** 讓使用者對任一檔台股/美股得到「客觀進場判斷 ＋ AI 中文解讀」的可信分析，而其依賴的金鑰與資料來源必須安全、穩定、不被盜用或竄改。
**Current focus:** 里程碑完成 — 後端 Serverless 代理層 4 個 phase 全數合併 main

## Current Position

Phase: 4 of 4 (防濫用強化 ＋ 部署驗收) — Complete
Plan: 4 of 4 complete
Status: Milestone complete（所有 phase 已合併 main）
Last activity: 2026-07-09 — Phase 4 由 Codex 執行、Opus 覆核（獨立重跑 build 驗證 A2 密鑰注入與 AIza=0）、合併 main（684453d）

Progress: [██████████] 100%

**里程碑收尾待辦（使用者手動，非 phase 範圍）：**
- 部署到 Vercel 並跑真環境驗收（需設 PROXY_SHARED_SECRET/UPSTASH_*/回填 ALLOWED_ORIGIN；無密鑰 curl→403、超限→429、CORS 無 `*`、6488/2330 籌碼正常）——詳 docs/DEPLOYMENT.md
- 作廢舊 Gemini 金鑰（Phase 1 前曾進 bundle）
- 文件債：Phase 2/3 缺 SUMMARY/VERIFICATION 收尾文件（功能無影響）

## Performance Metrics

**Velocity:**

- Total plans completed: 1
- Average duration: 126 min
- Total execution time: 2.1 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 1 | 1 | 126 min | 126 min |

**Recent Trend:**

- Last 5 plans: 126 min
- Trend: Baseline established

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [里程碑]: 聚焦「安全性：後端代理」——金鑰外洩是 CONCERNS 中唯一 CRITICAL、會直接造成金錢損失
- [里程碑]: 後端採 Vercel Serverless 函式（非自管伺服器），與 Vite 靜態站整合最順、免費層足夠
- [Phase 1]: Gemini 優先——唯一 CRITICAL 金錢風險、最小端到端切片，先驗通整條鏈路在 Vercel 上可行
- [架構]: 後端只做啞代理（Yahoo/FinMind 回原始 JSON），指標計算/normalize/prompt 全留前端，維持 `StockDataPoint[]` 契約零變動
- [Phase 1]: Gemini proxy 使用 AbortController 100 秒逾時，Vercel function `maxDuration=120`
- [Phase 1]: Handler 使用本地最小 request/response 型別，不依賴 `@vercel/node`
- [Phase 1]: 本地開發採 Vite 3000 + Vercel 3001，前端 `/api` 由 Vite proxy 轉發

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

- [ui] Add TW stock fundamentals tab（`2026-07-08-add-tw-stock-fundamentals-tab.md`）——
  台股個股月營收/EPS/財報整合進 App；資料層（tw-fundamentals skill）與設計文件已就緒，未排入 phase

- [api] Fix invalid FinMind OTC dataset names（`2026-07-09-fix-invalid-finmind-otc-dataset-names.md`）——
  `TaiwanOTCStockInstitutionalInvestorsBuySell`/`TaiwanOTCStockInfo` 非真實 dataset，上櫃股籌碼
  一直靜默失敗；Phase 3 誠實化功能正確揭露（顯示不可用而非假0），根因未修，改用統一 dataset 即可

### Blockers/Concerns

[Issues that affect future work]

- [Phase 2 研究旗標]: Yahoo 非官方端點的 cookie/crumb 握手行為可能隨時間改變；實作後須在 Vercel 環境（非本機）實測 ≥30 分鐘驗證，不能只靠本機。
- [Phase 1 待測量]: Gemini thinking/pro 模式實際延遲未知；需以真實技術分析提示測量，確認 `maxDuration=120` 是否足夠。
- [Phase 1 後續確認]: Codex 環境未直接保留 `vercel dev` 啟動輸出；部署前仍應依已核可的 Vite 3000 + Vercel 3001 流程再確認一次。

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260602-0u1 | 修正 services/yahoo.ts 最新一根日線 K 棒 close 為 null 時改用 regularMarketPrice 補上，使儀表板最新日期與盤中即時價正確更新 | 2026-06-01 | 31292c6 | [260602-0u1-services-yahoo-ts-k-close-null-regularma](./quick/260602-0u1-services-yahoo-ts-k-close-null-regularma/) |
| 260602-13g | 台股最新一根日線 close 為 null 時優先用 FinMind 真實 OHLC 補出 K 棒，FinMind 無資料才退回 regularMarketPrice 平盤補值 | 2026-06-01 | 73467de | [260602-13g-close-null-finmind-ohlc-k-finmind-regula](./quick/260602-13g-close-null-finmind-ohlc-k-finmind-regula/) |
| 260612-pdz | 修復程式碼審查 7 項 bug：volume.ts 時區日期、健檢決策 regex、盤中攻擊量改用預估全日量、錯誤訊息變數名、yahoo.ts 指標 nullish、切週期/更新報價用已解析 symbol、移除死碼 import | 2026-06-12 | 3251169 | [260612-pdz-fix-code-review-bugs-timezone-date-bug-h](./quick/260612-pdz-fix-code-review-bugs-timezone-date-bug-h/) |
| 260612-w4i | 用 50 檔大型權值股 60 日 5 分 K 實證校準台股盤中累積量權重曲線（2505 stock-days 中位數），getTaiwanVolumeWeight 改查表內插，Insufficient 窗口依實證誤差設 T*=105 分（美股不變） | 2026-06-12 | 4d61572 | [260612-w4i-calibrate-tw-intraday-volume-weight-curv](./quick/260612-w4i-calibrate-tw-intraday-volume-weight-curv/) |
| 260612-wyt | 用 50 檔 S&P 大型股 60 日 5 分 K 實證校準美股盤中累積量權重曲線（2800 stock-days 中位數），getUSVolumeWeight 改查表內插，美股 Insufficient 窗口設 T*=85 分；發現並繞過 Yahoo 美股 1d 量與 5m 加總不一致（改用 5m 自和，15:55 根已含收盤競價） | 2026-06-12 | 19df323 | [260612-wyt-calibrate-us-intraday-volume-weight-curv](./quick/260612-wyt-calibrate-us-intraday-volume-weight-curv/) |
| 260613-3ab | StockChart 效能重構：主圖/副圖抽成 React.memo、收盤價游標線改用 recharts 3.x 公開 hooks（useActiveTooltipDataPoints 等）在圖內訂閱，滑鼠查價時三圖零重繪（瀏覽器實測 80 次掃動 0 長任務）；修正十字線偏右（量能 Bar 移到獨立隱藏 XAxis，去除 barGap=-100%，實測偏移 0.03px） | 2026-06-13 | 03e4e21 | [260613-3ab-stockchart-performance-refactor-memoize-](./quick/260613-3ab-stockchart-performance-refactor-memoize-/) |
| 260613-if7 | StockChart 兩項互動：新增 rightOffset 狀態實作按住左鍵拖曳平移歷史股價（拖曳時抑制十字線、放開恢復、鉗位最新/最舊、切股票切週期歸位）；單根 K 棒浮動框改為頂端固定 OHLC/量資訊列（Tooltip content 設 null 保留十字線與游標價格線）。瀏覽器實測：拖曳方向正確、鉗位 OK、info bar 隨 hover 更新、浮動框已消除 | 2026-06-13 | 9e75132 | [260613-if7-stockchart-drag-to-pan-history-scrolling](./quick/260613-if7-stockchart-drag-to-pan-history-scrolling/) |
| 260613-ixg | 修正拖曳平移嚴重 lag：拖曳期間以 frozenSubDataRef 快照凍結兩張副圖（引用穩定→React.memo 跳過，放開才補正確視窗），主圖視窗粗化每 PAN_STEP=max(1,round(barsToShow/50)) 根才跳一步，單步成本由三圖重繪降為一圖且次數變少。build 通過；瀏覽器實測因 preview sandbox 的 Tailwind CDN 未載入（容器 0 寬）受阻，邏輯經 memo 正確性分析確認 | 2026-06-13 | 6e1ced1 | [260613-ixg-reduce-stockchart-pan-lag-freeze-sub-pan](./quick/260613-ixg-reduce-stockchart-pan-lag-freeze-sub-pan/) |
| 260629-ag1 | 新增專案 AGENTS.md（Codex 進入指引），採單一事實來源做法指向既有 CLAUDE.md（不複製），讓 Claude 與 Codex 在本專案層級同步；摘要安全紅線（GEMINI_API_KEY 不進前端/ git）、型別相容、程式風格與 GSD 流程。註：本機環境無 node，GSD 工具鏈無法自動執行，改以手動複刻結構＋git 原子提交完成 | 2026-06-29 | ac56a24 | [260629-ag1-add-agents-md-codex-sync](./quick/260629-ag1-add-agents-md-codex-sync/) |
| 260710-17a | 修正 api/ 後端 serverless function 在 Vercel production 部署時的 ERR_MODULE_NOT_FOUND 崩潰：package.json 設 "type":"module" 導致 Node 原生 ESM 執行 api/**/*.ts，但 tsconfig moduleResolution:"bundler" 允許的無副檔名相對匯入在原生 ESM 下不合法；為 6 個檔案（guard/http/finmind/gemini/yahoo-chart/yahoo-search）共 16 處相對匯入補上 .js 副檔名。今日首次真環境部署驗收時用 curl 對 production 實測發現（四個端點全 500 FUNCTION_INVOCATION_FAILED），非 Phase 4 引入、是 Phase 1 就存在的結構性 bug | 2026-07-10 | c977082 | [260710-17a-api-serverless-function-vercel-productio](./quick/260710-17a-api-serverless-function-vercel-productio/) |
| 260710-w7y | 修正前端 7 處 `.replace('.TW','').replace('.TWO','')` 後綴剝除 bug：對上櫃股 6488.TWO 會先吃掉 .TWO 內的 .TW 留下孤兒 O 變成 6488O，導致上櫃股 FinMind 中文名/籌碼/價量/K線fallback 全查無失效；改用 `.replace(/\.TWO?$/i,'')` 錨定字尾正確剝除（上市股不受影響）。真環境部署驗收搜尋上櫃股時發現 | 2026-07-10 | c8997fd | [260710-w7y-tw-two-bug](./quick/260710-w7y-tw-two-bug/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-09T12:28:50.653Z
Stopped at: Phase 4 context gathered
Resume file: .planning/phases/04-hardening/04-CONTEXT.md
