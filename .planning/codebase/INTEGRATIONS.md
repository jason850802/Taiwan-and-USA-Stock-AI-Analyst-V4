# External Integrations

**Analysis Date:** 2026-10-01（整份重寫，取代 2026-05-31 版）

> 2026-05-31 版描述的是「瀏覽器直連外部服務、Yahoo 經公共 CORS proxy、依賴由 esm.sh importmap 載入、
> 金鑰經 `vite.config.ts` 注入前端」的純前端架構。2026-07 起全部改變：Gemini、Yahoo（2026-07-05）與
> FinMind（2026-07-09）改由後端代打，importmap 與 Tailwind CDN 於 2026-07-13 移除。本版每條附對證的
> 指令或檔案，數字是 2026-10-01 的快照；舊版見 `git show 2b7637b:.planning/codebase/INTEGRATIONS.md`。
> 與 `CORE_RULES.md` 衝突時以 CORE_RULES 為準。

## 總覽

前端（Vite 建置的 React SPA）只打同源的 `/api/*`；需要金鑰或跨網域的外部呼叫，全由 `api/` 的 Vercel
Serverless 函式代打。

| 外部服務 | 後端 handler | 前端呼叫端 | 上游 |
|---|---|---|---|
| Google Gemini | `api/gemini.ts`、`api/gemini-stream.ts` | `services/gemini.ts` 的 `callGeminiApi`／`callGeminiApiStream` | `@google/genai` SDK |
| Yahoo Finance 行情 | `api/yahoo/chart.ts` | `services/yahoo.ts` 的 `queryYahoo` | `query2.finance.yahoo.com/v8/finance/chart/{symbol}` |
| Yahoo Finance 搜尋 | `api/yahoo/search.ts` | `services/stockDirectory.ts` | `query1.finance.yahoo.com/v1/finance/search` |
| FinMind | `api/finmind.ts` | `services/finmind.ts` 的 `fetchFinMindRows`（`services/yahoo.ts` 也經它）、`services/stockDirectory.ts` | `api.finmindtrade.com/api/v4/data` |
| Upstash Redis | `api/_lib/ratelimit.ts`（各 handler 共用） | — | 限流計數 |

- 對證：前端的 6 個 `/api/*` 呼叫點——``git grep -n -E "['\`\"]/api/" -- App.tsx components/ services/ utils/ ':!*.test.ts'``；
  前端原始碼沒有外部網址——`git grep -n -E 'https?://' -- App.tsx index.tsx components/ services/ utils/ config/ ':!*.test.ts' ':!*.snap'` 無命中。

## 共同把關：`applyGuards`（`api/_lib/guard.ts`）

5 支 handler 的第一步都是 `applyGuards`，依序：

1. **CORS**：請求的 Origin 在 `ALLOWED_ORIGIN` 白名單內才回 `Access-Control-Allow-Origin`；允許方法
   `GET, POST, OPTIONS`、header `Content-Type, X-Proxy-Secret`。`OPTIONS` 預檢直接回 204。
2. **來源檢查**：沒有 Origin 也沒有 Referer 時放行；同源（Origin／Referer 的 host 等於部署自己的 host）放行；
   其餘要命中 `ALLOWED_ORIGIN` 白名單，否則 403。`ALLOWED_ORIGIN` 未設時白名單只有 `http://localhost:3000`
   （`api/_lib/config.ts` 的 `getAllowedOrigins`）。
3. **共享密鑰**：後端有設 `PROXY_SHARED_SECRET` 時，請求 header `X-Proxy-Secret` 必須相等（`timingSafeEqual`），
   否則 403；未設則略過（設成空字串等同停用，會在 log 警告一次）。前端由 `services/_shared/apiClient.ts` 的
   `proxyHeaders` 帶上 `VITE_PROXY_SECRET`。
4. **限流**：Upstash 以 IP 滑動視窗計數，超過回 429（見下方 Upstash 節）。

## Google Gemini（AI 報告）

- **用途**：產生中文 Markdown 報告——進場分析 `analyzeEntryWithGemini`、交易決策 `analyzeTradeDecision`、
  庫存健檢 `analyzePortfolioHealth`、基本面解讀 `analyzeFundamentals`（都在 `services/gemini.ts`）。
- **端點**：`POST /api/gemini`（一次回完整文字）；`POST /api/gemini-stream`（`application/x-ndjson` 串流，
  `Cache-Control: no-store`）。有傳 `onChunk` 回呼的進場分析與庫存健檢走串流（`services/gemini.ts:250`、`:971`）。
- **請求驗證**：`api/_lib/http.ts` 的 `validateGeminiRequest`——`prompt`、`systemInstruction` 不可為空，`mode`
  只能是 `fast`／`thinking`，否則 `BAD_REQUEST`。
- **金鑰**：`GEMINI_API_KEY` 只在後端，由 `api/_lib/config.ts` 的 `getGeminiApiKey()` 讀；讀不到時
  `api/_lib/llm.ts` 丟 `ClassifiedError('MISSING_KEY')`，handler 回 500。前端 bundle 沒有金鑰：`vite.config.ts`
  只設 `envPrefix: 'VITE_'`、沒有 `define`（`utils/viteConfigGuard.test.ts` 鎖住）。
- **SDK**：`@google/genai` 只在 `api/_lib/http.ts`，`callGeminiWithTimeout` 每次呼叫 `new GoogleGenAI({ apiKey })`。
- **型號**：`api/_lib/config.ts` 的 `getModelForMode`——`fast` 用 `GEMINI_MODEL_FAST`（預設 `gemini-3.5-flash`），
  `thinking` 用 `GEMINI_MODEL_THINKING`（預設 `gemini-3.1-pro-preview`）。前端只傳 `mode`：進場分析依使用者選的
  模式，交易決策、庫存健檢、基本面固定 `fast`。改型號規則見 `CORE_RULES.md`「本專案關鍵事實」。
- **Provider 分流**（`api/_lib/llm.ts`）：`LLM_PROVIDER` 未設或 `gemini-api` 走 Gemini API；`claude-cli` 改在本機
  啟動 Claude Code CLI（吃 Claude 訂閱，只在本機 `vercel dev` 用；相關的 `CLAUDE_CLI_*` 變數見 `.env.example`）；
  其他值回設定錯誤。
- **錯誤分類**：`api/_lib/http.ts` 的 `ClassifiedError`——`MODEL_NOT_FOUND`（404）、`RATE_LIMITED`（429）、
  `UPSTREAM_ERROR`（502）、`BAD_REQUEST`（400）、`MISSING_KEY`（500）、`CANCELLED`（499，只為型別完整、實際
  不寫回應）。前端收到非 2xx 丟 `DataFetchError`（429→`RATE_LIMIT`、5xx→`BACKEND_DOWN`、其餘→`UNKNOWN`），
  訊息沿用後端回的中文 `message`。
- **函式時限**：`api/gemini.ts` `maxDuration = 120`、`api/gemini-stream.ts` `maxDuration = 200`（秒）。
- **前端快取**：`services/_shared/geminiCache.ts`，localStorage key
  `gemini_cache_v1|<ENGINE_TAG>|<mode>|<台北日期>|<hash>`（hash 取 system instruction＋prompt），跨日即清；
  只快取非空的成功回應。改型號要 bump `ENGINE_TAG`（CORE_RULES）。
- **Prompt**：system instruction 寫在 `services/gemini.ts`，受 snapshot 逐位元組鎖定（見 `TESTING.md`）；
  `prompts/持股庫存健檢系統_AI提示詞_adapted.md` 只是參考文件，程式沒有引用。

## Yahoo Finance（行情與搜尋）

- 非官方端點、沒有 API key。依賴非官方端點的風險見 `CONCERNS.md`。
- **握手**（`api/_lib/yahoo.ts` 的 `fetchYahooWithHandshake`）：先向 `https://fc.yahoo.com` 取 cookie、再向
  `https://query2.finance.yahoo.com/v1/test/getcrumb` 取 crumb，帶著兩者打主請求；crumb 快取 10 分鐘；
  遇 401／429 清掉 crumb、等 500 ms 重試一次；每個上游請求 8 秒逾時。
- **`GET /api/yahoo/chart`**（參數 `symbol`、`interval`、`range`）：上游 `v8/finance/chart/{symbol}`
  （`includeAdjustedClose=true`、`region=TW`）。`chart.error` 為 `Not Found` → 404。只有成功回應設
  `Cache-Control: s-maxage=60, stale-while-revalidate=300`（Vercel CDN 快取，錯誤回應不快取）。
- **`GET /api/yahoo/search`**（參數 `q`、`limit`）：上游 `v1/finance/search`，不設 CDN 快取。
- **錯誤分類**：`BAD_REQUEST` 400、`UPSTREAM_UNAUTHORIZED` 502、`RATE_LIMITED` 429、`UPSTREAM_ERROR` 502、
  `NOT_FOUND` 404。兩支 `maxDuration = 30`，只接受 GET。
- **前端**：`services/yahoo.ts` 的 `queryYahoo`→`fetchRawData`（裸台股代號先查名錄決定 `.TW`／`.TWO`，
  不行再依序試）；搜尋在 `services/stockDirectory.ts`。行情快取在 `services/quoteCache.ts`（sessionStorage）。
- **限流**：`marketPerMin`（每 IP 60 次／分，與 FinMind 共用同一組計數）。

## FinMind（台股資料）

- **`GET /api/finmind`**（參數 `dataset`、`data_id`、`start_date`）：後端轉打
  `https://api.finmindtrade.com/api/v4/data`，15 秒逾時；有 `FINMIND_TOKEN` 就附上（提高額度），未設走公開額度。
- **dataset 白名單**（`api/_lib/finmind.ts` 的 `ALLOWED_DATASETS`，9 個）：
  `TaiwanStockInstitutionalInvestorsBuySell`、`TaiwanStockPrice`、`TaiwanStockInfo`、
  `TaiwanStockFinancialStatements`、`TaiwanStockBalanceSheet`、`TaiwanStockCashFlowsStatement`、
  `TaiwanStockPER`、`TaiwanStockMonthRevenue`、`TaiwanStockDividend`。其他 dataset 回 400，避免成為任意資料代理。
- **CDN 快取**：`cacheSecondsForDataset`——財報三表與股利 3 天，其餘到台北午夜；
  `Cache-Control: public, s-maxage=<秒>, stale-while-revalidate=60`。
- **錯誤分類**：上游 402／429 或訊息含 upper／rate limit → `RATE_LIMITED`（429），其餘 → `UPSTREAM_ERROR`（502）；
  參數不合 → `BAD_REQUEST`（400）。`maxDuration = 30`，只接受 GET。
- **前端用途**：法人籌碼、台股中文名、台股日線 Yahoo 失敗時的備援（`services/yahoo.ts` 的
  `fetchFinMindDailyData`，只在台股日線觸發）、基本面分頁（`services/finmind.ts`）、台股名錄
  （`services/stockDirectory.ts`，localStorage 快取 7 天）。
- **限流**：`marketPerMin`（見上）。

## Upstash Redis（限流）

- `api/_lib/ratelimit.ts`：`UPSTASH_REDIS_REST_URL` 與 `UPSTASH_REDIS_REST_TOKEN` 都有才啟用；否則三組限流器
  都是 `null`＝不限流（本機常態）。
- 三組滑動視窗，以 IP 計（`x-forwarded-for` 第一段，退而用 `x-real-ip`）：`geminiPerMin` 10 次／分、
  `geminiPerDay` 100 次／日（兩支 Gemini handler）、`marketPerMin` 60 次／分（FinMind 與兩支 Yahoo handler）。
- Upstash 出錯時放行（fail-open），並 log `[guard] ratelimit unavailable, failing open`。
- 設定步驟見 `docs/DEPLOYMENT.md`。

## CDN 與字型

- 執行期唯一的第三方 CDN：Google Fonts（Inter、JetBrains Mono；`index.html:7`）。
- 沒有 importmap、沒有 Tailwind CDN（2026-07-13 `e6e4140`、`24a8135` 移除）；npm 依賴由 Vite 打包。

## 資料儲存

- 沒有伺服器端資料庫；Upstash Redis 只存限流計數。
- **localStorage**：
  - 庫存本體五鍵：`portfolio_items`、`portfolio_transactions_v1`、`portfolio_import_log_v1`、
    `portfolio_realized_trades_v1`、`portfolio_snapshots_v1`。可備份／回灌（`utils/portfolioBackup.ts`，
    ADR-0001；詞彙定義見 `CONTEXT.md`）。各鍵的讀寫經 `utils/persistentStore.ts` 工廠產生的 store。
  - 可重建：`portfolio_close_cache_v1`（回推用收盤價快取，`utils/closeSeriesCache.ts`）、`gemini_cache_v1|*`
    （AI 分析快取）、`tw_stock_directory_v1`＋`tw_stock_directory_ts_v1`（台股名錄，7 天）。
- **sessionStorage**（經 `services/_shared/boundedSession.ts` 控制容量）：行情快取 `quote_cache_v1:*`
  （`services/quoteCache.ts`）、基本面 `tw_fund_*`（`services/finmind.ts`，另有模組層記憶體快取）。
- 對證：`git grep -n -E "'portfolio_[a-z_0-9]+'|'tw_stock_directory[a-z_0-9]*'|'gemini_cache_v1\|'|'quote_cache_v1:'|'tw_fund_'" -- utils/ services/ components/ ':!*.test.ts'`。

## 認證與身分

- 沒有使用者帳號與登入。
- 後端秘密：`GEMINI_API_KEY`（必要），以及選填的 `FINMIND_TOKEN`、`UPSTASH_REDIS_REST_*`、`PROXY_SHARED_SECRET`。
  本機放 `.env`（不進 git），正式環境放 Vercel 環境變數。
- `VITE_PROXY_SECRET` 會被打包進前端（`VITE_` 前綴），只是提高直呼 `/api/*` 的門檻、不是機密
  （`.env.example`、`docs/DEPLOYMENT.md`）。

## 部署與 CI

- **Hosting**：Vercel——`vite build` 產出的靜態前端（`dist/`，不進 git）＋`api/` 的 Serverless 函式。repo 沒有
  `vercel.json`（零設定）：`api/` 內非 `_`／`.` 開頭的 `.ts` 各成一支函式。`.vercelignore` 排除 `.claude`、
  `.agents`、`.planning`、`.codex`、`node_modules` 與 `api/**/*.test.ts`（測試檔不能被部署成函式，由
  `utils/vercelIgnoreGuard.test.ts` 鎖住）。環境變數清單與部署步驟見 `docs/DEPLOYMENT.md`。
- **CI**：沒有（repo 沒有 `.github/`）。機械驗收靠本機 `npm run gate`（tsc → vitest → build → 金鑰掃描 →
  依賴檔 diff）。

## 環境變數

以 `.env.example` 為準；下表列出讀取位置（對證：`git grep -h -o -E 'process\.env\.[A-Z_]+' -- api/ ':!*.test.ts' | sort -u`）。

| 變數 | 必要性 | 讀取位置 |
|---|---|---|
| `GEMINI_API_KEY` | 必要（走 Gemini API 時） | `api/_lib/config.ts` |
| `GEMINI_MODEL_FAST`、`GEMINI_MODEL_THINKING` | 選填，有預設 | `api/_lib/config.ts` |
| `ALLOWED_ORIGIN` | 選填，未設＝只允許 `http://localhost:3000`（同源一律放行） | `api/_lib/config.ts` |
| `PROXY_SHARED_SECRET` | 選填，未設＝不驗共享密鑰 | `api/_lib/config.ts` |
| `FINMIND_TOKEN` | 選填 | `api/finmind.ts` |
| `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN` | 選填，production 建議設 | `api/_lib/ratelimit.ts` |
| `LLM_PROVIDER` | 只在本機；未設＝`gemini-api` | `api/_lib/llm.ts` |
| `CLAUDE_CLI_PATH`、`CLAUDE_CLI_MODEL_FAST`／`_THINKING`、`CLAUDE_CLI_EFFORT_FAST`／`_THINKING` | 只在 `claude-cli` | `api/_lib/llm.ts` |
| `VITE_PROXY_SECRET` | 前端，須與 `PROXY_SHARED_SECRET` 同值；會進 bundle | `services/_shared/apiClient.ts` |

`api/_lib/llm.ts` 另讀系統的 `PATH`、`APPDATA`，用來找本機的 claude 執行檔。

## Monitoring & Observability

- 沒有錯誤追蹤服務（`package.json` 沒有 Sentry 或 analytics 類套件）。
- 後端錯誤以 `console.error('[<handler>:<代碼>] …')` 寫進 Vercel function log；前端只有瀏覽器 console。

## Webhooks & Callbacks

- 無。

---

*Integration audit: 2026-10-01（整份重寫；原版 2026-05-31）*
