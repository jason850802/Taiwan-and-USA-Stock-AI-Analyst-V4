# Codebase Structure

**Analysis Date:** 2026-10-01（整份重寫，取代 2026-05-31 版）

> 2026-05-31 版停在「一個 `App.tsx`＋6 個元件＋3 個 service＋3 個 util，`index.html` 載 Tailwind CDN 與
> esm.sh importmap」的時期。之後新增了後端 `api/`、`config/`、`services/_shared/`、
> `components/portfolio|fundamentals|ui/`、`utils/statementParsers/`，`components/Portfolio.tsx` 從 1379 行
> 拆到 676 行，GSD 工具也已停用（2026-07-26）。本版以 `git ls-files` 為準（只列進 git 的檔案），行數是
> 2026-10-01 的快照；舊版見 `git show 2b7637b:.planning/codebase/STRUCTURE.md`。與 `CORE_RULES.md` 衝突時
> 以 CORE_RULES 為準。

## 目錄配置

```text
Taiwan-and-USA-Stock-AI-Analyst-V4/
├── index.html               # HTML 殼：#root、Google Fonts、載入 /index.tsx（無 importmap、無 CDN 腳本）
├── index.tsx                # React 進入點：import index.css；ErrorBoundary 包 <App />
├── index.css                # @tailwind 指令＋body 深色底與捲軸樣式
├── App.tsx                  # 根容器：儀表板狀態、分析流程、三個分頁切換
├── types.ts                 # 跨模組共用的領域型別
├── vite.config.ts           # Vite＋vitest 設定（envPrefix、/api proxy、@ alias、vendor 分包）
├── tsconfig.json            # TS 設定（非 strict；exclude 的理由見 CONVENTIONS.md）
├── tailwind.config.js       # Tailwind 掃描路徑＋語意色 token
├── postcss.config.js        # tailwindcss＋autoprefixer
├── package.json             # 依賴與 npm scripts（依賴單軌：只維護它與 package-lock.json）
├── package-lock.json
├── .env.example             # 環境變數範本（真值放 .env，不進 git）
├── .vercelignore            # 部署排除清單（含 api/**/*.test.ts）
├── .gitignore / .gitattributes
├── metadata.json            # Google AI Studio 時期的中繼資料
├── start-stock-analyst.bat  # 舊啟動腳本：只起 Vite、路徑寫死 D:（已過時，見 STACK.md）
├── README.md
├── CORE_RULES.md            # 專案規則的單一事實來源
├── CLAUDE.md / AGENTS.md    # Claude Code／Codex 的入口，只指向 CORE_RULES.md
├── CONTEXT.md               # 領域詞彙表（只收已拍板的詞）
├── PLAN.md                  # 2026-09-20 載入速度與瘦身計畫（01～12 已全部 resolved）
├── api/                     # 後端：Vercel Serverless 函式（非 _／. 開頭的 .ts 各是一支函式）
│   ├── gemini.ts                # POST /api/gemini：AI 報告，一次回完整文字
│   ├── gemini-stream.ts         # POST /api/gemini-stream：AI 報告，NDJSON 串流
│   ├── finmind.ts               # GET /api/finmind：FinMind 代理（dataset 白名單）
│   ├── yahoo/
│   │   ├── chart.ts             # GET /api/yahoo/chart：Yahoo 行情代理
│   │   └── search.ts            # GET /api/yahoo/search：Yahoo 搜尋代理
│   └── _lib/                    # 共用模組（_ 開頭，不會被部署成函式）
│       ├── config.ts            # 讀 env：金鑰、型號、允許來源、共享密鑰
│       ├── guard.ts             # applyGuards：CORS、來源檢查、共享密鑰、限流
│       ├── ratelimit.ts         # Upstash 限流器
│       ├── http.ts              # Gemini SDK 呼叫、錯誤分類、請求驗證
│       ├── llm.ts               # LLM provider 分流（gemini-api／claude-cli）
│       ├── yahoo.ts             # Yahoo cookie／crumb 握手、參數驗證、錯誤分類
│       └── finmind.ts           # FinMind dataset 白名單、CDN 快取秒數、錯誤分類
├── components/              # React UI（default export、Tailwind）
│   ├── Sidebar.tsx              # 分頁切換
│   ├── StockSearch.tsx          # 代號／中文名搜尋
│   ├── QuoteHeader.tsx          # 報價列
│   ├── ChartToolbar.tsx         # 週期與指標設定
│   ├── StockChart.tsx           # recharts K 線／均線／指標圖（lazy 載入）
│   ├── EntryChecklist.tsx       # 六六大順濾網結果
│   ├── AnalysisResult.tsx       # AI 報告卡片（lazy）
│   ├── Portfolio.tsx            # 庫存分頁容器（lazy）
│   ├── FundamentalsPanel.tsx    # 基本面分頁容器（lazy）
│   ├── ErrorBoundary.tsx        # 全 codebase 唯一的 class component
│   ├── portfolio/               # 庫存分頁的子元件與狀態 hooks（use*.ts）
│   ├── fundamentals/            # 基本面分頁的子元件
│   └── ui/                      # 跨頁共用的基礎元件
├── services/                # 前端 I/O 與快取：只打同源 /api/*
│   ├── yahoo.ts                 # 行情主管線：抓取、正規化、指標、台股日線 FinMind 備援
│   ├── finmind.ts               # FinMind 讀取（fetchFinMindRows）＋基本面資料
│   ├── gemini.ts                # AI 報告：system instruction／prompt＋呼叫 /api/gemini*
│   ├── stockDirectory.ts        # 台股名錄＋搜尋
│   ├── quoteCache.ts            # 行情快取（sessionStorage）
│   ├── fetchError.ts            # DataFetchError 分類型別
│   └── _shared/                 # 跨 service 共用：apiClient、geminiCache、boundedSession、healthDecision
├── utils/                   # 純計算與 localStorage 薄 IO（分組見下節）
│   ├── statementParsers/        # 對帳單解析（國泰美股、國泰台股、永豐台股）
│   └── __snapshots__/           # geminiRules／geminiPrompts 的 snapshot
├── config/
│   └── twFeeRates.ts            # 台股費率／稅率設定（唯一事實來源）
├── prompts/
│   └── 持股庫存健檢系統_AI提示詞_adapted.md   # 參考用 prompt 文件，程式沒有引用
├── scripts/                 # 開發腳本：run-gate.mjs、sync_skills_mirror.py、量測與量能曲線校準
├── docs/                    # ADR（adr/）、部署指南、gate 稽核、交接紀錄、skill 呼叫說明、agents 設定、優化報告
├── .claude/skills/          # 專案 skills 的單一事實來源
├── .agents/skills/          # Codex 讀的 skills 鏡像（npm run sync:skills 維護）
├── .planning/               # 規劃文件：codebase/（本目錄）、phases/（唯讀）、quick/、optimization/ 等
└── .scratch/                # 票據、spec 與驗收證據（.scratch/<feature>/）
```

- 對證：`git ls-files | awk -F/ '{print $1}' | sort | uniq -c`（頂層）；各子目錄 `git ls-files <目錄>`。

## 目錄用途

**根目錄：**
- 進入點（`index.html` → `index.tsx` → `App.tsx`）、建置與型檢設定、共用型別 `types.ts`，以及規則與說明文件。
  規則以 `CORE_RULES.md` 為準，`CLAUDE.md`、`AGENTS.md` 只是指標。

**api/：**
- 後端。5 支 handler 的第一步都是 `api/_lib/guard.ts` 的 `applyGuards`；handler 本身只做參數驗證、打上游、
  分類錯誤，共用邏輯放 `_lib/`。外部服務細節見 `INTEGRATIONS.md`。
- 測試：`_lib/` 的 7 個模組都有同名 `.test.ts`；handler 層只有 `gemini-stream` 與 `yahoo/chart` 有測試
  （見 `TESTING.md`）。`api/` 底下的測試檔必須叫 `*.test.ts`，`.vercelignore` 才排除得到。

**components/：**
- 頂層：儀表板元件與三個分頁容器。`StockChart`、`AnalysisResult`、`Portfolio`、`FundamentalsPanel` 由
  `App.tsx` 以 `lazy()` 載入（`App.tsx:27-30`）。
- `portfolio/`：持股表 `HoldingsTable.tsx`、賣出 `SellModal.tsx`、匯入對帳單 `ImportStatementModal.tsx`、
  回灌 `RestoreBackupModal.tsx`、歷史損益 `PnlHistorySection.tsx`＋`PnlHistoryChart.tsx`、已實現帳本
  `RealizedLedger.tsx`；狀態邏輯拆成 6 個 hooks（`useHoldingPrices`、`useHealthCheck`、`usePortfolioForm`、
  `usePortfolioBackup`、`useDailySnapshot`、`useLotDividendUpdate`），加上報價佇列 `holdingPriceQueue.ts`。
  其中 `HoldingsTable.tsx`、`useHoldingPrices.ts`、`usePortfolioForm.ts`、`useDailySnapshot.ts` 是 Phase 12 從
  `Portfolio.tsx` 拆出（見各檔檔頭）。
- `fundamentals/`：`ValuationHeader`、`FinancialHealthCards`、`MonthlyRevenueChart`、`QuarterlyTrendCharts`、
  `DividendTable`。
- `ui/`：`Badge`、`Banner`、`Button`、`Card`、`MarkdownReport`（AI 報告的 Markdown 渲染）、`Modal`、
  `Skeleton`、`StatCard`。

**services/：**
- 前端所有網路 I/O 與快取。只打同源 `/api/*`，請求帶 `services/_shared/apiClient.ts` 的 `proxyHeaders`。
- `_shared/`：`apiClient.ts`（共享密鑰 header）、`geminiCache.ts`（AI 結果快取，localStorage）、
  `boundedSession.ts`（有容量上限的 sessionStorage 命名空間）、`healthDecision.ts`（把庫存健檢的 LLM 回應
  解析成結構化決策）。

**utils/：**（25 個模組＋`statementParsers/` 6 個，不含測試）

| 分組 | 模組 |
|---|---|
| 指標與判定 | `math.ts`（指標）、`entryFilter.ts`（六六大順進場濾網）、`volume.ts`（盤中預估量）、`market.ts`（市場分類的唯一權威） |
| 庫存帳務與歷史 | `portfolioFees.ts`、`portfolioLedger.ts`（賣出引擎）、`portfolioGrouping.ts`、`portfolioHistory.ts`、`backfillPipeline.ts`（歷史回推）、`dividendEstimator.ts`、`fx.ts`、`shareUnits.ts`、`quoteGaps.ts`（報價不齊判定） |
| 對帳單匯入 | `importPlan.ts`、`importReplay.ts`、`statementParsers/`（`index.ts` 偵測格式並分派，`cathay.ts`、`cathayTw.ts`、`sinopac.ts` 各解一種對帳單，`xlsxReader.ts`、`twSymbolResolver.ts` 輔助） |
| localStorage 持久層 | `persistentStore.ts`（工廠）→ `portfolioItemsStore.ts`、`txnStore.ts`、`importStore.ts`、`portfolioHistoryStore.ts`、`closeSeriesCache.ts`；`portfolioBackup.ts`（備份／回灌） |
| 其他 | `framePublisher.ts`（串流文字逐幀發佈）、`panMath.ts`（圖表拖曳平移）、`workerPool.ts`（併發游標池）、`quoteTime.ts`（報價時間格式） |

- 測試多數與受測檔同目錄；另有 4 支守門測試（`viteConfigGuard`、`vercelIgnoreGuard`、`tsconfigScopeGuard`、
  `appLazyBoundaries`）與幾支早期放在 `utils/`、受測物在 `services/` 的測試——見 `TESTING.md`。

**config/：** 可調參數的單一事實來源，目前只有 `twFeeRates.ts`（台股費率／稅率）。

**prompts/：** 參考用的 prompt 文件；實際的 system instruction 寫在 `services/gemini.ts`（`git grep -n "prompts/" -- '*.ts' '*.tsx'` 無命中）。

**scripts/：** 開發用腳本，不屬於 App（`tsconfig.json` 的 `exclude` 排除）：`run-gate.mjs`（`npm run gate`）、
`sync_skills_mirror.py`（`npm run sync:skills`）、`benchmark-market-data.mjs`、`measure-initial-bundle.mjs`、
`audit-source-usage.mjs`、`calibrate-tw-volume-curve.mjs`／`calibrate-us-volume-curve.mjs`（附兩份校準報告 `.md`）。

**docs/：** `adr/`（0001～0004）、`DEPLOYMENT.md`、`gate-audit-findings.md`、`claude-handoff-findings.md`、
`codex-handoff-findings.md`、`skill-invocation.md`、`agents/`（issue tracker、triage labels、domain 設定）、
`optimization-*.md`。

## 關鍵檔案

**進入點：**
- `index.html`：HTML 殼（`#root`、Google Fonts、`/index.tsx`）。
- `index.tsx`：掛載 `<App />`（外包 `ErrorBoundary`、`React.StrictMode`）。
- `App.tsx`：根元件與儀表板流程。
- 後端進入點是 `api/` 的 5 支 handler。

**設定：**
- `vite.config.ts`、`tsconfig.json`、`tailwind.config.js`、`postcss.config.js`。
- `.env.example`（變數範本；真值放 `.env`，不進 git）、`.vercelignore`（部署排除）。
- `config/twFeeRates.ts`（台股費稅）。

**核心邏輯：**
- `services/yahoo.ts`：行情抓取、正規化與指標計算。
- `utils/entryFilter.ts`：客觀進場判定（GO／WAIT／NO_GO）。
- `services/gemini.ts`：AI 報告的 prompt 與呼叫。
- `api/_lib/guard.ts`、`api/_lib/llm.ts`：後端把關與 LLM 呼叫。
- `types.ts`：共用領域型別。

**大檔（行數，2026-10-01）：** `services/yahoo.ts` 1210、`services/gemini.ts` 1063、`components/StockChart.tsx` 1041、
`components/Portfolio.tsx` 676、`App.tsx` 631、`api/_lib/llm.ts` 591、`components/portfolio/HoldingsTable.tsx` 570、
`services/finmind.ts` 519、`utils/portfolioHistory.ts` 511。
- 對證：`git ls-files '*.ts' '*.tsx' | grep -v '\.test\.ts$' | xargs wc -l | sort -rn | head`。

**Testing:**
- Vitest（`~3.2.7`）；沒有獨立的 `vitest.config.*`，設定寫在 `vite.config.ts` 的 `test` 區塊。測試檔副檔名
  一律 `.test.ts`（`<模組>.test.ts`，同一模組多支時 `<模組>.<面向>.test.ts`），多數與受測檔放同目錄，
  snapshot 在 `utils/__snapshots__/`；2026-09-30 時 49 個測試檔、811 個案例。放置規則與例外見同目錄的
  `TESTING.md`。

## 命名慣例

**檔案：**
- 元件：`PascalCase.tsx`（例 `StockChart.tsx`）；庫存 hooks：`use<名稱>.ts`（`components/portfolio/`）。
- service／util：`camelCase.ts`（例 `entryFilter.ts`、`stockDirectory.ts`）。service 用短名（`yahoo.ts`、
  `gemini.ts`），不用 `*Service.ts`；localStorage 薄 IO 多叫 `*Store.ts`。
- 後端 handler：檔名＝路由（`api/gemini-stream.ts` → `/api/gemini-stream`、`api/yahoo/chart.ts` →
  `/api/yahoo/chart`）。
- 測試：`<模組>.test.ts`／`<模組>.<面向>.test.ts`（見 `TESTING.md`）。

**目錄：**
- 小寫。`components/` 的子目錄以功能命名（`portfolio/`、`fundamentals/`、`ui/`）。
- `_` 開頭（`api/_lib/`、`services/_shared/`）放共用模組；在 `api/` 底下 `_` 開頭也代表不會被部署成函式。

**Symbols：**
- Components: default-exported `PascalCase` consts/functions.
- Services/utils: named exports (`getStockData`, `runEntryFilter`, `calculateSMA`).
- Interfaces/types: `PascalCase` (`StockDataPoint`, `EntryFilterResult`, `IndicatorSettings`).
- Some shared types are exported from util/service modules (e.g. `EntryFilterResult` from
  `utils/entryFilter.ts`, `VolumeProjection` from `utils/volume.ts`) rather than from `types.ts`.

## 新程式放哪裡

完整規則見 `CONVENTIONS.md` 的「Where to Add New Code」（2026-10-01 核對），這裡只列位置：

- **UI 元件**：`components/<Name>.tsx`；屬於庫存或基本面分頁的放 `components/portfolio/`、
  `components/fundamentals/`；跨頁共用的基礎元件放 `components/ui/`。
- **庫存分頁的狀態邏輯**：`components/portfolio/use<名稱>.ts` hook，不要塞回 `Portfolio.tsx`。
- **前端資料／AI 呼叫**：`services/<name>.ts`，只打同源 `/api/*` 並帶 `proxyHeaders`。
- **需要金鑰或要打外部服務**：後端 `api/<name>.ts`（共用模組放 `api/_lib/`），handler 第一步 `applyGuards`；
  測試命名 `*.test.ts`。
- **純計算**：`utils/<name>.ts`，測試放同目錄 `utils/<name>.test.ts`。
- **localStorage 持久化**：用 `utils/persistentStore.ts` 的 `createPersistentStore` 產生 store（`portfolioItemsStore.ts`、
  `txnStore.ts`、`importStore.ts`、`portfolioHistoryStore.ts`、`closeSeriesCache.ts` 都這樣做）。
- **可調參數**（費率、稅率這類）：`config/`。
- **共用型別**：`types.ts`；只有單一使用者的型別可以和產生它的模組放一起。

## 特殊目錄

| 目錄 | 用途 | 自動產生 | 進 git |
|---|---|---|---|
| `.claude/skills/` | 專案 skills 的單一事實來源 | 否 | 是（`.claude/` 其餘——agent worktree、本機設定——由 `.gitignore` 的 `.claude/*` 排除） |
| `.agents/skills/` | Codex 讀的 skills 鏡像，`npm run sync:skills` 依白名單從兩個來源同步（`docs/skill-invocation.md`），不要手改 | 是 | 是 |
| `.planning/codebase/` | 本組 codebase 文件；2026-05-31 由 GSD 產生（`0e4085b`），之後人工維護，各檔檔頭註明核對範圍 | 否 | 是 |
| `.planning/phases/` | Phase 01～12 的歷史決策 | 否 | 是（唯讀檔案庫，新工作不寫入） |
| `.scratch/` | 票據、spec 與驗收證據（`<feature>/`） | 否 | 是 |
| `utils/__snapshots__/` | vitest snapshot | 是 | 是（`-u` 更新＝改期望值，先問使用者） |
| `dist/` | 建置產物 | 是 | 否（`.gitignore:11`） |
| `node_modules/` | 依賴 | 是 | 否 |

- GSD 已於 2026-07-26 停用（`CORE_RULES.md`），舊版列的 `.claude/get-shit-done/` 不再使用。

---

*Structure analysis: 2026-10-01（整份重寫；原版 2026-05-31）*
