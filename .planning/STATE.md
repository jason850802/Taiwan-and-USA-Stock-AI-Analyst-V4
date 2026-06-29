---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: planning
stopped_at: Phase 1 context gathered
last_updated: "2026-06-01T16:26:32.445Z"
last_activity: 2026-06-29 — Completed quick task 260629-ag1：新增 AGENTS.md 指向 CLAUDE.md，讓 Codex 與 Claude 同步
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-01)

**Core value:** 讓使用者對任一檔台股/美股得到「客觀進場判斷 ＋ AI 中文解讀」的可信分析，而其依賴的金鑰與資料來源必須安全、穩定、不被盜用或竄改。
**Current focus:** Phase 1 — 後端骨架 ＋ Gemini 端點（金鑰封存）

## Current Position

Phase: 1 of 4 (後端骨架 ＋ Gemini 端點)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-06-01 — 路線圖建立，22 項 v1 需求全數對應到 4 個階段

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: - min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [里程碑]: 聚焦「安全性：後端代理」——金鑰外洩是 CONCERNS 中唯一 CRITICAL、會直接造成金錢損失
- [里程碑]: 後端採 Vercel Serverless 函式（非自管伺服器），與 Vite 靜態站整合最順、免費層足夠
- [Phase 1]: Gemini 優先——唯一 CRITICAL 金錢風險、最小端到端切片，先驗通整條鏈路在 Vercel 上可行
- [架構]: 後端只做啞代理（Yahoo/FinMind 回原始 JSON），指標計算/normalize/prompt 全留前端，維持 `StockDataPoint[]` 契約零變動

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- [Phase 2 研究旗標]: Yahoo 非官方端點的 cookie/crumb 握手行為可能隨時間改變；實作後須在 Vercel 環境（非本機）實測 ≥30 分鐘驗證，不能只靠本機。
- [Phase 1 待測量]: Gemini thinking/pro 模式實際延遲未知；需以真實技術分析提示測量，確認 `maxDuration=120` 是否足夠。
- [整合風險]: `vercel dev` 與 Vite 6 整合社群回報有坑；先試單進程，遇問題退回 server.proxy + vercel dev 雙進程。

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

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-06-01T16:26:32.414Z
Stopped at: Phase 1 context gathered
Resume file: .planning/phases/01-gemini/01-CONTEXT.md
