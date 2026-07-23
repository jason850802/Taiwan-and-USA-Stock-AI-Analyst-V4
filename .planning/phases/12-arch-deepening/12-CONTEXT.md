# Phase 12 CONTEXT — 架構深化（六張健檢卡）

> 2026-07-23 立案。緣起：improve-codebase-architecture 架構健檢（報告存 OS temp，
> 結論已謄入本檔）找出 6 個深化機會，使用者拍板**六張全做**、順序照建議。
> 基準：main@36c0f41。偵查依據：兩輪 Explore subagent 報告（候選盤點＋計畫級行號快照）。

## 目標

把 Phase 10/11 用「元件生命週期」管理的風險移回「module interface」後面：
可測、集中、單一權威。**全程行為保持——除了兩處明文列出的刻意修正（D-02、D-04）。**

## 任務順序與理由（D-01）

**T1 市場分類 → T2 持久層 → T3 錯誤分類 → T4 回推管線＋worker-pool → T5 規則書鎖定 → T6 Portfolio 拆解**

原健檢建議 2→3→1；本序保持「管線先於拆解」核心意圖，把便宜的地基（分類、持久殼、
錯誤型別）墊在管線前面——管線（T4）直接消費 T3 的錯誤 kind；拆解（T6）最大最險，
放最後、緊鄰人工驗證。T5 獨立，卡在 T6 前是為了先把 gemini.ts 鎖上再動最大的元件檔。

## 分卡決策

### D-02 市場分類（健檢卡 4）
- 新 `utils/market.ts` 為唯一權威：`isTwStock`（沿用 portfolioFees 現版語意：後綴或
  `/^\d{3,6}[A-Z]?$/`）＋ `marketOf(symbol): 'TW'|'US'`。
- `utils/portfolioFees.ts` 改 re-export `isTwStock`——既有 16 個呼叫端**一行不動**。
- 換掉的呼叫端：quoteCache.marketForSymbol（改委派）、gemini.ts:535 與 :638、
  App.tsx:284-286 與 :289-291、yahoo.ts 分類語意的 6 處（:361,:476,:808,:829,:841,:863）。
- **行為修正（刻意，唯一一處）**：App.tsx:286 無 info 分支原用 `/^\d{4}$/`，
  `00679B`／`00631L` 這類 3/5/6 碼＋字母代碼會被誤判美股；統一後改判台股。
- **禁改清單**（語意不同，碰了就是 bug）：yahoo.ts:292（代碼「抽取」非分類，非錨定屬刻意）、
  yahoo.ts:1038（canonical key）、yahoo.ts:870（FinMind fallback 硬編 true）、
  stockDirectory.ts:100-102（台股名錄內個股/ETF 子分類）、api/_lib/finmind.ts:47 與
  api/_lib/yahoo.ts:35（後端白名單，一個要求裸碼、一個要求後綴，屬驗證規格非分類；後端不在本期）。

### D-03 持久層（健檢卡 3）
- 新 `utils/persistentStore.ts` 工廠只管「殼」：讀（try/catch＋JSON parse＋decode 驗形＋fallback）、
  寫（try/catch＋quota 時呼叫注入的 `trimForRetry` 裁一次再試＋console.warn）。
  **域內裁剪策略仍由各 store 注入**（snapshots 裁 backfill 最舊 1/4、importStore 兩段裁……語意不變）。
- **儲存格式位元組相容**：`portfolio_items` 維持裸陣列、各 `{version:1,...}` 信封維持原樣。
  工廠不引入新信封——舊資料必須直接可讀，不做遷移。
- 收編 6 把 key：`portfolio_items`（App.tsx——現況唯一裸寫無 try/catch 的，本卡最大價值）、
  txnStore、importStore、closeSeriesCache、portfolioHistoryStore×2。
- **不收編**（各有特殊語意，硬套工廠是搬家不是集中）：geminiCache（prefix 掃描＋跨日清理）、
  quoteCache（sessionStorage 雙層）、finmind sessionCache、stockDirectory（雙 key TTL＋中毒防護已完備）。

### D-04 錯誤分類（健檢卡 5）
- 新 `services/fetchError.ts`：`class DataFetchError extends Error { kind }`，
  kind ∈ `RATE_LIMIT | BACKEND_DOWN | NOT_FOUND | PARSE | NETWORK | UNKNOWN`＋
  `classifyCaught(e)` helper。**message 原文全數保留**（既有字串比對降級可用）。
- yahoo.ts 7 個 throw 點、finmind.ts 2 個 throw 點改丟 DataFetchError；
  yahoo.ts:880 外層包裝改「DataFetchError 原樣重丟」保 kind 穿透。
- 消費端：PnlHistorySection.diagnose() 改「先認 kind、認不得才退回現有 regex」；
  Portfolio.tsx:1014/:1081 罐頭文案改依 kind 分流（RATE_LIMIT→限流文案、
  BACKEND_DOWN→後端無回應文案、其他→通用）。**行為修正（刻意）**：健檢失敗文案從
  「無條件猜限流」變成「說實話」。
- 後端 api/_lib 已有三份同構 ClassifiedError（http/finmind/yahoo 各一）——既有現象，
  本期不動，記入待辦。

### D-05 回推管線＋worker-pool（健檢卡 2，本期首選）
- 新 `utils/workerPool.ts`：`runWithConcurrency(items, workers, task, hooks)` 一份，
  取代三份手刻游標池（PnlHistorySection:69-80、:147-168、Portfolio:1057-1064）；
  進度回報與錯誤策略由 hooks 保留各呼叫端現行語意。
- 新 `utils/backfillPipeline.ts`：把 runBackfill(102-245) 的編排（快取讀→併發抓→
  分類診斷→退避重試（首輪 3 workers、續輪 1 worker、間隔 45s）→批次寫快取→
  FIFO/現存持股模式選擇）收進一個 interface。**seam＝注入的 ports**：
  `fetchDaily`（prod 走 getStockData、測試走 in-memory fake）、`closeCache`（prod 走
  closeSeriesCache、測試走記憶體 stub）、`sleep`（測試瞬時）。兩個 adapter，seam 為真。
- UI 職責縮到：載入 txns/守衛匯率/呼叫管線/映射進度 state/合併存檔。市場篩選與
  匯率守衛留 UI（表現層閘門）。配息 runner 只換 pool 不改邏輯。

### D-06 規則書（健檢卡 6，**依偵查重新定義**）
- 偵查推翻「同一規則書寫兩份」：TRADE_DECISION「禁止做多進場條件」(:421-432) 與
  HEALTH_CHECK「加碼大忌」(:850-860) 是**進場 vs 加碼兩種語境的刻意變體**
  （例：「未突破月線」vs「未突破前高」），硬併措辭＝改壞領域規則；
  且任何 SI 位元組變動會作廢 A3 分析快取與 implicit caching（C-3 成果）。
- 本期改為「**鎖住防漂移**」：5 個 SI 常數（ENTRY_FULL/ENTRY_FAST/TRADE_DECISION/
  HEALTH_CHECK/FUNDAMENTALS）加 `export`＋vitest snapshot 鎖位元組；
  formatHealthCheckData 以固定 fixture 鎖輸出；兩套戒律區塊加交叉引用註解
  （「改這裡想想 :850 那份要不要跟」）。**位元組零變更是驗收條件而非期望。**
- 順帶：gemini.ts 兩處 isTW 判斷併入 T1 收斂。

### D-07 Portfolio 拆解（健檢卡 1）
- 兩段兩 commit，可獨立回滾：
  - **T6a 抽 hooks（JSX 零變動）**：usePortfolioForm（form/feeInput/feeTouched/showAddModal＋
    費用試算 effect :814-839）、useHealthCheck（healthResults/healthModalSymbol/batchChecking/
    healthSeqRef＋buildHealthItem＋單檔/批次 handlers）、useHoldingPrices（prices＋:785 effect）、
    useDailySnapshot（:793-807 debounce 快照）；`groupLotsBySymbol` 移 `utils/portfolioGrouping.ts`＋測試。
  - **T6b 併表**：`HoldingsTable` 吃市場設定物件（顯示手續費欄與否、幣別策略、費算函式）——
    TW/US 是同一 interface 的兩個 adapter；刪 TwGroupTable/UsGroupTable。
- 已知真實差異必須保留：TW 表 11 欄含獨立手續費欄、US 表 10 欄費用僅進 tooltip；
  TW 用 calcTwSellFeeAndTax、US 用 calcUsFee＋toDisplay；USD fallback 32 收斂為
  `utils/fx.ts` 單一常數（現況 :415 與 :812 各寫一份）。

### D-08 驗證策略
- 機械：既有 **185** 案例（11 檔）恆綠、新增套件全綠、tsc 0 錯、build 過、
  `grep -r "AIza" dist/` 0、package.json/lock diff 0（禁新依賴）。
- 人工（真實資料不變量，價格無關項）：回推重跑後 已實現價差 **+21,320**、
  配息合計 **274,152**、曲線起點 **2024-06-26**、最大同時持有 **20 檔**。

## 範圍外（明文守住）
- 量能顯示「單日比 vs 5 日均量」不一致（gemini.ts 資料組裝 vs SI 文字）——行為修正，
  影響 AI 輸出，另立待辦由使用者拍板。
- 後端 api/_lib 三份 ClassifiedError 收斂——另立待辦。
- 任何 UI 視覺改版、任何供應商更換、任何效能專案。

## 風險與未決點（spike-first 落在 PLAN 對應任務第一步）
1. services/ 下的 `.test.ts` 是否被現行 vitest 設定收錄（現況測試全在 utils/）——T5 第一步先驗。
2. gemini.ts 在 node 測試環境 import 是否有副作用（geminiCache 模組層只有常數，預期安全）——T5 第一步先驗。
3. T6b 無元件測試護網——靠 T6a/T6b 分 commit、grep 斷言、人工驗證清單三重補償。
4. App.tsx:286 行為修正的可見影響面（無 info 時的台股判定）——人工驗證含 00679B 案例。
