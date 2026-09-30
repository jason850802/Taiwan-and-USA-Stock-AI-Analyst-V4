<!-- refreshed: 2026-05-31; partial re-check 2026-10-01 -->
# Architecture

**Analysis Date:** 2026-05-31（2026-10-01 部分核對）

> **本檔整體仍是 2026-05-31 的「純前端、無後端」架構，大部分已過時。** 2026-10-01 只修了說金鑰或
> Gemini 型號在前端的敘述（金鑰紅線；`CORE_RULES.md` 的 Constraints 與「本專案關鍵事實」）：
> Entry Points 的 Vite 一點；Architectural Constraints 的 Global state、Client-side secret exposure、
> No backend、Two model-config worlds 四點；Anti-Patterns 的「Client-side API key injection」與
> 「Inconsistent fast/thinking model handling」兩節；Error Handling 的 Gemini 一點；Cross-Cutting 的
> Authentication。其餘段落讀的時候以下列現況為準：
> - **有後端**：前端只打同源 `/api/*`，由 `api/` 的 Vercel Serverless 函式代打 Gemini、Yahoo（2026-07-05，
>   Phase 01／02）與 FinMind（2026-07-09，Phase 03）。所以圖中 AI Layer 直連 Gemini、Data Layer
>   「via corsproxy.io / allorigins」、Pattern Overview 的「Client-only / no backend」、各處的「proxy rotation」
>   都已不成立。外部整合的現況見 `INTEGRATIONS.md`（2026-10-01 重寫）。
> - **沒有 esm.sh importmap、沒有 Tailwind CDN**（2026-07-13 `e6e4140`、`24a8135` 移除）：圖頂的
>   「Tailwind CDN」與 Entry Points 的 Note 已過時。
> - **元件與目錄大幅重整**：Portfolio 拆出 `components/portfolio/`、新增基本面分頁（`components/fundamentals/`，
>   `currentView` 多了 `'fundamentals'`）、共用 UI 在 `components/ui/`；`analyzeStockWithGemini` 已刪
>   （2026-07-12 `7bc35f1`）。本檔的檔案行號引用多半失準；目錄現況見 `STRUCTURE.md`（2026-10-01 重寫）。

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                    Presentation Layer (React 19 + Tailwind CDN)       │
├──────────────┬──────────────┬──────────────┬───────────────────────┤
│  Sidebar     │ StockSearch  │ StockChart   │ Portfolio              │
│ `components/ │ `components/ │ `components/ │ `components/           │
│  Sidebar.tsx`│ StockSearch  │ StockChart   │ Portfolio.tsx`         │
│              │ .tsx`        │ .tsx`        │                        │
│ EntryChecklist  AnalysisResult                                       │
│ `components/EntryChecklist.tsx` `components/AnalysisResult.tsx`      │
└──────┬───────────────────────────────────────────────┬─────────────┘
       │                                                │
       ▼                                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Container / Orchestration: `App.tsx`                     │
│  Owns all dashboard state; runs the fetch → filter → AI pipeline;     │
│  persists portfolio to localStorage                                   │
└──────┬──────────────────────┬───────────────────────┬───────────────┘
       │                      │                        │
       ▼                      ▼                        ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐
│  Data Layer      │ │  Compute Layer   │ │   AI Layer               │
│ `services/       │ │ `utils/math.ts`  │ │ `services/gemini.ts`     │
│  yahoo.ts`       │ │ `utils/          │ │  (prompt building +      │
│ `services/       │ │  entryFilter.ts` │ │   systemInstruction)     │
│  stockDirectory  │ │ `utils/volume.ts`│ │                          │
│  .ts`            │ │                  │ │                          │
└────────┬─────────┘ └──────────────────┘ └────────────┬─────────────┘
         │                                              │
         ▼                                              ▼
┌──────────────────────────────────┐   ┌──────────────────────────────┐
│  External: Yahoo Finance chart    │   │  External: Google Gemini API  │
│  + Yahoo search + FinMind         │   │  (`@google/genai`)            │
│  (via corsproxy.io / allorigins)  │   │                               │
└──────────────────────────────────┘   └──────────────────────────────┘

           Browser localStorage  ◄──── Portfolio + TW stock directory cache
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

**Overall:** Single-page application with a single smart container (`App.tsx`) plus a self-contained `Portfolio` feature component. Layered separation: presentation → data services → pure compute utilities → AI service.

**Key Characteristics:**
- Centralized dashboard state — all dashboard state lives in `App.tsx`; children are controlled/presentational via props + callbacks. `Portfolio` is an exception that owns its own analysis state and calls services directly.
- Deterministic-then-AI pipeline ("方案C"): `utils/entryFilter.ts` produces an objective GO/WAIT/NO_GO verdict in pure code; `services/gemini.ts` only *interprets* that verdict (the LLM is instructed not to override it).
- Indicators computed once in the data layer (`services/yahoo.ts`) and carried on every `StockDataPoint`; downstream code (filter, charts, prompts) reads precomputed fields rather than recomputing.
- Dual RAW + ADJUSTED indicator sets computed for every series (split/dividend-adjusted variants).
- Client-only / no backend — all HTTP runs in the browser; CORS bypassed via public proxies with rotation + FinMind fallback.
- Persistence via `localStorage` only (portfolio + TW directory cache).
- AI returns markdown prose (not structured JSON); there is no `responseSchema`.

## Layers

**Presentation Layer:**
- Purpose: Render UI and capture user input.
- Location: `components/`
- Contains: React function components (default-exported), Tailwind utility classes, `recharts`, `lucide-react`, `react-markdown`.
- Depends on: `types.ts`, props/callbacks from `App.tsx`; `Portfolio` also imports services directly.
- Used by: `App.tsx`.

**Container Layer:**
- Purpose: Hold dashboard state, orchestrate the analysis pipeline, persist portfolio.
- Location: `App.tsx`
- Contains: `useState`/`useEffect`/`useMemo` orchestration; `fetchData`, `handleRunAnalysis`, `handleRefreshQuote`, portfolio CRUD handlers.
- Used by: `index.tsx`.

**Data / Service Layer:**
- Purpose: Fetch + normalize external data; produce fully-enriched `StockDataPoint[]`.
- Location: `services/yahoo.ts`, `services/stockDirectory.ts`
- Contains: `getStockData`, `getLatestPrice`, `ensureTaiwanDirectory`, `searchStocks`, `searchYahoo`, FinMind fetchers, proxy rotation.
- Used by: `App.tsx`, `components/Portfolio.tsx`, `components/StockSearch.tsx`.

**Compute Layer (pure):**
- Purpose: Deterministic financial calculations and the entry filter.
- Location: `utils/math.ts`, `utils/entryFilter.ts`, `utils/volume.ts`
- Contains: indicator math, `runEntryFilter`, `estimateVolumeTrend`. No I/O.
- Used by: `services/yahoo.ts` (math), `App.tsx` (filter, volume).

**AI Layer:**
- Purpose: Turn data/verdicts into Chinese-language analyst reports.
- Location: `services/gemini.ts`
- Contains: `analyzeEntryWithGemini`, `analyzeStockWithGemini`, `analyzeTradeDecision`, `analyzePortfolioHealth`, prompt/systemInstruction builders.
- Used by: `App.tsx` (entry analysis), `components/Portfolio.tsx` (health check, trade decision).

## Data Flow

### Primary Analysis Path (dashboard)

1. User selects/searches a symbol; `StockSearch.onSelect` → `App` sets `symbol` and calls `fetchData` (`App.tsx:300`).
2. `fetchData` calls `getStockData(sym, interval)` (`App.tsx:102`).
3. `services/yahoo.ts:getStockData` fetches via proxy-rotated Yahoo (FinMind fallback for TW daily), aggregates weekly/monthly, shifts intraday timestamps, enriches TW chips/volume from FinMind, and computes all indicators via `utils/math.ts` (`services/yahoo.ts:442`).
4. `App` stores `data` + `info`; user opens the AI modal and confirms holding/cost/mode (`App.tsx:120`).
5. `handleRunAnalysis` optionally fetches weekly data, runs `runEntryFilter(sym, data, weeklyData)` to get the objective verdict (`App.tsx:144`, `utils/entryFilter.ts:85`).
6. `EntryChecklist` renders the verdict; `analyzeEntryWithGemini(filter, userPosition, mode)` produces the markdown report (`App.tsx:151`, `services/gemini.ts:241`).
7. `AnalysisResult` renders the markdown (`App.tsx:392`).

### Stock Search Flow

1. `StockSearch` ensures the TW directory is loaded (`services/stockDirectory.ts:ensureTaiwanDirectory`, memory → localStorage → FinMind).
2. Queries run through `searchStocks`: local TW substring match, plus Yahoo overseas search for Latin/code queries (`services/stockDirectory.ts:119`).

### Portfolio Flow

1. On mount `App` reads `portfolio_items` from `localStorage`; a `useEffect` writes back on every change (`App.tsx:54`, `App.tsx:63`).
2. `Portfolio` edits items with cross-field cost/share syncing (TWD vs USD) (`App.tsx:75`).
3. `Portfolio` fetches live data and calls `analyzePortfolioHealth` / `analyzeTradeDecision` directly (`services/gemini.ts:825`, `:316`).

**State Management:**
- Dashboard state held in `App.tsx` (`useState`); no global store/context.
- `Portfolio` holds its own local analysis state.
- `localStorage` keys: `portfolio_items`, `tw_stock_directory_v1` (+ `_ts_v1`).
- Module-level caches: `memCache`/`loadingPromise` in `stockDirectory.ts`.

## Key Abstractions

**StockDataPoint:**
- Purpose: The universal per-bar record carrying OHLCV, RAW + ADJUSTED indicators, MA directions, and TW institutional chips.
- Examples: `types.ts:1`
- Pattern: Computed once in `services/yahoo.ts`; read everywhere else.

**EntryFilterResult:**
- Purpose: Objective machine verdict (trend, six steps, SOP, precepts, decision, entry/stop prices) consumed by both UI and AI.
- Examples: `utils/entryFilter.ts:20`
- Pattern: Pure function output; the AI prompt is built from it verbatim.

**Service facade for data:**
- Purpose: Hide Yahoo/FinMind/proxy complexity behind `getStockData`.
- Examples: `services/yahoo.ts:442`

## Entry Points

**Browser bootstrap:**
- Location: `index.html` → `index.tsx`
- Triggers: Page load; mounts `<App />` into `#root` inside `React.StrictMode`.
- Note: `index.html` includes an `importmap` to esm.sh AND a Tailwind CDN script, in addition to the Vite bundle.

**Vite dev/build:**
- Location: `vite.config.ts`
- Triggers: `npm run dev` / `npm run build`.
- Responsibilities（2026-10-01 核對）: React plugin; `@` alias to project root; dev server on port 3000，`/api` 由 `server.proxy` 轉給 `http://localhost:3001`（本機 `vercel dev`）；`envPrefix: 'VITE_'`、**沒有 `define`**——只有 `VITE_` 前綴的變數會進 bundle，`GEMINI_API_KEY` 進不去（`utils/viteConfigGuard.test.ts` 鎖住）；vitest 的 `test` 區塊；`manualChunks` 把 React 分到 `vendor` chunk。舊版寫的「inject `GEMINI_API_KEY` into `process.env.API_KEY` and `process.env.GEMINI_API_KEY`」已於 2026-07-05 `0d2800e` 移除。

## Architectural Constraints

- **Threading:** Single-threaded browser main thread; async via `fetch` promises. No web workers. Heavy indicator math over multi-year series runs synchronously on the main thread.
- **Global state:** Module-level singletons `memCache`/`loadingPromise` in `services/stockDirectory.ts`（`:21-22`）。`new GoogleGenAI(...)` 只在後端 `api/_lib/http.ts` 的 `callGeminiWithTimeout`（每次呼叫建一個 client、不是 singleton）；前端 `services/gemini.ts` 不含 SDK（2026-10-01 核對：`git grep -n -E '@google/genai|GoogleGenAI' -- '*.ts' ':!*.test.ts'` 只命中 `api/_lib/http.ts`）。
- **Circular imports:** None observed. `App.tsx` imports `EntryFilterResult`/`VolumeProjection` types from util modules.
- **金鑰只在後端**（2026-10-01 核對；舊版此點為「Client-side secret exposure」）：`GEMINI_API_KEY` 由 `api/_lib/config.ts` 的 `getGeminiApiKey()` 讀；前端經 `services/gemini.ts` 的 `callGeminiApi`／`callGeminiApiStream` 打 `/api/gemini`、`/api/gemini-stream`（2026-07-05 `0d2800e` 起）。對證：`git grep -c 'process.env.API_KEY' -- services/ components/ App.tsx` 無命中。
- **有後端**（2026-10-01 核對；舊版此點為「No backend」）：第三方呼叫全經 `api/` 的 Serverless 函式——Gemini、Yahoo（2026-07-05）、FinMind（2026-07-09 `07ec1f7`）；前端原始碼沒有外部網址（`git grep -n -E 'https?://' -- App.tsx index.tsx components/ services/ utils/ config/ ':!*.test.ts' ':!*.snap'` 無命中）。
- **型號只在後端**（2026-10-01 核對；舊版此點為「Two model-config worlds」）：`api/_lib/config.ts` 的 `getModelForMode` 依 `mode` 取 `GEMINI_MODEL_FAST`／`GEMINI_MODEL_THINKING`（fallback `gemini-3.5-flash`／`gemini-3.1-pro-preview`）；前端 payload 只帶 `mode`（多數呼叫另帶 `thinkingConfig`），沒有型號字串。改型號的規則見 `CORE_RULES.md`「本專案關鍵事實」。

## Anti-Patterns

### Monolithic state container

**What happens:** All dashboard state (symbol, data, info, analysis, entryResult, modal flags, indicator settings, portfolio) lives in `App.tsx` (`App.tsx:17`–`61`).
**Why it's wrong:** Any state change re-renders the whole dashboard tree; the component is hard to test and grows unbounded.
**Do this instead:** Extract `useStockAnalysis` (fetch + filter + AI) and `usePortfolio` (localStorage CRUD) hooks; keep `App.tsx` as composition.

### Client-side API key injection（已解決，2026-07-05）

**原問題：** `vite.config.ts` 以 `define` 把 `GEMINI_API_KEY` 內聯進 bundle，`services/gemini.ts` 在瀏覽器讀 `process.env.API_KEY`——金鑰隨公開 JS 外流。
**現況（2026-10-01 核對）：** Phase 01 的 `0d2800e`（2026-07-05）移除 `define`、前端改打 `/api/gemini`，金鑰只由後端 `api/_lib/config.ts` 讀；`dab7508`（2026-07-26）再把 `envPrefix: 'VITE_'` 顯式化，由 `utils/viteConfigGuard.test.ts` 鎖住（gate-audit G3）。金鑰外洩由 `npm run gate` 第 4 道掃描。見上方 Architectural Constraints 的「金鑰只在後端」。

### Public CORS proxy dependency

**What happens:** `services/yahoo.ts:7` and `services/stockDirectory.ts:16` route requests through `corsproxy.io` / `allorigins`.
**Why it's wrong:** Third-party proxies are rate-limited single points of failure and a privacy/integrity risk.
**Do this instead:** Use a first-party backend proxy or an official CORS-enabled data API.

### Duplicated prompt-formatting logic

**What happens:** `formatPromptData`, `analyzeTradeDecision`, and `formatHealthCheckData` in `services/gemini.ts` each re-implement very similar K-line/indicator/volume string formatting (~1030 lines total).
**Why it's wrong:** Changes to formatting must be made in several places; high drift risk.
**Do this instead:** Extract shared formatters into a `prompts/` module and reuse.

### Inconsistent fast/thinking model handling（已解決，2026-06-12／07-05）

**原問題：** 部分呼叫在前端寫死 `gemini-3.5-flash`、其他依 `mode` 切換；`App.tsx` 引用 Vite 設定沒有定義的 `REACT_APP_GEMINI_API_KEY`。
**現況（2026-10-01 核對）：** `REACT_APP_GEMINI_API_KEY` 那段錯誤訊息已於 2026-06-12 `1a7dd92` 移除（`git grep -n 'REACT_APP_' -- '*.ts' '*.tsx'` 無命中）；型號選擇於 2026-07-05 `0d2800e` 移到後端，集中在 `api/_lib/config.ts` 的 `getModelForMode`，金鑰變數只有後端的 `GEMINI_API_KEY`。前端仍有三支分析固定送 `mode: 'fast'`（`analyzeTradeDecision`、`analyzePortfolioHealth`、`analyzeFundamentals`），只有 `analyzeEntryWithGemini` 依使用者選的模式——這是送出的模式固定，不是寫死型號。

## Error Handling

**Strategy:** Services throw localized (often Traditional Chinese) `Error`s; callers `try/catch` and surface `err.message` to UI state. Non-critical lookups degrade silently.

**Patterns:**
- Yahoo: proxy rotation with 429 detection, content-type check, and Yahoo `chart.error` mapping; on TW daily failure, falls back to FinMind (`services/yahoo.ts:272`, `:477`).
- Directory/search failures swallowed and return `[]` (`services/stockDirectory.ts:62`, `:113`).
- Gemini failures（2026-10-01 核對）：後端把錯誤分類成 `ClassifiedError`（`api/_lib/http.ts`；`MODEL_NOT_FOUND`、`RATE_LIMITED`、`UPSTREAM_ERROR`、`BAD_REQUEST`、`MISSING_KEY`、`CANCELLED`），handler 依代碼回 HTTP 狀態（404／429／502／400／500；`CANCELLED` 對應的 499 只為型別完整，實際不寫回應）與中文訊息；前端 `callGeminiApi`／`callGeminiApiStream` 收到非 2xx 丟 `DataFetchError`、訊息沿用後端的 `message`；`App.tsx` 的 `handleRunAnalysis` 把 `err.message` 顯示在報告區。缺金鑰是後端的 `MISSING_KEY`（500），前端不再自己檢查金鑰（舊版寫的「distinguishing missing API key」已不存在）。
- `localStorage` parse failures caught in the `useState` initializer (`App.tsx:54`).

## Cross-Cutting Concerns

**Logging:** `console.warn`/`console.error`/`console.log` only; no structured logging.
**Validation:** Empty-data guards (`data.length === 0`); ticker normalization + TW/US detection via regex (`services/yahoo.ts:342`, `App.tsx:178`). No schema validation of AI output (free-form markdown).
**Authentication（2026-10-01 核對）:** 使用者沒有帳號登入。`GEMINI_API_KEY` 只在後端；`/api/*` 每支 handler 先過 `api/_lib/guard.ts` 的 `applyGuards`（CORS 與來源白名單、`X-Proxy-Secret` 共享密鑰、Upstash 限流）。FinMind 由後端附上選填的 `FINMIND_TOKEN`；Yahoo 無金鑰，由後端做 cookie／crumb 握手（`api/_lib/yahoo.ts`）。
**Domain knowledge:** The "朱家泓 × 林穎" trading methodology is encoded both in `utils/entryFilter.ts` (deterministic) and in `services/gemini.ts` system prompts, and additionally in user-authored Claude skills under `.claude/skills/` (separate from the runtime app).

---

*Architecture analysis: 2026-05-31*
*Partial re-check 2026-10-01：只修金鑰／Gemini 型號在前端的敘述，並在檔頭列出其餘段落已知過時處（範圍見檔頭）*
