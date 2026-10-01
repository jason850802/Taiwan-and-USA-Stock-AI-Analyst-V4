# Architecture

**Analysis Date:** 2026-10-01（整份重寫，取代 2026-05-31 版）

> 2026-05-31 版描述的是「純前端、無後端」的時期：瀏覽器經公共 CORS proxy 直連 Yahoo、直打 FinMind 與 Gemini，
> 金鑰經 `vite.config.ts` 注入前端，`index.html` 載入 esm.sh importmap 與 Tailwind CDN，元件只有 6 個。之後
> Gemini、Yahoo（2026-07-05）與 FinMind（2026-07-09）改由後端 `api/` 代打，importmap 與 Tailwind CDN 於
> 2026-07-13 移除，並陸續加入基本面分頁與庫存的帳務、對帳單匯入、歷史曲線、備份。
> 本版核對範圍：`index.html`、`index.tsx`、`App.tsx`、`types.ts`、`components/`、`services/`、`utils/`、`config/`、
> `api/`、`vite.config.ts`、`.vercelignore`；不含 `scripts/` 與 `.claude/skills/`（開發工具，不屬於 App）。
> 每條附對證的檔案、符號或指令；行數與行號是 2026-10-01 的快照，定位以函式名／符號名為準。舊版見
> `git show d8b50aa:.planning/codebase/ARCHITECTURE.md`（同日的部分核對版）與
> `git show 0e4085b:.planning/codebase/ARCHITECTURE.md`（2026-05-31 原版）。
> 分工：外部服務細節見 `INTEGRATIONS.md`、目錄見 `STRUCTURE.md`、已知問題見 `CONCERNS.md`、測試見 `TESTING.md`、
> 詞彙見根目錄 `CONTEXT.md`。與 `CORE_RULES.md` 衝突時以 CORE_RULES 為準。

## 系統總覽

前端是 Vite 建置的 React 19 SPA，領域邏輯（指標、進場濾網、帳務、對帳單重播、歷史回推、prompt 組裝）與使用者
資料都在瀏覽器。後端是 `api/` 的 Vercel Serverless 函式，只做三件事：把關（來源、共享密鑰、限流）、持有金鑰、
代打外部服務；沒有資料庫，也不 import 前端任何程式碼。

```text
瀏覽器：React 19 SPA（index.html → index.tsx → App.tsx）
│
├─ 展示層 components/
│    Sidebar：切三個分頁（App 的 currentView，沒有 router）
│    儀表板：StockSearch、QuoteHeader、ChartToolbar、StockChart*、EntryChecklist、AnalysisResult*
│    庫存：Portfolio* ＋ portfolio/（子元件＋6 個 use* hooks）
│    基本面：FundamentalsPanel* ＋ fundamentals/
│    共用：ui/（Modal、Button、MarkdownReport…）、ErrorBoundary（包在 App 外層）
│    （* ＝ App.tsx 以 lazy() 按需載入）
│
├─ 容器 App.tsx：儀表板狀態與分析流程；庫存兩把本體資料的 React 鏡像與全部寫入 handler
│
├─ 前端服務層 services/：唯一發網路請求的一層，只打同源 /api/*
│    yahoo（K 線管線、報價）、quoteCache（K 線／報價快取）、finmind（FinMind 讀取、基本面）、
│    stockDirectory（台股名錄、搜尋）、gemini（規則書＋AI 呼叫，按需載入）、fetchError、_shared/
│
└─ 計算與持久層 utils/、config/
     指標與判定、庫存帳務、對帳單匯入、歷史快照與回推、localStorage store、備份
          │
          │  fetch('/api/…')，header 帶 X-Proxy-Secret
          ▼
Vercel Serverless：api/（零設定，5 支 handler）
│  每支第一步 applyGuards：CORS → OPTIONS 短路 → 來源檢查 → 共享密鑰 → 限流
│  _lib/：config、guard、ratelimit、http、llm、yahoo、finmind
│
├─▶ Google Gemini（@google/genai；本機可設 LLM_PROVIDER=claude-cli 改走 Claude Code CLI）
├─▶ Yahoo Finance chart／search（非官方端點，cookie＋crumb 握手）
├─▶ FinMind v4 data（dataset 白名單）
└─▶ Upstash Redis（只存限流計數）

瀏覽器儲存：localStorage（庫存本體資料 5 把＋可重建快取）、sessionStorage（K 線／報價快取、基本面快取）
```

- 對證：前端的網路請求只打 `/api/*`，6 個呼叫點全在 `services/`——``git grep -n -E "['\`\"]/api/" -- App.tsx components/ services/ utils/ ':!*.test.ts'``；
  前端原始碼沒有外部網址——`git grep -n -E 'https?://' -- App.tsx index.tsx components/ services/ utils/ config/ ':!*.test.ts' ':!*.snap'` 無命中；
  `api/` 不 import 前端目錄——`git grep -n -E "from '\.\./(\.\./)?(services|utils|components|types)" -- api/ ':!*.test.ts'` 無命中。

## 元件職責

**前端元件（`components/`）**

| 元件 | 職責 | 檔案 |
|---|---|---|
| App | 根容器：儀表板狀態、抓資料→濾網→AI 報告流程、三分頁切換；持有持股與已實現帳本的 React 鏡像及全部庫存寫入 handler | `App.tsx` |
| ErrorBoundary | render 期例外時顯示可恢復畫面（錯誤只進 console）；全 codebase 唯一的 class component | `components/ErrorBoundary.tsx` |
| Sidebar | 分頁切換（`'dashboard' \| 'portfolio' \| 'fundamentals'`） | `components/Sidebar.tsx` |
| StockSearch | 代號／中文名自動完成；儀表板與基本面分頁共用 | `components/StockSearch.tsx` |
| QuoteHeader | 報價列：價格、漲跌、成交量與盤中預估量、「更新報價」「AI 分析」按鈕 | `components/QuoteHeader.tsx` |
| ChartToolbar | 週期（15m／60m／1d／1wk／1mo）與指標顯示設定 | `components/ChartToolbar.tsx` |
| StockChart | recharts K 線、均線與指標副圖、拖曳平移；均線依使用者設定的週期自行計算；整體以 `React.memo` 包裝 | `components/StockChart.tsx` |
| EntryChecklist | 顯示六六大順濾網結果（六步驟燈號、SOP、戒律、決策） | `components/EntryChecklist.tsx` |
| AnalysisResult | AI 報告卡片（儀表板與基本面共用） | `components/AnalysisResult.tsx` |
| Portfolio | 庫存分頁容器：組合 6 個 hooks 與子元件、頁首總損益、新增持股（可同時做交易決策分析） | `components/Portfolio.tsx` |
| 庫存 hooks | 報價與匯率 `useHoldingPrices`、每日快照 `useDailySnapshot`、新增表單 `usePortfolioForm`、AI 健檢 `useHealthCheck`、在庫股利 `useLotDividendUpdate`、備份回灌 `usePortfolioBackup` | `components/portfolio/use*.ts` |
| 庫存子元件 | 持股表 `HoldingsTable`（台美單一實作）、`SellModal`、`ImportStatementModal`、`RestoreBackupModal`、`PnlHistorySection`＋`PnlHistoryChart`、`RealizedLedger`；報價佇列 `holdingPriceQueue` | `components/portfolio/` |
| FundamentalsPanel | 基本面分頁容器：自管搜尋、載入、警示與 AI 解讀 | `components/FundamentalsPanel.tsx` |
| 基本面子元件 | `ValuationHeader`、`MonthlyRevenueChart`、`QuarterlyTrendCharts`、`FinancialHealthCards`、`DividendTable` | `components/fundamentals/` |
| ui | 共用基礎元件；`MarkdownReport` 是全 codebase 唯一 import `react-markdown` 的地方 | `components/ui/` |

**前端服務與工具（`services/`、`utils/`、`config/`）**

| 模組 | 職責 | 檔案 |
|---|---|---|
| yahoo | K 線管線 `getStockData`（快取外殼、共享請求、Yahoo→FinMind 備援、法人籌碼、指標）；庫存報價 `getLatestPrice`／`peekLatestPrice` | `services/yahoo.ts` |
| quoteCache | K 線快取與報價快取的雙層基座（記憶體為權威、sessionStorage 加值）與沿用窗判定 | `services/quoteCache.ts` |
| finmind | `fetchFinMindRows`（打 `/api/finmind`）、`getTwFundamentals`（基本面整備＋快取） | `services/finmind.ts` |
| stockDirectory | 台股名錄載入、`.TW`／`.TWO` 後綴預解析、整合搜尋 `searchStocks` | `services/stockDirectory.ts` |
| gemini | 五本規則書（system instruction）、四支分析函式、`callGeminiApi`／`callGeminiApiStream` | `services/gemini.ts` |
| fetchError | 前端錯誤分類 `DataFetchError`、`classifyHttpStatus`、`classifyCaught` | `services/fetchError.ts` |
| _shared | `apiClient`（共享密鑰 header）、`geminiCache`（AI 快取）、`boundedSession`（有上限的 sessionStorage 命名空間）、`healthDecision`（健檢回應解析） | `services/_shared/` |
| 指標與判定 | `math`（指標）、`entryFilter`（六六大順濾網）、`volume`（盤中全日量預估）、`market`（市場分類唯一權威） | `utils/` |
| 庫存帳務 | `portfolioFees`＋`config/twFeeRates.ts`（費稅）、`portfolioLedger`（賣出引擎、當沖判定）、`fx`（匯率口徑）、`shareUnits`、`portfolioGrouping` | `utils/`、`config/` |
| 對帳單匯入 | `statementParsers/`（依內容偵測格式並解析；xlsx 用自寫的零依賴讀取器）、`importPlan`（去重＋乾跑）、`importReplay`（重播引擎） | `utils/` |
| 歷史與股利 | `portfolioHistory`（快照、回推計算、圖表序列）、`backfillPipeline`（回推編排）、`dividendEstimator`（配息推算） | `utils/` |
| 持久層 | `persistentStore`（工廠）→ `portfolioItemsStore`、`txnStore`、`importStore`、`portfolioHistoryStore`、`closeSeriesCache`；`portfolioBackup`（備份／回灌） | `utils/` |
| 共用機制 | `framePublisher`（串流文字逐幀發佈）、`workerPool`（併發池）、`panMath`（圖表平移）、`quoteTime`（報價時間格式） | `utils/` |

**後端（`api/`）**

| 模組 | 職責 | 檔案 |
|---|---|---|
| gemini | `POST /api/gemini`：AI 報告，一次回完整文字 | `api/gemini.ts` |
| gemini-stream | `POST /api/gemini-stream`：AI 報告，NDJSON（`delta`／`done`／`error` 行） | `api/gemini-stream.ts` |
| finmind | `GET /api/finmind`：FinMind 代理（dataset 白名單、CDN 快取） | `api/finmind.ts` |
| yahoo/chart、yahoo/search | `GET /api/yahoo/chart`、`GET /api/yahoo/search`：Yahoo 代理 | `api/yahoo/` |
| config | 讀環境變數：金鑰、型號、允許來源、共享密鑰 | `api/_lib/config.ts` |
| guard／ratelimit | `applyGuards` 守門序；Upstash 三組限流器 | `api/_lib/guard.ts`、`api/_lib/ratelimit.ts` |
| http | Gemini SDK 呼叫（含逾時）、`ClassifiedError`、金鑰消毒、請求驗證 | `api/_lib/http.ts` |
| llm | LLM provider 分流 `generateText`／`generateTextStream`（gemini-api／claude-cli） | `api/_lib/llm.ts` |
| yahoo、finmind（_lib） | Yahoo 握手、參數驗證、錯誤分類；FinMind 白名單、CDN 快取秒數、錯誤分類 | `api/_lib/yahoo.ts`、`api/_lib/finmind.ts` |

## 架構模式與分層

**整體：** 厚前端＋薄代理後端。前端承擔全部領域邏輯與資料持久化；後端是替前端代打外部服務的薄層，只負責把關、
金鑰與錯誤分類。

**主要特徵：**
- **先客觀判定、再 AI 解讀（方案C）**：`utils/entryFilter.ts` 的 `runEntryFilter` 以純程式產出 GO／WAIT／NO_GO；
  進場規則書（`ENTRY_SYSTEM_INSTRUCTION_FULL`／`_FAST`）明訂 AI「不得推翻」濾網結論，只負責解讀。
- **指標在資料層一次算好**：`services/yahoo.ts` 的 `enrichChartData` 把 MA5／10／20／60、RSI、MACD、KDJ、布林、
  均線方向、漲跌算進每根 `StockDataPoint`，原始價（RAW）與還原權息價（ADJ）各一套；濾網、prompt、健檢都讀這些
  欄位。例外：圖表的均線週期可由使用者設定（含 120／240），所以 `StockChart` 在 `useMemo` 裡依
  `IndicatorSettings.maLines` 自己算（`maResultsCache`）。
- **同源代理**：前端只打 `/api/*`，外部網址與金鑰都只在後端（對證見系統總覽）。
- **資料只在瀏覽器**：庫存存 localStorage，行情與基本面快取存 sessionStorage；後端沒有資料庫，Upstash 只存限流計數。
- **純函式核心、薄 IO 外殼**：賣出（`buildSellResult`）、對帳單重播（`replayStatement`）、回推計算
  （`buildBackfillRows`／`buildBackfillFromTxns`）是純函式；需要 storage、時間或網路的模組（`persistentStore`、
  `portfolioBackup`、`backfillPipeline`）改由參數或 ports 注入，所以能在 Node 跑測試（`TESTING.md`）。
- **按需載入**：非首屏元件與 `services/gemini.ts` 都在用到時才下載（見橫切關注點）。

**分層與依賴方向：**

| 層 | 位置 | 內容 | 依賴 |
|---|---|---|---|
| 展示 | `components/` | function components（default export）、Tailwind、recharts、lucide-react | `types.ts`、`services/`、`utils/` |
| 容器 | `App.tsx` | 18 個 `useState`、儀表板流程、庫存寫入 handler；沒有 Context、reducer 或全域 store | `components/`、`services/`（`yahoo`；`gemini` 動態載入）、`utils/` |
| 前端服務 | `services/` | 網路 I/O（只打 `/api/*`、帶 `proxyHeaders`）、模組層快取與進行中請求去重、錯誤分類 | `utils/`（`math`、`market`、`entryFilter` 型別）、`types.ts` |
| 計算與持久 | `utils/`、`config/` | 純函式；localStorage 薄 IO（經 `createPersistentStore`） | `types.ts`；例外見下 |
| 後端 handler | `api/*.ts`、`api/yahoo/*.ts` | `applyGuards` → 方法檢查 → 驗參 → 打上游 → 分類錯誤 | `api/_lib/` |
| 後端共用 | `api/_lib/` | 設定、把關、限流、LLM 分流、上游握手與錯誤分類 | `@google/genai`、`@upstash/*`、Node 內建模組 |

- 例外：`utils/backfillPipeline.ts` 的預設 ports 直接綁 `services/yahoo` 的 `getStockData`，是 utils 依賴 services
  的唯一一處（`git grep -n -E "from '(\.\./)+services" -- utils/ ':!*.test.ts'`）。
- 展示層有幾處直接呼叫服務層或持久層、不經 App：庫存 hooks 呼叫 `getStockData`／`getLatestPrice`；
  `PnlHistorySection` 與 `useLotDividendUpdate` 呼叫低階的 `fetchFinMindRows`；`PnlHistorySection`、
  `useDailySnapshot` 直接讀寫快照與交易流水 store（見反模式）。
- services 與 utils 都不 import components（`git grep -n "components/" -- services/ ':!*.test.ts'`、
  `git grep -n -E "from '(\.\./)+components" -- utils/ ':!*.test.ts'` 皆無命中）。

## 資料流

### 儀表板分析

1. **觸發抓資料**：首次掛載與切換週期由 `useEffect([interval])` 呼叫 `fetchData`（預設 `'2330'`、`'1d'`）；搜尋選取與
   空狀態的快捷鈕直接呼叫 `fetchData(sym, interval)`。
2. **防競態**：`fetchData` 先 `cancelAnalysis()`，再遞增 `fetchSeqRef` 並 `abort()` 前一個請求；只有最新序號的結果
   與錯誤會寫回 state。成功時清掉舊的濾網結果與報告。
3. **K 線快取外殼**（`services/yahoo.ts` 的 `getStockData`）：裸台股代號先查名錄補 `.TW`／`.TWO`，快取鍵為
   `<代號>|<週期>`。快取在沿用窗內且沒有同鍵刷新在進行 → 零網路直接回；有快取但已過期 → 先回舊資料，背景刷新
   到貨再經 `onRevalidated` 回呼（stale-while-revalidate）；同鍵已有進行中的請求 → 共用同一份工作
   （`inflightCharts`）。冷抓日線且呼叫端有 `onRevalidated` 時走兩段式：2 年與 10 年同時發出，2 年先到先上屏，
   10 年到貨後用同一批籌碼重算再交換。
4. **管線本體**（`fetchStockDataUncached`）：依週期決定區間（1d＝10y、1wk＝5y、1mo＝15y、60m＝1y、15m＝60d）→
   `/api/yahoo/chart`（`fetchRawData` 對裸台股代號先用名錄後綴，再依序試 `.TW`、`.TWO`）→ 台股日線若 Yahoo 失敗
   改抓 FinMind 日線 → 週／月線合併、台股盤中時間位移 → `resolveChipContext`（台股抓 FinMind 中文名；台股日線另抓
   法人買賣超與 FinMind 量價）→ `enrichChartData`（FinMind 成交量覆寫、以 FinMind 當日 OHLC 取代 Yahoo 缺值時
   合成的平盤棒、剔除休市的「殭屍棒」、計算 RAW／ADJ 兩套指標）。台股日線且代號已帶後綴時，籌碼請求與 chart
   同時起跑（`chipSpec`）。
5. **顯示**：`QuoteHeader`（盤中預估量來自 `estimateVolumeTrend`）、`ChartToolbar`、`StockChart`。
6. **AI 分析**：「AI 分析」→ `handleOpenAnalysisModal`（日線時先預抓週線暖快取）→ 使用者選模式（`fast`／`thinking`）
   與持股狀態 → `handleRunAnalysis`：
   - 取週線（失敗略過）→ `runEntryFilter(sym, data, weeklyData, volumeProj)` → `EntryChecklist` 立即顯示客觀結論。
   - 動態 `import('./services/gemini')` → `analyzeEntryWithGemini(filter, userPosition, mode, onChunk)`：以濾網結果
     組 prompt，經 `/api/gemini-stream` 取得報告；有增量時經 `createFramePublisher` 逐幀更新 `AnalysisResult`
     （正式環境不送增量，見架構限制）。
   - `analysisSeqRef` 世代守衛：換股、換週期、離開儀表板（`Sidebar` 的 `setView` 包裝）都會作廢進行中的報告。
7. **更新報價**：`handleRefreshQuote` 以 `forceRefresh` 繞過快取，並沿用 `fetchSeqRef` 序列，避免舊刷新蓋掉新標的。

### 搜尋

1. `StockSearch` 掛載時預熱台股名錄：`ensureTaiwanDirectory` 依序查記憶體 → localStorage（7 天）→
   `/api/finmind?dataset=TaiwanStockInfo`；空結果不寫快取，避免把暫時故障固化成 7 天的空名錄。
2. 輸入變更 → `runSearch`：作廢前一次查詢（`AbortController`＋`reqIdRef`），180 ms debounce 後呼叫
   `searchStocks(q, onResults, signal)`。
3. `searchStocks`（`services/stockDirectory.ts`）：含中文 → 只查本地名錄，發一次 `'final'`（零網路）；英文或代號 →
   `/api/yahoo/search` 與名錄載入並行，本地有命中先發 `'local'`，Yahoo 到貨後合併去重再發 `'final'`（Yahoo 失敗時
   `'final'` 即本地結果）。
4. 過濾：本地只收上市／上櫃的個股與 ETF（`isSearchableTaiwanEntry`）；Yahoo 只收 `EQUITY`／`ETF`，且須為台股後綴或
   美股七大交易所（`mapYahooQuote`）。
5. 選取 → `onSelect(sym)` 交給父層：儀表板呼叫 `fetchData`；基本面分頁呼叫自己的 `handleSelect`（非台股只顯示提示）。

### 庫存

庫存的五把本體資料（`CONTEXT.md`）中，`portfolio_items` 與 `portfolio_realized_trades_v1` 在 `App.tsx` 有 React
state 鏡像（`portfolioItems`、`realizedTrades`，變更即由 `useEffect` 寫回）；其餘三把沒有鏡像，各流程直接讀寫 store。

1. **持股增刪改**（`App.tsx` 的 `handlePortfolio*`）：新增時若有買進日期，同步寫一筆手動買進流水（`fromManualLot`）；
   刪除時一併移除該批的手動流水，若該市場因此歸零就清掉 live 快照；修改成本或股數時依計價幣別交叉換算。
2. **報價與匯率**（`useHoldingPrices`）：初值同步讀報價快取（`peekLatestPrice`）；持股代號集合一變就逐檔
   `fetchPrice`，未命中才排進 `holdingPriceQueue` → `getLatestPrice`（`/api/yahoo/chart` 取 5 日日線最後一根有效
   收盤；台股另補 FinMind 中文名）。有美股時另抓 `USDTWD=X`。「更新報價」＝強制更新（`force: true`）。
3. **每日快照**（`useDailySnapshot`）：持股、報價、匯率任一變動後 800 ms → `computeLiveSnapshot` 分市場計算（任一檔
   報價不全、或美股需要匯率卻沒有 → 該市場本輪跳過）→ `upsertSnapshots` → `saveSnapshots` → 遞增 `historyTick`
   通知圖表重讀。
4. **歷史損益曲線**（`PnlHistorySection`）：依 `historyTick` 從 storage 重讀快照，`buildChartSeries` 組合已實現帳本與
   配息流水後交給 `PnlHistoryChart`（台股 TWD；美股可切 USD／TWD）。「建立／重算歷史回推」→ `runBackfillPipeline`：
   先查收盤價快取，缺的以 `getStockData(sym, '1d')` 抓（首輪 3 條並行，失敗者最多再重試 2 輪、每輪 1 條、間隔
   45 秒，查無代號（`NOT_FOUND`）不重試；仍有標的失敗則整輪不寫入）；有交易流水時以流水重播（含已清倉部位），
   沒有才從現存持股逆推；只填第一筆 live 快照之前的日期 → 清掉該市場舊的 backfill 列再寫入。
5. **賣出**（`SellModal` → `App.handlePortfolioSell`）：預覽與入帳都走 `utils/portfolioLedger.ts` 的 `buildSellResult`；
   產出 `RealizedTrade`（含當沖旗標，ADR-0003），追加手動賣出流水，批次扣減或移除。
6. **對帳單匯入**（`ImportStatementModal` → `App.handleStatementImport`）：`parseStatementFile` 依內容判別格式（xlsx
   讀取器動態載入；國泰台股經名錄反查代號）→ `buildImportPlan`（比對匯入紀錄去重、排序、乾跑重播找出期初缺口）→
   使用者補缺口成本 → `replayStatement` 預覽 → 確認後一次套用：持股換成重播結果、追加已實現紀錄、寫入匯入紀錄
   與交易流水。
7. **AI 健檢**（`useHealthCheck`）：每檔組 `PortfolioHealthItem`（成本換算到報價幣別、`getStockData(sym, '1d')`、
   盤中預估量）→ 動態載入 `analyzePortfolioHealth`。單檔走串流並即時顯示；全部健檢與重試失敗是「資料準備 3 條並行、
   行情失敗的檔位個別標錯、其餘一次送 LLM」（同樣打串流端點，但不顯示中途文字）。回應先解析末尾的 JSON 決策區
   （`parseHealthDecisions`），失敗才退回 regex；批次再以 `splitHealthReport` 切成各檔段落。每檔以 `healthSeqRef`
   世代守衛，單檔與批次重疊時以後起跑者為準。
8. **新增並 AI 分析**（`Portfolio` 的 `handleAddAndAnalyze`）：先新增持股，再抓日線並呼叫 `analyzeTradeDecision`
   （`/api/gemini`，非串流），結果顯示在 Modal。
9. **股利**：「自動估算股利」（`useLotDividendUpdate`）依 FinMind 除權息公告重算在庫台股各批的現金／股票股利並覆寫
   欄位，餵頁首總損益；「估算歷史配息」（`PnlHistorySection` 的 `runDividendEstimate`）依交易流水推算歷史配息、
   寫成 `kind: 'dividend'` 的流水，餵歷史曲線（要再按重算才反映）。兩者都只處理台股（美股帳單本身含息）。
10. **備份與回灌**（`usePortfolioBackup`，ADR-0001）：備份＝`buildBackup(localStorage)` 讀五把本體 key 的原始 JSON 存成
    檔案下載；回灌＝`RestoreBackupModal` 驗檔並列出筆數對照 → 確認後先下載一份預備份 → `applyBackup` 整包覆蓋 →
    400 ms 後整頁重新載入（只有兩把 key 有 React 鏡像，重載才能讓全部狀態一致）。

### 基本面

1. 切到基本面分頁時，App 傳入起始代號（儀表板正在看台股就沿用並去掉後綴，否則 `'2330'`）；`FundamentalsPanel`
   掛載後自管搜尋（同一個 `StockSearch`）。
2. `getTwFundamentals(stockId, { force })`（`services/finmind.ts`）：快取鍵含台北日期（`tw_fund_<代號>_<日期>`），
   先查記憶體 LRU、再查 sessionStorage，跨日清理。未命中 → 7 個 FinMind dataset 以 `Promise.allSettled` 並行 →
   被限流（429）的那幾個等 2 秒重試一次 → `buildIncome`（近 8 季）、`buildBalance`、`buildCashflow`、
   `buildMonthlyRevenue`（近 13 月含 YoY）、`buildDividends`（近 5 期）與估值。個別 dataset 失敗記進 `warnings`；
   損益、資產負債、估值三者全空才整體丟錯。
3. 顯示：`ValuationHeader`、`MonthlyRevenueChart`、`QuarterlyTrendCharts`、`FinancialHealthCards`、`DividendTable`；
   有 `warnings` 時顯示可重試的提示（重試＝`force` 重抓）。
4. AI 解讀：按鈕觸發 → 動態載入 `analyzeFundamentals`（`/api/gemini`，非串流）；結果以代號為鍵存在元件 state
   （`aiResults`），切換股票互不污染。
5. 後端 `/api/finmind` 依 dataset 設 CDN 快取（財報三表與股利 3 天、其餘到台北午夜；見 `INTEGRATIONS.md`）。

### 狀態放在哪裡

| 狀態 | 擁有者 | 寫入者 |
|---|---|---|
| 儀表板（標的、週期、K 線、濾網、報告、指標設定、分析參數、目前分頁） | `App.tsx` 的 `useState` | `App.tsx` |
| 持股 `portfolio_items` | `App.tsx` 的 `portfolioItems`（鏡像） | App 的 handler；回灌直接寫 storage 後重載 |
| 已實現帳本 `portfolio_realized_trades_v1` | `App.tsx` 的 `realizedTrades`（鏡像） | App 的 handler；回灌 |
| 交易流水 `portfolio_transactions_v1` | 無鏡像，用到時讀 store | App 的 handler、`PnlHistorySection`（配息流水）、回灌 |
| 匯入紀錄 `portfolio_import_log_v1` | 無鏡像 | `App.handleStatementImport`、回灌 |
| 每日快照 `portfolio_snapshots_v1` | 無鏡像；`PnlHistorySection` 依 `historyTick` 重讀 | `useDailySnapshot`（live）、`PnlHistorySection`（backfill）、`App.handlePortfolioDelete`、回灌 |
| 庫存畫面狀態（報價、匯率、健檢結果、表單、Modal） | `components/portfolio/use*.ts`、`Portfolio.tsx` | 同左 |
| 基本面資料與 AI 解讀 | `FundamentalsPanel.tsx` | 同左 |
| 行情、名錄、基本面、AI 快取 | 服務層模組變數＋瀏覽器 storage | `services/`（見橫切關注點的快取表） |

- 對證：`git grep -n -E "save(Txns|ImportLog|Snapshots|RealizedTrades|PortfolioItems)\(" -- App.tsx components/ ':!*.test.ts'`；
  回灌的寫入在 `utils/portfolioBackup.ts` 的 `applyBackup`。

## 關鍵抽象

- **`StockDataPoint`**（`types.ts`）：每根 K 棒的通用紀錄——OHLCV、RAW／ADJ 兩套指標、均線方向、台股法人買賣超、
  漲跌。只由 `services/yahoo.ts` 的 `enrichChartData` 產生，其他地方只讀。
- **`StockInfo`**（`types.ts`）：標的資訊；`chipDataUnavailable` 用來區分「法人資料抓不到」與「法人真的是 0」。
- **`EntryFilterResult`**（`utils/entryFilter.ts`）：客觀進場判定——趨勢、六步驟燈號、SOP、戒律、決策（`GO`／`WAIT`／
  `NO_GO`）、建議進場價與停損雙軌。`EntryChecklist` 顯示它，`analyzeEntryWithGemini` 逐項轉成 prompt。
- **`getStockData` 門面**（`services/yahoo.ts`）：把 Yahoo／FinMind、後綴解析、快取、共享請求、兩段式載入、備援藏在
  一個函式後面；儀表板、健檢、交易決策、歷史回推共用。庫存報價另走 `getLatestPrice`（報價快取的鍵加 `latest|`
  前綴，與 K 線快取的命名空間互斥）。
- **`DataFetchError`／`FetchErrorKind`**（`services/fetchError.ts`）：前端錯誤種類（`RATE_LIMIT`、`BACKEND_DOWN`、
  `NOT_FOUND`、`PARSE`、`NETWORK`、`UNKNOWN`），讓 UI 依種類給不同處置；非 2xx 回應一律由 `classifyHttpStatus` 分類
  （四個 fetch 出口共用），`classifyCaught` 認不出就回 `UNKNOWN`，不猜。
- **`ClassifiedError`**（`api/_lib/http.ts`）與 `YahooClassifiedError`、`FinMindClassifiedError`：後端錯誤代碼＋中文
  訊息，handler 以各自的 `statusByCode` 轉成 HTTP 狀態。
- **`applyGuards`**（`api/_lib/guard.ts`）：每支 handler 的把關入口，檢查順序固定（`CONTEXT.md` 的「守門序」）。
- **`generateText`／`generateTextStream`**（`api/_lib/llm.ts`）：LLM provider 介面，依 `LLM_PROVIDER` 切 Gemini API 或
  本機 Claude Code CLI；handler 不需要知道背後是誰，設定值不認得時明確報錯、不靜默改走其他 provider。
- **`callGeminiApi`／`callGeminiApiStream`**（`services/gemini.ts`）：前端 AI 呼叫的唯一出口，內含透明快取
  （`services/_shared/geminiCache.ts`）與 NDJSON 解析。
- **規則書（system instruction）**：`services/gemini.ts` 的五個常數（進場完整版／快速版、交易決策、庫存健檢、
  基本面），逐位元組被 snapshot 鎖住（`utils/geminiRules.test.ts`）；四支分析函式送出的完整 prompt 也被鎖住
  （`utils/geminiPrompts.test.ts`）。
- **健檢決策契約**：健檢規則書要求報告末尾輸出 `{"decisions":[…]}` 的 json 圍欄區塊；
  `services/_shared/healthDecision.ts` 解析並驗證列舉值（加碼、續抱、減碼、停利、停損），失敗退回 regex。
- **庫存領域型別**（`types.ts`）：`PortfolioItem`（一批持股）、`RealizedTrade`（一筆已實現賣出）、`ParsedTxn`（券商
  無關的交易中間格式，解析器產出、重播引擎消費）、`DailyPnlSnapshot`（存可加成的分解量而非算好的損益，含息與否在
  渲染期組合）；落地的交易流水是 `utils/txnStore.ts` 的 `StoredTxn`。
- **`createPersistentStore`**（`utils/persistentStore.ts`）：localStorage store 的共用外殼——讀時驗形並退回 fallback、
  寫時遇 quota 依注入的策略裁剪重試一次；key、信封與裁剪策略由各 store 自帶。
- **`BackupFile`／`BACKUP_KEYS`**（`utils/portfolioBackup.ts`）：備份檔格式與五把本體 key 的唯一清單；刻意只搬原始
  JSON、不認領域型別，讓 decode 不收的資料也進得了備份。
- **`runBackfillPipeline` 的 ports**（`utils/backfillPipeline.ts`）：抓價、收盤價快取、等待三個依賴可注入；正式環境接
  `getStockData`，測試接假實作。
- **`createFramePublisher`**（`utils/framePublisher.ts`）：以 `requestAnimationFrame` 合併串流增量，每個動畫幀最多
  更新一次畫面。
- **`runWithConcurrency`**（`utils/workerPool.ts`）：併發池的唯一實作（共享游標、單一項目失敗不中斷整池）。

## 進入點

**瀏覽器：**
- `index.html`：`#root`、Google Fonts、`<script type="module" src="/index.tsx">`；沒有 importmap、沒有 CDN 腳本。
- `index.tsx`：import `index.css`，`ReactDOM.createRoot` 掛載
  `<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>`（`index.tsx:14-18`）。
- `App.tsx`：根元件；首次掛載即以 `'2330'`、`'1d'` 呼叫 `fetchData`。

**後端：**
- `api/gemini.ts`、`api/gemini-stream.ts`、`api/finmind.ts`、`api/yahoo/chart.ts`、`api/yahoo/search.ts`：各自
  `export default async function handler(req, res)` 與 `export const maxDuration`。Vercel 零設定（repo 沒有
  `vercel.json`）：`api/` 內非 `_`／`.` 開頭的 `.ts` 各成一支函式；`.vercelignore` 排除 `api/**/*.test.ts`
  （`utils/vercelIgnoreGuard.test.ts` 鎖住）。
- 對證：`git ls-files api/ ':!api/_lib/*' ':!*.test.ts'`。

**開發與建置：**
- `vite.config.ts`：dev server 3000（`host: 0.0.0.0`，不監看 `.claude/`）；`/api` 由 `server.proxy` 轉給
  `http://localhost:3001`（本機 `vercel dev`）；`envPrefix: 'VITE_'`、沒有 `define`（`utils/viteConfigGuard.test.ts`
  鎖住）；`@` alias；vitest 的 `test` 區塊；`manualChunks` 只把 React 分到 `vendor`。
- 本機要同時起後端（`npx vercel dev --listen 3001`）與前端（`npm run dev`），步驟見 `STACK.md` 的 Platform
  Requirements 與 `start-dev` skill。
- `npm run build`（`vite build` → `dist/`）、`npm run test`（vitest）、`npm run gate`（機械驗收五道，`scripts/run-gate.mjs`）。

## 架構限制

- **單一執行緒**：計算都在瀏覽器主執行緒；10 年日線的指標（`enrichChartData`）與圖表均線（`StockChart` 的
  `useMemo`）同步執行。沒有 Web Worker（`git grep -n "new Worker" -- '*.ts' '*.tsx'` 無命中；`utils/workerPool.ts`
  是 Promise 併發池，不是 Web Worker）。
- **沒有 router、沒有全域 store**：分頁是 `App.tsx` 的 `currentView`，重新整理一律回儀表板；沒有 Context 或 reducer
  （`git grep -n -E "createContext|useContext|useReducer" -- '*.ts' '*.tsx'` 無命中），跨元件狀態靠 props 與 storage。
- **模組層單例**：前端——`services/stockDirectory.ts` 的 `memCache`／`loadingPromise`、`services/quoteCache.ts` 的
  `memCache`、`services/yahoo.ts` 的 `inflightCharts`／`inflightLatestPrices`、`services/finmind.ts` 的
  `memoryCache`／`latestRequests`；後端——`api/_lib/yahoo.ts` 的 `crumbGeneration`、`api/_lib/ratelimit.ts` 的
  Redis client 與限流器、`api/_lib/llm.ts` 的 `cachedClaudeCliPath`。後端的模組狀態只在單一函式實例內有效，不跨
  實例共享；需要跨實例的限流計數放在 Upstash。
- **資料只在一個瀏覽器**：庫存只存在使用者那個瀏覽器的 localStorage，沒有伺服器端資料庫或同步；換瀏覽器或電腦
  只能靠備份／回灌（ADR-0001）。
- **金鑰與型號只在後端**（紅線）：`GEMINI_API_KEY` 只由 `api/_lib/config.ts` 讀；前端只送 `mode`（`fast`／`thinking`），
  型號由 `getModelForMode` 決定。改型號要同步 bump `services/_shared/geminiCache.ts` 的 `ENGINE_TAG`
  （`CORE_RULES.md`「本專案關鍵事實」）。
- **正式環境不逐字串流**：`generateTextStream` 走 gemini-api 時直接呼叫非串流的 `callGeminiApiProvider`，所以
  `/api/gemini-stream` 只回一行 `done`；逐字的 `delta` 只有本機 `claude-cli` 才有。這是 Phase 09 的既定決策
  （`.planning/phases/09-llm-latency/09-CONTEXT.md` 的 D-02，Gemini 串流列為後續選項）。對證：
  `git grep -n generateContentStream -- api/` 無命中。
- **函式時限**：`maxDuration`——`gemini` 120 秒、`gemini-stream` 200 秒、`finmind` 與兩支 Yahoo 30 秒；Gemini SDK
  呼叫預設 100 秒逾時（`callGeminiWithTimeout`），Yahoo 每個上游請求 8 秒、FinMind 15 秒。
- **外部限流是常態**：後端每 IP 限流（Gemini 10 次／分＋100 次／日；行情與 FinMind 共用 60 次／分；未設 Upstash 不限流，
  Upstash 出錯放行）；FinMind 免費層與 Yahoo 都會回 429。前端以快取、共享請求、併發上限與退避重試吸收（見橫切關注點）。
- **規則書與 prompt 被逐位元組鎖住**：改一個字就讓所有使用者的 AI 快取失效一輪（快取鍵含
  `fnv1a(規則書 + ' ' + prompt)`）；進場與加碼兩套戒律刻意不同、不得合併（`.planning/phases/12-arch-deepening/12-CONTEXT.md`
  的 D-06）。
- **依賴與型別設定**：只維護 `package.json`＋`package-lock.json`、禁裝新套件（`CORE_RULES.md`）；`tsconfig.json` 非
  strict（`CONVENTIONS.md`）。

## 反模式

以下「方向」是建議，未排程。

### 庫存本體資料沒有單一擁有者

**現況：** 五把本體 key 中，持股與已實現帳本在 `App.tsx` 有 React 鏡像，另外三把沒有鏡像，由 App 的 handler、
`useDailySnapshot`、`PnlHistorySection` 各自直接讀寫 store；歷史圖表靠 `historyTick`／`refreshTick` 計數器觸發重讀
storage。回灌直接改寫 storage，只能整頁重載讓兩邊對齊（`usePortfolioBackup` 的 `handleRestore` 註解）。
**問題：** 同一份資料的寫入點分散在 App 與兩個 portfolio 模組，新增寫入路徑時容易漏同步（例如刪除持股要同時清手動
流水與 live 快照，這條規則只寫在 `handlePortfolioDelete` 裡）；畫面是否反映最新 storage，取決於有沒有人遞增計數器。
**方向：** 收斂成一個庫存資料模組，統一持有五把 key 的讀寫與訂閱，元件只呼叫它提供的操作。

### App.tsx 兼任儀表板容器與庫存寫入中樞

**現況：** `App.tsx` 631 行、18 個 `useState`：儀表板的抓資料、AI 分析、更新報價三條流程（以 `fetchSeqRef`、
`analysisSeqRef`、`AbortController` 防競態），與庫存的 7 支寫入 handler（新增、刪除、修改、補日期、賣出、刪除
已實現、匯入）放在同一個元件。庫存的畫面狀態已拆進 `components/portfolio/use*.ts`，寫入 handler 仍留在 App。
**問題：** 兩個不相干的領域共用一個根元件；庫存的寫入規則（流水同步、快照清理）沒有行為鎖——沒有測試
import `App.tsx`（`utils/appLazyBoundaries.test.ts` 只讀它的原始碼字串）。
**方向：** 儀表板流程抽成 hook；庫存寫入併入上一則的庫存資料模組，連同規則一起進測試。

### 兩份 K 線 prompt 格式化，判空方式不同

**現況：** `services/gemini.ts` 裡「近 15 根 K 線＋指標」的字串組裝有兩份：`analyzeTradeDecision` 內嵌一份、
`formatHealthCheckData` 一份。前者用 truthy 判斷（`d.k ? …`），後者用 `!= null`（`if (d.k != null)`），所以值為 0 的
K、D 與 MACD 各欄（DIF、DEA、柱）在交易決策 prompt 會被省略、在健檢 prompt 會保留。舊版列的第三份 `formatPromptData` 已於
2026-07-12 `7bc35f1` 隨死碼刪除。
**問題：** 改格式要改兩處，而且兩份已經悄悄分歧。
**方向：** 兩份輸出都被 snapshot 鎖住（`utils/geminiRules.test.ts`、`utils/geminiPrompts.test.ts`）；合併時須證明輸出
逐位元組不變，否則等於讓所有使用者的 AI 快取失效一輪。

### 展示層直接呼叫低階資料函式，除權息抓取寫了兩份

**現況：** `PnlHistorySection` 的 `runDividendEstimate` 與 `useLotDividendUpdate` 的 `runLotDividendUpdate` 各自以
`runWithConcurrency(symbols, 3, …)` 呼叫 `fetchFinMindRows('TaiwanStockDividend', …)`，抓取與失敗收集的寫法幾乎
相同；兩處都在展示層直接碰服務層的低階 FinMind 讀取。
**問題：** 抓取政策（併發數、起始日、失敗處理）改一處容易漏另一處；FinMind 的 dataset 名稱散進元件。
**方向：** 在 `services/finmind.ts` 提供取除權息公告的函式，兩處共用。

### 型別的零星重複與死型別

**現況：**
- `AppView` 在 `App.tsx:54` 與 `components/Sidebar.tsx:4` 各宣告一次。
- `types.ts` 的 `TechnicalIndicators`、`AIAnalysisResult` 與 `StockDataPoint.dealerBuySell` 沒有任何使用處
  （`git grep -n -E "\bTechnicalIndicators\b|\bAIAnalysisResult\b|\bdealerBuySell\b" -- '*.ts' '*.tsx'` 只命中 `types.ts`）。

**問題：** 改分頁時要記得兩處；`AIAnalysisResult` 容易讓人誤以為 AI 回傳結構化結果，實際上報告是 Markdown 文字。
**方向：** 共用 `AppView`、刪掉死型別。
- 已解決：本節原列的 `components/FundamentalsPanel.tsx` 自寫 `isTwCode`，2026-10-01 改用 `utils/market.ts` 的
  `isTwCode`（純代碼版，`isTwStock` 委派它），見 `CONCERNS.md` 的 Duplicated constants。

## 錯誤處理

**策略：** 後端把上游錯誤收斂成固定代碼＋中文訊息；前端把失敗分類成 `FetchErrorKind`，UI 依種類給不同處置；
非關鍵資料（法人籌碼、中文名、搜尋、名錄）失敗時吞錯降級，關鍵路徑則明確告知並可重試。

**後端：**
- 錯誤代碼與 HTTP 狀態：Gemini（`MODEL_NOT_FOUND` 404、`RATE_LIMITED` 429、`UPSTREAM_ERROR` 502、`BAD_REQUEST` 400、
  `MISSING_KEY` 500、`CANCELLED` 499）；Yahoo（`BAD_REQUEST` 400、`UPSTREAM_UNAUTHORIZED` 502、`RATE_LIMITED` 429、
  `UPSTREAM_ERROR` 502、`NOT_FOUND` 404）；FinMind（`BAD_REQUEST` 400、`RATE_LIMITED` 429、`UPSTREAM_ERROR` 502）。
  回應形狀一律 `{ code, message }`。
- 把關失敗：來源或共享密鑰不符 403、限流 429；`OPTIONS` 回 204；方法不符 405。
- 日誌：`console.error('[<handler>:<代碼>] …')`；Gemini 路徑先經 `sanitizeErrorForLog`（金鑰消毒）。
- 串流：寫出第一行前出錯 → 一般 JSON 錯誤＋狀態碼；寫出後出錯 → 補一行 `{"t":"error",…}`；client 斷線（`CANCELLED`）
  → 不寫任何內容，只 `res.end()`。

**前端：**
- 服務層遇非 2xx 一律丟 `DataFetchError`，訊息沿用後端回的中文 `message`。種類由 `services/fetchError.ts` 的
  `classifyHttpStatus` 決定，`queryYahoo`、`fetchFinMindRows`、`callGeminiApi`、`callGeminiApiStream` 四個出口共用：
  429 → `RATE_LIMIT`、404 → `NOT_FOUND`（Yahoo＝查無代號，Gemini＝設定的模型不存在）、5xx → `BACKEND_DOWN`、
  其餘 → `UNKNOWN`。接線鎖：`services/fetchError.wiring.test.ts`。`queryYahoo` 另有 `chart.error` 分支（`Not Found` →
  `NOT_FOUND`、其他 → `PARSE`），但現行後端已把 `chart.error` 轉成 404／502、不會回 200 帶錯誤，這個分支實際走不到；
  回應沒有資料時則丟 `NOT_FOUND`。`fetchFinMindRows` 另把 HTTP status 掛在錯誤物件上（基本面的 429 重試讀它）。
- 裸台股代號的試探鏈（`fetchRawData`）只有 `NOT_FOUND` 才換下一個後綴；限流、後端沒開等其他失敗原樣上拋（保留種類與
  後端原文），每個後綴都查無才丟 `NOT_FOUND`（「找不到台股代號」）。`fetchStockDataUncached` 的台股 FinMind 備援也失敗時
  重丟 Yahoo 的錯誤，例外是 Yahoo 說查無、FinMind 卻是其他失敗——改丟 FinMind 的，兩邊都查無才是 `NOT_FOUND`。
  行為鎖：`services/yahoo.twSuffixChain.test.ts`。
- `classifyCaught` 把任意例外歸類：`DataFetchError` 照用、`status` 為 429／5xx、`TypeError` 或 failed to fetch →
  `NETWORK`，認不出就 `UNKNOWN`。
- 串流收尾（`callGeminiApiStream`）：收到 `done` → 回全文並寫快取；只有部分 `delta` → 回部分內容並附「報告生成
  中斷」提示、不寫快取；什麼都沒有 → 丟錯。
- 消費端：儀表板抓資料失敗 → 可重試的 `Banner`；進場分析失敗 → 錯誤訊息直接顯示在報告區；健檢 →
  `quoteFailMarkdown`／`analysisFailMarkdown` 依種類分流文案（查無代號有專屬文案、請使用者確認代號）；歷史回推 →
  查無代號的標的不重試、失敗訊息單獨列出，其餘以 `diagnose` 依種類給處置（認不出再比對訊息），退避期間只有限流才說
  「限流中」（`progressLabel`、`backfillFailMessage` 有行為鎖：`components/portfolio/PnlHistorySection.test.ts`）；
  基本面 → `Banner`＋強制重抓。

**降級：**
- 台股日線 Yahoo 失敗 → FinMind 日線備援（只限台股 `1d`）；使用者取消（`AbortError`）直接上拋、不觸發備援；
  兩段式已顯示 2 年資料後 10 年失敗 → 保留畫面、不寫快取、不備援。
- 法人資料抓不到 → `info.chipDataUnavailable = true`（不是填 0），該筆 K 線快取只享 10 分鐘短窗。
- 中文名抓不到 → 沿用 Yahoo 名稱；名錄抓不到 → 回 `[]` 且不寫快取；Yahoo 搜尋失敗 → `[]`。
- 基本面：被限流的 dataset 等 2 秒重試一次；個別失敗列進 `warnings`；三大項全空才丟錯。

**儲存：** store 讀取失敗回 fallback（交易流水、匯入紀錄、已實現帳本、快照遇到不認得的版本信封另 `console.warn`），
寫入回傳 `boolean`。quota 滿時各 store 策略不同：快照裁掉最舊 1/4 的 backfill 列再試、收盤價快取丟掉最舊一半再試、
匯入紀錄有自己的兩段裁剪；持股、交易流水、已實現帳本不裁（寫不進去就回 `false` 並 `console.warn`）。sessionStorage
層的任何失敗都靜默退回記憶體層。

**Render：** `ErrorBoundary` 接住 render 期例外，顯示可恢復畫面（錯誤摘要＋重新載入），完整錯誤只進 console。

## 橫切關注點

**快取（由外到內）：**

| 層 | 存放 | 失效規則 | 檔案 |
|---|---|---|---|
| Yahoo chart CDN | Vercel CDN | `s-maxage=60, stale-while-revalidate=300`，只快取成功回應 | `api/yahoo/chart.ts` |
| FinMind CDN | Vercel CDN | 財報三表與股利 3 天、其餘到台北午夜；`stale-while-revalidate=60` | `api/_lib/finmind.ts` 的 `cacheSecondsForDataset` |
| Yahoo crumb | 後端模組變數 | 10 分鐘；遇 401／429 清掉重取 | `api/_lib/yahoo.ts` |
| K 線快取＋報價快取 | 記憶體 Map（權威）＋sessionStorage `quote_cache_v1:`（有容量上限） | 沿用窗：盤中 10 分鐘、收盤後到下一交易日開盤；法人資料不可用的結果只享 10 分鐘；匯率代碼 60 分鐘（匯率旁路） | `services/quoteCache.ts` |
| 進行中的請求 | 模組變數 | 請求結束即移除 | `services/yahoo.ts`（`inflightCharts`、`inflightLatestPrices`） |
| 基本面 | 記憶體 LRU＋sessionStorage `tw_fund_<代號>_<台北日期>` | 跨日清除；`force` 繞過 | `services/finmind.ts` |
| 台股名錄 | 記憶體＋localStorage | 7 天；空結果不寫 | `services/stockDirectory.ts` |
| AI 結果 | localStorage `gemini_cache_v1\|<ENGINE_TAG>\|<mode>\|<台北日期>\|<hash>` | 跨日清除、最多 50 筆；只快取成功回應，空字串不會被讀回 | `services/_shared/geminiCache.ts` |
| 回推收盤價 | localStorage `portfolio_close_cache_v1` | 寫入後 3 天內直接沿用，過期才重抓（`MAX_AGE_MS`） | `utils/closeSeriesCache.ts` |

**競態防護：** 非同步結果回來時先確認自己仍是最新的那一次，過期的結果與錯誤一律丟棄。
- `App.tsx`：`fetchSeqRef`＋`AbortController`（抓資料與更新報價共用同一序列）、`analysisSeqRef`（AI 報告世代）。
- `StockSearch`：`reqIdRef`＋`AbortController`＋180 ms debounce。
- `FundamentalsPanel`：`requestSeqRef`（資料）、`aiRequestIdsRef`（各代號的 AI 請求）。
- `useHoldingPrices`：每檔一個請求身分物件；`useHealthCheck`：每檔的 `healthSeqRef` 世代，單檔與批次共用。
- `getStockData`：訂閱者模型——各呼叫端只取消自己的訂閱，最後一位離開才中止共享工作；強制更新開新世代。
  `getTwFundamentals` 以 `latestRequests` 確保舊請求不會讓快取倒退。

**併發與佇列：** `runWithConcurrency` 是唯一的併發池（健檢的資料準備、兩處除權息查詢、回推首輪都是 3 條）；
`holdingPriceQueue` 讓庫存報價同時最多 3 個、匯率優先，尚未開始的同鍵請求會被合併。

**按需載入：** `App.tsx:27-30` 以 `lazy()` 載入 `Portfolio`、`FundamentalsPanel`、`StockChart`、`AnalysisResult`（後兩者
由 `utils/appLazyBoundaries.test.ts` 鎖住）；UI 端一律以動態 `import()` 載入 `services/gemini.ts`（5 處，
`git grep -n "import('.*services/gemini')" -- App.tsx components/`）；對帳單的 xlsx 讀取器也是動態載入
（`utils/statementParsers/index.ts`）；`vite.config.ts` 只把 React 分成 `vendor` chunk。

**串流顯示：** `createFramePublisher` 把串流增量合併成每個動畫幀最多一次 state 更新；進場報告與單檔健檢使用。

**把關與身分：** 沒有使用者帳號。`/api/*` 由 `applyGuards` 依守門序把關；`VITE_PROXY_SECRET` 會被打包進前端，只是提高
直呼 `/api/*` 的門檻、不是機密（`INTEGRATIONS.md`）。

**輸入驗證：** 後端——`validateGeminiRequest`、`validateChartParams`、`validateSearchParams`、`validateFinMindParams`
（週期與區間的封閉集合、代號格式、dataset 白名單）；前端——各 store 的 `decode` 驗形、備份檔驗 app id 與 schema 版本（`parseBackupFile`）、健檢決策驗列舉值。
Yahoo／FinMind 的回應沒有 schema 驗證（`CONCERNS.md`）。

**日誌與監控：** 只有 `console.*`；後端 log 進 Vercel function log（`[handler:代碼]` 前綴）。沒有錯誤追蹤服務。

**可測性：** 多數 service／util 遵守「純模組守則」——模組頂層不碰瀏覽器全域，storage、時間、網路由參數或 ports
注入，所以能在 Node 跑 vitest；規則書、prompt、健檢版面另有 snapshot 鎖；`viteConfigGuard`、`vercelIgnoreGuard`、
`tsconfigScopeGuard`、`appLazyBoundaries` 四支守門測試鎖住設定檔。細節見 `TESTING.md`。

**時間與時區：** K 線日期依交易所時區轉換（`Intl.DateTimeFormat` 依時區快取重用）；沿用窗依各市場交易時段（台股
09:00–13:30 `Asia/Taipei`、美股 09:30–16:00 `America/New_York`）；AI 與基本面快取以台北日期分日。

**領域知識：** 朱家泓 × 林穎的方法論寫在三處：`utils/entryFilter.ts`（確定性判定）、`services/gemini.ts` 的規則書
（AI 解讀）、`.claude/skills/`（給 Claude 用的分析 skill，不屬於執行期的 App）。用語以 `CONTEXT.md` 為準。

## 已解決（2026-05-31 版列的反模式）

原文見 `git show 0e4085b:.planning/codebase/ARCHITECTURE.md`。

- **Client-side API key injection**（2026-07-05 解決）：`0d2800e` 移除 `vite.config.ts` 的 `define`、前端改打
  `/api/gemini`；`dab7508`（2026-07-26）把 `envPrefix: 'VITE_'` 顯式化並由 `utils/viteConfigGuard.test.ts` 鎖住。
  對證：`git grep -c 'process.env.API_KEY' -- services/ components/ App.tsx` 無命中。
- **Public CORS proxy dependency**（2026-07-05／07-09 解決）：`e7da3c7` 讓 Yahoo 改經 `/api/yahoo/*`、`07ec1f7` 讓
  FinMind 改經 `/api/finmind`。對證：`git grep -n -E 'PROXIES|corsproxy|allorigins' -- services/ components/ App.tsx utils/ api/` 無命中。
- **Inconsistent fast/thinking model handling**（2026-06-12／07-05／10-01 解決）：`1a7dd92` 移除引用不存在變數
  `REACT_APP_GEMINI_API_KEY` 的錯誤訊息；`0d2800e` 把型號選擇移到後端的 `getModelForMode`；2026-10-01 再拿掉 UI 文案
  殘留的型號名與「檢查 API Key」提示（「新增並 AI 分析」的失敗訊息改由 `components/portfolio/tradeFailMarkdown.ts`
  依 `DataFetchError` 種類分流）。對證：`git grep -n -E 'gemini-[0-9]' -- App.tsx components/ services/ utils/ ':!*.test.ts'`
  與 `git grep -n -i -E "API Key|Gemini 3|\(Flash\)|\(Pro\)" -- App.tsx components/ ':!*.test.ts'` 皆無命中。
- **Duplicated prompt-formatting logic**（部分解決）：`7bc35f1`（2026-07-12）刪掉 `formatPromptData`；剩下的兩份見反模式。
- **Monolithic state container**（部分解決）：庫存的畫面狀態已拆進 `components/portfolio/use*.ts`（Phase 12 起）；App 仍
  兼任庫存寫入中樞，見反模式。

---

*Architecture analysis: 2026-10-01（整份重寫；原版 2026-05-31）*
