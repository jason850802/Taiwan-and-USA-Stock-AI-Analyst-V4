<!-- 本檔只放「現在有效」的規則與指路：上限 150 行。歷史與緣由放 docs/rules-history.md，不要塞回來。 -->

# 專案共用規則（Claude Code ＋ Codex 單一事實來源）

> `CLAUDE.md`（Claude 讀）與 `AGENTS.md`（Codex 讀）只是指標，規則以本檔為準。
> 全域基準：`agent-dual-core\CORE_RULES.md`；**衝突時以本檔為準**。

## 紅線（違反即停）

1. **金鑰**：`GEMINI_API_KEY` 等後端秘密只能在 Vercel 環境變數／後端，絕不進前端 bundle 或 git。
2. **碰錢的語意決策停下來問使用者**，而且要攤開現值、依據、新值會改變什麼；不可把使用者給的新值當預設、只問適用範圍。
3. **既有測試紅燈＝語意變更的訊號**：停下來問，不是把期望值改綠。
4. **推 main＝正式上線**：正式站是 GitHub `main` 的 Vercel Git 自動部署。push main 前先列出 `origin/main` 以來會上線的全部內容，取得使用者同意才推。
5. **禁裝新 npm 套件**（要裝先問）；行情只用 Yahoo（非官方）與 FinMind 免費層，不換供應商；盡量落在 Vercel 免費層。
6. 資料服務層的領域型別（`StockDataPoint[]`、`StockInfo` 等）保持相容。

## 專案

台股／美股技術分析工具（繁中介面）：搜尋股票 → 抓行情、算指標 → 依朱家泓「六六大順」法則產出 GO/WAIT/NO_GO → AI 中文報告；另有可做 AI 健檢的庫存功能。前端 React SPA（Vite）＋ Vercel Serverless 後端（`api/`）。

## 每次改碼：機械 gate

`npm run gate` 一鍵跑完：tsc 0 錯 → vitest 全綠（既有案例零修改）→ build → 金鑰掃描 → `package.json`／lock 無差異。
真金鑰不是 `AIza` 前綴，手動 grep 掃不到，一律用 gate。
gate 管不到、仍要人工的：console 零紅字、UI 數字要量、快取類換乾淨代號。各道 gate 的能力與缺口見 `docs/gate-audit-findings.md`。

## 易錯事實

- 依賴只維護 `package.json`＋`package-lock.json`。測試＝vitest；無 lint、tsconfig 非 strict；改被測試鎖住的檔案前先跑 test。
- 資料鏈：Yahoo 由後端 `/api/yahoo/chart` 抓（`api/_lib/yahoo.ts` 做 cookie／crumb 握手）→ 台股日線失敗改抓 FinMind（經後端 `/api/finmind`）；429 是常態，先懷疑限流再改碼。
- **換 AI 模型或 effort 要換快取代號**：模型名稱只在後端（`api/_lib/config.ts` 的 fallback 與 `.env.example`；claude-cli 路徑看 `.env` 的 `CLAUDE_CLI_MODEL_*`／`CLAUDE_CLI_EFFORT_*` 與 `api/_lib/llm.ts` 預設）。任何一項改了，都要把 `services/_shared/geminiCache.ts` 的 `ENGINE_TAG` 往上加一格；快取鍵不含模型與 effort，不換就會端出舊結果。
- `services/gemini.ts` 的 5 個 system instruction 被 `utils/geminiRules.test.ts` 逐位元組鎖住，改一字就讓 AI 快取全失效；動之前先讀 `.planning/phases/12-arch-deepening/12-CONTEXT.md` 的 D-06。
- `.cbmignore`（程式碼圖譜排除 `.scratch/` 的設定）刻意不進 git：不要 commit、不要刪。

## 工作流（依表路由，不要即興）

| 任務型態 | 走法 |
|---|---|
| 小修（單檔／文案／無語意決策） | 直接做：TDD → gate → commit，不開票 |
| 新功能 | `grill-with-docs` → `to-spec` → `to-tickets`（落 `.scratch/<feature>/issues/`）→ 每票 `implement` |
| 碰錢的精密 refactor | `phase-loop` 的 PLAN 格式，覆核用 `code-review` |
| 大霧工程（跨 session） | `wayfinder` 決策票地圖 → 收斂後接 `to-spec` |
| 壞掉／沒反應／數字不對 | `diagnosing-bugs`（先建紅燈迴圈才准提假設） |

- 主線 skills（grill→spec→tickets→implement）只能由使用者呼叫；啟動方式與派 Codex 的實務見 `docs/skill-invocation.md`。
- **合併進 main**：
  - merge commit 必帶 `Code-Review:` trailer。新功能、碰錢、跨多模組：跑 `code-review` 雙軸，寫兩軸處置（無發現也寫「無發現」，有收就點名）。小修：AI 自審即可，寫明「自審：Standards …；Spec …」。純文件／規則：寫「免跑」。
  - 合併前先用 plain-pr skill 的格式在對話中給使用者白話摘要（只在對話，不寫進 commit）。寫 PR 內文也用 plain-pr。
  - 稽核（應 0 筆）：`git log --merges code-review-trailer-start..HEAD --invert-grep --grep="^Code-Review:"`。
- resolved 的票，票面 code-review checkbox 必須已勾。中大型任務每張票建議開新對話。
- 票據刻意不寫檔案路徑與行號（票可能躺數天），接手方依行為描述自行找現況程式碼。一票一個 commit。

## 指路（需要時才讀）

| 要找的東西 | 去哪裡 |
|---|---|
| 技術棧／架構／寫碼風格／技術債／外部整合 | `.planning/codebase/` 的 STACK／ARCHITECTURE／CONVENTIONS／CONCERNS／INTEGRATIONS |
| 目前進度與下一步 | `.scratch/` 的未完成票據＋`git log` |
| 領域詞彙與架構決策 | 根目錄 `CONTEXT.md`＋`docs/adr/` |
| 票據格式與狀態標籤 | `docs/agents/issue-tracker.md`、`docs/agents/triage-labels.md` |
| Phase 1～12 歷史決策 | `.planning/phases/`（唯讀檔案庫） |
| 規則的歷史與緣由 | `docs/rules-history.md` |
| 交辦、判斷、環境雷、記教訓 | `C:\Users\jason\Documents\Codex\agent-dual-core\INDEX.md` |
| 找函式、呼叫鏈、改動影響 | 先查程式碼圖譜（codebase-memory-mcp，`search_graph`／`trace_path`），查不到再 grep |

## 程式風格

2 空格縮排、單引號、繁體中文註解、camelCase／PascalCase。不要重排或重寫無關檔案。
所有產出（註解、commit、文件、票據）一律繁體中文，禁用簡體字。

## 雙工具與 skills

- Skills 來源在 `.claude/skills/`，改完跑 `npm run sync:skills` 同步到 Codex 讀的 `.agents/skills/`，不要手改鏡像端。
- `phase-loop` 只在 Claude 端（Codex 只收 PLAN 文件）；`start-dev` 兩端都有。各 skill 的細節讀它的 SKILL.md，不要憑記憶重建。
