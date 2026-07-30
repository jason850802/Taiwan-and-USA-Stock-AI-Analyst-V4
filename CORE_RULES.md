<!-- 本檔是索引：上限 150 行。長內容放引用檔，不要塞回來（規則見 agent-dual-core\MAINTENANCE.md）。 -->

# 專案共用規則（Claude Code ＋ Codex 單一事實來源）

> **動工前必讀。** `CLAUDE.md`（Claude Code 讀）與 `AGENTS.md`（Codex 讀）都只是薄指標，
> 規則內容一律以本檔為準——避免兩份不同步。工具專屬的差異（skills 目錄、呼叫方式）
> 寫在各自的入口檔，其餘全部在這裡。
>
> 全域基準：`agent-dual-core\CORE_RULES.md`（跨專案）；**衝突時以本檔為準**。

## Project

**Taiwan & USA Stock AI Analyst** — 給個人投資者的台股／美股技術分析工具（繁中介面）。
搜尋股票 → 抓行情、算技術指標 → 依朱家泓「六六大順」法則產出客觀 GO/WAIT/NO_GO →
Google Gemini 產生中文分析報告；另有可做 AI 健檢的庫存（Portfolio）功能。
前端 React SPA ＋ Vercel Serverless 後端（金鑰只在後端）。

**Core Value:** 對任一檔台股／美股給出「客觀進場判斷＋AI 中文解讀」的可信分析，
其金鑰與資料來源必須安全、穩定、不被盜用或竄改。

### Constraints（紅線，違反即停）

- **Security**：`GEMINI_API_KEY` 只能存在 Vercel 環境變數／後端，**絕不可出現在前端 bundle 或 git**。這是本專案存在的根本目的。
- **Compatibility**：資料服務層的領域型別（`StockDataPoint[]`、`StockInfo` 等）必須保持相容，避免動到圖表、濾網、提示詞與既有分析行為。
- **Tech stack**：後端採 Vercel Serverless 函式，與既有 Vite 靜態站整合。
- **Dependencies**：行情沿用 Yahoo Finance（非官方）與 FinMind 免費層，不換供應商；**禁裝新 npm 套件**（如需請先問使用者）。
- **Budget**：盡量落在 Vercel 免費層。

## 索引：需要時才讀（不要全部預讀）

| 要做的事 | 先讀 |
|---|---|
| 了解技術棧、依賴、設定 | `.planning/codebase/STACK.md` |
| 了解架構、資料流、分層 | `.planning/codebase/ARCHITECTURE.md` |
| 寫碼風格、命名、放哪裡 | `.planning/codebase/CONVENTIONS.md` |
| 已知問題與技術債 | `.planning/codebase/CONCERNS.md` |
| 外部整合（Yahoo/FinMind/Gemini） | `.planning/codebase/INTEGRATIONS.md` |
| 目前進度與下一步 | `.scratch/` 的未完成票據 ＋ `git log` |
| 查 Phase 1~12 的歷史決策 | `.planning/phases/`（**唯讀檔案庫**，新工作不寫入） |

## 制度檔（跨專案）

交辦／選模型、判斷完成或升級或該不該問、環境雷、交辦單範本、改制度與記教訓——
一律走總索引 `C:\Users\jason\Documents\Codex\agent-dual-core\INDEX.md`（含最小閱讀路徑）。

## 程式風格

2 空格縮排、單引號、**繁體中文註解**、camelCase／PascalCase 命名。
不要重排或重寫無關檔案；保留既有資料夾結構、命名與工具鏈。
所有產出（註解、commit message、文件、票據、spec）一律繁體中文，**禁用簡體字**。

## 本專案關鍵事實（易錯）

- 依賴單軌：只維護 `package.json`＋`package-lock.json`（index.html 的 esm.sh importmap 已移除，Vite 從 node_modules 解析）。
- 測試跑道＝vitest（`npm run test`）：核心 utils 有行為鎖案例；仍無 lint、tsconfig 非 strict。改被鎖的檔案前先跑 test。
- 資料鏈：Yahoo（公共 CORS proxy 輪替）→ 失敗 fallback FinMind；429 是常態，先懷疑限流再改碼。
- Gemini 型號**只在後端**：`api/_lib/config.ts` 的環境變數 fallback（`GEMINI_MODEL_FAST`=`gemini-3.5-flash`／`GEMINI_MODEL_THINKING`=`gemini-3.1-pro-preview`），另一份在 `.env.example`；**改型號（或改 `LLM_PROVIDER`）三處都要動**——前兩處，加上 `services/_shared/geminiCache.ts` 的 `ENGINE_TAG` bump 一格讓前端舊模型快取失效（前端拿不到型號，只能靠這個不含型號名的世代代號；`services/gemini.ts` 仍不含型號字串）。不 bump 的後果有上限：key 仍有日期段且跨日全清，最壞是當天繼續端出舊模型的結果。
- `services/gemini.ts` 的 5 個 system instruction 受 snapshot **逐位元組鎖定**（`utils/geminiRules.test.ts`）——改一個字就會讓 AI 分析快取全失效，動它前先讀 `.planning/phases/12-arch-deepening/12-CONTEXT.md` 的 D-06。

## 工作流：Matt Pocock skills（2026-07-26 起，GSD 已完全停用）

使用者只描述需求，**依下表路由，不要即興決定流程**：

| 任務型態 | 走法 |
|---|---|
| 小修（單檔／文案／無語意決策） | 直接做：TDD → 機械 gate → commit，不開票 |
| 新功能 | `grill-with-docs` 拍板邊界 → `to-spec` → `to-tickets`（落 `.scratch/<feature>/issues/`）→ 每票 `implement` |
| 碰錢的精密 refactor | `phase-loop` 的 PLAN 格式（雷區 diff 形狀／手算對數／review_checklist），覆核用 `code-review` |
| 大霧工程（跨 session） | `wayfinder` 決策票地圖 → 收斂後接 `to-spec` |
| 壞掉／沒反應／數字不對 | `diagnosing-bugs`（**先建紅燈迴圈才准提假設**） |

**主線 skills（grill→spec→tickets→implement）整條是 user-invoked，模型的 Skill 工具叫不到，
兩端皆同。** 啟動的兩條路、可自動呼叫的名單、派 Codex 執行的實務，見 `docs/skill-invocation.md`。

`implement` 收尾**必跑 `code-review`**（雙軸 Standards＋Spec）。**每個 merge commit 必帶
`Code-Review:` trailer**——implement 類寫兩軸處置（無發現也要寫「無發現」；有收就點名
收了什麼，內容要可對證、不是打卡）；純文件／規則類寫「免跑」。錨點放 merge 而非票 commit，
因為「先 commit 後 review」的流程在零發現時沒有票 commit 可蓋。稽核（應 0 筆）：
`git log --merges code-review-trailer-start..HEAD --invert-grep --grep="^Code-Review:"`
（tag＝制度起點，2026-07-28）。逐票第二訊號＝resolved 票面的 code-review checkbox 必須已勾。
中大型任務每張票建議開新對話（換窗紀律）。**碰錢的語意決策一律停下來問使用者，而且要問對**：
**攤開現值、依據、新值會改變什麼**，不可把使用者給的新值當正當預設、只問適用範圍
（2026-07-29 盲測教訓，詳 `docs/claude-handoff-findings.md`）。

**機械驗收 gate（專案紅線，與工作流無關，每次改碼都要）**：`npm run gate` 一鍵跑完機械五道——
tsc 0 錯 → vitest 全綠（**既有案例零修改**）→ build → 金鑰掃描（dist ＋ git 追蹤原始碼＋用 `.env`
值抓任何形狀的秘密；真金鑰非 `AIza` 前綴，手動 grep 掃不到）→ `package.json`／lock diff 0。
**runtime 類腳本管不到，仍人工**：console 零紅字、UI 量數字不靠肉眼、快取類換乾淨代號。
**既有測試紅燈＝語意變更的訊號，停下來問使用者；不是把期望值改綠。**
各道 gate 的紅燈能力與剩餘缺口：`docs/gate-audit-findings.md`（2026-07-26 逐道故障注入驗證）。

> GSD 已於 2026-07-26 完全停用（兩端 hooks 解除註冊、指令／agent 面移出專案，`gsd:` 指令與
> gsd-* subagent 不再載入）。備份含還原說明：`E:\My Project\_gsd-backup-2026-07-26\`。

## Project Skills

朱家泓進場分析 7 步驟：`trend-analysis` → `position-analysis` → `kline-signal` →
`ma-structure` → `volume-analysis` → `indicator-analysis` → `entry-decision`（總入口／最終結論）。
使用者說「分析 XXXX」「XXXX 能不能買」時從 `trend-analysis` 依序跑，或直接用 `entry-decision`
帶完整流程。**各步驟細節讀該 skill 的 SKILL.md，不要憑記憶重建規則。**

`tw-fundamentals`（台股基本面資料層）：用 FinMind 免 token 抓台股財報／估值／月營收／股利，
補上美股 skill（dcf-model／comps-analysis）從 SEC 自動取得、台股缺的那層。
抓取腳本 `.claude/skills/_shared/fetch_fundamentals.py`。

工作流 skills：`phase-loop`（碰錢的精密 refactor 用，7 輪實戰驗證；**Claude 端專用、不進鏡像**——
Codex 只收 PLAN 文件不自行規劃）；`start-dev`（起 dev 環境固定流程＋故障對照表，**兩端都有**）。

## Agent skills（Matt Pocock 流的設定）

- **Issue tracker**：local markdown — issues／spec 放 `.scratch/<feature>/`。見 `docs/agents/issue-tracker.md`。
- **Triage labels**：五個角色（`needs-triage`／`needs-info`／`ready-for-agent`／`ready-for-human`／`wontfix`），在本地 tracker 表現為 `Status:` 行。見 `docs/agents/triage-labels.md`。
- **Domain docs**：single-context — 根目錄 `CONTEXT.md` ＋ `docs/adr/`。見 `docs/agents/domain.md`。

## 雙工具運作（Claude Code ＋ Codex）

- **入口檔**：Claude 讀 `CLAUDE.md`、Codex 讀 `AGENTS.md`，兩者都只指向本檔。改規則改這裡，不要改入口檔。
- **Skills 鏡像與呼叫**：`.agents/skills/`（Codex 讀取端）由 `npm run sync:skills` 維護——
  兩個來源、白名單制、**不要手動改鏡像端**；機制、孤兒行為、兩端呼叫方式見 `docs/skill-invocation.md`。
- **交接紀律**：票據刻意**不寫檔案路徑與行號**（耐久原則，票可能躺數天）——
  接手方依行為描述自行探索現況程式碼。一票一個 commit。
