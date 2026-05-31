<!-- refreshed: 2026-05-31 -->
# Architecture

**Analysis Date:** 2026-05-31

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

**What happens:** All dashboard state (symbol, data, info, analysis, entryResult, modal flags, indicator settings, portfolio) lives in `App.tsx` (`App.tsx:17`–`61`).
**Why it's wrong:** Any state change re-renders the whole dashboard tree; the component is hard to test and grows unbounded.
**Do this instead:** Extract `useStockAnalysis` (fetch + filter + AI) and `usePortfolio` (localStorage CRUD) hooks; keep `App.tsx` as composition.

### Client-side API key injection

**What happens:** `vite.config.ts:13` inlines `GEMINI_API_KEY`; `services/gemini.ts` reads `process.env.API_KEY` in-browser.
**Why it's wrong:** The key ships in public JS and can be extracted and abused.
**Do this instead:** Proxy Gemini calls through a server-side function holding the key.

### Public CORS proxy dependency

**What happens:** `services/yahoo.ts:7` and `services/stockDirectory.ts:16` route requests through `corsproxy.io` / `allorigins`.
**Why it's wrong:** Third-party proxies are rate-limited single points of failure and a privacy/integrity risk.
**Do this instead:** Use a first-party backend proxy or an official CORS-enabled data API.

### Duplicated prompt-formatting logic

**What happens:** `formatPromptData`, `analyzeTradeDecision`, and `formatHealthCheckData` in `services/gemini.ts` each re-implement very similar K-line/indicator/volume string formatting (~1030 lines total).
**Why it's wrong:** Changes to formatting must be made in several places; high drift risk.
**Do this instead:** Extract shared formatters into a `prompts/` module and reuse.

### Inconsistent fast/thinking model handling

**What happens:** Some calls hard-code `gemini-3.5-flash` (`services/gemini.ts:687`) while others switch on `mode`; `App.tsx:155` references a `REACT_APP_GEMINI_API_KEY` env var that the Vite config does not define.
**Why it's wrong:** Confusing, mismatched configuration paths.
**Do this instead:** Centralize model selection and the env-var name.

## Error Handling

**Strategy:** Services throw localized (often Traditional Chinese) `Error`s; callers `try/catch` and surface `err.message` to UI state. Non-critical lookups degrade silently.

**Patterns:**
- Yahoo: proxy rotation with 429 detection, content-type check, and Yahoo `chart.error` mapping; on TW daily failure, falls back to FinMind (`services/yahoo.ts:272`, `:477`).
- Directory/search failures swallowed and return `[]` (`services/stockDirectory.ts:62`, `:113`).
- Gemini failures: `console.error` then throw a generic message; `App.handleRunAnalysis` shows a markdown error block, distinguishing missing API key (`App.tsx:153`).
- `localStorage` parse failures caught in the `useState` initializer (`App.tsx:54`).

## Cross-Cutting Concerns

**Logging:** `console.warn`/`console.error`/`console.log` only; no structured logging.
**Validation:** Empty-data guards (`data.length === 0`); ticker normalization + TW/US detection via regex (`services/yahoo.ts:342`, `App.tsx:178`). No schema validation of AI output (free-form markdown).
**Authentication:** None for users. Gemini API key only (client-exposed). FinMind/Yahoo accessed unauthenticated.
**Domain knowledge:** The "朱家泓 × 林穎" trading methodology is encoded both in `utils/entryFilter.ts` (deterministic) and in `services/gemini.ts` system prompts, and additionally in user-authored Claude skills under `.claude/skills/` (separate from the runtime app).

---

*Architecture analysis: 2026-05-31*
