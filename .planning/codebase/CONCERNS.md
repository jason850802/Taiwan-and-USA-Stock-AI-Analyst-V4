# Codebase Concerns

**Analysis Date:** 2026-05-31

> Scope: application source only — `App.tsx`, `components/`, `services/`, `utils/`, `prompts/`, `types.ts`, `vite.config.ts`, `index.tsx`. GSD tooling under `.claude/get-shit-done/` is excluded.

---

## Security Considerations

### Gemini API key is inlined into the client bundle (CRITICAL)

- **Risk:** The Gemini key is substituted into the compiled JavaScript at build time and runs directly in the browser. Anyone who loads a deployed build can read the key from the JS bundle or the network tab and spend against your Google billing account.
- **Files:**
  - `vite.config.ts` (lines 8-11) — `define: { 'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY), 'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY) }`. `vite define` is a literal text replacement, so the raw key string is embedded in the output.
  - `services/gemini.ts` — every export (`analyzeStockWithGemini` L152, `analyzeEntryWithGemini` L249, `analyzeTradeDecision` L328, `analyzePortfolioHealth` L832) constructs `new GoogleGenAI({ apiKey: process.env.API_KEY })` and calls Gemini from the client.
- **Current mitigation:** `.env` and `.env.*` are correctly in `.gitignore` (lines 26-29) and are NOT tracked by git (verified: `git ls-files` returns nothing for env files). This protects the repo history but does NOT protect a hosted build — the key is still public to every end user.
- **Recommendations (priority order):**
  1. Move all Gemini calls behind a server-side proxy / serverless function; the browser calls your endpoint, never Google directly.
  2. Until then, treat the key as exposed the moment a build is hosted publicly. In Google Cloud apply HTTP-referrer restrictions + a per-day quota cap to bound the blast radius.
  3. Rotate the key once the proxy is in place.

### Third-party CORS proxies sit in every market-data request path

- **Risk:** All Yahoo requests are routed through `corsproxy.io` (primary) or `api.allorigins.win` (fallback) — uncontrolled third parties that can observe every request, rate-limit, go down, or in principle tamper with the JSON the analysis is built on. This is both a privacy and a financial-data-integrity risk.
- **Files:** `services/yahoo.ts` (lines 7-10 `PROXIES`, used in `queryYahoo` L272-334); `services/stockDirectory.ts` (line 16 `PROXIES`, used in `searchYahoo` L91-116).
- **Current mitigation:** Two-proxy rotation with 429 detection and JSON content-type validation (`services/yahoo.ts` L288-303) — improves availability but does nothing for trust/tamper risk.
- **Note:** FinMind (`api.finmindtrade.com`) is called **directly without a proxy** (`services/yahoo.ts` L198, L211, L226, L248; `services/stockDirectory.ts` L41), so it relies on FinMind's CORS headers and can break independently.
- **Recommendation:** Proxy Yahoo (and ideally FinMind) through your own server-side function, removing the public CORS proxies from the client.

### No validation of AI-controlled or external JSON before use

- **Risk:** Responses from Gemini and from Yahoo/FinMind are consumed with minimal/no runtime schema validation. Untyped payloads (`as any`) flow into indicator math, the prompt, the chart, and `localStorage`.
- **Files:**
  - `services/gemini.ts` — return values are used as plain markdown (lower risk, since output is rendered, not parsed), but `analyzePortfolioHealth` extracts a decision via a brittle regex on free-text model output (`components/Portfolio.tsx` L782); a wording change silently degrades to `'分析完成'`.
  - `services/yahoo.ts` (L373-421 `processYahooResult`, L614-625) and `services/stockDirectory.ts` (L99-112) cast external payloads with `any` and index fields without shape validation.
- **Recommendation:** Add response-shape validation (zod or manual guards) for Yahoo/FinMind payloads so a changed API fails loudly instead of feeding bad numbers into indicators.

---

## Data Accuracy / Financial-Risk Concerns

### Unofficial, unstable Yahoo Finance endpoints

- **Problem:** Depends on undocumented Yahoo endpoints (`query2.finance.yahoo.com/v8/finance/chart`, `query1.finance.yahoo.com/v1/finance/search`). These are not a supported API; they change shape, add crumb/cookie challenges, and rate-limit without notice. A silent change can corrupt every analysis input.
- **Files:** `services/yahoo.ts` (line 13 `YAHOO_BASE`), `services/stockDirectory.ts` (line 94).
- **Improvement path:** Add response-shape validation and consider a licensed market-data provider for production.

### `gemini.ts` and `entryFilter.ts` use different volume-ratio baselines (inconsistent verdicts)

- **Problem:** Two parallel analysis layers can disagree.
  - `entryFilter.ts` computes the attack-volume check as `last.volume / prev.volume >= 1.3` using raw daily bars (`utils/entryFilter.ts` L98-99), and step 5 references "量5MA" in text but never computes a 5-day average.
  - `gemini.ts` `formatPromptData` uses the same single-day `volume / prev.volume` ratio (L25) but can override it with the intraday projection (L106-110).
  - The Chu Chia-hung rules embedded in the prompts define 基本量 = 5-day average (`services/gemini.ts` L447), which neither code path actually implements.
- **Impact:** The deterministic checklist (`EntryChecklist`) and the AI report can present different volume verdicts for the same stock; neither matches the stated "5-day basic volume" rule.
- **Files:** `utils/entryFilter.ts` L98-99, L187-201; `services/gemini.ts` L25, L106-110.
- **Fix approach:** Centralize one volume-ratio definition (ideally vs 5-day average) and feed the same computed value to both the filter and the prompt.

### Indaday volume projection can produce large errors

- **Problem:** `estimateVolumeTrend` divides current volume by a hardcoded time-of-day weight curve (`utils/volume.ts` L42-63, L97). Early in the session (just past the 5-minute guard) the weight is tiny, so `projectedVolume = volume / weight` can be wildly inflated, and this projected figure is what drives the "攻擊量(依預估量)" verdict shown to the user and sent to the AI.
- **Files:** `utils/volume.ts` L84-98; consumed in `services/gemini.ts` L106-110 and `App.tsx` L182, L348-356.
- **Impact:** Over-stated projected volume can flip the volume signal to PASS near the open.
- **Fix approach:** Widen the early-session insufficient-data guard, or cap/flag projections when elapsed time is small.

### `currentPrice` / `regularMarketPrice` fallback may be undefined

- **Problem:** `getLatestPrice` falls back to `meta.regularMarketPrice` when no valid closes exist (`services/yahoo.ts` L429); for delisted/illiquid symbols this can be `undefined`/`NaN` and is then stored as a portfolio price and used in P/L math.
- **Files:** `services/yahoo.ts` L423-440; consumed in `components/Portfolio.tsx` `fetchPrice` L586-594.
- **Fix approach:** Validate the price is a finite number > 0 before treating the fetch as successful.

### LLM emits actionable BUY/SELL/停損/停利 levels

- **Problem:** The prompts ask the model to output concrete entry/stop/take-profit levels and operation decisions (`services/gemini.ts` prompt sections, e.g. L196-202, L539-563, L644-682). `entryFilter.ts` also outputs a hard `entryPrice`/`stopPrice` (`utils/entryFilter.ts` L263-264).
- **Mitigation present:** `EntryChecklist` shows a disclaimer ("※ 技術面教學框架推演，非投資建議", `components/EntryChecklist.tsx` L105) and the entry prompt requires a one-line disclaimer (`services/gemini.ts` L298). The free-form `AnalysisResult` report and the trade/health reports have **no enforced UI disclaimer**.
- **Recommendation:** Render a persistent "not financial advice" banner around `AnalysisResult` and the portfolio trade/health modals, not only inside the checklist.

---

## Error Handling

### Original errors are flattened to generic strings, losing failure category

- **Issue:** Service `catch` blocks log to console then throw generic messages, so the caller cannot distinguish rate-limit vs auth-failure vs bad-ticker vs proxy-outage.
- **Files:** `services/gemini.ts` L230-233, L310-313, L696-699 (`"Failed to analyze..."`); `services/yahoo.ts` L497 (`Data Fetch Failed`), and the search/FinMind helpers swallow errors to `console.warn` and return `[]` (L201-204, L214-217, L231-233, L113).
- **Impact:** In `App.tsx`/`Portfolio.tsx` the only branch that inspects the message is the `"API Key is missing"` check (`App.tsx` L154); everything else collapses to "Analysis Failed" / "讀取失敗", making production support hard.
- **Fix approach:** Normalize errors into categories (HTTP status, parse failure, empty result, model-not-found) and map them to specific, actionable user messages.

### Silent empty-array fallbacks hide partial-data analysis

- **Issue:** FinMind chip/price/name helpers and Yahoo search return `[]`/`null` on failure (`services/yahoo.ts` L201-204, L214-217, L235; `services/stockDirectory.ts` L113). Analysis then proceeds with foreign/trust = 0 and possibly stale names, with no indication to the user that chip data was missing.
- **Impact:** The AI receives "Foreign: 0 / Trust: 0" that is indistinguishable from a real zero, biasing chip analysis.
- **Fix approach:** Track and surface a "chip data unavailable" state distinct from a true zero.

### No React error boundary

- **Issue:** No `ErrorBoundary`/`componentDidCatch` anywhere; `index.tsx` mounts `<App/>` directly. A render-time throw (e.g. a malformed data point reaching the chart, or `.toFixed` on an undefined field) blanks the whole app.
- **Files:** gap; `index.tsx`, `App.tsx`.
- **Fix approach:** Wrap the app (or at least the chart + analysis panels) in an error boundary with a recoverable fallback.

### Persisted portfolio is parsed without schema validation

- **Issue:** `JSON.parse(localStorage 'portfolio_items')` is try/caught only for parse errors (`App.tsx` L54-61); individual items are never validated against `PortfolioItem`. A schema change or corrupt entry can throw later inside `Portfolio.tsx` math (e.g. `item.totalShares` undefined) rather than at load.
- **Files:** `App.tsx` L54-65; `types.ts` L99-112.
- **Fix approach:** Validate/normalize each parsed item; drop or repair invalid entries and notify the user.

---

## Tech Debt

### Two overlapping AI analysis paths; one is dead

- **Issue:** `analyzeStockWithGemini` (`services/gemini.ts` L141-234) and its helper `formatPromptData` (L14-139) implement an older single-call analysis flow, but `App.tsx` only imports and calls `analyzeEntryWithGemini` (the filter-driven "方案C" path). `analyzeStockWithGemini` is imported in `App.tsx` (L9) yet never invoked.
- **Impact:** ~220 lines of unused prompt/logic plus a second, divergent set of golden-buy-point criteria to keep in sync.
- **Fix approach:** Remove `analyzeStockWithGemini`/`formatPromptData` (and the unused import) or consolidate onto the filter path.

### Duplicated constants across services

- **Issue:** `PROXIES`, the FinMind base URL, and `.TW/.TWO` detection logic are redefined independently.
  - `PROXIES`: `services/yahoo.ts` L7-10 vs `services/stockDirectory.ts` L16.
  - FinMind base: `services/yahoo.ts` L14 (`FINMIND_BASE`) vs `services/stockDirectory.ts` L15 (`FINMIND`).
  - "is Taiwan stock" regex `/^\d{3,6}[A-Z]?$/`: `components/Portfolio.tsx` L23, `services/gemini.ts` L329 & L716, `services/yahoo.ts` L480; plus a different `/^\d{4}$/` variant in `App.tsx` L180.
- **Fix approach:** Centralize proxy list, base URLs, and a single `isTaiwanStock(symbol)` helper in one module (`constants.ts` does not yet exist — create it).

### Massive untyped string-building prompt files

- **Issue:** `services/gemini.ts` is 1030 lines, dominated by inline systemInstruction template literals (the rule book is duplicated between `analyzeTradeDecision` L399-683 and `analyzePortfolioHealth` L835+, and partially again in `prompts/持股庫存健檢系統_AI提示詞_adapted.md`).
- **Impact:** Hard to keep prompt rules consistent; `prompts/stockAnalysisPrompt.ts` referenced by earlier docs does not exist (only the `.md` file does), so prompt text lives inline rather than in `prompts/`.
- **Fix approach:** Extract system instructions into `prompts/*.ts` modules and share the common rule book.

### `config: any` and external payload `any` casts

- **Issue:** Gemini `config` objects are typed `any` (`services/gemini.ts` L213, L302), and Yahoo/FinMind payloads use `(d: any)`/`(item: any)` throughout (`services/yahoo.ts` L252, L373, L614, L623; `services/stockDirectory.ts` L45, L100).
- **Fix approach:** Define response interfaces; the `YahooChartResponse` interface (`services/yahoo.ts` L16-44) already exists but `quote.close` etc. are typed `number[]` when they are actually `(number|null)[]`, masking the null-handling requirement.

---

## Performance / UX

### `App.tsx` initial-load effect omits `symbol` dependency

- **Issue:** `useEffect(() => fetchData(symbol, interval), [interval])` depends on `interval` only (`App.tsx` L116-118). Initial load uses the default `'2330'`; symbol-triggered fetches are handled separately via `StockSearch onSelect`. This works but is a lint-suppressed implicit dependency that is fragile to refactor.
- **Fix approach:** Make the data-fetch trigger explicit (single effect keyed on `[symbol, interval]`, or a single fetch entry point).

### Portfolio refetches all prices on any symbol-set change

- **Issue:** `useEffect` keyed on `items.map(i => i.symbol).join(',')` (`components/Portfolio.tsx` L609-612) re-fetches every holding's price (plus FX) whenever the symbol set changes; adding one stock refetches all. FinMind name lookups run per symbol inside `getLatestPrice` (`services/yahoo.ts` L434-437).
- **Fix approach:** Fetch only newly added symbols; batch/cache FX and names.

### Heavy per-render work in the chart

- **Issue:** `StockChart` recomputes `displayData` and MA caches with multiple `useMemo`s and builds `<Cell>` arrays for every bar (`components/StockChart.tsx` L305-433). Reasonable, but combined with `recharts` and no virtualization, very large `barsToShow` values can be slow.
- **Fix approach:** Cap `barsToShow` or downsample for very long ranges.

---

## Test Coverage Gaps

- **What's not tested:** Everything. No test runner, no test files; `package.json` declares only `dev`/`build`/`preview` scripts.
- **Highest-risk untested logic:**
  - Indicator math — `utils/math.ts` (RSI/MACD/KDJ/Bollinger), including the non-standard MACD params (10,20,10) and KDJ (5,3).
  - Entry filter decision logic — `utils/entryFilter.ts` (swing detection, trend classification, SOP/precept/decision).
  - Yahoo/FinMind mapping and weekly/monthly merge — `services/yahoo.ts` L504-543, L629-642.
  - Volume projection — `utils/volume.ts`.
  - Portfolio fee/tax/PNL and currency conversion — `components/Portfolio.tsx` L36-60, L150-164, L341-357.
- **Risk:** These produce numbers users may trade on; errors fail silently with plausible-looking output.
- **Priority:** High for `utils/math.ts`, `utils/entryFilter.ts`, and `services/yahoo.ts` mapping.

---

## Dependencies at Risk

### Hardcoded, non-current Gemini model names

- **Risk:** Models are hardcoded as `gemini-3.5-flash` / `gemini-3.1-pro-preview` (`services/gemini.ts` L154, L250, L687). These names do not match known released Gemini model IDs; if invalid or deprecated, every analysis fails with the generic "Analysis Failed" message and no fallback.
- **Migration plan:** Make the model id configurable (one constant), verify against current Gemini model names, and handle model-not-found distinctly from transient errors.

### corsproxy.io / allorigins.win (third-party, free tier)

- **Risk:** No SLA; single points of failure already flagged under Security/Data Accuracy.
- **Migration plan:** Replace with an own server-side proxy.

### Unofficial Yahoo + FinMind free tier

- **Risk:** FinMind free tier is rate-limited and called on nearly every TW-stock load (name + chips + price, `services/yahoo.ts` L588-626); heavy usage can throttle and silently return empty chip data.
- **Migration plan:** Cache FinMind directory/chip responses more aggressively (a 7-day directory cache already exists in `services/stockDirectory.ts` L19; chips are not cached).

---

## Missing Critical Features

- **Server-side API layer:** Root cause of the top security and data-integrity concerns; required to secure the Gemini key and stabilize/validate market data.
- **Runtime validation:** No schema validation on external payloads or persisted portfolio.
- **Persistent financial disclaimer:** BUY/SELL signals and price targets are shown in the dashboard report and portfolio modals without an enforced in-app disclaimer (only the entry checklist has one).
- **`.env.example`:** `.gitignore` whitelists `!.env.example` (line 29) but no such file exists; new contributors have no template for required `GEMINI_API_KEY`.

---

*Concerns audit: 2026-05-31*
