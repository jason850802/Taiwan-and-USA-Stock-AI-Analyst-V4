# Coding Conventions

**Analysis Date:** 2026-10-01 (partial re-check; original analysis 2026-05-31)

> **部分核對**：下列範圍已對照現況修正，每條附對證的指令或檔案——
> - 2026-09-30：「Comments」「TypeScript Configuration」兩節。
> - 2026-10-01：檔頭 Scope；「Linting」「Environment & Secrets」兩節；「Error Handling」第一點；
>   「Styling」第一點中 Tailwind 載入方式那一句；「Where to Add New Code」的資料／AI 整合那一點。
> - 2026-10-01（第二輪）：「Styling」兩點的其餘部分；「Error Handling」第二點。
>
> 其餘段落仍是 2026-05-31 的分析、未重新核對——當時還沒有 `api/`（2026-07-05 `6b13f22` 起）與
> `config/`（2026-07-29 `88363f1` 起），那些段落的範例也不涵蓋它們。已知「Naming Patterns」舉的例子
> 有 8 個已不存在：`analyzeStockWithGemini`、`formatPromptData`、`passPriceCheck`、`passVolumeCheck`、
> `PROXIES`、`YAHOO_BASE`、`FINMIND_BASE`、`FINMIND`（對證：`git grep -c -w <名稱> -- '*.ts' '*.tsx'
> ':!*.test.ts'` 無命中）。與 `CORE_RULES.md` 衝突時以 CORE_RULES 為準。

> Scope：應用程式原始碼——根目錄的 `App.tsx`、`index.tsx`、`types.ts`，以及 `components/`、
> `services/`、`utils/`、`prompts/`、`config/`（台股費率／稅率設定）、`api/`（後端：Vercel
> Serverless 函式，共用模組在 `api/_lib/`）。不含 `node_modules/` 與 `.claude/`——後者是 agent
> 工具目錄，進 git 的只有 `.claude/skills/`（專案 skills），其餘（本機設定、agent worktree）由
> `.gitignore` 的 `.claude/*` 排除。

## Naming Patterns

**Files:**
- React components: **PascalCase** `.tsx`, one component per file —
  `components/AnalysisResult.tsx`, `components/Sidebar.tsx`,
  `components/StockSearch.tsx`, `components/Portfolio.tsx`,
  `components/StockChart.tsx`, `components/EntryChecklist.tsx`.
- Services & utilities: **camelCase** `.ts` — `services/yahoo.ts`,
  `services/gemini.ts`, `services/stockDirectory.ts`, `utils/math.ts`,
  `utils/volume.ts`, `utils/entryFilter.ts`.
- Shared types: single root `types.ts`.
- Entry: `index.tsx` mounts root `App.tsx` (both at repo root, no `src/`).

**Functions:**
- camelCase throughout. Exported util/service functions are descriptive verbs:
  `calculateSMA`, `calculateRSI`, `calculateMACD`, `calculateKDJ`,
  `calculateBollingerBands` (`utils/math.ts`); `getStockData`,
  `getLatestPrice` (`services/yahoo.ts`); `analyzeStockWithGemini`,
  `analyzeEntryWithGemini`, `analyzeTradeDecision`, `analyzePortfolioHealth`
  (`services/gemini.ts`); `runEntryFilter` (`utils/entryFilter.ts`);
  `estimateVolumeTrend` (`utils/volume.ts`); `searchStocks`, `searchTaiwan`,
  `searchYahoo`, `ensureTaiwanDirectory` (`services/stockDirectory.ts`).
- Internal helpers are also camelCase and often module-private (not exported):
  `formatPromptData`, `formatHealthCheckData` (`services/gemini.ts`);
  `detectSwings`, `classifyTrend`, `trendOf`, `fmt` (`utils/entryFilter.ts`);
  `queryYahoo`, `fetchRawData`, `processYahooResult`, `fetchFinMindStockInfo`
  (`services/yahoo.ts`).
- React event handlers use the `handle*` prefix: `handleRunAnalysis`,
  `handlePortfolioAdd`, `handleZoom`, `handleMouseMove`, `handleSingleHealthCheck`.
- Boolean locals/derived flags use `is*`/`has*`/`pass*` prefixes:
  `isTaiwanStock`, `isRedCandle`, `isAttackVol`, `hasChipData`, `hasHolding`,
  `passPriceCheck`, `passVolumeCheck` (`App.tsx`, `services/gemini.ts`,
  `utils/entryFilter.ts`).

**Variables:** camelCase. Module-level constants are UPPER_SNAKE_CASE:
`PROXIES`, `YAHOO_BASE`, `FINMIND_BASE` (`services/yahoo.ts`); `FINMIND`,
`LS_KEY`, `LS_TS`, `TTL` (`services/stockDirectory.ts`); `Y_AXIS_WIDTH`
(`components/StockChart.tsx`).

**Types:**
- Interfaces & type aliases: **PascalCase** — `StockDataPoint`, `StockInfo`,
  `PortfolioItem`, `IndicatorSettings`, `TimeInterval` (`types.ts`);
  `EntryFilterResult`, `FilterStep`, `StepStatus`, `Decision`
  (`utils/entryFilter.ts`); `VolumeProjection` (`utils/volume.ts`);
  `StockDirEntry`, `Market` (`services/stockDirectory.ts`);
  `PortfolioHealthItem` (`services/gemini.ts`).
- String-literal union types are used heavily instead of enums:
  `type TimeInterval = '15m' | '60m' | '1d' | '1wk' | '1mo'` (`types.ts`);
  `type StepStatus = 'pass' | 'warn' | 'fail'`,
  `type Decision = 'GO' | 'WAIT' | 'NO_GO'` (`utils/entryFilter.ts`);
  `type Market = 'TW' | 'US' | 'OTHER'`; `type AppView = 'dashboard' |
  'portfolio'` (declared locally in both `App.tsx` and `components/Sidebar.tsx`).
  Inline field unions are common too, e.g. `ma5Dir?: 'up' | 'down' | 'flat'`.

## Code Style

**Formatting:**
- No formatter configured (no `.prettierrc`, `.editorconfig`, no Prettier dep).
- De-facto style observed across all files: 2-space indent, single quotes,
  semicolons present, trailing commas in multiline literals. Some files use
  extra alignment whitespace in object literals (e.g. `Portfolio.tsx` aligns
  `useState` declarations and form fields in columns) — match the local file.
- Bilingual code is the norm: comments and many user-facing strings are in
  Traditional Chinese; identifiers are English. Section dividers use box-drawing
  comment banners (`// ── ... ──`) — follow this when adding sections.

**Linting:**
- 沒有 linter：`package.json` 沒有 ESLint／Biome，也沒有進 git 的設定檔
  （`git ls-files | grep -i -E 'eslint|biome'` 為空）。
- 原始碼裡有 5 處停用 `react-hooks/exhaustive-deps`（hook 依賴陣列完整性檢查）的註解，分在 4 個檔：
  `components/FundamentalsPanel.tsx:111`、`components/portfolio/PnlHistorySection.tsx:180` 與 `:183`、
  `components/portfolio/useHoldingPrices.ts:148`（以上是 `eslint-disable-next-line`）、
  `components/portfolio/SellModal.tsx:63`（`eslint-disable-line`）。專案沒裝 ESLint，這些註解目前
  沒有工具會讀。對證：`git grep -n 'eslint-disable' -- '*.ts' '*.tsx'`。
  - 舊版記載的 `components/Portfolio.tsx` ~609 那一處，已在 `03bf94a`（2026-07-23，Phase 12 抽出
    Portfolio 的 hooks）移到 `components/portfolio/useHoldingPrices.ts`。

## TypeScript Configuration

From `tsconfig.json`:
- `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`.
- `jsx: react-jsx` — automatic runtime; `React` import is still written
  explicitly in every component (existing convention — keep doing it).
- `noEmit: true` (Vite/esbuild transpiles); `allowImportingTsExtensions: true`;
  `allowJs`, `isolatedModules`, `moduleDetection: force`.
- **`strict` is NOT enabled.** Consequence: implicit `any` is allowed and used.
  The codebase leans on this — note `config: any` in `services/gemini.ts`,
  `const p: any = {}` accumulators in `services/yahoo.ts`, and `(props: any)`
  for Recharts custom shapes/tooltips in `components/StockChart.tsx`. When the
  shape is known, prefer explicit interfaces (as `types.ts` does); fall back to
  `any` only for third-party callback payloads, matching existing usage.
- `exclude: ["node_modules", "dist", ".claude", "scripts"]`, and there is no
  `include` — everything else under the repo root is type-checked, test files
  included; with `allowJs`, root-level JS counts too (currently
  `postcss.config.js`, `tailwind.config.js`; check with
  `npx --no -- tsc --listFilesOnly`). Why each entry:
  - `node_modules`：自訂 `exclude` 會**整個取代** TS 的預設排除清單、不是附加，所以必須顯式列出。
  - `dist`：沒有它時，`dist/` 存在就會把建置產物（`dist/assets/*.js`）一起型檢，`tsc` 的結果取決於
    有沒有先 build（2026-07-26，`dd3e1e8`，gate-audit G5）。
  - `.claude`：只是把意圖寫明——TS 預設 glob 本來就不收 `.` 開頭的路徑段，`.claude/` 底下的檔案
    從沒被收進來過（`dd3e1e8` 以 `.claude/hooks/` 的 JS 實測，修前修後都是 0 檔）。
  - `scripts`：開發／量測腳本不屬於 App。2026-09-30 `scripts/benchmark-market-data.mjs` 為了量測把
    `globalThis.fetch` 換成假函式；`@vercel/node` 建置 `api/` 函式時用這份 tsconfig 型檢，把假函式
    當成 `fetch` 的型別正本，正式建置 log 多出 5 個 error TS（只印不擋，gate 與 runtime 都不會紅）。
    加入於 `ac456dc`（merge `8176fca`），由 `utils/tsconfigScopeGuard.test.ts` 鎖住——改
    `exclude`／`include` 前先讀它的檔頭。

## Import Organization

**Order (observed):**
1. React (`import React, { useState, ... } from 'react'`).
2. Other third-party packages (`recharts`, `lucide-react`, `react-markdown`,
   `remark-gfm`, `@google/genai`).
3. Local modules via relative paths (`./types`, `../utils/math`,
   `../services/yahoo`).

**Path style:** Components/services/utils import each other with **relative**
paths (`../types`, `../utils/math`). The `@/*` alias is configured in
`tsconfig.json` and `vite.config.ts` but is **not** used in app source —
relative imports are the actual convention. Match relative imports for
consistency.

## Error Handling

- 金鑰檢查在後端、不在前端。前端的 AI 呼叫一律經 `services/gemini.ts` 的 `callGeminiApi`／
  `callGeminiApiStream` 打 `/api/gemini`、`/api/gemini-stream`；後端預設的 Gemini API 路徑
  （`api/_lib/llm.ts` 的 `callGeminiApiProvider`）讀不到金鑰就丟 `ClassifiedError('MISSING_KEY')`，
  handler 回 500 與中文訊息（`api/_lib/http.ts` 的 `errorMessages`）。前端收到非 2xx 回應時丟
  `DataFetchError`，種類一律交給 `services/fetchError.ts` 的 `classifyHttpStatus`（429→`RATE_LIMIT`、
  404→`NOT_FOUND`、5xx→`BACKEND_DOWN`、其餘→`UNKNOWN`），訊息沿用後端回的 `message`。新的 fetch 出口
  也要用它，不要自己再寫一份對應。
  - 對證：`git grep -c 'process.env.API_KEY' -- services/ components/ App.tsx` 沒有任何命中；
    `git grep -n 'MISSING_KEY' -- api/ ':!*.test.ts'`。
- Network/parse failures are caught and logged with `console.warn` /
  `console.error`, then either return a safe fallback (`[]`, `null`) or rethrow
  a normalized error（本點 2026-10-01 核對）。例子都在前端：
  - `services/yahoo.ts` 的 `queryYahoo` 打後端 `/api/yahoo/chart`：非 2xx 丟 `DataFetchError`（種類照
    `classifyHttpStatus`，後端回 404「找不到該股票代號」→`NOT_FOUND`）；回應帶 `chart.error` 時
    `Not Found`→`NOT_FOUND`、其餘→`PARSE`。
  - 同檔 `fetchRawData`：裸台股代號先查名錄決定先試 `.TW` 還是 `.TWO`（名錄沒有就先 `.TW`）；只有
    `NOT_FOUND` 才改試另一個後綴，其他失敗原樣上拋，兩個後綴都查無才丟 `NOT_FOUND`（「找不到台股代號」）。
  - 同檔 `fetchStockDataUncached`（`getStockData` 的無快取本體）：台股日線 Yahoo 失敗時改抓 FinMind
    （`fetchFinMindDailyData`）；使用者主動取消（`AbortError`）直接上拋、不觸發這條備援。FinMind 也失敗時
    重丟 Yahoo 的錯誤，但 Yahoo 查無、FinMind 是其他失敗時丟 FinMind 的（兩邊都查無才算查無）。
  - `services/stockDirectory.ts` 的非關鍵路徑用 `catch { /* ignore */ }`。
  - 舊版寫的「proxy rotation in `queryYahoo`」（公共 CORS proxy 輪替）已隨 proxy 移除（2026-07-05
    `e7da3c7`）。Yahoo 的 cookie／crumb 握手與遇 401／429 重試一次，現在在後端 `api/_lib/yahoo.ts` 的
    `fetchYahooWithHandshake`。對證：`git grep -n -E 'PROXIES|corsproxy|allorigins' -- services/ api/` 無命中。
- UI layer catches with `catch (err: any)` and sets an error state string
  (`App.tsx` `fetchData`), or renders a fallback markdown error message
  (`App.tsx` `handleRunAnalysis`, `Portfolio.tsx` health-check handlers).
- Empty `catch {}` blocks with an explanatory comment are an accepted pattern
  for best-effort enrichment (e.g. weekly-data fetch in `App.tsx`).

## Logging

- No logging library — `console.warn` for recoverable issues, `console.error`
  for caught exceptions before rethrow, `console.log` sparingly for fallback
  tracing (`services/yahoo.ts`). Keep `console.warn` for non-fatal paths.

## Comments

- Inline `//` comments (often Chinese) are the most common form, describing
  business rules (the 朱家泓 "六六大順" trading logic in
  `utils/entryFilter.ts` and the rule library in `services/gemini.ts`).
- `/** … */` doc comments directly above a function, constant, type or field
  are an established convention (test files included), usually one line in
  Traditional Chinese — e.g. `/** 模式對應 CLI effort；env 可覆寫 */`
  (`api/_lib/llm.ts`). Longer explanations use a multi-line `/**` block.
  JSDoc tags are rare (`@param` only); there is no tag convention and no
  generated API docs.
  - 對證（2026-09-30）：單行型 `git grep -c -E '^\s*/\*\* .*\*/\s*$' -- '*.ts' '*.tsx'`
    → 40 檔、124 處（其中測試檔 6 檔、16 處）；多行區塊開頭
    `git grep -c -E '^\s*/\*\*\s*$' -- '*.ts' '*.tsx'` → 29 檔、69 處；`@param` 4 檔、5 行；
    整行 `//` 註解（`^\s*//`）112 檔、1730 行。
- Use comments to explain non-obvious financial/domain logic and numeric
  thresholds (e.g. why volume ratio > 1.3 = "攻擊量"), not to restate code.

## Function & Module Design

- **Exports:** Components use `export default` at end of file plus a
  `const X: React.FC<Props> = ...` declaration. Services/utils use **named**
  `export const` / `export function`; types use `export interface` /
  `export type`. No barrel `index.ts` files — import from concrete paths.
- **Component typing:** `React.FC<Props>` with a dedicated `interface XProps`
  declared just above the component (`StockChartProps`, `SidebarProps`,
  `PortfolioProps`, `StockSearchProps`, `AnalysisResultProps`). Inline prop
  types are used for tiny components (`EntryChecklist`, sub-tooltips).
- **Hooks:** `useState`/`useEffect`/`useMemo`/`useCallback`/`useRef`. Expensive
  derived data is memoized (`maResultsCache`, `displayData`, cell arrays in
  `StockChart.tsx`). `useCallback` wraps handlers passed down or used in effect
  deps. Lazy `useState` initializers read `localStorage` (`App.tsx`
  `portfolioItems`). Persisted state mirrors to `localStorage` via an effect.
- **Pure utils:** `utils/math.ts` functions are pure, take/return number arrays,
  default parameters for periods (`period: number = 14`), and guard short input
  (`if (data.length < period) return new Array(...).fill(null)`). Indicator
  outputs are `(number | null)[]` with `null` padding for the warm-up window.
- **Domain layering:** indicators (`utils/math.ts`) → data assembly
  (`services/yahoo.ts`) → objective rule filter (`utils/entryFilter.ts`) → AI
  interpretation (`services/gemini.ts`) → UI. The filter pre-computes the
  GO/WAIT/NO_GO decision in code; Gemini only narrates it (see the explicit
  comment banner in `services/gemini.ts` `analyzeEntryWithGemini`). Preserve
  this separation — do not move rule logic into prompts.

## Styling

- **Tailwind CSS utility classes** inline in `className` (no CSS modules,
  no styled-components). Tailwind 在建置期編譯（本句 2026-10-01 核對）：`tailwindcss`
  `^3.4.19` 是 devDependency，經 PostCSS（`postcss.config.js`，另掛 `autoprefixer`）處理
  `index.css` 的 `@tailwind` 指令（`index.tsx` 第 1 行 import），設定在 `tailwind.config.js`；
  `index.html` 沒有 Tailwind CDN（`git grep -i tailwind -- index.html` 沒有命中）。
  本點以下三項 2026-10-01 第二輪核對：
  - **語意色 token**：`tailwind.config.js` 的 `theme.extend.colors` 定義 `surface`（`DEFAULT`／`card`／
    `inset`／`line`）、`accent`（含 `hover`）、`ai`、`up`／`down`、`ok`／`danger`（皆含 `muted`）、`warn`。
    底色、框線、強調色以 token 為主，文字色仍多用 slate——用量（`components/`＋`App.tsx`）：
    `bg-surface*` 70 處對 `bg-slate-*` 44 處、`border-surface*` 77 對 `border-slate-*` 43、
    `bg-accent*` 33 對 `bg-blue-*`／`bg-indigo-*` 2、`text-slate-*` 319。深色底由 `index.css` 設在
    `body`（`#0f172a`，與 `surface` 同色）。新程式優先用 token。
    - 對證：`git grep -o -E '\bbg-surface(-[a-z]+)?\b' -- components/ App.tsx | wc -l`，其餘換樣式同法。
  - **K 線與漲跌＝台股慣例紅漲綠跌**：token `up`＝`#f0405a`（紅）、`down`＝`#22c55e`（綠），元件用
    `text-up`／`text-down` 等 class。recharts 的自訂 SVG 圖形吃不到 Tailwind class，所以
    `components/StockChart.tsx` 直接寫同一組色碼並加註 `// token: up 紅漲 / down 綠跌`：K 線 `:72`、
    量能 `:708`；MACD 柱 `:909`、法人買賣超 `:122` 也是正紅負綠。KDJ／RSI 的超買超賣參考線
    （`:547-548`、`:559-560`）另用 `#ef4444`（紅）／`#10b981`（綠）。舊版寫 K 線是
    `#ef4444`／`#10b981`，已過時。保持紅漲綠跌，不要改成西方的綠漲紅跌。
  - **AI 報告的關鍵字上色是另一套語意，方向和 K 線相反**：`components/ui/MarkdownReport.tsx` 的粗體
    （`strong`）依兩組關鍵字清單上色，含「空、賣、跌、風險、停損」等字→`text-danger`（紅），含
    「多、買、漲、獲利、停利」等字→`text-ok`（綠）；h4 標題同理（空方／警示／出場／減碼→紅，
    多方／進場／獲利／停利→綠）。`danger`／`ok` 與 `up`／`down` 是同一組色碼。這從第一版
    （`f657acb`，2026-01-14，當時是 `text-red-400`／`text-emerald-400`）就是如此，`acb9023`
    （2026-07-07）只換成語意 token。舊版把「`AnalysisResult.tsx` keyword coloring」當成紅漲綠跌的
    例子，是誤記。本段只記錄現況，不判定哪一套才對。
- Icons come from `lucide-react`; charts from `recharts`（`StockChart.tsx`、
  `fundamentals/MonthlyRevenueChart.tsx`、`fundamentals/QuarterlyTrendCharts.tsx`、
  `portfolio/PnlHistoryChart.tsx`）。AI 報告的 Markdown 渲染集中在 `components/ui/MarkdownReport.tsx`
  （`react-markdown`＋`remark-gfm`，自訂各元素的 renderer），`AnalysisResult.tsx` 與 `Portfolio.tsx`
  （交易決策、健檢兩個 modal）都用它；新的 AI 報告畫面沿用這個元件即可（本點 2026-10-01 核對）。
  - 對證：`git grep -n -E "from 'react-markdown'|from 'remark-gfm'" -- '*.ts' '*.tsx'` 只命中 `MarkdownReport.tsx`；
    `git grep -l "from 'recharts'" -- components/` 為上列 4 檔。

## Environment & Secrets

- **金鑰紅線**（`CORE_RULES.md` Constraints）：`GEMINI_API_KEY` 只存在後端（Vercel 環境變數／本機
  `.env`），絕不可進前端 bundle 或 git。`.gitignore` 排除 `.env`、`.env.*`，只有範本 `.env.example`
  進 git（列出變數名，值留空或只放範例值）。不要把金鑰值寫死在程式裡，也不要印出來。
- 後端讀秘密：`GEMINI_API_KEY` 由 `api/_lib/config.ts` 的 `getGeminiApiKey()` 讀 `process.env`；
  其餘後端設定也只在 `api/` 內讀 `process.env`（`api/_lib/config.ts`、`api/_lib/llm.ts`、
  `api/_lib/ratelimit.ts`、`api/finmind.ts`）。
- 前端拿不到後端秘密：`vite.config.ts` 顯式設 `envPrefix: 'VITE_'`、沒有 `define`，只有 `VITE_`
  前綴的變數會被內聯進 bundle；這條由 `utils/viteConfigGuard.test.ts` 鎖住，改 Vite 設定前先讀它。
  前端原始碼讀環境變數的只有 `services/_shared/apiClient.ts`（`VITE_PROXY_SECRET`）。
  - 對證：下面這條只命中 `services/_shared/apiClient.ts`——
    `git grep -n -E 'process\.env|import\.meta' -- App.tsx index.tsx types.ts components/ services/ utils/ config/ ':!*.test.ts'`；
    `git grep -c 'process.env.API_KEY' -- services/ components/ App.tsx` 沒有任何命中。
- 驗證金鑰沒外洩用 `npm run gate` 的金鑰掃描，不要用手動 `grep AIza`（原因見 `CORE_RULES.md`
  「機械驗收 gate」段）。

## Where to Add New Code

- New UI component → `components/<PascalCase>.tsx`, `React.FC<Props>` + default
  export, Tailwind classes, red/green = up/down.
- 新的資料／AI 整合（本點 2026-10-01 核對）→ 前端 `services/<camelCase>.ts`（named exports）
  只打同源的 `/api/*`，請求帶 `services/_shared/apiClient.ts` 的 `proxyHeaders`（現有的 `fetch('/api/…')`
  都這樣帶）。需要金鑰或要打外部服務的部分放後端 `api/<name>.ts`（Vercel 函式，共用模組放
  `api/_lib/`），handler 第一步先過 `api/_lib/guard.ts` 的 `applyGuards`（CORS、來源檢查、
  共享密鑰、限流；現有 5 支 handler 都是）。AI 呼叫沿用 `services/gemini.ts` 的 `callGeminiApi`／
  `callGeminiApiStream`，金鑰只在後端（見 Error Handling 與 Environment & Secrets）。行情備援可參考
  `services/yahoo.ts`：台股日線在 Yahoo 失敗時改抓 FinMind（`fetchFinMindDailyData`）。
- New pure calculation → `utils/<camelCase>.ts`, pure functions over arrays,
  null-padded warm-up, default-param periods.
- New shared type → root `types.ts` (or co-located `export interface` next to
  its sole consumer, as services do for their result types).

---

*Convention analysis: 2026-05-31; re-checked 2026-09-30 (Comments, TypeScript Configuration) and
2026-10-01 (Scope, Linting, Environment & Secrets, and parts of Error Handling / Styling /
Where to Add New Code; second round the same day: the rest of Styling and Error Handling point 2 —
see the header for exact scope)*
