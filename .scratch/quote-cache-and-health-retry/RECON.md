# RECON — 報價快取與健檢重跑（偵查快照）

> 本檔是 grill 當下（2026-08-13）讀碼的**位置快照**，只為加速接手方定位。
> **一律以現況程式碼為準**；行號若對不上，用檔名＋函式名重新定位，不要照抄行號。
> 票據本身不含路徑與行號（耐久原則），需要位置就查這裡。

## 一、報價鏈路現況

### 1.1 `getLatestPrice` 完全沒有快取

`services/yahoo.ts:456` — 函式體直接 `fetchRawData(symbol, '1d', '5d')`（`fetchRawData` 在
`services/yahoo.ts:288`），沒有任何快取讀寫。台股還會在函式內多打一次
`fetchFinMindStockInfo` 取中文名（同檔 :481）。

回傳形狀：`{ price, name, date? }`。`date` 是 Phase 10 D-13 加的，取最後一根有效
close 同 index 的 timestamp 轉交易所當地日期（同檔 :464-475）。

**呼叫端只有兩個，都在 `components/portfolio/useHoldingPrices.ts`**：
- `:19` 逐檔報價 `getLatestPrice(symbol)`
- `:28` 匯率 `getLatestPrice('USDTWD=X')`

（全 repo 搜尋確認；`.planning/` 底下的其他命中都是歷史文件，非程式碼。）

### 1.2 K 線快取已有完整基座，但 `getLatestPrice` 沒接

`services/quoteCache.ts` 全檔即基座：
- `:17` `QuoteCacheEntry = { cachedAt, shortTtlOnly, result }`
- `:24` `marketForSymbol(symbol)` → 委派 `utils/market.ts:22` 的 `marketOf`
- `:61` `isMarketOpen(msEpoch, market)`（TW 09:00–13:30、US 09:30–16:00，DST 交給 Intl）
- `:81` `isQuoteCacheFresh(cachedAt, now, market, shortTtlOnly?)` — 七步演算法，
  註解明寫「演算法順序即語意，勿重排」
- `:119` `readQuoteCache` / `:139` `writeQuoteCache`（memory 權威層＋sessionStorage
  best-effort，前綴 `quote_cache_v1:`）
- `:168` `writeMemoryAlias`

`getStockData` 的接法在 `services/yahoo.ts:1040-1115`：先做名錄預解析得 `canon`，
鍵是 `` `${canon}|${interval}` ``（`:1051`），fresh 命中直接回、stale 走 SWR
背景 revalidate（`:1017`）。

### 1.3 【紅線】鍵撞掉會炸

`memCache` 是**單一 Map**，`getStockData` 存的是 `{ info, data }`（`StockDataResult`），
`getLatestPrice` 要存的是 `{ price, name, date }`。兩者共用同一個 Map，
若 `getLatestPrice` 用 `` `${symbol}|1d` `` 當鍵就會與 `2330.TW|1d` 正面對撞，
`getStockData` 讀到後會把報價物件當 K 線結果解讀。**必須獨立命名空間。**

### 1.4 匯率會被判成美股時段

`marketForSymbol('USDTWD=X')` → `isTwStock` 不成立（`utils/market.ts:15`）→ 回 `'US'`。
直接沿用即等於「美股收盤 16:00 ET＝台灣清晨 5 點之後匯率整天不動」。

### 1.5 `writeQuoteCache` 的配額回退會連坐

`services/quoteCache.ts:153-162`：sessionStorage 配額爆掉時會**清光所有自家前綴 key**
再重試一次。K 線單檔 1.5–2.5MB，很容易觸發 → 會把小小的報價 entry 一起掃掉。
memory 層不受影響（只清 sessionStorage），所以同 session 內仍然命中，
只有 F5 之後會少一層。已知行為，不是 bug。

### 1.6 報價無效值可能是 NaN／undefined

`.planning/codebase/CONCERNS.md:68` 已記：`getLatestPrice` 在無有效 close 時 fallback
到 `meta.regularMarketPrice`，下市／冷門標的可能是 `undefined`／`NaN`。
**這種值一旦寫進快取會毒一整天**，寫入必須有 `price > 0` 閘門。

## 二、庫存頁狀態現況

### 2.1 切頁＝整棵樹拆掉

`App.tsx:440` 是 `{currentView === 'portfolio' && (<Suspense…><Portfolio …/></Suspense>)}`，
條件渲染 → 切走即 unmount，所有 hook state 歸零；切回來重新 mount，
`useHoldingPrices` 的 effect（`components/portfolio/useHoldingPrices.ts:40-42`，
deps 是 `items.map(i => i.symbol).join(',')`）必然重跑一次全抓。

`.planning/codebase/CONCERNS.md:147` 早已把這條記成已知技術債。

### 2.2 `useHoldingPrices` 的形狀

- `:9` `interface PriceData { price; name; loading; error; date? }`
- `:16` `fetchPrice(symbol)` — **先 `setPrices(loading: true)` 再 await**（就算之後有
  快取、這一步仍會讓每列閃一次「載入中」）
- `:26` `fetchExchangeRate()`
- `:33` `fetchAllPrices()` — 目前**無參數**
- `:40` effect

### 2.3 【地雷】兩顆工具列按鈕直接把函式當 handler

- `components/Portfolio.tsx:174` `onClick={fetchAllPrices}`
- `components/Portfolio.tsx:196` `onClick={handleBatchHealthCheck}`

React 會把 **click event 當第一個參數**傳進去。這兩個函式一旦加上參數
（`{ force }` 與 `targetSymbols`），event 物件就會被當成該參數 → 功能靜默失效。
改參數的同時**必須**改成 `onClick={() => fn(...)}`。

### 2.4 每日快照不受快取影響（已驗證，免驗）

`components/portfolio/useDailySnapshot.ts:21-35` 的 effect 把 `prices` 交給
`utils/portfolioHistory.ts:42` 的 `computeLiveSnapshot`；守衛 A 在 `:52-55`
逐檔要求 `p.date` 存在，快照日期取自**每檔報價自帶的 `date`**。
快取 entry 會把 `date` 一起存，而「沿用窗」定義上市場沒有交易，
快取值與重抓值必然相同 → 快照內容零變化。

## 三、健檢現況

### 3.1 狀態與兩種失敗

`components/portfolio/useHealthCheck.ts`：
- `:48` `healthResults: Record<string, { status: 'loading'|'done'|'error'; decision; fullResult }>`
- `:24` `quoteFailMarkdown` → 行情抓取失敗，decision 寫「資料取得失敗」
- `:35` `analysisFailMarkdown` → LLM 呼叫失敗，decision 寫「分析失敗」
- `:53` `healthSeqRef` 世代守衛（per-symbol 單調遞增，單檔與批次**共用同一個 ref**；
  檔頭 `:4-7` 有「拆這個 hook 前先確認守衛仍橫跨兩者」的警語）
- `:100` `handleSingleHealthCheck(symbol)`
- `:135` `handleBatchHealthCheck()` — symbols 在 `:136` 內部算出，未參數化
- `:149` `attemptedSymbols`（catch 只回收實際送 LLM 的那批）
- `:222` return 清單

### 3.2 有結果就沒得重跑

`components/portfolio/HoldingsTable.tsx:113` 的 `HealthCell`：
`:115` `if (!hr) return <健檢按鈕>` —— 只要 `healthResults[symbol]` 存在（**不論成功
或失敗**），儲存格就只剩開詳情的 Badge，那顆 HeartPulse 按鈕不再出現。
所以單檔重跑的能力目前**整個不存在**，只剩「全部健檢」批次。

### 3.3 【地雷】modal 的 open 條件綁 `fullResult`

`components/Portfolio.tsx:613-629`：

```
open={Boolean(healthModalSymbol && healthResults[healthModalSymbol]?.fullResult)}
```

`handleSingleHealthCheck` 開頭（`useHealthCheck.ts:104`）會把該檔設成
`{ status:'loading', decision:'', fullResult:'' }` —— `fullResult` 變空字串，
open 條件立刻轉 false，**modal 會自己彈掉**。要在 modal 內原地重跑就必須先改這個條件。

footer 目前只有一顆「關閉」（`:625`）。

## 四、測試與 gate

- 測試跑道 vitest（`npm run test`）；一鍵機械 gate `npm run gate`（tsc → vitest →
  build → 金鑰掃描 → package/lock diff 0）。
- **`services/quoteCache.ts` 目前零測試覆蓋**（全 repo 搜尋 `isQuoteCacheFresh`／
  `quoteCache` 於 `*.test.ts` 無命中）。`services/` 底下只有一個
  `yahoo.maWarmup.test.ts`。我們正要讓報價顯示依賴它的 TTL 判定。
- 專案慣例**不寫元件測試**（35 個測試檔全在 `utils/` 與 `api/_lib/`），
  所以票 02／03 的驗收走 DOM 實測，不補元件測試。
- 需要 mock 網路／子程序的路徑屬 CONTEXT.md 定義的「首批外」，本案不碰
  （＝不測 `getLatestPrice` 的網路分支，只測抽出來的純政策函式）。
