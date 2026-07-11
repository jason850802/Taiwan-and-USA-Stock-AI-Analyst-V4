<!-- 本檔是索引：上限 150 行。長內容放引用檔，不要塞回來（規則見 agent-dual-core\MAINTENANCE.md）。 -->
<!-- 舊版全文備份：.claude/backups/CLAUDE.md.20260703.bak -->

<!-- GSD:project-start source:PROJECT.md -->

## Project

**Taiwan & USA Stock AI Analyst** — 給個人投資者的台股／美股技術分析工具（繁中介面）。
搜尋股票 → 抓行情、算技術指標 → 依朱家泓「六六大順」法則產出客觀 GO/WAIT/NO_GO →
Google Gemini 產生中文分析報告；另有可做 AI 健檢的庫存（Portfolio）功能。
目前為純前端 React SPA（無後端，所有外部呼叫在瀏覽器端）。

**Core Value:** 對任一檔台股／美股給出「客觀進場判斷＋AI 中文解讀」的可信分析，
其金鑰與資料來源必須安全、穩定、不被盜用或竄改。

### Constraints（紅線，違反即停）

- **Security**: `GEMINI_API_KEY` 只能存在 Vercel 環境變數，絕不可出現在前端 bundle 或 git（本里程碑的根本目的）
- **Tech stack**: 後端採 Vercel Serverless 函式，與既有 Vite 靜態站整合
- **Compatibility**: 前端介面與分析行為不變；領域型別（`StockDataPoint[]` 等）保持相容
- **Dependencies**: 行情沿用 Yahoo Finance（非官方）與 FinMind 免費層，本次不換供應商
- **Budget**: 盡量落在 Vercel 免費層

<!-- GSD:project-end -->

## 索引：需要時才讀（不要全部預讀）

| 要做的事 | 先讀 |
|---|---|
| 了解技術棧、依賴、設定 | `.planning/codebase/STACK.md` |
| 了解架構、資料流、分層 | `.planning/codebase/ARCHITECTURE.md` |
| 寫碼風格、命名、放哪裡 | `.planning/codebase/CONVENTIONS.md` |
| 已知問題與技術債 | `.planning/codebase/CONCERNS.md` |
| 外部整合（Yahoo/FinMind/Gemini） | `.planning/codebase/INTEGRATIONS.md` |
| 目前進度與下一步 | `.planning/STATE.md`、`.planning/ROADMAP.md` |

## 制度檔（跨專案，位於 C:\Users\jason\Documents\Codex\agent-dual-core\）

| 時機 | 檔案 |
|---|---|
| 交辦 subagent／選模型前 | `MODEL-DISPATCH.md` |
| 判斷完成／升級／該不該問使用者 | `JUDGMENT.md` |
| 動 shell、路徑、驗證前 | `ENVIRONMENT-GOTCHAS.md` |
| 交辦單怎麼寫 | `TASK-TEMPLATES.md` |
| 想改制度檔／記錄踩雷 | `MAINTENANCE.md`（教訓寫 `LESSONS.md`） |

**不開檔也要遵守的三條**：
1. 偵查／批次／驗證工作交辦 subagent，主對話只收結論（判準：開 ≥3 檔、掃 repo、改 ≥3 檔、一切驗證）。
2. 改 `.ts/.tsx` 後最低驗證 `npx tsc --noEmit`；只讀過程式碼不算驗證。
3. PowerShell 5.1 沒有 `&&`；路徑含空格必加引號；寫檔用 Write 工具或 `-Encoding utf8`。

## 本專案關鍵事實（易錯）

- 依賴要同時維護兩處：`package.json` 與 `index.html` 的 esm.sh importmap。
- 無測試跑道：無 test runner／lint，tsconfig 非 strict。驗證靠 tsc＋preview 實跑。
- 資料鏈：Yahoo（公共 CORS proxy 輪替）→ 失敗 fallback FinMind；429 是常態，先懷疑限流再改碼。
- 金鑰驗證法：`npm run build` 後 `grep -r "AIza" dist/` 必須無結果（用 Bash 工具跑；PowerShell 5.1 沒有 grep）。
- `services/gemini.ts` 的 Gemini 型號（fast=`gemini-3.5-flash`／thinking=`gemini-3.1-pro-preview`）有硬編處，改型號要全域搜尋。
- 改 `.claude/skills/` 後執行 `npm run sync:skills` 同步 Codex 鏡像（`.agents/skills/`，白名單見 `scripts/sync_skills_mirror.py`）。

<!-- GSD:skills-start source:skills/ -->

## Project Skills

朱家泓進場分析 7 步驟 skills 位於 `.claude/skills/`（Codex 讀 `.agents/skills/`）：
`trend-analysis` → `position-analysis` → `kline-signal` → `ma-structure` →
`volume-analysis` → `indicator-analysis` → `entry-decision`（總入口／最終結論）。
使用者說「分析 XXXX」「XXXX 能不能買」時從 `trend-analysis` 開始依序跑，
或直接用 `entry-decision` 帶完整流程。各步驟細節讀該 skill 的 SKILL.md，不要憑記憶重建規則。

另有 `tw-fundamentals`（台股基本面資料層）：用 FinMind 免 token 抓台股財報／估值／月營收／股利，
補上美股 skill（dcf-model／comps-analysis／initiating-coverage）從 SEC 自動取得、台股缺的那層。
使用者要台股的財報、估值、DCF、基本面時用；抓取腳本 `.claude/skills/_shared/fetch_fundamentals.py`。

工作流 skills：`phase-loop`（三角開發迴圈 playbook——規劃/交 Codex/覆核/合併四階段，
7 輪實戰驗證的格式與儀式，做任何 phase 工作先讀它）；`start-dev`（起 dev 環境固定流程＋故障對照表）。

<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

改檔前先走 GSD 入口，讓規劃產物與執行 context 同步（注意是冒號語法）：
`/gsd:quick`（小修／文件）、`/gsd:debug`（查蟲）、`/gsd:execute-phase`（計畫內工作）。
除非使用者明確要求繞過，不要在 GSD 流程外直接改 repo。

**節省 token**：本專案已用 `/gsd:surface` 關閉 `ns_meta`／`milestone`／`research_ideate`／
`workspace_state`／`docs`／`ui`／`ai_eval` 這 7 個 cluster（保留 core_loop／audit_review／utility，
故 quick/debug/execute-phase 不受影響）。若任務真的需要被關掉的功能（如里程碑收尾、UI 設計稿、
AI 評估規劃），先執行 `/gsd:surface enable <cluster>` 借回來再呼叫該指令，用完可 `disable` 關回去。
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
