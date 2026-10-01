# Codebase Concerns

**Analysis Date:** 2026-05-31（2026-10-01 部分核對）

> Scope（原始稽核）: application source only — `App.tsx`, `components/`, `services/`, `utils/`, `prompts/`, `types.ts`, `vite.config.ts`, `index.tsx`。當時還沒有 `api/`（2026-07-05 起）與 `config/`（2026-07-29 起），它們不在原始稽核範圍；舊版提到要排除的 GSD 工具目錄已隨 GSD 停用（2026-07-26，見 `CORE_RULES.md`）移出專案。
>
> **部分核對（2026-10-01）**：
> - 原文 8 處已解決的項目（6 節＋Missing Critical Features 的 2 點）併成 6 則，移到文末「已解決」節，各附解決的 commit 與對證指令。
> - 「Duplicated constants across services」「Test Coverage Gaps」兩節逐項核對。
> - 留在正文、但內文提到已解決事物的兩處加了註：「Unofficial, unstable Yahoo Finance endpoints」（端點已移到後端）、「Original errors are flattened」（`"API Key is missing"` 已不存在）。
> - **其餘條目未重新核對。** 引用的行號（尤其 `services/yahoo.ts`、`services/gemini.ts`、`components/Portfolio.tsx`、`App.tsx`）多半已因 Phase 01～12 的重構失準，有些問題可能已部分解決（例如錯誤分類：前端現在有 `DataFetchError`、後端有 `ClassifiedError`），引用前先對照現況。

---

## Security Considerations

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
  - 2026-10-01 註：這兩個端點現在只由後端呼叫——`api/yahoo/chart.ts`、`api/yahoo/search.ts`，cookie／crumb 握手與遇 401／429 重試一次在 `api/_lib/yahoo.ts` 的 `fetchYahooWithHandshake`。上列前端行號已失準（`YAHOO_BASE` 已不存在）。依賴非官方端點這個風險本身仍在。
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
  - 2026-10-01 註：`"API Key is missing"` 字串與其檢查已於 2026-07-05 `0d2800e` 移除；缺金鑰改由後端丟 `ClassifiedError('MISSING_KEY')`（`api/_lib/llm.ts`），前端顯示後端回的訊息。本節其餘內容未重新核對。
- **Fix approach:** Normalize errors into categories (HTTP status, parse failure, empty result, model-not-found) and map them to specific, actionable user messages.

### Silent empty-array fallbacks hide partial-data analysis

- **Issue:** FinMind chip/price/name helpers and Yahoo search return `[]`/`null` on failure (`services/yahoo.ts` L201-204, L214-217, L235; `services/stockDirectory.ts` L113). Analysis then proceeds with foreign/trust = 0 and possibly stale names, with no indication to the user that chip data was missing.
- **Impact:** The AI receives "Foreign: 0 / Trust: 0" that is indistinguishable from a real zero, biasing chip analysis.
- **Fix approach:** Track and surface a "chip data unavailable" state distinct from a true zero.

### Persisted portfolio is parsed without schema validation

- **Issue:** `JSON.parse(localStorage 'portfolio_items')` is try/caught only for parse errors (`App.tsx` L54-61); individual items are never validated against `PortfolioItem`. A schema change or corrupt entry can throw later inside `Portfolio.tsx` math (e.g. `item.totalShares` undefined) rather than at load.
- **Files:** `App.tsx` L54-65; `types.ts` L99-112.
- **Fix approach:** Validate/normalize each parsed item; drop or repair invalid entries and notify the user.

---

## Tech Debt

### Duplicated constants across services

- **現況（2026-10-01 核對）：** 原列三項大多已收斂——
  - `PROXIES`：已隨公共 CORS proxy 移除（2026-07-05 `e7da3c7`），見文末「已解決」。
  - FinMind base URL：前端的 `FINMIND_BASE`／`FINMIND` 已不存在，網址只剩後端一處（`api/finmind.ts:48`；`git grep -n finmindtrade -- '*.ts' '*.tsx' ':!*.test.ts'`）。
  - 台股判斷：已全數集中到 `utils/market.ts`——`isTwStock`（2026-07-23 `c6887ad`，Phase 12 T1）＋純代碼版 `isTwCode`（2026-10-01；`isTwStock` 委派它，regex 只剩一份）。T1 漏收的 `components/FundamentalsPanel.tsx` 本地 `isTwCode`（2026-07-12 就存在）已改用 `market.ts` 版。該處不能直接換成 `isTwStock`：搜尋閘門只剝一層 `.TW/.TWO`，`isTwStock` 會放行「2330.TW.TW」剝剩的「2330.TW」——由 `components/FundamentalsPanel.test.ts` 鎖住。原始碼其餘 4 處含 `\d{3,6}` 的 regex 都在 `market.ts` 檔頭的例外清單（代碼抽取、canonical key、後端白名單）：`git grep -nF 'd{3,6}' -- '*.ts' '*.tsx' ':!*.test.ts'`。
  - 去 `.TW/.TWO` 後綴的 `replace(/\.TWO?$/i, '')` 共 10 處（`services/yahoo.ts` 7、`services/stockDirectory.ts`／`App.tsx`／`components/FundamentalsPanel.tsx` 各 1）屬正規化、不是分類，未收斂：`git grep -nF ".TWO?$/i, '')" -- '*.ts' '*.tsx'`。
  - 待使用者決定（行為變更，未動）：`App.tsx` 的 `fundamentalsInitialSymbol` 同樣「剝一層後綴再判斷」，用的卻是 `isTwStock`。依程式碼推論（未實機重現）：儀表板查詢失敗後 `info` 為 null、改用搜尋框原文；原文若是「2330.TW.TW」，基本面分頁會以「2330.TW」起始並在 FinMind 報錯，改用 `isTwCode` 則落回預設 2330。
  - 原 Fix approach 建議新建的 `constants.ts` 不必再建；台股判斷用 `utils/market.ts`。
- 原文（2026-05-31）：
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

- **現況（2026-10-01 核對）：** Vitest 跑道（`~3.2.7`，2026-07-13 `6ed7713` 建立，`npm run test`）；2026-09-30 時 49 個測試檔、811 個案例。覆蓋與已知缺口以同目錄的 `TESTING.md` 為準。查某模組有沒有被測：`git grep -l "<模組檔名>" -- '*.test.ts'`。
- **2026-05-31 列的 Highest-risk untested logic，逐項現況：**
  - **已測** — Indicator math `utils/math.ts`：`utils/math.test.ts`，含非標準參數 MACD (10,20,10) 與 KDJ（period=5）的鎖定案例。
  - **已測** — Entry filter `utils/entryFilter.ts`：`utils/entryFilter.test.ts`（`utils/geminiPrompts.test.ts` 也以它組 prompt）。
  - **部分** — Yahoo/FinMind mapping and weekly/monthly merge（`services/yahoo.ts`）：有 3 支測試（`services/yahoo.loading.test.ts`、`yahoo.maWarmup.test.ts`、`yahoo.revalidation.test.ts`），但沒有以週／月線資料驗合併結果的行為鎖——`git grep -n -i -E '1wk|1mo|weekly|monthly|aggregat' -- 'services/yahoo.*.test.ts'` 只命中 revalidation 測試的快取案例。
  - **未測** — Volume projection `utils/volume.ts`：沒有任何測試檔 import 它（`utils/entryFilter.ts` 只 import 它的型別）。
  - **部分** — Portfolio fee/tax/PNL and currency conversion：費稅已抽到 `utils/portfolioFees.ts`，由 `utils/portfolioFees.test.ts` 以手算對數案例鎖住；賣出損益在 `utils/portfolioLedger.ts`，由 `utils/portfolioLedger.test.ts` 鎖住；匯率換算 `utils/fx.ts` 沒有直接測試（沒有測試檔 import 它）。
- **Risk:** These produce numbers users may trade on; errors fail silently with plausible-looking output.
- **Priority（原文）:** High for `utils/math.ts`, `utils/entryFilter.ts`, and `services/yahoo.ts` mapping——前兩項已有測試，`services/yahoo.ts` 的週／月線合併仍缺專門的行為鎖。

---

## Dependencies at Risk

### Unofficial Yahoo + FinMind free tier

- **Risk:** FinMind free tier is rate-limited and called on nearly every TW-stock load (name + chips + price, `services/yahoo.ts` L588-626); heavy usage can throttle and silently return empty chip data.
- **Migration plan:** Cache FinMind directory/chip responses more aggressively (a 7-day directory cache already exists in `services/stockDirectory.ts` L19; chips are not cached).

---

## Missing Critical Features

- **Runtime validation:** No schema validation on external payloads or persisted portfolio.
- **Persistent financial disclaimer:** BUY/SELL signals and price targets are shown in the dashboard report and portfolio modals without an enforced in-app disclaimer (only the entry checklist has one).
- 原列的「Server-side API layer」與「`.env.example`」兩點已解決，見文末。

---

## 已解決（2026-10-01 從上方移出，保留紀錄）

2026-05-31 列出、之後已解決的項目。每則附解決的 commit 與現況對證指令；原文見
`git show 2b7637b:.planning/codebase/CONCERNS.md`。

### Gemini API key is inlined into the client bundle（原列 CRITICAL；2026-07-05 解決）

- **原問題：** `vite.config.ts` 的 `define` 把 `GEMINI_API_KEY` 內聯進前端 bundle；`services/gemini.ts` 在瀏覽器以 `new GoogleGenAI({ apiKey: process.env.API_KEY })` 直打 Gemini，任何人都能從 JS 取出金鑰。
- **解決：** Phase 01（2026-07-05）——`fda2063` 建後端共用層（`api/_lib/config.ts`、`.env.example`）、`6b13f22` 新增 `api/gemini.ts`、`0d2800e` 前端改打 `/api/gemini` 並移除 `define`。2026-07-26 `dab7508` 再把 `envPrefix: 'VITE_'` 顯式化，由 `utils/viteConfigGuard.test.ts` 三層鎖住（gate-audit G3）。
- **現況：** 金鑰只由 `api/_lib/config.ts` 的 `getGeminiApiKey()` 讀；`@google/genai` 只在 `api/_lib/http.ts`；缺金鑰時後端丟 `ClassifiedError('MISSING_KEY')`（`api/_lib/llm.ts`），handler 回 500。金鑰外洩由 `npm run gate` 第 4 道掃描（`dist/`＋git 追蹤原始碼＋`.env` 實際值）。
- **對證：** `git grep -c 'process.env.API_KEY' -- services/ components/ App.tsx` 無命中；`git grep -n -E '@google/genai|GoogleGenAI' -- '*.ts' ':!*.test.ts'` 只命中 `api/_lib/http.ts`。
- 原建議的「proxy 上線後輪替金鑰」屬 Google 端的手動操作，repo 內無法對證。

### Third-party CORS proxies in the market-data path（2026-07-05／07-09 解決）

合併原文兩處：Security 的「Third-party CORS proxies sit in every market-data request path」與 Dependencies at Risk 的「corsproxy.io / allorigins.win (third-party, free tier)」。

- **原問題：** Yahoo 請求經 `corsproxy.io`／`api.allorigins.win` 兩個不受控的第三方（可觀察、限流、竄改）；FinMind 由瀏覽器直打，仰賴對方的 CORS header。
- **解決：** Phase 02 `e7da3c7`（2026-07-05）前端改打 `/api/yahoo/chart`、`/api/yahoo/search` 並移除 `PROXIES`；Phase 03 `07ec1f7`（2026-07-09）FinMind 改經 `/api/finmind`。
- **現況：** 後端 `api/_lib/yahoo.ts` 的 `fetchYahooWithHandshake` 處理 cookie／crumb 握手，遇 401／429 清掉 crumb 重試一次；`api/finmind.ts` 只放行 `api/_lib/finmind.ts` 的 `ALLOWED_DATASETS`（9 個 dataset），有 `FINMIND_TOKEN` 就附上。
- **對證：** `git grep -n -E 'PROXIES|corsproxy|allorigins' -- services/ components/ App.tsx utils/ api/` 無命中；前端原始碼沒有外部網址（`git grep -n -E 'https?://' -- App.tsx index.tsx components/ services/ utils/ config/ ':!*.test.ts' ':!*.snap'` 無命中）。
- 依賴 Yahoo 非官方端點的風險仍在，見正文 Data Accuracy 的「Unofficial, unstable Yahoo Finance endpoints」。

### No React error boundary（2026-07-13 解決）

- **解決：** `d06bcb2` 新增 `components/ErrorBoundary.tsx`，`index.tsx` 以 `<ErrorBoundary>` 包住 `<App />`；render 期例外改顯示可恢復的 fallback（錯誤摘要＋重新載入），完整錯誤只進 console。
- **對證：** `index.tsx:15-17`；`git grep -n componentDidCatch -- components/`。

### Two overlapping AI analysis paths; one is dead（2026-07-12 解決）

- **解決：** `7bc35f1` 刪除死碼 `analyzeStockWithGemini`＋`formatPromptData`（約 237 行）；進場分析只走濾網驅動的 `analyzeEntryWithGemini`。
- **對證：** `git grep -n -w -E 'analyzeStockWithGemini|formatPromptData' -- '*.ts' '*.tsx'` 無命中。

### Hardcoded, non-current Gemini model names（2026-07-05 解決）

- **原問題：** 型號寫死在前端 `services/gemini.ts`；型號失效時所有分析只會得到籠統的失敗訊息，沒有備援。
- **解決：** Phase 01 把型號移到後端（`fda2063` 新增 `getModelForMode`、`0d2800e` 移除前端型號字串）。
- **現況：** `api/_lib/config.ts` 的 `getModelForMode` 依 `mode` 讀 `GEMINI_MODEL_FAST`／`GEMINI_MODEL_THINKING`，未設或只有空白時 fallback `gemini-3.5-flash`／`gemini-3.1-pro-preview`；型號不存在另分類為 `MODEL_NOT_FOUND`（handler 回 404，訊息請使用者確認型號設定）。前端只傳 `mode`。改型號的規則見 `CORE_RULES.md`「本專案關鍵事實」。型號名是否為 Gemini 目前有效的型號，repo 內無法對證。
- **對證：** `git grep -n -E 'gemini-[0-9]' -- App.tsx components/ services/ utils/ ':!*.test.ts'` 無命中。

### Missing: server-side API layer／`.env.example`（2026-07-05 解決）

原文 Missing Critical Features 的兩點。

- **Server-side API layer：** `api/` 現有 5 支 Vercel Serverless handler（`gemini`、`gemini-stream`、`finmind`、`yahoo/chart`、`yahoo/search`），共用模組在 `api/_lib/`；每支第一步過 `api/_lib/guard.ts` 的 `applyGuards`（CORS 與來源白名單、`X-Proxy-Secret` 共享密鑰、Upstash 限流）。起點是 Phase 01 的 `6b13f22`（2026-07-05）。
- **`.env.example`：** `fda2063`（2026-07-05）新增，列出後端與前端變數（值留空或放範例值），`.gitignore` 的 `!.env.example` 讓它進 git。
- **對證：** `git ls-files api/ ':!api/_lib/*' ':!*.test.ts'`；`git ls-files .env.example`。

---

*Concerns audit: 2026-05-31*
*Updated 2026-10-01: 先只改 Test Coverage Gaps 第一點；同日第二輪移出已解決項、核對 Duplicated constants 與 Test Coverage Gaps（範圍見檔頭）*
