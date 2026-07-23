---
phase: 12
slug: arch-deepening
branch: gsd/phase-arch-deepening
baseline: main@36c0f41（行號快照全以此為準；動手前開檔確認，行號漂移以內容錨定）
files_modified:
  new:
    - utils/market.ts
    - utils/market.test.ts
    - utils/fx.ts
    - utils/persistentStore.ts
    - utils/persistentStore.test.ts
    - services/fetchError.ts
    - utils/fetchError.test.ts
    - utils/workerPool.ts
    - utils/workerPool.test.ts
    - utils/backfillPipeline.ts
    - utils/backfillPipeline.test.ts
    - utils/geminiRules.test.ts
    - utils/portfolioGrouping.ts
    - utils/portfolioGrouping.test.ts
    - components/portfolio/HoldingsTable.tsx
    - components/portfolio/usePortfolioForm.ts
    - components/portfolio/useHealthCheck.ts
    - components/portfolio/useHoldingPrices.ts
    - components/portfolio/useDailySnapshot.ts
  modified:
    - utils/portfolioFees.ts
    - services/quoteCache.ts
    - services/gemini.ts
    - services/yahoo.ts
    - services/finmind.ts
    - App.tsx
    - utils/txnStore.ts
    - utils/importStore.ts
    - utils/closeSeriesCache.ts
    - utils/portfolioHistoryStore.ts
    - components/Portfolio.tsx
    - components/portfolio/PnlHistorySection.tsx
must_haves:
  - 既有 185 個 vitest 案例（11 檔）零修改零刪除、全程綠（行為鎖）
  - npx.cmd tsc --noEmit 0 錯誤；npm run build 成功；grep -r "AIza" dist/ 無結果
  - package.json 與 package-lock.json diff 為 0（禁新依賴）
  - 5 個 systemInstruction 常數位元組零變更（T5 snapshot 為證）
  - 各 localStorage key 既有 JSON 形狀不變（裸陣列維持裸陣列、v1 信封維持原樣，不做資料遷移）
  - files_modified 之外任何檔案 diff 為 0（.planning/ 除外）
---

# Phase 12 PLAN — 架構深化（六張健檢卡）

## 給冷啟動執行者的前提（Codex 無對話背景，全部照此執行）

### 拍板決策（詳見 12-CONTEXT.md，衝突時以本節為準）
- **D-01 順序**：T1 市場分類 → T2 持久層 → T3 錯誤分類 → T4 管線＋pool → T5 規則書鎖定 → T6a/T6b Portfolio 拆解 → T7 人工驗證。一任務一 commit（T6 兩 commit）。
- **D-02**：`utils/market.ts` 是市場分類唯一權威；`portfolioFees.isTwStock` 改 re-export（16 個既有呼叫端不動）。全期唯一允許的行為變化之一：App.tsx 無 info 分支 `/^\d{4}$/` → 統一語意。
- **D-03**：持久層工廠只管殼（parse 守衛＋quota 重試骨架），域內裁剪策略由各 store 注入；儲存格式位元組相容，**不做遷移**。
- **D-04**：DataFetchError 的 message **維持現有字串原文**，只是加上 kind；全期允許的行為變化之二：Portfolio 健檢失敗文案依 kind 分流（不再無條件寫「可能限流中」）。
- **D-05**：backfillPipeline 的 seam 是注入 ports（fetchDaily/closeCache/sleep）；重試政策照舊（首輪 3 workers、重試 2 輪各 1 worker、輪間 sleep(45000)）。
- **D-06**：**禁止**合併兩套戒律文字（進場 vs 加碼是刻意不同的領域規則）；T5 只 export＋snapshot 鎖定＋加交叉引用註解。SI 字串內容一個位元組都不能動。
- **D-07**：T6a 只抽 hooks 與純函式（JSX 零變動）、T6b 才併表；TW 11 欄含手續費欄、US 10 欄費用進 tooltip 的差異必須原樣保留。

### 環境事實（Windows，踩過的雷）
- 路徑含空格：`E:\My Project\...`——所有命令引號包路徑。
- PowerShell 5.1：沒有 `&&`；用 `npx.cmd tsc --noEmit`、`npx.cmd vitest run`（或 `npm run test`）；文字搜尋用 `Select-String`（沒有 grep）。
- 產物金鑰掃描在 Git Bash 跑：`npm run build` 後 `grep -r "AIza" dist/` 必須無結果。
- **禁裝任何 npm 套件**；新檔一律相對路徑 import（repo 現況零 `@/` alias 使用）。
- git 大動作（checkout/merge）前先確認無 node 程序鎖檔（`tasklist //FI "IMAGENAME eq node.exe"`）。
- 寫檔一律 UTF-8。

### 既有程式碼事實（行號快照 @36c0f41；動手前開檔確認）
- `utils/portfolioFees.ts:5-9`：`export const isTwStock`＝`s.endsWith('.TW') || s.endsWith('.TWO') || /^\d{3,6}[A-Z]?$/.test(s)`（先 toUpperCase）。測試鎖在 `utils/portfolioFees.test.ts:16-22`。
- 市場分類待收斂點：`services/quoteCache.ts:22-27`（marketForSymbol）、`services/gemini.ts:535`、`services/gemini.ts:638`、`App.tsx:284-286`（無 info 分支 `/^\d{4}$/`——**已知分歧**）、`App.tsx:289-291`、`services/yahoo.ts:361,:476,:808,:829,:841`（`meta*.symbol.endsWith` 後綴判斷，輸入恆帶後綴）、`services/yahoo.ts:863`（裸碼 regex）。
- **市場分類禁改清單**：`services/yahoo.ts:292`（`match(/^(\d{3,6}[A-Z]?)/)` 是「抽取」非分類，非錨定屬刻意）、`services/yahoo.ts:1038`（canonical key）、`services/yahoo.ts:870`（fallback 硬編 `isTaiwanStock = true`）、`services/stockDirectory.ts:100-102`（名錄內個股/ETF 子分類）、`api/_lib/finmind.ts:47`、`api/_lib/yahoo.ts:35`（後端白名單）。
- 持久層現況：`App.tsx:77-88`（portfolio_items 裸陣列；**寫入無 try/catch**）；`utils/txnStore.ts`（96 行，`{version:1,txns}`，寫失敗只 warn 不裁剪）；`utils/closeSeriesCache.ts`（73 行，`{version:1,series}` 欄位轉陣列壓縮，quota 裁最舊一半）；`utils/importStore.ts`（67 行，兩段裁剪 :38-41、:51-53）；`utils/portfolioHistoryStore.ts`（67 行，兩 key，`safeSet` :9-16，snapshots 裁 backfill 最舊 1/4 且 live 永不裁 :56-63）。
- 錯誤丟擲現況：`services/yahoo.ts` throw 於 :254、:266、:274、:276、:280、:331、:880；`services/finmind.ts` :41-43（掛 `.status`）、:391。消費端 `PnlHistorySection.tsx:169-175`（diagnose regex：`/429|too many|限流/i`、`/5\d\d|internal|failed to fetch|networkerror/i`）、`Portfolio.tsx:1014`、`Portfolio.tsx:1081`（硬編猜測文案）。
- worker-pool 三份：`PnlHistorySection.tsx:69-80`（配息，3 併發，逐項遞增 divState）、`PnlHistorySection.tsx:147-168`（fetchBatch，workers 參數 3→重試 1，記 lastError＋missed[]）、`Portfolio.tsx:1057-1064`（批次健檢，3 併發，無進度無 try/catch——靠 buildHealthItem :964-999 內部吞錯恆不 throw）。
- `runBackfill`＝`PnlHistorySection.tsx:102-245`：市場篩選 :103（`isTwStock` 對照 market）→ txns :106（**直接 loadTxns()，不經 props**）→ 匯率守衛 :112-119（US 無匯率即 error return，不用 32）→ 快取讀 :136-142（getCachedSeries 逐檔）→ 併發抓 :147-168（getStockData(sym,'1d')）→ 重試 :177-184（sleep(45000)）→ 寫快取 :186（putCachedSeriesMany(freshlyFetched, firstTxnDate)）→ 模式選擇 :211-239（`useTxnMode ? buildBackfillFromTxns : buildBackfillRows`）→ merge :240-242（filter 掉同市場舊 backfill 後 upsertSnapshots）。
- `utils/portfolioHistory.ts`（416 行）export：computeLiveSnapshot/upsertSnapshots/reconstructLotAsOf/buildBackfillRows/buildBackfillFromTxns(:257)/buildChartSeries。`utils/dividendEstimator.ts`（144 行）：sharesBefore/estimateDividends/toDividendTxns/dividendCumUpTo。
- gemini.ts 5 個 SI 常數（module 私有，未 export）：`ENTRY_SYSTEM_INSTRUCTION_FULL`:151-177、`ENTRY_SYSTEM_INSTRUCTION_FAST`:179-196、`TRADE_DECISION_SYSTEM_INSTRUCTION`:247-525、`HEALTH_CHECK_SYSTEM_INSTRUCTION`:747-935、`FUNDAMENTALS_SYSTEM_INSTRUCTION`:997-1032。`formatHealthCheckData`:636-745、`formatFundamentalsData`:958-995。A3 快取 hash＝mode＋台北日期＋fnv1a(SI+' '+prompt)（geminiCache.ts:33-35）——**SI 位元組變動＝快取全失效，禁止**。
- Portfolio.tsx（1593 行）：`groupLotsBySymbol`:38-46（module 級唯一一份）；TwGroupTable :150-389（12 props，11 欄含手續費欄，calcTwSellFeeAndTax）；UsGroupTable :407-713（15 props，多 displayCurrency/onToggleCurrency/usdTwdRate，10 欄，calcUsFee＋toDisplay :427-436，**rate fallback 32 於 :415**）；主元件 useState :717-758（prices/historyTick/usdTwdRate/showAddModal/deleteConfirm/sellTarget/showImportModal/includeDividend/displayCurrency/isAnalyzeMode/tradeAnalyzing/tradeResult/showTradeResult/healthResults/healthModalSymbol/batchChecking/form/feeInput/feeTouched＋healthSeqRef :739）；三個 useEffect：:785-787 抓價、:793-807 每日快照 debounce、:814-839 手續費試算（**主元件 rate fallback 32 於 :812**）；健檢 :964-1126（buildHealthItem/handleSingleHealthCheck/handleBatchHealthCheck）。
- App.tsx → Portfolio 9 props（:413-423）：items/onAdd/onDelete/onUpdate/realizedTrades/onSell/onUpdateMeta/onDeleteTrade/onStatementImport。
- 測試現況：11 檔 185 案例（portfolioFees 18、dividendEstimator 14、entryFilter 9、backfillFromTxns 11、portfolioLedger 11、importReplay 22、math 23、portfolioHistory 21、cathayTw 30、parsers 18、importPlan 8）。**測試檔全在 utils/ 底下**。

---

## Task 1 — 市場分類唯一權威（健檢卡 4）

**檔案**：新 `utils/market.ts`、`utils/market.test.ts`；改 `utils/portfolioFees.ts`、`services/quoteCache.ts`、`services/gemini.ts`、`App.tsx`、`services/yahoo.ts`。

**步驟**：
1. 建 `utils/market.ts`：把 portfolioFees.ts:5-9 的 `isTwStock` **整段搬入**（實作零改寫），加 `export const marketOf = (symbol: string): 'TW' | 'US' => isTwStock(symbol) ? 'TW' : 'US';`。
2. `utils/portfolioFees.ts`：刪本地實作，改 `export { isTwStock } from './market';`（呼叫端零改動）。
3. `services/quoteCache.ts:22-27`：`marketForSymbol` 本體改 `return marketOf(symbol)`（export 名保留）。
4. `services/gemini.ts:535`、`:638`：條件式整句換成 `isTwStock(symbol)`／`isTwStock(item.symbol)`（import 自 `../utils/market`）。
5. `App.tsx:284-286`：整段換 `const isTaiwanStock = isTwStock(info?.symbol ?? symbol);`；`:289-291` 的 regex 判斷換 `isTwStock(stripped)`。
6. `services/yahoo.ts` 六處分類：`:361`、`:476`、`:808`、`:829`、`:841` 的 `endsWith` 雙判斷換 `isTwStock(meta*.symbol)`；`:863` 換 `isTwStock(cleanSymbol)`（原變數名 isPotentialTaiwanStock 保留）。**禁改清單五處碰都不碰**。
7. `utils/market.test.ts` 鎖真值表（見下）＋斷言 `portfolioFees` re-export 與 `market` 同一參考。

**真值表（機械對數）**：`'2330'→TW`、`'0050'→TW`、`'00631L'→TW`、`'00679B'→TW`、`'6488'→TW`、`'2330.TW'→TW`、`'6488.TWO'→TW`、`'aapl'→US`、`'AAPL'→US`、`'NVDA'→US`、`'BRK.B'→US`、`'VT'→US`。

**雷區（diff 形狀）**：quoteCache/gemini/App/yahoo 五檔只准出現「import 行新增」與「條件式單行替換」兩類 diff；yahoo.ts 出現任何抓取/解析/快取邏輯行變動即回退。portfolioFees.test.ts **不准動**（它綠著就是 re-export 成功的證據）。

**驗收**：tsc 0 錯；185＋新案例全綠；`Select-String -Path App.tsx -Pattern '\^\\d\{4\}\$'` 0 命中；yahoo.ts 內 `endsWith('.TW')` 剩 0 處（分類用途）。

## Task 2 — 持久層 versioned store 工廠（健檢卡 3）

**檔案**：新 `utils/persistentStore.ts`、`utils/persistentStore.test.ts`；改 `App.tsx`、`utils/txnStore.ts`、`utils/importStore.ts`、`utils/closeSeriesCache.ts`、`utils/portfolioHistoryStore.ts`。

**工廠 interface（實作自由，介面照此）**：
```ts
createPersistentStore<T>(opts: {
  key: string;
  fallback: () => T;                    // 缺值/壞 JSON/驗形失敗時回傳
  decode?: (raw: unknown) => T | null;  // 驗形；null 視同 fallback
  trimForRetry?: (value: T) => T;       // quota 失敗時裁一次再試（域內策略）
  storage?: Storage;                    // 測試注入；預設 localStorage
}): { load(): T; save(value: T): boolean; clear(): void }
```
**序列化必須是 `JSON.stringify(value)` 原樣**——各 store 的信封（`{version:1,...}`／裸陣列）由呼叫端的 T 自帶，工廠不加包裝（位元組相容鐵則）。

**步驟**：
1. 建工廠＋測試（注入記憶體 Storage stub）：壞 JSON→fallback；quota 拋錯→trimForRetry 恰被呼叫一次→重試成功；重試仍失敗→false＋不 throw；round-trip 保形（裸陣列進出仍裸陣列）。
2. 各 store 換內臟保介面：txnStore（loadTxns/saveTxns/appendTxns 簽名不變；**裁剪策略維持「無」**，quota 失敗照舊只 warn 回 false）、importStore（兩段裁剪語意原樣塞進 trimForRetry＋二次裁剪的遞迴/迭代等價實作）、closeSeriesCache（裁最舊一半策略原樣）、portfolioHistoryStore（snapshots 裁 backfill 最舊 1/4、live 永不裁；trades 無裁剪）。
3. `App.tsx:77-88`：portfolio_items 改走工廠（`fallback: () => []`、decode 驗陣列）；讀寫行為升級為有防護——這不是行為變化，是把「從未處理的例外」處理掉。

**雷區（diff 形狀）**：各 store 檔的 export 簽名一個都不准變（`Select-String 'export'` 前後對照相同）；儲存 key 字串常數逐字不變；**禁止**在任何 store 加 version 遷移邏輯。

**驗收**：tsc 0 錯；全部測試綠（backfillFromTxns/importReplay/portfolioHistory 等既有測試間接覆蓋 store 介面穩定）；新測試含「舊格式資料直接可讀」案例（以現行 JSON 形狀字面量作 fixture）。

## Task 3 — 錯誤分類跨 seam（健檢卡 5）

**檔案**：新 `services/fetchError.ts`、`utils/fetchError.test.ts`；改 `services/yahoo.ts`、`services/finmind.ts`、`components/portfolio/PnlHistorySection.tsx`、`components/Portfolio.tsx`。

**步驟**：
1. 建 `services/fetchError.ts`：`export type FetchErrorKind = 'RATE_LIMIT'|'BACKEND_DOWN'|'NOT_FOUND'|'PARSE'|'NETWORK'|'UNKNOWN';`＋`export class DataFetchError extends Error { readonly kind: FetchErrorKind; constructor(kind, message) }`＋`export const classifyCaught = (e: unknown): FetchErrorKind`（status 429→RATE_LIMIT、5xx→BACKEND_DOWN、TypeError/failed to fetch→NETWORK、其餘 UNKNOWN）。
2. yahoo.ts 換丟：:254→NOT_FOUND、:266→依 res.status（429→RATE_LIMIT、≥500→BACKEND_DOWN、其他→BACKEND_DOWN）、:274→NOT_FOUND、:276→PARSE、:280→NOT_FOUND、:331→NOT_FOUND、:880→**若 err 已是 DataFetchError 原樣 rethrow**，否則包 UNKNOWN（message 維持 `Data Fetch Failed: ${err.message}` 原文）。
3. finmind.ts :41-43：改丟 `new DataFetchError(status===429?'RATE_LIMIT':status>=500?'BACKEND_DOWN':'UNKNOWN', 同一 message)`（`.status` 掛載可保留）；:391→RATE_LIMIT 語意屬猜測，**改 UNKNOWN**，message 原文不動。
4. `PnlHistorySection.tsx` diagnose（:169-175）：記錄錯誤處改存 `{kind?, message}`；diagnose 先 switch kind（RATE_LIMIT→現行限流文案、BACKEND_DOWN→現行無回應文案），kind 缺席才走既有 regex（fallback 保留，一行不刪）。
5. `Portfolio.tsx:1014`、`:1081`：catch 住的錯誤依 kind 分流三段文案（RATE_LIMIT→維持現行「可能限流中」句、BACKEND_DOWN→「行情後端目前無回應，請確認網路或稍後再試」、其他→「行情資料暫時無法取得，請稍後再試」；:1081 尾句「或單獨對此檔重跑健檢」保留）。
6. `utils/fetchError.test.ts`：kind 判定表（429/500/TypeError/字串錯誤）＋DataFetchError 穿透（instanceof 保持）。

**雷區（diff 形狀）**：yahoo/finmind 兩檔只准「throw 行替換＋import」；**所有 message 字串逐字保留**（диff 中字串字面量變動即回退）；抓取/解析邏輯零觸碰。

**驗收**：tsc 0 錯；全測試綠；`Select-String -Path services\yahoo.ts -Pattern 'throw new Error\('` 0 命中（全換 DataFetchError）。

## Task 4 — 回推管線 deep module ＋ worker-pool 唯一化（健檢卡 2）

**檔案**：新 `utils/workerPool.ts`、`utils/workerPool.test.ts`、`utils/backfillPipeline.ts`、`utils/backfillPipeline.test.ts`；改 `components/portfolio/PnlHistorySection.tsx`、`components/Portfolio.tsx`。

**步驟**：
1. `utils/workerPool.ts`：`export async function runWithConcurrency<T,R>(items: T[], workers: number, task: (item:T)=>Promise<R>, hooks?: { onSettled?: (item:T, result: {ok:true,value:R}|{ok:false,error:unknown}) => void }): Promise<void>`——游標池語意與現行三份一致（共享 index、Math.min 夾 worker 數）。測試：順序無關完成、併發上限（同時在飛 ≤ workers，用計數器斷言）、錯誤不中斷池。
2. `utils/backfillPipeline.ts`：
```ts
export interface BackfillPorts {
  fetchDaily: (symbol: string) => Promise<{ close: number|null; date: string }[]>; // prod: getStockData(sym,'1d') 的 data
  closeCache: { get(symbol: string): CloseBar[]|null; putMany(entries: {symbol:string; bars: CloseBar[]}[], fromDate?: string): void };
  sleep: (ms: number) => Promise<void>;
}
export async function runBackfillPipeline(params: {
  market: 'TW'|'US';
  items: PortfolioItem[];         // 已由 UI 篩到本市場
  txns: StoredTxn[];              // 已由 UI loadTxns() 並篩市場
  usdTwdRate: number;
  ports?: Partial<BackfillPorts>; // 預設接真實 adapter
  onProgress?: (p: { done: number; total: number }) => void;
}): Promise<
  | { ok: true; snapshots: DailyPnlSnapshot[]; fetched: number; cacheHits: number; missedSymbols: string[] }
  | { ok: false; kind: FetchErrorKind | 'NO_DATA'; detail: string }
>
```
   內部搬移 :136-242 的既有邏輯：快取讀→toFetch→首輪 3 workers（用 runWithConcurrency）→missed 重試 2 輪各 1 worker、輪間 `ports.sleep(45000)`→putMany 批次寫→`useTxnMode ? buildBackfillFromTxns : buildBackfillRows`→回傳 snapshots（**merge/save 留 UI**）。錯誤診斷改讀 DataFetchError.kind（T3 已就位）。
3. `PnlHistorySection.tsx`：runBackfill 縮成——市場篩選＋匯率守衛（原樣留 UI）→ `loadTxns()` → 呼叫管線（onProgress 映射 setBfState）→ ok 時 cleaned＋upsertSnapshots＋saveSnapshots（:240-242 原樣）→ 錯誤時依 kind 設 error 文案。:147-168 的 fetchBatch 與 :177-184 重試迴圈**整段刪除**（邏輯已進管線）。:69-80 配息 runner 改用 runWithConcurrency（divState 進度語意不變）。
4. `Portfolio.tsx:1057-1064`：批次健檢改用 runWithConcurrency（無進度、靠 buildHealthItem 吞錯的現行語意原樣——hooks 不傳 onSettled 或傳空實作）。
5. `utils/backfillPipeline.test.ts`（fake ports，sleep 瞬時）：全快取命中零抓取；部分 429 首輪失敗→重試補齊→snapshots 與全成功一致；重試仍缺→missedSymbols 正確且其餘照算；txns 模式 vs lots 模式選擇；進度單調遞增至 total。fixture 用小型合成流水（3 檔 × 10 日），**期望快照值以 buildBackfillFromTxns 既有測試（backfillFromTxns.test.ts 11 案例）風格手排、獨立算出**。

**雷區（diff 形狀）**：`utils/portfolioHistory.ts`／`utils/dividendEstimator.ts` **零 diff**（管線只是搬編排，不動計算）；PnlHistorySection 的 JSX 區塊（return 之後）只准文案分流的最小改動；Portfolio.tsx 本任務只准動 :1057-1064 池子一段。

**驗收**：tsc 0 錯；全測試綠（新增 ≥12 案例）；`PnlHistorySection.tsx` 行數顯著下降且不再 import getStockData/fetchFinMindRows（改由管線內部）；三份游標池原文（`while (cursor < ...)` 同構段）全 repo 剩 workerPool.ts 一處。

## Task 5 — 規則書鎖定防漂移（健檢卡 6，重定義版）

**檔案**：改 `services/gemini.ts`（只加 export 與註解）；新 `utils/geminiRules.test.ts`。

**步驟**：
1. **Spike-first**：先確認 vitest 對 `utils/geminiRules.test.ts` 的收錄（測試檔放 utils/ 是為了沿用現行收錄範圍——若 vitest include 已涵蓋 services/ 亦可放 services/，以實跑為準）；並確認 `import { ... } from '../services/gemini'` 在 node 測試環境無副作用（模組層只有常數與函式宣告，geminiCache 只在呼叫期碰 localStorage；若 import 失敗，改為測試檔內 `vi.stubGlobal('localStorage', stub)` 先行）。
2. gemini.ts：5 個 SI 常數宣告前加 `export`（**只加關鍵字，字串內容位元組零變**）；`formatHealthCheckData` 已 export 則不動。
3. 兩套戒律區塊各加一行註解（:421 前、:850 前）：「⚠ 進場（禁止做多）與加碼（大忌）是刻意不同的兩套規則——改任一套前先讀 12-CONTEXT.md D-06，並同步檢視另一套是否該跟」。註解只准加在字串字面量**之外**。
4. `utils/geminiRules.test.ts`：5 個 SI 的 `toMatchSnapshot()`（首跑生成基準）＋3 條內容不變量（TRADE_DECISION 含「六大做多進場位置」且含買點 1-6 六行；HEALTH_CHECK 含「加碼大忌」；ENTRY_FULL 與 ENTRY_FAST 互不相等）＋`formatHealthCheckData` 固定 fixture（2 檔：一台股一美股）輸出 snapshot。

**雷區（diff 形狀）**：gemini.ts 只准三類 diff——`export ` 關鍵字前綴、字串外註解行、（無其他）。**snapshot 基準生成後，gemini.ts 再有任何字串變動測試必紅**——這就是本卡的交付物。

**驗收**：tsc 0 錯；新測試綠且 snapshot 檔入庫；`git diff` 中 gemini.ts 無任何字串字面量行。

## Task 6a — Portfolio 抽 hooks 與純函式（健檢卡 1 前半）

**檔案**：新 `utils/portfolioGrouping.ts`（+test）、`components/portfolio/usePortfolioForm.ts`、`useHealthCheck.ts`、`useHoldingPrices.ts`、`useDailySnapshot.ts`；改 `components/Portfolio.tsx`。

**步驟**：
1. `groupLotsBySymbol`（:38-46）整段搬 `utils/portfolioGrouping.ts`，Portfolio.tsx 改 import；`utils/portfolioGrouping.test.ts` 鎖：多 lot 聚合股數/成本、單 lot 直通、空陣列、排序穩定（依現行實作行為寫，先讀函式再出題）。
2. 四個 hooks 平移 state＋effect＋handlers（**JSX 零變動**；hook 回傳現名變數，主元件解構後原名使用）：
   - `useHoldingPrices(items)` ← prices state＋:785-787 effect＋fetchAllPrices。
   - `useDailySnapshot(items, prices, usdTwdRate)` ← :793-807 debounce 快照 effect＋historyTick。
   - `usePortfolioForm(...)` ← form/feeInput/feeTouched/showAddModal＋:814-839 試算 effect＋submit 組裝。
   - `useHealthCheck(...)` ← healthResults/healthModalSymbol/batchChecking/healthSeqRef＋buildHealthItem＋handleSingleHealthCheck＋handleBatchHealthCheck（:964-1126）。
3. rate fallback：新 `utils/fx.ts` `export const USD_TWD_FALLBACK = 32;`，:812 與 :415 兩處改引用（本步只動 :812，:415 留給 T6b 併表時處理）。

**雷區（diff 形狀）**：本 commit 的 Portfolio.tsx diff 只准「刪除搬走的區塊＋import＋hook 呼叫行」；**JSX（return 內）零 diff**（`git diff` 檢查 return 段落無變動）；App.tsx 零 diff。

**驗收**：tsc 0 錯；全測試綠；Portfolio.tsx 行數下降 ≥300；`groupLotsBySymbol` 全 repo 只存在 utils/portfolioGrouping.ts。

## Task 6b — HoldingsTable 併表（健檢卡 1 後半）

**檔案**：新 `components/portfolio/HoldingsTable.tsx`；改 `components/Portfolio.tsx`。

**步驟**：
1. 設計 `MarketTableSpec`（介面示意，實作依現碼微調）：`{ market: 'TW'|'US'; showFeeColumn: boolean; toDisplay?: (twd/usd 轉換…); costInDisplay: (...); sellFee: (...) }`——TW spec 用 calcTwSellFeeAndTax＋恆 TWD；US spec 用 calcUsFee＋toDisplay＋displayCurrency 切換＋USD_TWD_FALLBACK。
2. 以 **UsGroupTable（:407-713，功能超集）為藍本**寫 HoldingsTable，用 spec 分支吸收 TW 差異：11 欄 vs 10 欄（TW 的獨立手續費欄依 `showFeeColumn`＋現行 hasBuyFee 旗標 :228,293,349 語意）、健檢 badge／刪除二次確認／展開列逐段對照兩表原文搬移。
3. Portfolio.tsx：兩處 `<TwGroupTable/>`／`<UsGroupTable/>` 呼叫點換 `<HoldingsTable spec={...}/>`；刪除兩個舊元件定義（:150-389、:407-713）。
4. 對照走查（執行者自檢，逐項寫進 commit message）：TW 手續費欄顯示條件、US tooltip feeDetails、幣別切換按鈕只在 US、賣出/刪除/展開行為兩市場各自不變。

**雷區（diff 形狀）**：**disallow 行為「順手修正」**——兩表現行任何不一致（含視覺）都原樣保留，發現疑似 bug 記到回報不修；SellModal/RealizedLedger/ImportStatementModal/PnlHistorySection 零 diff。

**驗收**：tsc 0 錯；全測試綠；build 過；Portfolio.tsx 總行數 ≤ 900（自 1593）；grep 無 TwGroupTable/UsGroupTable 殘留。

## Task 7 — checkpoint:human-verify（使用者實機驗證）

起環境用 `/start-dev`（3000＋3001）。逐項按：
1. **庫存基本操作**：新增台股（2330，含手續費試算跳動）、新增美股（AAPL）、展開明細、刪除（需二次確認）、賣出一筆→已實現帳本出現、復原測試資料。
2. **表格對照**：台股表 11 欄含「手續費」欄；美股表 10 欄、費用在損益 tooltip；美股 TWD/USD 切換按鈕正常、台股無此按鈕。
3. **健檢**：單檔健檢一檔；「全部健檢」跑完；**製造失敗路徑**——關掉 3001 後端視窗再跑單檔健檢→文案應顯示「後端無回應」類訊息（**不再是**「可能限流中」）→ 重啟後端恢復（一次性驗證，不留改動）。
4. **歷史損益（對數不變量，價格無關項）**：台股＋美股各按「重算回推」跑完後核對——已實現價差 **+21,320**、配息合計 **274,152**、曲線起點 **2024-06-26**、最大同時持有 **20 檔**、快照筆數 ≥502；含息開關切換曲線兩側一致；重算過程進度條有動、結束無 console 紅字。
5. **市場分類修正驗證**：搜尋 `00679B`（元大美債 20 正 2 類）直接分析→應以台股路徑處理（FinMind 中文名正常、無「海外」誤標）。
6. **AI 面**：entry 分析跑一檔（串流正常、內容風格與改前無感差異）；健檢報告格式正常（**SI 位元組未變，理論上與改前逐字同分佈**）。
7. 發現問題先分類：本期改壞（退 Codex）vs 舊 bug（/gsd:capture 記待辦不擋合併）vs 新需求（另立）——比對 `git show main:<檔>` 判定。

---

## <review_checklist>（覆核模型逐條執行，不即興；判定規則：必修退 Codex 附行號，同題最多退 2 輪，第 3 輪升級回報使用者）

**全域機械檢查（親手跑，不採信回報）**
- [ ] `npx.cmd tsc --noEmit` 0 錯誤
- [ ] `npx.cmd vitest run`：既有 11 檔 185 案例零修改全綠＋新增 ≥7 檔測試全綠（總數回報）
- [ ] `npm run build` 成功；Git Bash `grep -r "AIza" dist/` 無結果
- [ ] `git diff main --stat` 逐檔對照 frontmatter files_modified；清單外檔案（.planning/ 除外）diff=0；package.json/package-lock.json diff=0
- [ ] 每任務一 commit（T6 兩個），commit message 對得上任務

**T1**：utils/market.ts 的 regex 與 portfolioFees @36c0f41 原版逐字元相同；portfolioFees.test.ts 零 diff 且綠；App.tsx 無 `/^\d{4}$/`；yahoo.ts :292/:1038/:870 與 stockDirectory :100-102 與 api/_lib 兩檔**零 diff**（禁改清單）；真值表 12 案例在測試中逐條存在。
**T2**：各 store export 簽名前後相同（Select-String 'export' 對照）；6 把 key 字串逐字不變；裁剪策略語意對照（txnStore 無裁剪、importStore 兩段、closeSeriesCache 半數、snapshots 1/4 且 live 不裁）——沿程式碼路徑逐一走讀；「舊格式 fixture 直接可讀」測試存在且 fixture 形狀與 @36c0f41 現況一致；App.tsx 寫入已有防護。
**T3**：yahoo/finmind 全部 throw 已型別化且 **message 字串逐字保留**（diff 逐行比對字面量）；:880 對 DataFetchError 原樣 rethrow；diagnose 的 regex fallback 未刪；Portfolio 兩處文案分流三段且 RATE_LIMIT 句沿用原文。
**T4**：portfolioHistory.ts 與 dividendEstimator.ts **零 diff**；管線重試政策＝首輪 3、重試 2 輪各 1、sleep(45000)（讀碼確認）；快取批次寫仍走 putCachedSeriesMany(entries, fromDate)；merge/save 仍在 UI（:240-242 語意）；workerPool 併發上限測試以計數器斷言而非時序猜測；游標池同構段全 repo 僅剩一處。
**T5**：gemini.ts diff 僅含 `export ` 前綴與字串外註解（逐行檢視）；snapshot 檔已入庫；SI 內容不變量 3 條存在。**把 5 個 SI 的 snapshot 與 @36c0f41 的原文抽查比對 ≥2 段**（親自開 `git show main:services/gemini.ts` 對照）。
**T6a**：Portfolio.tsx return 段零 diff（JSX 未動）；hooks 內 state/effect 與原行號快照逐段對照無邏輯改寫；groupLotsBySymbol 唯一存在於 utils。
**T6b**：TW 11 欄／US 10 欄、手續費欄條件、feeDetails tooltip、幣別切換僅 US——逐項讀碼確認；無「順手修正」；TwGroupTable/UsGroupTable 定義已刪且 grep 無殘留。
**手算複核**：market 真值表親自沿 regex 走一遍；backfillPipeline 測試的期望快照值**獨立重算 ≥2 案例**（不看實作算）。
**UI 實測**（可用 preview 時）：庫存頁渲染、展開、健檢按鈕可按；preview 沙盒連不到使用者本機 vercel dev——需要後端的部分（健檢實跑、回推實跑）誠實標「未實測，交人工驗證」。
</review_checklist>

## 未決點（誠實列出，執行期先驗）
1. vitest 是否收錄 utils/ 之外的測試檔——T5 步驟 1 spike，結論寫回本檔。
2. gemini.ts 於 node 測試環境 import 的副作用——T5 步驟 1 spike（預期安全；不安全則 stub localStorage）。
3. T4 管線的 fetchDaily 回傳形狀（getStockData 的 data 欄位子集）——執行時開檔對齊實際型別，介面欄位名可微調但 ports 注入結構不可變。
4. T6b 兩表對照中若發現現行為 bug（例如某欄位計算兩表不一致）——**記回報不修**，由使用者在 T7 分類。
