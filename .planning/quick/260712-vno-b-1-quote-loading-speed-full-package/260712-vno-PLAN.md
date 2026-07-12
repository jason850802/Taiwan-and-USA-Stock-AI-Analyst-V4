---
phase: quick-260712-vno
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - services/quoteCache.ts
  - services/stockDirectory.ts
  - services/yahoo.ts
  - App.tsx
  - api/_lib/yahoo.ts
  - api/yahoo/chart.ts
autonomous: true
requirements: [B1-QUOTE-SPEED]
must_haves:
  truths:
    - "切回看過的標的或週期（日/週/月來回）在快取新鮮期內 0 網路請求即渲染（<300ms）"
    - "冷抓上櫃股（如 6488）不再先吃一整輪 .TW 失敗握手——名錄命中時後綴直達 .TWO"
    - "連點 5 檔股票，畫面最終只顯示最後一檔的資料；舊請求的回應與錯誤不覆蓋新請求的 loading/error/data 狀態"
    - "快取過期時先立即顯示舊資料，背景刷新到貨後自動更新（SWR）"
    - "後端任一 upstream fetch 逾時 8 秒即走既有分類錯誤路徑，整條請求不懸掛"
    - "更新報價按鈕仍真的重抓（不被快取吞掉）"
  artifacts:
    - path: "services/quoteCache.ts"
      provides: "台/美交易時段 TTL 純函式＋memory/sessionStorage 雙層快取存取"
      exports: ["marketForSymbol", "isMarketOpen", "isQuoteCacheFresh", "readQuoteCache", "writeQuoteCache"]
    - path: "services/stockDirectory.ts"
      provides: ".TW/.TWO 後綴預解析純函式"
      exports: ["resolveTaiwanSuffix"]
    - path: "services/yahoo.ts"
      provides: "getStockData 快取/SWR/forceRefresh/signal 整合＋台股三段串行改兩段"
    - path: "App.tsx"
      provides: "fetchData reqId＋AbortController 防競態"
    - path: "api/_lib/yahoo.ts"
      provides: "握手三個 upstream fetch 各 8s timeout"
    - path: "api/yahoo/chart.ts"
      provides: "200 回應 Cache-Control s-maxage=60 + stale-while-revalidate"
  key_links:
    - from: "services/yahoo.ts getStockData"
      to: "services/quoteCache.ts"
      via: "readQuoteCache 先於 fetchRawData；writeQuoteCache 寫入最終 {info,data}"
      pattern: "readQuoteCache|writeQuoteCache"
    - from: "services/yahoo.ts fetchRawData"
      to: "services/stockDirectory.ts resolveTaiwanSuffix"
      via: "ensureTaiwanDirectory + resolveTaiwanSuffix 先於 .TW try-chain"
      pattern: "resolveTaiwanSuffix"
    - from: "App.tsx fetchData"
      to: "services/yahoo.ts getStockData opts"
      via: "signal + onRevalidated + reqId 守衛"
      pattern: "onRevalidated"
---

<objective>
B-1 行情載入全套（Phase B 子包 2/3，權威規格：.planning/optimization/PLAN.md「Phase B / B-1」章節＋「已拍板決策」第 3 條 TTL 政策）。

五項改動：(1) 前端行情雙層快取＋SWR（含週期切換秒開）；(2) 台股三段串行改並行（中文名併入 Promise.all）；(3) .TW/.TWO 名錄預解析（消滅上櫃股 .TW 試錯輪——6488 那 12 秒的大宗）；(4) App.tsx fetchData AbortController＋reqId 防競態；(5) 後端握手 upstream timeout＋chart 端點 CDN Cache-Control。選配的「1d 先抓 2y 快繪」明確不做。

Purpose: 影片實測 6488 選定到出圖 12 秒、週/月切換各 ~7 秒——本包消滅重複抓取與試錯握手，讓看過的東西秒開、沒看過的東西不白等。
Output: 上述 6 個檔案的原子修改＋純函式直測斷言記錄＋SUMMARY.md
</objective>

<execution_context>
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/workflows/execute-plan.md
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/optimization/PLAN.md（「已拍板決策」第 3 條＋「Phase B / B-1」——本包權威規格）
@services/yahoo.ts
@services/stockDirectory.ts
@services/finmind.ts（僅參考：getTwFundamentals 的 memory Map＋sessionStorage 雙層快取為既有先例模式）
@App.tsx
@api/_lib/yahoo.ts
@api/yahoo/chart.ts
</context>

<planner_rulings>
規劃期讀碼後的裁決（執行時不需重新辯論，照做並在 SUMMARY 記錄）：

1. **快取內容＝getStockData 最終回傳值 `{info, data}`**（處理完成的最終資料，非原始回應）。理由：(a) 命中＝0 網路請求＋0 重算，才達成 <300ms；(b) 殭屍棒過濾（步驟 4.5）、FinMind close-null 補值鏈（_synthetic 取代）、量能覆寫全部已在管線內完成——快取包在整條管線外層，後處理不可能被跳過或重複執行（regression guard 的結構性保證）；(c) 若快取原始回應，每次命中仍要打 FinMind 中文名＋籌碼＋量能三支網路請求，白做。
2. **sessionStorage 層保留但定位為 best-effort 加值**（F5 存活），memory Map 為權威層。量化依據：1d|10y 一檔約 2500 根 × ~40 欄位，序列化約 1.5-2.5MB，對上 sessionStorage ~5MB 配額只放得下 1-2 檔大 entry——可接受，因為主要痛點（同 session 內切週期/切回標的）memory 層全覆蓋。一切 sessionStorage 讀寫失敗（配額滿/無痕模式/JSON 壞損）silent 全退化，絕不拋錯（比照 finmind.ts writeSessionCache 先例）。
3. **`info.chipDataUnavailable === true` 的結果只享 10 分鐘短 TTL，不享收盤後沿用**。理由：籌碼不可用可能是暫時性 429，凍結到隔日開盤是退化；且上櫃股籌碼因 FinMind dataset 名稱 bug 目前恆不可用（STATE.md pending todo），若因此完全不快取會讓 6488 這類主要受害者拿不到任何快取收益——短 TTL 是兩者平衡。
4. **AbortSignal 只 plumb 到 queryYahoo**（主要成本：Yahoo chart 含握手最長 12s+）。FinMind 子請求（名/籌碼/量能）內部有 try/catch 吞錯——若 abort 打在籌碼階段會被吞成 null → chipDataUnavailable:true 的降級結果照常完成，**因此 getStockData 在寫快取前必須檢查 `signal?.aborted`，已中止則拋 AbortError 且不寫快取**（防快取中毒）。fetchFinMindRows 簽名不動。
5. **handleRefreshQuote 必須傳 `forceRefresh: true`**，否則「更新報價」按鈕在 TTL 內變 no-op（行為退化）。handleRunAnalysis 的週線抓取不改（自動吃快取收益，語意不變）。
6. **預解析失敗防禦**：名錄命中直達後綴的那次 query 若失敗，fall through 回既有 .TW→.TWO try-chain（極罕見的名錄與 Yahoo 不一致情境下行為不劣於今日）；名錄查無此代碼（含 emerging 興櫃）→ resolveTaiwanSuffix 回 null → 走現行 try-fallback，原行為保留。
7. **CDN 快取安全註記（有意為之，供覆核者看見）**：`s-maxage=60` 使同 URL 60 秒內的重複請求由 Vercel CDN 直接回應、不過 applyGuards（PROXY_SHARED_SECRET/限流）。接受理由：行情為公開資料、視窗僅 60 秒、cache miss 仍全額過 guard 與限流，且 CDN 命中不消耗 function invocation（反而降低濫用成本）。只加在 200 成功路徑，錯誤回應不設此 header。
</planner_rulings>

<tasks>

<task type="auto">
  <name>Task 1: 快取基座——services/quoteCache.ts（TTL 純函式＋雙層存取）＋ stockDirectory.ts 後綴預解析純函式＋一次性直測</name>
  <files>services/quoteCache.ts, services/stockDirectory.ts</files>
  <action>
**A. 新檔 `services/quoteCache.ts`**（純模組：不 import React、模組頂層絕不觸碰 sessionStorage/window，全部延遲到函式內並 try/catch——這樣 `npx tsx` 在 Node 下可直接 import 測試）：

1. `export type QuoteMarket = 'TW' | 'US'`。
2. `export function marketForSymbol(symbol: string): QuoteMarket` —— trim+toUpperCase 後：以 `/\.TWO?$/` 結尾或整串符合 `/^\d{3,6}[A-Z]?$/`（裸台股代碼）→ 'TW'；其餘（含 AAPL、USDTWD=X）→ 'US'。
3. `export function isMarketOpen(msEpoch: number, market: QuoteMarket): boolean` —— 用 Intl.DateTimeFormat（timeZone：TW='Asia/Taipei'、US='America/New_York'；weekday:'short', hour/minute numeric, hour12:false）formatToParts 取交易所當地 weekday＋時分（模式照抄 services/yahoo.ts getExchangeTime，含 h===24→0 正規化）；formatter 以模組層 Map 依 timeZone 快取重用（Intl 建構昂貴，取樣迴圈會呼叫上百次）。週一至週五且分鐘數落在 [開盤,收盤)：TW 09:00–13:30（540–810）、US 09:30–16:00（570–960）。DST 交給 Intl（America/New_York 自動處理 EST/EDT）。
4. `export function isQuoteCacheFresh(cachedAtMs: number, nowMs: number, market: QuoteMarket, shortTtlOnly?: boolean): boolean` —— 依已拍板決策 3（盤中 10 分鐘／收盤後沿用到下一交易日開盤），演算法（順序即語意，勿重排）：
   - `nowMs - cachedAtMs < 10*60_000` → true（盤中 10 分鐘規則，兼作萬用短窗）。
   - `shortTtlOnly` → false（planner_rulings #3：chipDataUnavailable 結果不享沿用）。
   - `isMarketOpen(nowMs, market)` → false（此刻盤中且超過 10 分鐘 → 過期）。
   - `isMarketOpen(cachedAtMs, market)` → false（快取寫入時在盤中，其後已跨越收盤 → 資料缺當日尾盤，過期——覆蓋「盤中 10:00 快取、當日 15:00 讀」情境）。
   - `nowMs - cachedAtMs > 72*3600_000` → false（安全上界；正常週末 TW 週五 13:30→週一 09:00 ≈ 67.5h、US ≈ 65.5h 都在界內；春節等長假提早過期只是多抓一次，無害）。
   - 自 `cachedAtMs + 30min` 起每 30 分鐘取樣至 nowMs：任一取樣點 `isMarketOpen` → false（期間曾開盤——30 分鐘步長遠小於最短交易時段 270 分鐘，不可能漏偵測整個時段）。
   - 以上皆過 → true（收盤後快取，沿用到下一交易日開盤）。
5. 快取存取（entry 型別 `{ cachedAt: number; shortTtlOnly: boolean; result: unknown }`，泛型或由呼叫端斷言皆可）：
   - 模組層 `const memCache = new Map<string, QuoteCacheEntry>()`。
   - `export function readQuoteCache(key: string): QuoteCacheEntry | null` —— memory 優先；miss 再讀 sessionStorage（key 前綴 `quote_cache_v1:`，JSON.parse try/catch，壞損則 removeItem 回 null；讀到即回填 memory）。
   - `export function writeQuoteCache(key: string, entry: QuoteCacheEntry): void` —— memory 必寫；sessionStorage try setItem，QuotaExceeded 之類失敗時 best-effort 清掉所有自家前綴 key 再重試一次，再失敗就放棄（silent，絕不 throw）。
   - `export function writeMemoryAlias(aliasKey: string, entry: QuoteCacheEntry): void` —— 只寫 memory（同一 entry 參照，零成本），供 yahoo.ts 把 `2330|1d` 與 `2330.TW|1d` 指向同一份。

**B. `services/stockDirectory.ts` 追加 export**（緊鄰 isSearchableTaiwanEntry，同「純函式，可獨立測試」註解風格）：

`export function resolveTaiwanSuffix(coreCode: string, dir: StockDirEntry[]): '.TW' | '.TWO' | null` —— 在 dir 中找 `id === coreCode` 的第一筆（**用原始名錄、不過 isSearchableTaiwanEntry 濾網**——特別股 2888A 等使用者仍可能輸入，必須能解析）：type==='twse' → '.TW'；type==='tpex' → '.TWO'；emerging／其他／查無 → null（保留 try-fallback）。線性掃描即可（單次 fetch 呼叫一次，3000 筆無感）。

**C. 一次性直測斷言**（規格要求：純函式要有一次性直測）：在 scratchpad 寫臨時腳本（如 `verify-b1-pure.ts`），`npx tsx` 執行，**不 commit 進 repo**，輸出全文記入 SUMMARY。斷言至少涵蓋：
- `marketForSymbol`：'2330'→TW、'2330.TW'→TW、'6488.TWO'→TW、'00679B'→TW、'AAPL'→US、'USDTWD=X'→US。
- `resolveTaiwanSuffix`（fixture dir）：{id:'2330',type:'twse'}→'.TW'；{id:'6488',type:'tpex'}→'.TWO'；{id:'1264',type:'emerging'}→null；查無代碼→null。
- `isQuoteCacheFresh` 三情境 × 台美兩市場（epoch 用 Date.UTC 建構：台北恆 UTC+8；美東 7 月取 EDT=UTC-4、另加一組 1 月 EST=UTC-5 的盤中判定證明 Intl 有處理 DST）。必測案例（TW 以 2026-07-08 週三為基準日）：
  1. 盤中 10:00 快取、10:05 讀 → fresh；10:20 讀 → stale。
  2. 收盤後 14:00 快取、同日 20:00 讀 → fresh。
  3. 週五 14:00 快取 → 週六/週日任意時刻 fresh、週一 08:59 fresh、週一 09:05 stale。
  4. 盤中 10:00 快取、同日 15:00 讀 → stale（盤中快取不得沿用過收盤）。
  5. shortTtlOnly=true：14:00 快取、16:00 讀 → stale。
  6. US 對照組：盤中（ET 10:00）5 分 fresh／20 分 stale；收盤後（ET 17:00）→ 隔日 ET 09:00 fresh、09:35 stale；1 月 EST 某週三 ET 10:00 isMarketOpen===true。
  </action>
  <verify>
    <automated>npx tsc --noEmit 通過；npx tsx 執行 scratchpad 直測腳本全數斷言通過（輸出記入 SUMMARY）；bash 檢查 `grep -c "sessionStorage" services/quoteCache.ts` 的每一處都在函式體內（模組頂層無裸 sessionStorage 取用——直測腳本能在 Node 下 import 成功本身即為證明）</automated>
  </verify>
  <done>quoteCache.ts 提供 marketForSymbol/isMarketOpen/isQuoteCacheFresh/readQuoteCache/writeQuoteCache/writeMemoryAlias；stockDirectory.ts 提供 resolveTaiwanSuffix；全部純函式直測斷言通過（台美時區 × 盤中/收盤後/隔日開盤前三情境、DST 兩制）；tsc 過</done>
</task>

<task type="auto">
  <name>Task 2: yahoo.ts 整合（快取/SWR/並行化/預解析）＋ App.tsx fetchData 防競態</name>
  <files>services/yahoo.ts, App.tsx</files>
  <action>
**A. `services/yahoo.ts` —— fetchRawData 預解析（現 :280-302 區塊）**：

import `ensureTaiwanDirectory, resolveTaiwanSuffix` from './stockDirectory'（無循環依賴：stockDirectory 只 import apiClient）。codeMatch 命中且 clean 不含 '.TW' 時，在既有 try-.TW 之前插入：`const dir = await ensureTaiwanDirectory()`（有 memCache＋localStorage，常態 0ms；整段 try/catch，名錄失敗即跳過）→ `resolveTaiwanSuffix(coreCode, dir)` 非 null 則 `try { return await performQuery(coreCode + suffix) } catch { /* fall through 既有 try-chain（planner_rulings #6） */ }`。既有 .TW→.TWO try-fallback 原封保留在其後。

**B. `services/yahoo.ts` —— queryYahoo 接 signal**：

`queryYahoo(symbol, interval, range, signal?: AbortSignal)` → fetch options 加 `signal`。fetchRawData 同步加 optional `signal` 參數並透傳到每個 performQuery。getLatestPrice 不傳（簽名不變，optional 參數零影響）。

**C. `services/yahoo.ts` —— getStockData 快取整合**：

1. 簽名改為 `getStockData(symbol, interval = '1d', opts?: { forceRefresh?: boolean; signal?: AbortSignal; onRevalidated?: (r: {info: StockInfo, data: StockDataPoint[]}) => void })` ——第三參數 optional，Portfolio.tsx 兩處呼叫端與 handleRunAnalysis 週線抓取零改動即相容。
2. 把現有函式體整段抽成內部 `fetchStockDataUncached(symbol, interval, signal?)`（**內容零改動搬移**，除了下方 D 的並行化與 signal 透傳到 fetchRawData——殭屍棒過濾 4.5、_synthetic/FinMind OHLC 取代、volumeMap 覆寫、`.replace(/\.TWO?$/i,'')` 全部原樣）。
3. 新的 getStockData 外殼流程：
   - 正規化＋canonical key：`clean = symbol.trim().toUpperCase()`；若 clean 是裸台股碼（`/^\d{3,6}[A-Z]?$/`）→ try `ensureTaiwanDirectory()`＋`resolveTaiwanSuffix`，命中則 `canon = clean + suffix`，否則 canon = clean。`key = canon + '|' + interval`。
   - 非 forceRefresh 時 `readQuoteCache(key)`：
     - **fresh**（`isQuoteCacheFresh(entry.cachedAt, Date.now(), marketForSymbol(canon), entry.shortTtlOnly)`）→ 直接回傳（0 網路請求）。回傳做淺拷貝防禦：`{ info: { ...info }, data: data.slice() }`（防呼叫端意外 mutate 陣列污染快取；資料點物件共享，消費端本就視為 immutable）。
     - **stale** → 立即回傳舊資料（同上淺拷貝），並發動背景刷新：模組層 `inflightRevalidate = Map<string, Promise<...>>` 去重——同 key 已在刷新則不重複發；刷新用 `fetchStockDataUncached(canon, interval)`（**不傳呼叫端 signal**——刷新 promise 可能被多消費端共享，中止會誤傷；planner_rulings #4），成功→寫快取＋（若有）呼叫 `opts.onRevalidated(result)`，失敗→console.warn 吞掉、保留舊快取不清除，finally 從 inflight Map 移除。
     - **miss / forceRefresh** → 若 forceRefresh 且同 key 有 inflight 刷新可直接 await 共用；否則 `await fetchStockDataUncached(canon, interval, opts?.signal)`。
   - **寫快取前守衛**：`if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')`（planner_rulings #4——abort 打在 FinMind 階段會被內部 catch 吞成降級結果，不攔截會把 chipDataUnavailable:true 毒進快取）。
   - 寫入：`writeQuoteCache(key, { cachedAt: Date.now(), shortTtlOnly: result.info.chipDataUnavailable === true, result })`（planner_rulings #3）；若 `result.info.symbol + '|' + interval !== key` 另以 `writeMemoryAlias` 建 memory 別名（canonical 解析失敗但 Yahoo try-chain 成功的殘餘情境）。
4. **快取語意記錄**（寫進碼註解）：快取的是 getStockData 管線終點的最終資料——殭屍棒過濾／close-null 補值／FinMind 量能覆寫都已完成，命中路徑與新抓路徑逐位元同源；TTL 政策見 .planning/optimization/PLAN.md 已拍板決策 3。

**D. `services/yahoo.ts` —— 台股三段串行改並行（現 :587-633 步驟 3）**：

把 :595-599 的 `await fetchFinMindStockInfo(...)` 併入 :610 的 Promise.all，消掉一段串行等待。重構為：
- `const namePromise = (isTaiwanStock && !usedFallback) ? fetchFinMindStockInfo(symbolInfo.symbol) : Promise.resolve(null)`（fetchFinMindStockInfo 內部 try/catch 回 null，永不 reject——Promise.all 安全）。
- `shouldFetchFinMindChips` 為 true 時：`const [fetchedName, institutionalData, finMindPriceData] = await Promise.all([namePromise, fetchInstitutionalData(cleanId, startStr), fetchFinMindPriceVolume(cleanId, startStr)])`；為 false 時：`const fetchedName = await namePromise`。
- **語意守恆三點**（走讀驗證）：(1) `chipDataUnavailable = true` 只能由「shouldFetchFinMindChips 為 true 且 institutionalData === null」觸發——非籌碼路徑（US／TW 週月線）絕不誤設；(2) 中文名抓取條件仍是 `isTaiwanStock && !usedFallback`（所有 interval），與籌碼條件（僅 1d）各自獨立；(3) chipMap/volumeMap/ohlcMap 的填充邏輯逐行原樣。usedFallback 路徑（:483-493）不動。

**E. `App.tsx` —— fetchData 防競態＋SWR 接線**：

1. import 加 `useRef`；新增 `const fetchSeqRef = useRef(0)`、`const fetchAbortRef = useRef<AbortController | null>(null)`。
2. fetchData 重寫：
   - 進入即 `const reqId = ++fetchSeqRef.current`；`fetchAbortRef.current?.abort()` 中止前一請求；建新 AbortController 存入 ref。
   - `getStockData(sym, intvl, { signal: controller.signal, onRevalidated: (r) => { if (fetchSeqRef.current !== reqId) return; setData(r.data); setInfo(r.info); } })`——SWR 背景刷新到貨後更新，但過期 reqId 的更新丟棄（不清 analysis/entryResult——背景刷新是同標的微幅更新，清掉是退化）。
   - 成功路徑：`if (fetchSeqRef.current !== reqId) return;` 先於一切 setState（setData/setInfo/setAnalysis('')/setEntryResult(null)）。
   - catch：`if (fetchSeqRef.current !== reqId) return;` 先於 setError/setData([])/setInfo(null)——舊請求的錯誤（**含被 abort 拋出的 AbortError**）不得污染新請求的狀態機。
   - finally：`if (fetchSeqRef.current === reqId) setLoading(false)`——loading 歸屬最新請求，舊請求不得提前熄燈。
3. handleRefreshQuote：`getStockData(info?.symbol || symbol, interval, { forceRefresh: true })`（planner_rulings #5——否則更新報價在 TTL 內變 no-op）。
4. handleRunAnalysis 週線抓取、Portfolio.tsx：零改動（optional opts 相容）。

**Regression guards 自查清單（改完 git diff 逐項確認，結果記 SUMMARY）**：殭屍棒過濾器 4.5 區塊（:682-699）零 diff；_synthetic 合成＋FinMind OHLC 取代鏈（:360-417、:643-662）零 diff；所有 `.replace(/\.TWO?$/i,'')` 呼叫點原樣；FinMind fallback 誠實化（chipDataUnavailable 語意）依 D-守恆三點走讀；stockDirectory 的 A1 過濾（isSearchableTaiwanEntry）與 B-2 兩段式 searchStocks 零觸碰。
  </action>
  <verify>
    <automated>npx tsc --noEmit 通過；bash 斷言：(1) `grep -n "resolveTaiwanSuffix" services/yahoo.ts` 出現在 try-.TW 行號之前（後綴直達先於試錯輪）；(2) `grep -n "readQuoteCache" services/yahoo.ts` 行號小於 fetchStockDataUncached 呼叫處（快取先於網路）；(3) `grep -c "signal?.aborted" services/yahoo.ts` ≥1（寫快取前守衛存在）；(4) `git diff services/yahoo.ts` 中步驟 4.5 殭屍棒過濾區塊與 _synthetic 區塊無變更行；(5) `grep -c "forceRefresh: true" App.tsx` = 1（handleRefreshQuote）；(6) `grep -c "fetchSeqRef.current !== reqId" App.tsx` ≥3（成功/catch/onRevalidated 三處守衛）＋ finally 有 `=== reqId` 守衛</automated>
  </verify>
  <done>切回看過的 symbol|interval 在新鮮期內 0 網路請求即回傳；上櫃股名錄命中時後綴直達不吃 .TW 失敗輪；台股 1d 中文名與籌碼/量能同一個 Promise.all 並行；連點 5 檔的資料錯置在 reqId/abort 狀態機下不可能（三處過期守衛＋loading 歸屬走讀成立）；更新報價 forceRefresh 真重抓；全部 regression guard 自查零退化；tsc 過</done>
</task>

<task type="auto">
  <name>Task 3: 後端——握手 upstream timeout ＋ chart 端點 CDN Cache-Control</name>
  <files>api/_lib/yahoo.ts, api/yahoo/chart.ts</files>
  <action>
**A. `api/_lib/yahoo.ts`**：

1. 常數 `const UPSTREAM_TIMEOUT_MS = 8000;`（規格 8-10s 取 8s：最壞串行 cookie+crumb+main = 24s，留在 chart.ts maxDuration=30 內）。
2. 三個 upstream fetch 各加 `signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)`：fetchCookie 的 fc.yahoo.com（:105）、fetchCrumb 的 getcrumb（:129）、fetchYahooWithHandshake 的主 fetch（:175）。Vercel Node 18.17+/20 原生支援 AbortSignal.timeout，零依賴。
3. `classifyYahooError`（:217）name 檢查擴為 `name === 'AbortError' || name === 'TimeoutError'`——undici 對 AbortSignal.timeout 拋的是 DOMException name='TimeoutError'（message 'The operation was aborted due to timeout' 雖已被既有 /aborted|timed?\s*out/i regex 撈到，但顯式列名不賭 message 措辭）。
4. 逾時路徑語意（不改碼、走讀確認）：timeout → classifyYahooError → UPSTREAM_ERROR → canRetry 只認 UNAUTHORIZED/RATE_LIMITED → 不重試、立即拋分類錯誤 → chart.ts 回 502 → 前端 getStockData catch → 台股 1d 走既有 FinMind fallback。整條請求有界，不懸掛。已知殘餘風險（記 SUMMARY 即可，不擋）：極端情境「attempt1 兩段近逾時成功＋主 fetch 401＋retry 全額 24s」理論可超 maxDuration=30 被 Vercel 砍——先前是無界懸掛，本改動嚴格改善。

**B. `api/yahoo/chart.ts`**：

成功路徑 `res.status(200).json(json)` 之前加 `res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')`。錯誤路徑不設（分類錯誤不得被 CDN 快取）。s-maxage 是 CDN 專屬指令、瀏覽器忽略——前端行為判斷（含 Task 2 的前端快取 TTL）不受影響。CDN 命中繞過 applyGuards 的取捨已裁決接受（planner_rulings #7，公開資料＋60 秒窗＋miss 仍全額過 guard），碼註解一行註明。search.ts 不動（本包範圍僅 chart）。
  </action>
  <verify>
    <automated>npx tsc --noEmit 通過；bash 斷言：(1) `grep -c "AbortSignal.timeout" api/_lib/yahoo.ts` = 3（三個 upstream fetch 全覆蓋）；(2) `grep -c "TimeoutError" api/_lib/yahoo.ts` ≥1；(3) `grep -n "s-maxage=60" api/yahoo/chart.ts` 存在且位於 status(200) 路徑（走讀確認錯誤路徑無此 header）</automated>
  </verify>
  <done>握手三個 upstream fetch 各有 8s timeout，逾時走既有分類錯誤路徑（前端照常 FinMind fallback），不懸掛；chart 200 回應帶 s-maxage=60＋swr=300、錯誤回應不帶；tsc 過</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CDN → api/yahoo/chart | s-maxage 使 60 秒內重複 URL 由 CDN 回應、不過 applyGuards |
| 瀏覽器 sessionStorage | 快取行情資料落地於使用者自身瀏覽器 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-B1-01 | Elevation | CDN 快取繞過 PROXY_SHARED_SECRET/限流 | accept | 公開行情資料、60 秒窗、miss 仍全額過 guard；碼註解明示（planner_rulings #7） |
| T-B1-02 | Tampering | sessionStorage 快取被使用者/擴充套件竄改 | accept | 僅影響自身瀏覽器顯示；JSON.parse 壞損即丟棄 removeItem，不 crash |
| T-B1-03 | DoS | upstream 懸掛耗盡 serverless 時長 | mitigate | AbortSignal.timeout(8000) × 3 段握手（Task 3） |
</threat_model>

<verification>
1. `npx tsc --noEmit` 全綠（每 task 後各跑一次，最終再跑一次）。
2. 純函式直測（Task 1 scratchpad 腳本）：TTL 三情境 × 台美市場 × DST 兩制、marketForSymbol、resolveTaiwanSuffix 全數斷言通過，輸出記入 SUMMARY。
3. 後綴直達證明：resolveTaiwanSuffix('6488', fixture)==='.TWO' 斷言＋grep 證明 fetchRawData 預解析先於 .TW try-chain。
4. 快取命中 0 網路請求：走讀證明 fresh 路徑在任何 fetch 呼叫前 return（grep 行號斷言輔助）。
5. 防競態：App.tsx 三處 reqId 過期守衛＋finally loading 歸屬＋abort 錯誤不落 setError 的走讀斷言。
6. Regression guards：git diff 確認殭屍棒過濾器/_synthetic 補值鏈/後綴剝除 regex 零變更；並行化語意守恆三點走讀。
7. 瀏覽器 e2e 體感實測（6488 冷抓 ≤5s、切回 <300ms、連點 5 檔）屬 Phase B 收尾（Sonnet 覆核＋preview 實跑）範圍，非本包阻斷項。
</verification>

<success_criteria>
- 五項改動全落地且「1d 先抓 2y 快繪」未做（明確不做項）。
- 快取 TTL 對盤中/收盤後/隔日開盤前三情境台美各自正確（純函式直測證明）。
- 上櫃股冷抓不再吃 .TW 試錯輪（名錄命中路徑）。
- 連點 5 檔資料錯置在狀態機上不可能。
- 更新報價按鈕、FinMind fallback、殭屍棒過濾、close-null 補值、A1/B-2 搜尋成果全部零退化。
- `npx tsc --noEmit` 通過；原子 commit（可 1-3 個，依 task 邊界）。
</success_criteria>

<output>
完成後建立 `.planning/quick/260712-vno-b-1-quote-loading-speed-full-package/260712-vno-SUMMARY.md`（含：直測腳本輸出全文、planner_rulings 各項的實作落點、regression guard 自查結果、已知殘餘風險 T-B1-01 與 maxDuration 邊界註記）。
</output>
