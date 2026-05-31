<!-- GSD:project-start source:PROJECT.md -->

## Project

**Taiwan & USA Stock AI Analyst**

一個給個人投資者使用的台股／美股技術分析工具（繁體中文介面）。使用者搜尋股票後，App 抓取行情、計算技術指標、依朱家泓「六六大順」進場法則做出客觀的 GO/WAIT/NO_GO 判斷，再由 Google Gemini 產生中文分析報告；另含一個可做 AI 健檢的庫存（Portfolio）功能。目前為純前端 React 單頁應用，所有外部呼叫都在瀏覽器端進行、無後端。

**Core Value:** 讓使用者對任一檔台股／美股，得到一個「客觀進場判斷 ＋ AI 中文解讀」的可信分析 —— 而這份分析所依賴的金鑰與資料來源必須是安全、穩定、不會被盜用或竄改的。

### Constraints

- **Security**: `GEMINI_API_KEY` 只能存在於 Vercel 環境變數，絕不可再出現在前端 bundle 或 git — 這是本里程碑的根本目的
- **Tech stack**: 後端採 Vercel Serverless 函式（非自管伺服器），與既有 Vite 靜態站整合 — 部署與維運成本最低
- **Compatibility**: 前端介面與分析行為對使用者維持不變；資料服務層改接後端端點但回傳的領域型別（`StockDataPoint[]` 等）保持相容 — 避免動到圖表、過濾器、提示詞
- **Dependencies**: 行情仍沿用 Yahoo Finance（非官方端點）與 FinMind 免費層，僅改由後端呼叫 — 本次不換供應商
- **Budget**: 盡量落在 Vercel 免費層額度內 — 個人專案

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- TypeScript `~5.8.2` - All application source (`App.tsx`, `components/`, `services/`, `utils/`, `types.ts`)
- TSX/JSX - React components (`jsx: "react-jsx"` in `tsconfig.json`)
- HTML - Single entry document `index.html`
- Markdown - AI prompt template `prompts/持股庫存健檢系統_AI提示詞_adapted.md`
- Batch script - `start-stock-analyst.bat` (Windows launcher that runs `npx vite --port 3000 --host`)

## Runtime

- Node.js (version unpinned - no `.nvmrc` or `engines` field). Required only for the Vite dev/build toolchain. `@types/node` `^22.14.0` is installed, implying a Node 22 target.
- Browser runtime: modern ES2022 browser with native ES module and import-map support. In the deployed `index.html` the app loads its npm dependencies from a CDN import map (`esm.sh`) rather than a bundle.
- npm
- Lockfile: present (`package-lock.json`, ~154 KB)

## Frameworks

- React `^19.2.3` - UI framework (`react`, `react-dom`). Entry mounts via `ReactDOM.createRoot` in `index.tsx` inside `<React.StrictMode>`. App is a single-component state container (`App.tsx`, ~600 lines) with all view state in `useState` hooks; no router (view toggled by `currentView: 'dashboard' | 'portfolio'`).
- None detected. No test runner, no test files, no test script in `package.json`.
- Vite `^6.2.0` - Dev server (port 3000, host `0.0.0.0`) and bundler. Scripts: `dev` (vite), `build` (vite build), `preview` (vite preview).
- `@vitejs/plugin-react` `^5.0.0` - React Fast Refresh / JSX transform for Vite.
- TypeScript `~5.8.2` - Type checking only (`noEmit: true`; transpilation handled by Vite/esbuild). Note: no `typecheck` npm script wired up.

## Key Dependencies

- `@google/genai` `^1.35.0` - Google Gemini SDK (`GoogleGenAI` client). Core AI engine producing stock analysis. Used in `services/gemini.ts`.
- `react` / `react-dom` `^19.2.3` - Application UI.
- `recharts` `^3.6.0` - Charting (price/MA/indicator charts). Used by `components/StockChart.tsx`; data shape = `StockDataPoint` in `types.ts`.
- `lucide-react` `^0.562.0` - Icon set (e.g. `Search`, `Wallet`, `BrainCircuit`, `RefreshCw` imported in `App.tsx`).
- `react-markdown` `^10.1.0` - Renders Gemini's markdown analysis text (`components/AnalysisResult.tsx`).
- `remark-gfm` `^4.0.1` - GitHub-Flavored Markdown plugin for `react-markdown` (tables, etc.).
- Tailwind CSS - Loaded at runtime via CDN `<script src="https://cdn.tailwindcss.com">` in `index.html` (Play CDN, not a build dependency). Inter font loaded from Google Fonts. Dark slate theme set inline.
- `@types/node` `^22.14.0` - Node typings for build config (`vite.config.ts` uses `path`).

## Configuration

- Secrets supplied via a `.env` file (present at repo root; git-ignored). README instructs setting `GEMINI_API_KEY` (it references `.env.local`; runtime loads any env via `loadEnv(mode, '.', '')`).
- `vite.config.ts` injects the key at build time via `define`:
- Path alias: `@` → project root (defined in both `vite.config.ts` and `tsconfig.json` `paths`). Note: actual source imports use relative paths (`./services/...`), not the `@` alias.
- `vite.config.ts` - Vite config (server port/host, env injection, `@` alias).
- `tsconfig.json` - `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `allowImportingTsExtensions`, `noEmit`, `experimentalDecorators`, `isolatedModules`.
- `index.html` - Defines an `importmap` pointing React, `@google/genai`, `recharts`, `lucide-react`, `react-markdown`, `remark-gfm` to `https://esm.sh/...`. References `/index.css` (no such file in repo root - likely generated/absent).
- `metadata.json` - AI Studio app metadata (English name/description mentioning MA/RSI/MACD/KDJ and "Gemini Pro"; `requestFramePermissions: []`).
- Build output: `dist/` directory (present/committed).
- Fast mode: `gemini-3.5-flash`
- Thinking mode: `gemini-3.1-pro-preview`
- Some calls hardcode `gemini-3.5-flash` (e.g. entry/secondary analyses around lines 686, 1017).
- Mode chosen at runtime via `analysisMode: 'fast' | 'thinking'` state in `App.tsx`.

## Platform Requirements

- Node.js + npm installed.
- `GEMINI_API_KEY` configured in `.env`.
- `npm install` then `npm run dev` (or `start-stock-analyst.bat` on Windows, which hardcodes the project path `D:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4`).
- Static build (`vite build` → `dist/`). Project originates from Google AI Studio (README links ai.studio app). Deployable to any static host. Note: runtime depends on third-party CDNs (`esm.sh`, `cdn.tailwindcss.com`, public CORS proxies) being reachable.
- UI language is Traditional Chinese (`<html lang="zh-TW">`, app title "Taiwan Stock AI Analyst"; many in-code comments and the prompt template are in Chinese).

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- React components: **PascalCase** `.tsx`, one component per file —
- Services & utilities: **camelCase** `.ts` — `services/yahoo.ts`,
- Shared types: single root `types.ts`.
- Entry: `index.tsx` mounts root `App.tsx` (both at repo root, no `src/`).
- camelCase throughout. Exported util/service functions are descriptive verbs:
- Internal helpers are also camelCase and often module-private (not exported):
- React event handlers use the `handle*` prefix: `handleRunAnalysis`,
- Boolean locals/derived flags use `is*`/`has*`/`pass*` prefixes:
- Interfaces & type aliases: **PascalCase** — `StockDataPoint`, `StockInfo`,
- String-literal union types are used heavily instead of enums:

## Code Style

- No formatter configured (no `.prettierrc`, `.editorconfig`, no Prettier dep).
- De-facto style observed across all files: 2-space indent, single quotes,
- Bilingual code is the norm: comments and many user-facing strings are in
- No linter configured (no ESLint/Biome dep, no config file). One inline

## TypeScript Configuration

- `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`.
- `jsx: react-jsx` — automatic runtime; `React` import is still written
- `noEmit: true` (Vite/esbuild transpiles); `allowImportingTsExtensions: true`;
- **`strict` is NOT enabled.** Consequence: implicit `any` is allowed and used.

## Import Organization

## Error Handling

- Service functions that require the key throw early:
- Network/parse failures are caught and logged with `console.warn` /
- UI layer catches with `catch (err: any)` and sets an error state string
- Empty `catch {}` blocks with an explanatory comment are an accepted pattern

## Logging

- No logging library — `console.warn` for recoverable issues, `console.error`

## Comments

- No JSDoc/TSDoc convention. Comments are inline `//` (often Chinese),
- Use comments to explain non-obvious financial/domain logic and numeric

## Function & Module Design

- **Exports:** Components use `export default` at end of file plus a
- **Component typing:** `React.FC<Props>` with a dedicated `interface XProps`
- **Hooks:** `useState`/`useEffect`/`useMemo`/`useCallback`/`useRef`. Expensive
- **Pure utils:** `utils/math.ts` functions are pure, take/return number arrays,
- **Domain layering:** indicators (`utils/math.ts`) → data assembly

## Styling

- **Tailwind CSS utility classes** inline in `className` (no CSS modules,
- Icons come from `lucide-react`; charts from `recharts`; AI markdown via

## Environment & Secrets

- `.env` holds `GEMINI_API_KEY` (git-ignored). Build-time injection in

## Where to Add New Code

- New UI component → `components/<PascalCase>.tsx`, `React.FC<Props>` + default
- New data/AI integration → `services/<camelCase>.ts`, named exports,
- New pure calculation → `utils/<camelCase>.ts`, pure functions over arrays,
- New shared type → root `types.ts` (or co-located `export interface` next to

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| App | Root container; owns dashboard state, orchestrates fetch → entry-filter → AI flow, persists portfolio | `App.tsx` |
| Sidebar | Interval picker, indicator-settings toggles, dashboard/portfolio view switch | `components/Sidebar.tsx` |
| StockSearch | Autocomplete search (TW local directory + Yahoo overseas); selecting a symbol triggers fetch | `components/StockSearch.tsx` |
| StockChart | Recharts candlestick/MA/indicator chart from `StockDataPoint[]` and `IndicatorSettings` | `components/StockChart.tsx` |
| EntryChecklist | Renders the six-step `EntryFilterResult` (lights, SOP, precepts, decision) | `components/EntryChecklist.tsx` |
| AnalysisResult | Renders the AI markdown report via `react-markdown` + `remark-gfm` | `components/AnalysisResult.tsx` |
| Portfolio | Holdings table; cost/share editing, AI portfolio health-check, per-trade decision analysis | `components/Portfolio.tsx` |
| yahoo (service) | Fetch + normalize OHLCV from Yahoo (with FinMind fallback/enrichment), compute all indicators | `services/yahoo.ts` |
| stockDirectory (service) | Load/cache TW stock directory (FinMind) + Yahoo overseas search | `services/stockDirectory.ts` |
| gemini (service) | Build prompts + systemInstructions, call Gemini, return markdown text | `services/gemini.ts` |
| entryFilter (util) | Pure "六六大順" long-entry filter producing `EntryFilterResult` | `utils/entryFilter.ts` |
| math (util) | SMA/EMA/RSI/MACD/KDJ/Bollinger indicator calculations | `utils/math.ts` |
| volume (util) | Intraday full-day volume projection | `utils/volume.ts` |
| types | Shared domain interfaces | `types.ts` |

## Pattern Overview

- Centralized dashboard state — all dashboard state lives in `App.tsx`; children are controlled/presentational via props + callbacks. `Portfolio` is an exception that owns its own analysis state and calls services directly.
- Deterministic-then-AI pipeline ("方案C"): `utils/entryFilter.ts` produces an objective GO/WAIT/NO_GO verdict in pure code; `services/gemini.ts` only *interprets* that verdict (the LLM is instructed not to override it).
- Indicators computed once in the data layer (`services/yahoo.ts`) and carried on every `StockDataPoint`; downstream code (filter, charts, prompts) reads precomputed fields rather than recomputing.
- Dual RAW + ADJUSTED indicator sets computed for every series (split/dividend-adjusted variants).
- Client-only / no backend — all HTTP runs in the browser; CORS bypassed via public proxies with rotation + FinMind fallback.
- Persistence via `localStorage` only (portfolio + TW directory cache).
- AI returns markdown prose (not structured JSON); there is no `responseSchema`.

## Layers

- Purpose: Render UI and capture user input.
- Location: `components/`
- Contains: React function components (default-exported), Tailwind utility classes, `recharts`, `lucide-react`, `react-markdown`.
- Depends on: `types.ts`, props/callbacks from `App.tsx`; `Portfolio` also imports services directly.
- Used by: `App.tsx`.
- Purpose: Hold dashboard state, orchestrate the analysis pipeline, persist portfolio.
- Location: `App.tsx`
- Contains: `useState`/`useEffect`/`useMemo` orchestration; `fetchData`, `handleRunAnalysis`, `handleRefreshQuote`, portfolio CRUD handlers.
- Used by: `index.tsx`.
- Purpose: Fetch + normalize external data; produce fully-enriched `StockDataPoint[]`.
- Location: `services/yahoo.ts`, `services/stockDirectory.ts`
- Contains: `getStockData`, `getLatestPrice`, `ensureTaiwanDirectory`, `searchStocks`, `searchYahoo`, FinMind fetchers, proxy rotation.
- Used by: `App.tsx`, `components/Portfolio.tsx`, `components/StockSearch.tsx`.
- Purpose: Deterministic financial calculations and the entry filter.
- Location: `utils/math.ts`, `utils/entryFilter.ts`, `utils/volume.ts`
- Contains: indicator math, `runEntryFilter`, `estimateVolumeTrend`. No I/O.
- Used by: `services/yahoo.ts` (math), `App.tsx` (filter, volume).
- Purpose: Turn data/verdicts into Chinese-language analyst reports.
- Location: `services/gemini.ts`
- Contains: `analyzeEntryWithGemini`, `analyzeStockWithGemini`, `analyzeTradeDecision`, `analyzePortfolioHealth`, prompt/systemInstruction builders.
- Used by: `App.tsx` (entry analysis), `components/Portfolio.tsx` (health check, trade decision).

## Data Flow

### Primary Analysis Path (dashboard)

### Stock Search Flow

### Portfolio Flow

- Dashboard state held in `App.tsx` (`useState`); no global store/context.
- `Portfolio` holds its own local analysis state.
- `localStorage` keys: `portfolio_items`, `tw_stock_directory_v1` (+ `_ts_v1`).
- Module-level caches: `memCache`/`loadingPromise` in `stockDirectory.ts`.

## Key Abstractions

- Purpose: The universal per-bar record carrying OHLCV, RAW + ADJUSTED indicators, MA directions, and TW institutional chips.
- Examples: `types.ts:1`
- Pattern: Computed once in `services/yahoo.ts`; read everywhere else.
- Purpose: Objective machine verdict (trend, six steps, SOP, precepts, decision, entry/stop prices) consumed by both UI and AI.
- Examples: `utils/entryFilter.ts:20`
- Pattern: Pure function output; the AI prompt is built from it verbatim.
- Purpose: Hide Yahoo/FinMind/proxy complexity behind `getStockData`.
- Examples: `services/yahoo.ts:442`

## Entry Points

- Location: `index.html` → `index.tsx`
- Triggers: Page load; mounts `<App />` into `#root` inside `React.StrictMode`.
- Note: `index.html` includes an `importmap` to esm.sh AND a Tailwind CDN script, in addition to the Vite bundle.
- Location: `vite.config.ts`
- Triggers: `npm run dev` / `npm run build`.
- Responsibilities: React plugin; `@` alias to project root; inject `GEMINI_API_KEY` into `process.env.API_KEY` and `process.env.GEMINI_API_KEY`; dev server on port 3000.

## Architectural Constraints

- **Threading:** Single-threaded browser main thread; async via `fetch` promises. No web workers. Heavy indicator math over multi-year series runs synchronously on the main thread.
- **Global state:** Module-level singletons `memCache`/`loadingPromise` in `services/stockDirectory.ts`; per-call `new GoogleGenAI(...)` in `services/gemini.ts` (a fresh client per analysis call, not a singleton).
- **Circular imports:** None observed. `App.tsx` imports `EntryFilterResult`/`VolumeProjection` types from util modules.
- **Client-side secret exposure:** `GEMINI_API_KEY` is inlined into the client bundle by `vite.config.ts` (`define`); it ships to the browser.
- **No backend:** All third-party calls run from the browser and depend on public proxies (`corsproxy.io`, `api.allorigins.win`) or direct FinMind calls.
- **Two model-config worlds:** `services/gemini.ts` references model names like `gemini-3.5-flash` / `gemini-3.1-pro-preview` and `thinkingConfig`; verify these against the installed `@google/genai` SDK before relying on them.

## Anti-Patterns

### Monolithic state container

### Client-side API key injection

### Public CORS proxy dependency

### Duplicated prompt-formatting logic

### Inconsistent fast/thinking model handling

## Error Handling

- Yahoo: proxy rotation with 429 detection, content-type check, and Yahoo `chart.error` mapping; on TW daily failure, falls back to FinMind (`services/yahoo.ts:272`, `:477`).
- Directory/search failures swallowed and return `[]` (`services/stockDirectory.ts:62`, `:113`).
- Gemini failures: `console.error` then throw a generic message; `App.handleRunAnalysis` shows a markdown error block, distinguishing missing API key (`App.tsx:153`).
- `localStorage` parse failures caught in the `useState` initializer (`App.tsx:54`).

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| trend-analysis | 朱家泓進場分析【步驟1/7：趨勢研判】。判定個股目前為多頭(頭頭高底底高)、空頭(頭頭低底底低)或盤整，並比對日線與週線。當使用者要分析股票進場、做多、技術面，或說「分析 XXXX」「XXXX 能不能買」時，這是第一個要跑的 skill。 | `.claude/skills/trend-analysis/SKILL.md` |
| position-analysis | 朱家泓進場分析【步驟2/7：當下位置】。在多頭趨勢中定位股價屬於打底/初升段/主升段/末升段、起漲/上漲中/高檔/回檔/遇壓/遇支撐，評估是否為良好進場位置或追高風險。接在 trend-analysis 之後執行。 | `.claude/skills/position-analysis/SKILL.md` |
| kline-signal | 朱家泓進場分析【步驟3/7：K線轉折】。判讀單一K棒(長紅/長黑/十字/槌子)與組合K棒(晨星/夜星/上升三法/一星二陽/吞噬/變盤線)，並檢查是否出現多頭關鍵進場K線(價漲>2%、量增>昨1.3倍、中長紅實體、突破5均及前一日高點)。接在 position-analysis 之後執行。 | `.claude/skills/kline-signal/SKILL.md` |
| ma-structure | 朱家泓進場分析【步驟4/7：均線架構】。檢查均線是否至少3線多排(MA5>MA10>MA20)、方向向上、股價是否站上月線MA20，並偵測均線糾結突破與扣抵方向。接在 kline-signal 之後執行。 | `.claude/skills/ma-structure/SKILL.md` |
| volume-analysis | 朱家泓進場分析【步驟5/7：量價關係】。檢查價漲量增/價跌量縮、是否出現攻擊量(>昨1.3倍)、辨識起漲量/換手量/出貨量/高檔爆量，並偵測量價背離。進場必須有攻擊量配合。接在 ma-structure 之後執行。 | `.claude/skills/volume-analysis/SKILL.md` |
| indicator-analysis | 朱家泓進場分析【步驟6/7：指標】。檢查KD黃金交叉且多排向上(非高檔鈍化)、MACD紅柱延長/綠柱縮短與背離，並加分判斷向上跳空缺口、底部型態。接在 volume-analysis 之後執行。 | `.claude/skills/indicator-analysis/SKILL.md` |
| entry-decision | 朱家泓進場分析【步驟7/7：進場決策彙總】。彙總趨勢/位置/K線/均線/量價/指標6步驟結果，比對選股SOP 6項必要條件、判斷進場口訣(回後買上漲/盤整突破)、逐條檢核做多10大戒律，輸出「進場 GO/等待/NO-GO」與建議進場價、停損(進場價-5%)、停利規則、信心評分。這是整套做多進場分析的總入口與最終結論。當使用者要「完整分析某股能不能進場做多」時可直接從這裡啟動，依序帶完步驟1-6再彙總。 | `.claude/skills/entry-decision/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
