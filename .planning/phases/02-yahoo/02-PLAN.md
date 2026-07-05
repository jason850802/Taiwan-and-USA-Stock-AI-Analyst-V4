---
phase: 02-yahoo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - api/_lib/yahoo.ts
  - api/yahoo/chart.ts
  - api/yahoo/search.ts
  - services/yahoo.ts
  - services/stockDirectory.ts
autonomous: false
requirements: [PROXY-03, PROXY-06, FE-02]

must_haves:
  truths:
    - "使用者查詢任一檔台股/美股，行情、圖表、搜尋行為與遷移前完全一致"
    - "瀏覽器 Network 分頁對行情/搜尋只看到同源 /api/yahoo/chart 與 /api/yahoo/search，不再出現 corsproxy.io 或 allorigins.win"
    - "非白名單 interval/range 或格式不合法的 symbol 一律被後端拒絕（400），端點不可被當開放行情代理"
    - "Yahoo 失敗時，前端既有 FinMind 台股日線 fallback 仍正常運作（維持前端直連，不受本階段影響）"
    - "StockDataPoint[] 與 StockInfo 型別、getStockData/getLatestPrice/searchYahoo 對外簽章完全不變"
  artifacts:
    - path: "api/_lib/yahoo.ts"
      provides: "cookie/crumb 握手、function 記憶體 crumb 快取（short-TTL）、interval/range/symbol 白名單驗證、瀏覽器式 UA fetch 輔助"
      min_lines: 60
    - path: "api/yahoo/chart.ts"
      provides: "GET /api/yahoo/chart 薄代理端點，回傳 Yahoo 原始 chart JSON"
      exports: ["default", "maxDuration"]
    - path: "api/yahoo/search.ts"
      provides: "GET /api/yahoo/search 薄代理端點，回傳 Yahoo 原始 search JSON"
      exports: ["default", "maxDuration"]
  key_links:
    - from: "services/yahoo.ts"
      to: "/api/yahoo/chart"
      via: "fetch，取代原 PROXIES 輪替 + corsproxy/allorigins 拼接"
      pattern: "fetch\\(.*api/yahoo/chart"
    - from: "services/stockDirectory.ts"
      to: "/api/yahoo/search"
      via: "fetch，取代原 PROXIES 輪替"
      pattern: "fetch\\(.*api/yahoo/search"
    - from: "api/yahoo/chart.ts"
      to: "api/_lib/yahoo.ts"
      via: "呼叫共用握手 + 白名單驗證函式"
      pattern: "from ['\"]\\.\\./_lib/yahoo['\"]"
---

<objective>
把前端對 Yahoo Finance 的兩個呼叫點（`services/yahoo.ts` 的行情 chart、`services/stockDirectory.ts` 的 `searchYahoo`）從「經 `corsproxy.io`/`allorigins.win` 公用 proxy 直連 Yahoo」改為「打自家後端 `/api/yahoo/chart` 與 `/api/yahoo/search`」。後端在 Vercel Node.js function 內完整實作 Yahoo 的 cookie/crumb 握手，回傳 Yahoo 原始 JSON（不做任何 normalize），前端既有的 800 行解析邏輯（`processYahooResult`、intraday shift、synthetic 補值、指標計算等）完全不動。

Purpose: 消除對不受信任公用 CORS proxy 的依賴（限流、停機、竄改風險），同時把行情代理端點做成不可被當開放代理濫用的白名單閘道。這是 PROXY-03、PROXY-06、FE-02 三項需求的完整交付。

Output:
- `api/_lib/yahoo.ts` — Yahoo 專屬共用邏輯（握手、快取、白名單）
- `api/yahoo/chart.ts` — chart 端點
- `api/yahoo/search.ts` — search 端點
- `services/yahoo.ts`、`services/stockDirectory.ts` 改接後端，簽章與回傳型別不變
</objective>

<execution_context>
@E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/workflows/execute-plan.md
@E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
## 給冷啟動執行者的前提（濃縮自 `.planning/phases/02-yahoo/02-CONTEXT.md` D-01~D-06）

這份計畫要交給一個沒有本次對話背景的執行者。以下決策**已拍板，不可重新設計、不可更動**：

- **D-01（雙端點，不做萬用閘道）**：建立 `api/yahoo/chart.ts`（行情 OHLCV）與 `api/yahoo/search.ts`（海外搜尋）兩個獨立端點。**絕不**做 `/api/yahoo?target=` 這種單一萬用轉發閘道（研究文件 `ARCHITECTURE.md` Anti-Pattern 3 明確警告：任意 URL 轉發等於把公用 proxy 的風險搬到自家伺服器）。
- **D-02（薄代理，回原始 JSON，前端解析零變動）**：後端只做「cookie/crumb 握手 → 帶握手打 Yahoo → 原封不動回傳 Yahoo 原始 JSON」。`chart.ts` 回傳 Yahoo 的 `{ chart: { result: [...], error: ... } }` 結構；`search.ts` 回傳 Yahoo search 的原始 JSON（含 `quotes` 欄位）。**前端 `processYahooResult`、intraday shift、synthetic 補值、指標計算、`searchYahoo` 內的 `.map()` 解析邏輯，一行都不准改** —— 只把「怎麼打到 Yahoo」換成「打自家端點」。這是為了讓 PROXY-06（型別契約不變）與 FE-02 的回歸風險降到最低；把解析搬到後端＝重寫資料管線，是本階段明確要避免的範圍膨脹。
- **D-03（cookie/crumb 握手，含重試）**：
  1. GET 一個 Yahoo 頁面（如 `https://fc.yahoo.com`）取得 `Set-Cookie`。
  2. 帶著這個 cookie GET `https://query2.finance.yahoo.com/v1/test/getcrumb`，回應 body（純文字）即 crumb。
  3. chart/search 正式請求要帶上 cookie header + `crumb` query 參數。
  4. 遇到 401/429：清掉記憶體中的 crumb 快取、做一次指數退避後重新握手＋重打一次；仍失敗才把錯誤分類回傳給前端。
  5. 所有對 Yahoo 的請求（握手與正式請求）都要帶瀏覽器式 `User-Agent` 與 `Accept` header——研究 `PITFALLS.md` 明確指出缺省 UA 更容易被 Yahoo 反爬機制擋下。
- **D-04（crumb 快取＝function 記憶體，short-TTL，不外部化）**：crumb（連同對應的 cookie）快取在 function 模組層級的記憶體變數，TTL 約 10 分鐘（可用常數表示，如 `CRUMB_TTL_MS = 10 * 60 * 1000`）。**本階段不得引入 Vercel KV / Upstash Redis 等外部儲存**——那是 Phase 4 防濫用限流的事，本階段若冷啟動或多實例各自握手一次，是已知且可接受的取捨，不要為此加外部依賴。
- **D-05（參數白名單，非法值一律 400）**：
  - `interval` 只允許 `{ '1d', '1wk', '1mo', '60m', '15m' }`，其他值一律拒絕。
  - `range` 依 `interval` 綁定（比照現有 `services/yahoo.ts` 的 `getStockData` 硬編對照表：`1d→10y`、`1wk→5y`、`1mo→max`、`60m→1y`、`15m→60d`）。**後端驗證時 `range` 不是自由字串**——每個 `interval` 只接受它對應的那一個 `range` 值（如果前端另外傳了不同組合，視為不合法，回 400）。這比「range 也開一個獨立白名單，任意 interval/range 組合都放行」更嚴，是刻意的設計：避免端點被當成可自由組合查詢任何區間的開放代理。
  - `symbol` 做基本格式檢查：台股格式為 `數字(3-6碼)+可選單一大寫字母` 加上 `.TW` 或 `.TWO` 後綴（例：`2330.TW`、`00981A.TW`）；美股/海外格式為 `1-6 碼英文字母，可選 `.` 加後綴`（例：`AAPL`、`BRK.B`）。不符合任一格式一律 400。
  - 非白名單參數（interval、range 組合、symbol 格式）一律回 400，**不透傳** Yahoo 或內部原因，只回 `{ code, message }`（中文訊息，比照 Phase 1 `api/gemini.ts` 慣例）。
- **D-06（逾時與錯誤分類）**：`api/yahoo/chart.ts` 與 `api/yahoo/search.ts` 都設 `export const maxDuration = 30;`（比 Gemini 的 120s 短得多，這是行情類端點的合理上限）。錯誤一律分類為 `{ code, message }` 回前端，**不透傳** Yahoo 上游原始錯誤內容／URL。錯誤碼至少涵蓋：`BAD_REQUEST`（白名單驗證失敗）、`UPSTREAM_UNAUTHORIZED`（cookie/crumb 握手或請求本身 401，重試後仍失敗）、`RATE_LIMITED`（429，重試後仍失敗）、`UPSTREAM_ERROR`（其他上游錯誤或逾時）、`NOT_FOUND`（Yahoo 回應 `chart.error.code === 'Not Found'` 或 search 查無結果——**search 查無結果不算錯誤，正常回空陣列**，`NOT_FOUND` 只用於 chart 端點的股票代碼不存在）。

**Claude's Discretion（planner 已決定的落地方式，執行者比照即可，不必重新評估）：**
- FinMind fallback 留在前端直連，`services/yahoo.ts` 內 `fetchFinMindDailyData`/`fetchInstitutionalData`/`fetchFinMindPriceVolume`/`fetchFinMindStockInfo` 全部不動，本階段完全不碰。
- 不加任何回應層快取（無 `Cache-Control`/`s-maxage`，無記憶體回應快取）——那是 Phase 3 CACHE-01 的事。
- 共用層延續 Phase 1 `api/_lib/` 風格：Origin/Referer 檢查直接複用既有 `api/_lib/guard.ts` 的 `isAllowedOrigin`，不新增或修改該檔案。Yahoo 專屬的握手/白名單邏輯放新檔 `api/_lib/yahoo.ts`（底線前綴，不會被 Vercel 當成路由）。
- 不在本階段加 rate limit（Phase 4 的事）。

## 讀取本計畫前應理解的既有程式碼（已由 planner 讀過，重點摘錄，執行者仍應自行開檔確認實際內容以防漂移）

### `services/yahoo.ts`（800 行，本階段唯一要動的部分是「怎麼打到 Yahoo」，其餘不動）
- **L7-10**：`PROXIES` 陣列（`corsproxy.io`、`allorigins.win`）——**本階段要完全移除**。
- **L12-14**：`YAHOO_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart/'`、`FINMIND_BASE`——`YAHOO_BASE` 不再需要（後端才知道 Yahoo URL），`FINMIND_BASE` 不動。
- **L16-45**：`YahooChartResponse` 型別定義——**保留不動**，前端仍用這個型別解析後端回傳的原始 JSON。
- **L273-335**：`queryYahoo(symbol, interval, range)` 函式——這是本階段要改寫的核心函式。現況：組 Yahoo target URL，`for (const proxy of PROXIES)` 迴圈依序試兩個公用 proxy，成功則回傳 `json as YahooChartResponse`。**改寫後**：不再迴圈試 proxy，改成單一 `fetch` 打 `/api/yahoo/chart?symbol=...&interval=...&range=...`（同源、無需 proxy 前綴），檢查 `res.ok`、解析 JSON、維持既有的「`json.chart.error` → 拋錯（含 `Not Found` 特判）」「`!json.chart.result` → 拋錯」邏輯（這段錯誤處理是前端既有行為，不變）。
- **L337-371**：`fetchRawData(symbol, interval, range)`——呼叫 `queryYahoo` 的封裝，**不動**（台股 `.TW`/`.TWO` 嘗試邏輯與美股邏輯不變，因為 `queryYahoo` 簽章不變）。
- **L373-474**：`processYahooResult(...)`——**完全不動**（synthetic 補值等既有邏輯）。
- **L476-493**：`getLatestPrice(...)`——**完全不動**（呼叫 `fetchRawData`，簽章不變則此函式零修改）。
- **L495-801**：`getStockData(...)`——**完全不動**（interval→range 對照表在這裡，L497-509；FinMind fallback 在 L530-554，均維持前端直連，不搬後端）。

### `services/stockDirectory.ts`（136 行）
- **L15-16**：`FINMIND`、`PROXIES` 常數——`PROXIES` 本階段要移除（`FINMIND` 不動）。
- **L91-116**：`searchYahoo(query, limit)`——現況：組 Yahoo search target URL，`for (const proxy of PROXIES)` 迴圈試兩個公用 proxy，成功後 `.map()` 解析 `quotes` 陣列成 `StockDirEntry[]`。**改寫後**：不再迴圈試 proxy，改成單一 `fetch` 打 `/api/yahoo/search?q=...&limit=...`（同源），解析邏輯（`.filter()`/`.map()` 那段，L100-112）**完全不動**。函式簽章 `searchYahoo(query: string, limit = 8): Promise<StockDirEntry[]>` 不變。
- 其餘函式（`ensureTaiwanDirectory`、`searchTaiwan`、`searchStocks`）**完全不動**（FinMind 目錄呼叫留在前端，這是 Phase 3 的事）。

### Phase 1 既有後端模式（`api/_lib/config.ts`、`api/_lib/http.ts`、`api/_lib/guard.ts`、`api/gemini.ts`）
延續這些既有慣例：
- **薄轉發** + **參數驗證** + **錯誤分類 `{ code, message }`**（中文訊息）+ **`export const maxDuration = N`**（具名匯出，無需 `vercel.json`——本專案目前沒有 `vercel.json`，Phase 1 就是靠這個具名匯出設定逾時，Phase 2 比照辦理）。
- **不裝 `@vercel/node`**：handler 用本地最小型別定義請求/回應介面（比照 `api/gemini.ts` 的 `GeminiReq`/`GeminiRes` 寫法），因為 Phase 1 SUMMARY 記錄了安裝 `@vercel/node`在此環境不穩定，已改用本地最小型別。
- **Origin/Referer 檢查**：直接 import `api/_lib/guard.ts` 的 `isAllowedOrigin(req)`，用法比照 `api/gemini.ts` L42-48（`if (!isAllowedOrigin(req)) { res.status(403).json(...); return; }`）。
- **錯誤分類模式**：定義一個 `ClassifiedError` 風格的錯誤類別（可放進新的 `api/_lib/yahoo.ts`，不需要跟 Gemini 共用同一個類別，因為錯誤碼集合不同），`statusByCode` 對照表 + `try/catch` 在 handler 內轉換成 `res.status(...).json({ code, message })`，訊息永遠是固定中文字串（比照 `api/gemini.ts` 的 `errorMessages` record 寫法），絕不透傳 Yahoo 原始錯誤內容。

### 本地開發環境
沿用 Phase 1 已設定好的雙進程模式：Vite（port 3000）+ `vercel dev --listen 3001`，`vite.config.ts` 已設好 `/api` proxy 轉發到 3001，本階段**不需要**改動 `vite.config.ts`。

### 驗證指令環境（沿用 Phase 1 彩排裁定 #5，勿踩同一雷）
本計畫各 `<verify>` 區塊寫的是 **Bash 語法**（`&&`、`grep`、`npx`）。**請在 Git Bash 執行這些驗證命令**（該環境 `&&`/`grep`/`npx` 皆正常）。若你身處 PowerShell：`npx` 會被 execution policy 擋 `npx.ps1`，改用 **`npx.cmd`**；PowerShell 沒有 `grep`，改用 **`Select-String`**（例：`Select-String -Path services\yahoo.ts,services\stockDirectory.ts -Pattern "corsproxy\.io|allorigins\.win|PROXIES"` 應無命中）。這是 Phase 1 SUMMARY 已記錄的環境事實。
</context>

<tasks>

<task type="auto">
  <name>Task 1: 建立 Yahoo 共用邏輯層 api/_lib/yahoo.ts</name>
  <files>api/_lib/yahoo.ts</files>
  <action>
建立新檔 `api/_lib/yahoo.ts`（底線前綴，不會被 Vercel 當成路由端點），實作 Phase 2 需要的所有共用邏輯，供 `api/yahoo/chart.ts` 與 `api/yahoo/search.ts` 匯入使用。內容包含：

1. **型別與錯誤分類**（比照 `api/_lib/http.ts` 的 `ClassifiedError`/`errorMessages`/`GeminiErrorCode` 寫法，但用 Yahoo 專屬的錯誤碼集合）：
   - `export type YahooErrorCode = 'BAD_REQUEST' | 'UPSTREAM_UNAUTHORIZED' | 'RATE_LIMITED' | 'UPSTREAM_ERROR' | 'NOT_FOUND';`
   - 一個 `errorMessages: Record<YahooErrorCode, string>` record，值為固定中文訊息（例：`BAD_REQUEST: '請求參數不正確，請確認股票代號與時間區間設定。'`、`UPSTREAM_UNAUTHORIZED: 'Yahoo 行情服務暫時無法驗證，請稍後再試。'`、`RATE_LIMITED: 'Yahoo 行情服務目前請求過於頻繁，請稍後再試一次。'`、`UPSTREAM_ERROR: 'Yahoo 行情服務暫時無法回應，請稍後再試。'`、`NOT_FOUND: '找不到該股票代號。'`）。
   - `export class YahooClassifiedError extends Error { code: YahooErrorCode; constructor(code, message = errorMessages[code]) {...} }`（比照 `ClassifiedError` 寫法，`this.name = 'YahooClassifiedError'`）。

2. **參數白名單驗證函式**（D-05 落地）：
   - `const INTERVAL_RANGE_MAP: Record<string, string> = { '1d': '10y', '1wk': '5y', '1mo': 'max', '60m': '1y', '15m': '60d' };`——注意這是 interval→唯一合法 range 的一對一對照，不是各自獨立的白名單陣列。
   - `export function validateChartParams(query: { symbol?: unknown; interval?: unknown; range?: unknown }): { symbol: string; interval: string; range: string }`：檢查 `interval` 是否為 `INTERVAL_RANGE_MAP` 的 key，檢查傳入的 `range` 是否等於該 interval 對應的唯一合法值，檢查 `symbol` 是否符合正則（台股：`/^\d{3,6}[A-Z]?\.TWO?$/`；美股/海外：`/^[A-Z]{1,6}(\.[A-Z]{1,2})?$/i`，兩者符合其一即可）。任何一項不合法就 `throw new YahooClassifiedError('BAD_REQUEST')`。全部合法則回傳 trim 過的三個字串。
   - `export function validateSearchParams(query: { q?: unknown; limit?: unknown }): { q: string; limit: number }`：檢查 `q` 為非空字串（trim 後長度 1-100）；`limit` 若提供需為 1-20 之間的整數，否則預設 8。不合法（`q` 為空或過長）則 `throw new YahooClassifiedError('BAD_REQUEST')`。

3. **cookie/crumb 握手與快取**（D-03、D-04 落地）：
   - 模組層級變數：`let cachedCookie: string | null = null; let cachedCrumb: string | null = null; let crumbFetchedAt = 0;` 以及 `const CRUMB_TTL_MS = 10 * 60 * 1000;`（10 分鐘）。
   - 共用 header 常數：`const BROWSER_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };`（瀏覽器式 UA，具體版本號不重要，重點是像真實瀏覽器）。
   - `async function fetchCookie(): Promise<string>`：`fetch('https://fc.yahoo.com', { headers: BROWSER_HEADERS })`，從回應的 `Set-Cookie` header 取值（Node fetch 環境用 `res.headers.get('set-cookie')`，若該環境回傳單一字串就直接用；若需要處理多個 `Set-Cookie` entries，用 `res.headers.getSetCookie?.()`（Node 18.14+ 支援）優先，退回 `get('set-cookie')`）。取不到則 `throw new YahooClassifiedError('UPSTREAM_UNAUTHORIZED')`。
   - `async function fetchCrumb(cookie: string): Promise<string>`：帶 `Cookie: cookie` header 打 `https://query2.finance.yahoo.com/v1/test/getcrumb`，回應狀態非 2xx 則依狀態碼分類拋錯（401→`UPSTREAM_UNAUTHORIZED`、429→`RATE_LIMITED`、其他→`UPSTREAM_ERROR`），成功則回傳 `(await res.text()).trim()`。
   - `async function ensureCrumb(forceRefresh = false): Promise<{ cookie: string; crumb: string }>`：若 `!forceRefresh && cachedCookie && cachedCrumb && (Date.now() - crumbFetchedAt < CRUMB_TTL_MS)` 直接回傳快取值；否則呼叫 `fetchCookie()` → `fetchCrumb(cookie)`，成功後更新三個模組變數並回傳新值。
   - `export async function fetchYahooWithHandshake(buildUrl: (params: { cookie: string; crumb: string }) => string): Promise<Response>`：核心握手＋重試邏輯。流程：
     1. `let { cookie, crumb } = await ensureCrumb();`
     2. `let res = await fetch(buildUrl({ cookie, crumb }), { headers: { ...BROWSER_HEADERS, Cookie: cookie } });`
     3. 若 `res.status === 401 || res.status === 429`：清空快取（`cachedCookie = null; cachedCrumb = null;`），等待一個短暫退避（例如 `await new Promise(r => setTimeout(r, 500));`），呼叫 `({ cookie, crumb } = await ensureCrumb(true));`，重打一次 `res = await fetch(buildUrl({ cookie, crumb }), { headers: { ...BROWSER_HEADERS, Cookie: cookie } });`。
     4. 重試後仍非 2xx：依最終狀態碼 `throw new YahooClassifiedError(status === 401 ? 'UPSTREAM_UNAUTHORIZED' : status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR')`。
     5. 成功則 `return res;`（呼叫端自行 `.json()`）。
   - 這個函式讓 `chart.ts` 與 `search.ts` 都能用同一套「握手 + 帶 crumb 打 Yahoo + 401/429 重試一次」邏輯，各自只需傳入自己的 URL builder。

4. **上游錯誤分類輔助**（給 handler 最外層 catch 用）：
   - `export function classifyYahooError(error: unknown): YahooClassifiedError`：若已是 `YahooClassifiedError` 則直接回傳；否則依 `error` 訊息或 `name` 判斷（`AbortError`/逾時關鍵字 → `UPSTREAM_ERROR`），預設回傳 `new YahooClassifiedError('UPSTREAM_ERROR')`（比照 `api/_lib/http.ts` 的 `classifyGeminiError` 寫法但不需要 404 model 判斷）。

命名與程式風格比照 `api/_lib/http.ts`／`api/_lib/config.ts`：2 空格縮排、單引號、具名 export、無 barrel、Traditional Chinese 註解說明非顯而易見的商業邏輯（例如為何 range 綁死單一值、為何要重試一次）。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <done>`api/_lib/yahoo.ts` 存在，匯出 `YahooErrorCode`、`YahooClassifiedError`、`validateChartParams`、`validateSearchParams`、`fetchYahooWithHandshake`、`classifyYahooError`；`npx tsc --noEmit` 0 錯誤。</done>
</task>

<task type="auto">
  <name>Task 2: 建立 chart 與 search 兩個 Yahoo 代理端點</name>
  <files>api/yahoo/chart.ts, api/yahoo/search.ts</files>
  <action>
建立兩個新端點檔案，比照 `api/gemini.ts` 的整體結構（本地最小 req/res 型別、`isAllowedOrigin` 檢查、`try/catch` + 錯誤分類 + `statusByCode` 對照、`export const maxDuration`），但改為 GET 方法、無 body、查詢字串驗證。

**`api/yahoo/chart.ts`**：
- 本地型別：`interface YahooReq { method?: string; headers: Record<string, string | string[] | undefined>; query: Record<string, string | string[] | undefined>; }` 與 `interface YahooRes { status(code: number): YahooRes; json(data: unknown): void; }`（Vercel Node handler 的 `req.query` 是 Vercel 平台自動解析好的物件，直接用即可，不需要手動 parse URL）。
- import `isAllowedOrigin` from `../_lib/guard`；import `validateChartParams`, `fetchYahooWithHandshake`, `classifyYahooError`, `YahooClassifiedError`, `YahooErrorCode` from `../_lib/yahoo`。
- `const statusByCode: Record<YahooErrorCode, number> = { BAD_REQUEST: 400, UPSTREAM_UNAUTHORIZED: 502, RATE_LIMITED: 429, UPSTREAM_ERROR: 502, NOT_FOUND: 404 };`
- `export const maxDuration = 30;`
- `export default async function handler(req: YahooReq, res: YahooRes)`：
  1. 若 `req.method !== 'GET'` → 405 + `{ code: 'BAD_REQUEST', message: '僅支援 GET 請求。' }`。
  2. 若 `!isAllowedOrigin(req)` → 403 + `{ code: 'BAD_REQUEST', message: '請求來源不被允許。' }`。
  3. `try` 區塊：呼叫 `const { symbol, interval, range } = validateChartParams(req.query);`（不合法會拋 `YahooClassifiedError('BAD_REQUEST')`，被下方 catch 接住）。
  4. 用 `fetchYahooWithHandshake(({ cookie, crumb }) => ...)` 組出 Yahoo chart URL：`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includeAdjustedClose=true&includePrePost=false&lang=zh-Hant-TW&region=TW&crumb=${encodeURIComponent(crumb)}`（比照既有 `services/yahoo.ts` L275 的既有 query string 組成方式，新增 `crumb` 參數；不需要 `_rand` cache-buster，因為現在是伺服器對伺服器、無 proxy 快取問題）。
  5. `const upstreamRes = await fetchYahooWithHandshake(...)`；`const json = await upstreamRes.json();`
  6. 若 `json?.chart?.error?.code === 'Not Found'` → `throw new YahooClassifiedError('NOT_FOUND')`。
  7. 成功：`res.status(200).json(json);`（原封不動回傳 Yahoo 的完整 `{ chart: {...} }` JSON，不做任何欄位挑選或轉換——這是 D-02 的核心要求）。
  8. `catch (error)`：分類（`error instanceof YahooClassifiedError ? error : classifyYahooError(error)`），`console.error` 記錄（比照 `api/gemini.ts` 用 `[yahoo-chart:${code}] ...` 前綴，訊息不含 Yahoo 原始回應內容，只印分類後的 code 與一句安全描述），`res.status(statusByCode[code]).json({ code, message })`。

**`api/yahoo/search.ts`**：
- 結構與上面幾乎相同，差異：
  - `validateSearchParams(req.query)` 取得 `{ q, limit }`。
  - Yahoo search URL：`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${limit}&newsCount=0&lang=zh-Hant-TW&region=TW&crumb=${encodeURIComponent(crumb)}`（比照既有 `services/stockDirectory.ts` L94 的既有 query string，新增 `crumb` 參數）。
  - search 端點沒有 `chart.error.code === 'Not Found'` 這種情境；Yahoo search 查無結果時回應仍是 2xx 且 `quotes` 為空陣列或不存在，這種情況**不算錯誤**，直接把 Yahoo 原始 JSON 原封不動回傳（`res.status(200).json(json)`），前端既有的 `.filter()`/`.map()` 邏輯會自然處理空 `quotes`。
  - `maxDuration = 30`（與 chart 端點一致）。

兩個檔案都要遵守：
- 錯誤訊息永遠固定中文（來自 `api/_lib/yahoo.ts` 的 `errorMessages`），絕不透傳 Yahoo 原始錯誤內容或 URL 到前端或 log。
- 不裝 `@vercel/node`，用本地最小介面（比照 Task 1 的說明與 `api/gemini.ts` 既有寫法）。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <done>`api/yahoo/chart.ts` 與 `api/yahoo/search.ts` 存在，各自匯出 `default handler` 與 `maxDuration = 30`；兩者都呼叫 `api/_lib/yahoo.ts` 的驗證與握手函式；`npx tsc --noEmit` 0 錯誤。</done>
</task>

<task type="auto">
  <name>Task 3: 前端改接後端端點，移除公用 proxy</name>
  <files>services/yahoo.ts, services/stockDirectory.ts</files>
  <action>
**`services/yahoo.ts`**：
1. 刪除 L7-10 的 `PROXIES` 陣列與其上方註解區塊（`// PROXY ROTATION STRATEGY` 那兩行說明也一併刪除）。
2. 刪除 L12-13 的 `YAHOO_BASE` 常數（不再需要，Yahoo URL 只存在後端）；`FINMIND_BASE`（L14）保留不動。
3. 改寫 `queryYahoo(symbol: string, interval: string, range: string): Promise<YahooChartResponse>`（原 L273-335）為：
   - 組 `const qs = new URLSearchParams({ symbol, interval, range }).toString();`
   - `const res = await fetch(\`/api/yahoo/chart?${qs}\`);`
   - 若 `!res.ok`：嘗試 `await res.json()` 取得後端的 `{ code, message }`，若解析成功則 `throw new Error(parsed.message || 'Yahoo 行情服務暫時無法回應')`；解析失敗則 `throw new Error(\`Fetch error (${res.status})\`)`（維持與既有錯誤處理心智模型一致，前端 catch 邏輯不用改）。
   - `const json = await res.json();`
   - 保留既有的 Yahoo-specific 錯誤判斷邏輯（維持 L308-319 原有的這兩段判斷，只是判斷對象換成這次拿到的 `json`）：
     - 若 `json.chart && json.chart.error`：`Not Found` code 則 `throw new Error(\`Symbol ${symbol} not found.\`)`，否則 `throw new Error(JSON.stringify(json.chart.error))`。
     - 若 `!json.chart || !json.chart.result || json.chart.result.length === 0`：`throw new Error('No data found in response')`。
   - 成功則 `return json as YahooChartResponse;`。
   - **移除**整個 `for (const proxy of PROXIES)` 迴圈與 proxy 輪替、`isAllOrigins`/`cacheBuster`/`_rand` 相關程式碼——這些是公用 proxy 特有的繞過快取/限流手法，同源後端呼叫不需要。
   - 函式簽章 `queryYahoo(symbol: string, interval: string, range: string): Promise<YahooChartResponse>` **不變**，因為 `fetchRawData` 與其呼叫者完全不用跟著改。
4. `fetchRawData`（L337-371）、`processYahooResult`（L373-474）、`getLatestPrice`（L476-493）、`getStockData`（L495-801）**完全不動**——這些函式都不直接碰 `PROXIES`/`YAHOO_BASE`，只透過 `fetchRawData` → `queryYahoo` 間接呼叫，改寫 `queryYahoo` 內部實作對它們透明。

**`services/stockDirectory.ts`**：
1. 刪除 L16 的 `PROXIES` 常數（`FINMIND`、`LS_KEY`、`LS_TS`、`TTL` 保留不動）。
2. 改寫 `searchYahoo(query: string, limit = 8): Promise<StockDirEntry[]>`（原 L91-116）為：
   - `const q = query.trim(); if (!q) return [];`（保留既有 guard）。
   - `const qs = new URLSearchParams({ q, limit: String(limit) }).toString();`
   - `try { const res = await fetch(\`/api/yahoo/search?${qs}\`); if (!res.ok) return []; const json = await res.json(); const quotes: any[] = json.quotes || []; return quotes.filter(...).map(...); } catch { return []; }`——把原本 L95-114 的 `for (const proxy of PROXIES) { try {...} catch {...} }` 迴圈換成單一 `try/catch`（同源請求失敗直接回空陣列，維持既有「搜尋失敗不拋錯、回空陣列」的行為）。
   - **`.filter()` 與 `.map()` 內部的解析邏輯（原 L100-112，判斷 `quoteType`、組 `market`、组 `StockDirEntry`）完全不動**，只是換了資料來源（原本是迴圈內某個 proxy 回應的 `json`，現在是同源 fetch 回應的 `json`）。
   - 函式簽章與回傳型別 `Promise<StockDirEntry[]>` **不變**。
3. `ensureTaiwanDirectory`、`searchTaiwan`、`searchStocks` **完全不動**。

改完後執行一次全域搜尋確認乾淨移除：確認 `services/yahoo.ts` 與 `services/stockDirectory.ts` 內都不再出現 `corsproxy.io`、`allorigins.win`、`PROXIES` 字樣。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" &amp;&amp; npx tsc --noEmit &amp;&amp; ! grep -E "corsproxy\.io|allorigins\.win|PROXIES" services/yahoo.ts services/stockDirectory.ts</automated>
  </verify>
  <done>`services/yahoo.ts` 的 `queryYahoo` 改打 `/api/yahoo/chart`，`services/stockDirectory.ts` 的 `searchYahoo` 改打 `/api/yahoo/search`；两檔均無 `corsproxy.io`/`allorigins.win`/`PROXIES` 殘留；`getStockData`/`getLatestPrice`/`searchYahoo` 對外簽章與回傳型別不變；`npx tsc --noEmit` 0 錯誤。</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: 人工驗證 Yahoo 代理端到端行為與公用 proxy 移除</name>
  <what-built>
後端兩個 Yahoo 代理端點（`api/yahoo/chart.ts`、`api/yahoo/search.ts`，含 `api/_lib/yahoo.ts` 的 cookie/crumb 握手與參數白名單），以及前端 `services/yahoo.ts`／`services/stockDirectory.ts` 改接這兩個端點、移除公用 CORS proxy 依賴。
  </what-built>
  <how-to-verify>
1. 執行 `npm run build`，確認 build 成功無錯誤（Bash 工具執行，非 PowerShell）。
2. 開兩個終端機／終端分頁：
   - 分頁 A：`npx vercel dev --listen 3001`（第一次可能要求登入/連結專案）。
   - 分頁 B：`npm run dev`（Vite，port 3000）。
3. 瀏覽器開 `http://localhost:3000`，開啟 DevTools Network 分頁，過濾 `Fetch/XHR`。
4. 搜尋任一檔台股（例：輸入 `2330` 或「台積電」）並載入其行情圖表：
   - 確認 Network 分頁只出現 `/api/yahoo/chart?...` 與（如有觸發搜尋）`/api/yahoo/search?...` 這兩種同源請求。
   - 確認**完全沒有**對 `corsproxy.io` 或 `api.allorigins.win` 的請求。
   - 確認圖表正常顯示 K 線、成交量、技術指標，與遷移前行為一致。
5. 搜尋一檔美股（例：`AAPL`）確認搜尋建議與圖表載入正常，Network 分頁同樣只見 `/api/yahoo/*`。
6. 切換不同 K 線週期（日線/週線/月線/60分/15分），確認圖表隨之更新且無錯誤訊息。
7. 嘗試搜尋一個不存在的代號（例：`ZZZZZZ`），確認前端顯示合理的「找不到該股票代號」類錯誤訊息，而不是整頁崩潰或顯示英文技術錯誤堆疊。
8. （可選但建議）打開瀏覽器 DevTools Console，確認沒有出現 CORS 相關錯誤、也沒有 Yahoo 原始錯誤 URL 外洩到 console。
  </how-to-verify>
  <resume-signal>輸入 "approved" 或描述遇到的問題（例如：401/429、圖表空白、搜尋無回應等）</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|--------------|
| Browser → `/api/yahoo/*` | 前端使用者輸入（symbol/query）跨越到後端，未受信任 |
| `/api/yahoo/*` → Yahoo query1/query2 | 後端出口請求跨越到第三方非官方端點 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01 | Tampering | `api/yahoo/chart.ts` 的 `symbol`/`interval`/`range` 參數 | mitigate | `validateChartParams` 白名單驗證：interval 限定 5 個值、range 與 interval 一對一綁定（非自由組合）、symbol 正則檢查，任何不符一律 400（D-05） |
| T-02-02 | Tampering | `api/yahoo/search.ts` 的 `q`/`limit` 參數 | mitigate | `validateSearchParams` 限制 `q` 長度與非空、`limit` 範圍 1-20，避免超長查詢或過大 `quotesCount` 濫用上游 |
| T-02-03 | Elevation of Privilege（SSRF 風險） | Yahoo 端點被當成任意 URL 開放代理 | mitigate | D-01 拒絕萬用閘道設計；symbol/interval/range/q 均為白名單枚舉或格式化正則，無法注入任意上游路徑（比照 `ARCHITECTURE.md` Anti-Pattern 3） |
| T-02-04 | Information Disclosure | Yahoo 上游錯誤內容/URL/cookie 外洩到前端或 log | mitigate | 所有錯誤經 `classifyYahooError`/`YahooClassifiedError` 轉為固定中文 `{ code, message }`；`console.error` 只印分類後 code，不印 Yahoo 原始回應或 cookie/crumb 值 |
| T-02-05 | Denial of Service | Yahoo 端點被高頻呼叫拖垮後端出口或撞上游限流 | accept | 本階段刻意不加 rate limit（Phase 4 範圍，D-06 授權預設）；`maxDuration = 30` 限制單次請求耗用時長作為最低防線 |
| T-02-06 | Spoofing | 非自家網域呼叫 `/api/yahoo/*` | mitigate | 複用既有 `api/_lib/guard.ts` 的 `isAllowedOrigin` Origin/Referer 檢查（Phase 1 已建立，非本階段新增邏輯，僅延續使用） |
| T-02-SC | Tampering | 本階段無新增 npm 套件安裝 | accept | 無套件安裝任務，不適用 Package Legitimacy Gate；沿用 Node 18+ 內建 `fetch`，無新依賴 |
</threat_model>

<verification>
## 整體階段驗證

1. **型別檢查**：`npx tsc --noEmit`（Bash 工具執行）在每個 auto 任務後皆為 0 錯誤。
2. **Build**：`npm run build` 成功完成（於 checkpoint 任務前執行一次確認）。
3. **Proxy 移除確認**：`grep -rE "corsproxy\.io|allorigins\.win" services/` 命中數為 0。
4. **契約不變確認**：`getStockData`、`getLatestPrice`（`services/yahoo.ts`）與 `searchYahoo`（`services/stockDirectory.ts`）的函式簽章、回傳型別與遷移前逐字相同（可用 `git diff` 確認這三個函式的簽章行未變）。
5. **白名單驗證確認**（人工，可在 checkpoint 前用 curl/瀏覽器直接測）：對 `/api/yahoo/chart?symbol=2330.TW&interval=5m&range=1d` 這種非白名單 interval 發請求，應收到 400 + 中文錯誤訊息，而非 500 或透傳 Yahoo 錯誤。
6. **Checkpoint 人工驗證**：Network 分頁只見同源 `/api/yahoo/*`、圖表與搜尋行為與遷移前一致（見 checkpoint 任務 `<how-to-verify>`）。
</verification>

<success_criteria>
本計畫完成時，以下皆為真：

1. 使用者查詢任一檔台股/美股，行情與圖表正常顯示，前端不再呼叫 `corsproxy.io`/`allorigins.win`，Network tab 只見同源 `/api/yahoo/*`（對應 ROADMAP Phase 2 成功標準 1）。
2. 後端對 `interval`/`range` 做白名單檢查，非白名單參數被拒（400），端點不可被當成開放代理（對應 ROADMAP Phase 2 成功標準 3）。
3. 前端 `services/yahoo.ts` 解析出的 `StockDataPoint[]` 與既有型別完全相容，圖表、過濾器、提示詞無須改動（對應 ROADMAP Phase 2 成功標準 4）。
4. `npx tsc --noEmit` 全程 0 錯誤，`npm run build` 成功。
5. Checkpoint 人工驗證通過（圖表/搜尋行為與遷移前一致、無 401/429 立即可見的異常、找不到代號時顯示可辨識中文錯誤）。

**部署後才能驗證、本計畫範圍內無法自動驗收的項目**（見下方「未決點」）：
- ROADMAP Phase 2 成功標準 2「部署到 Vercel 後，Yahoo 路徑連續實測 ≥30 分鐘不出 401/429」——此項本質上需要真實 Vercel datacenter IP 環境與時間流逝，無法在規劃或本機執行階段驗證，留給部署後的人工驗收動作。
</success_criteria>

<output>
Create `.planning/phases/02-yahoo/02-01-SUMMARY.md` when done
</output>

---

## Requirements 對應表

| Requirement | 對應任務 | 說明 |
|-------------|----------|------|
| PROXY-03 | Task 1, Task 2 | 建立 `/api/yahoo/chart`、`/api/yahoo/search`，後端實作完整 cookie/crumb 握手（含瀏覽器式 UA、crumb 短 TTL 記憶體快取），移除前端對公用 CORS proxy 的依賴 |
| PROXY-06 | Task 2, Task 3 | 代理端點回傳 Yahoo 原始 JSON（不做 normalize），前端 `StockDataPoint[]`/`StockInfo` 契約完全不變 |
| FE-02 | Task 3 | `services/yahoo.ts`、`services/stockDirectory.ts` 改接 `/api/yahoo/*`，函式簽章與回傳型別不變 |

## 誠實的未決點（Unresolved / 需部署後驗證）

1. **Yahoo cookie/crumb 握手在 Vercel datacenter IP 上的實際成功率未知**——研究文件（`PITFALLS.md` Pitfall 3、`SUMMARY.md` Research Flags）明確標注這是社群實測（MEDIUM-HIGH confidence），非官方保證行為。本計畫已依 D-03 實作握手＋401/429 重試一次的邏輯，但**握手是否足夠應付 Vercel 出口 IP 被 Yahoo 更嚴格挑戰的情況，只有部署後實測 ≥30 分鐘才能確認**（ROADMAP Phase 2 成功標準 2）。如部署後仍持續 401，下一步是加大重試次數或評估釘住單一 region（`ARCHITECTURE.md`/`PITFALLS.md` 均提及此為可能的後續手段，但本階段不預先實作，避免過度工程化一個尚未證實存在的問題）。
2. **`res.headers.getSetCookie?.()` 在 Vercel Node runtime 的實際可用性未經本計畫驗證**——Task 1 的 `fetchCookie()` 實作已寫成「優先用 `getSetCookie()`，退回 `get('set-cookie')`」的防禦性寫法，但兩種路徑何者在部署環境實際生效，需執行時觀察（不影響型別檢查，但可能影響握手成功率，與未決點 1 相關）。
3. **crumb 10 分鐘 TTL 是否與 Yahoo 實際 cookie 過期週期（社群觀察約 10-20 分鐘）吻合**——D-04 選定 10 分鐘是保守值，若部署後觀察到過期更快導致間歇性 401，可能需要縮短 TTL 或提高「無論 TTL 是否到期，遇 401 就強制重新握手」的優先權（本計畫的重試邏輯已涵蓋後者，TTL 只是主動預防機制）。
4. **台股/美股 symbol 正則格式檢查的邊界案例覆蓋度**——Task 1 的 `validateChartParams` 正則基於 `services/yahoo.ts` 既有的隱式規則（3-6 碼數字+可選字母、`.TW`/`.TWO`）與美股常見格式推導，但 Yahoo 支援的完整代碼格式空間（如某些海外交易所後綴）未窮舉驗證；若 checkpoint 測試中發現合法代碼被誤擋，需調整正則（不影響架構決策，屬實作微調）。
5. **search 端點是否真的需要 crumb**——Yahoo 的 `/v1/finance/search` 過去多半**不需要** crumb；本計畫為求與 chart 一致，對 search 也走完整 `fetchYahooWithHandshake`。風險：若部署後出現「chart 正常但 search 因握手失敗而壞掉」，代表 search 被握手拖累。屆時的解法是讓 `search.ts` 改為**不強制 crumb**（握手失敗時 fallback 成無 crumb 直接查 search），與 chart 分開處理。本階段先走一致握手，checkpoint 若發現 search 異常再據此調整。

## 審查修正（2026-07-05，Codex 執行後 fresh-context 覆核發現，權威高於 D-05）

覆核窮舉前端所有 (interval,range) 組合與 symbol，發現 D-05 白名單有**兩個缺口**，必須修正（都在 `api/_lib/yahoo.ts`）：

**修正 1（必修 — 功能回歸）：symbol 白名單漏掉匯率格式 `=X`。**
`components/Portfolio.tsx` 用 `getLatestPrice('USDTWD=X')` 抓台美匯率，但 `validateChartParams` 的正則不接受含 `=` 的匯率代碼，後端會回 400；呼叫端有 try/catch 會靜默吞掉，導致匯率停在舊值（違反「行為與遷移前完全一致」）。**修法**：在 symbol 驗證額外允許 Yahoo 匯率格式，例如新增 pattern `/^[A-Z]{3,8}=X$/i`（`USDTWD=X`、`JPY=X` 等），三種格式（台股/海外/匯率）符合其一即通過。

**修正 2（必修 — 效率，同檔一併做）：白名單改為每個 interval 對應「一組」合法 range，並移除前端正規化 hack。**
`getLatestPrice` 用 `1d/5d`，原設計 `1d→10y` 一對一導致 `services/yahoo.ts:264-265` 加了「1d/5d 正規化成 1d/10y」的 hack，使抓最新價每次多拉約 480 倍資料（庫存頁逐檔高頻呼叫）。**修法**：
- `INTERVAL_RANGE_MAP` 由 `Record<string,string>` 改為 `Record<string,string[]>`：
  ```
  '1d':  ['10y', '5d'],
  '1wk': ['5y'],
  '1mo': ['max'],
  '60m': ['1y'],
  '15m': ['60d'],
  ```
- `validateChartParams` 改為「`range` 必須**屬於**該 interval 的合法陣列」（`allowed.includes(range)`），非 `===` 單一值。
- **移除** `services/yahoo.ts:264-265` 的正規化 hack，`queryYahoo` 原樣傳遞 `range`（讓 `1d/5d` 直接送後端、直接合法）。

安全不受影響：range 仍是封閉枚舉、symbol 仍是格式化正則，端點不會因此變成可注入任意上游的開放代理。

## 第二輪審查修正（2026-07-05，人工本機實測 100% 失敗後診斷發現，必修，權威覆蓋 D-03）

**根本原因（已用臨時診斷 log + stack trace 確認，非猜測）**：`api/_lib/yahoo.ts` 的 `fetchCookie()`（約 L104-111）在請求 `https://fc.yahoo.com` 後檢查 `if (!response.ok) throw classifyStatus(response.status)`。**但 `fc.yahoo.com` 這個端點本來就固定回傳 HTTP 404**（頁面標題含 "Not Found on Accelerator"，屬 Yahoo 已知怪異行為）——**它的 404 回應仍然夾帶我們需要的 `Set-Cookie` header**。目前程式碼把非 2xx 一律視為握手失敗，導致 `fetchCookie()` 每次都在讀取 `Set-Cookie`之前就先拋錯，**100% 必然失敗**（已在使用者本機用同樣邏輯的獨立 Node 腳本驗證：拿掉 `response.ok` 檢查後，同一支腳本可正常取得 cookie/crumb/chart 資料）。

**修法（`fetchCookie()` 唯一需要改的地方）**：移除 `if (!response.ok) throw classifyStatus(response.status)` 這個提前失敗的檢查（或至少不要因為 404 就直接丟錯）。改為：不論 HTTP 狀態碼為何，先嘗試從 `response.headers` 讀取 `Set-Cookie`；只有在**讀不到任何 cookie** 時才 `throw new YahooClassifiedError('UPSTREAM_UNAUTHORIZED')`（此檔案下方本來就有這個 fallback 判斷，L125-127，保留即可）。`fetchCrumb()`（L132-153）與 `fetchYahooWithHandshake()` 內對正式 chart/search 請求（L179-188）的 `response.ok` 檢查**維持不變**——這兩處檢查的是真正的 Yahoo API 端點，非 2xx 才代表真正失敗，不受本次修正影響。

**驗證方式**：修完後於本機 `vercel dev` 環境（非獨立 Node 腳本）重新搜尋 2330、美股 AAPL、切換週期、庫存頁匯率，Network 應全數回 200，`vercel dev` 終端機不應再出現 `[yahoo-chart:UPSTREAM_ERROR]`。
</output>
