---
phase: 10-portfolio-history
branch: gsd/phase-portfolio-history
files_modified:
  - types.ts                                   # additive：PortfolioItem.buyDate?＋RealizedTrade＋DailyPnlSnapshot
  - utils/portfolioFees.ts                     # 新增：費用純函式自 Portfolio.tsx 原樣搬出＋export
  - utils/portfolioFees.test.ts                # 新增
  - utils/portfolioLedger.ts                   # 新增：buildSellResult 賣出引擎（純函式）
  - utils/portfolioLedger.test.ts              # 新增
  - utils/portfolioHistory.ts                  # 新增：快照/回推/圖表序列（純函式）
  - utils/portfolioHistory.test.ts             # 新增
  - utils/portfolioHistoryStore.ts             # 新增：localStorage 薄 IO 層（版本驗證＋quota 守衛）
  - services/yahoo.ts                          # 只准 getLatestPrice 函式體 additive 加回傳 date
  - components/Portfolio.tsx                   # 費用函式改 import、PriceData.date、快照 effect、賣出鈕/buyDate cell、圖表插入
  - components/portfolio/SellModal.tsx         # 新增
  - components/portfolio/RealizedLedger.tsx    # 新增
  - components/portfolio/PnlHistoryChart.tsx   # 新增
  - components/portfolio/PnlHistorySection.tsx # 新增
  - App.tsx                                    # 只准庫存區（:71-117 鄰域）：realizedTrades state＋handlePortfolioSell＋handlePortfolioUpdateMeta
must_haves:
  - GEMINI_API_KEY 不進前端 bundle：npm run build 後 `grep -r "AIza" dist/` 必須無結果
  - services/gemini.ts、services/finmind.ts、api/**：git diff 必須為 0；App.tsx:163-204（進場分析串流區）零接觸
  - 既有表格/StatCards 損益數字行為零變化（T1 純搬移）；npm run test 既有 32 案例全綠
  - 快照公式與 StatCards 同語意：per-lot floor 費稅、totalCost 含買費、股利分開存不混進未實現
  - 新程式禁用 toISOString()；日期一律本地 getter＋padStart 或 formatExchangeDate；日期比較用 'YYYY-MM-DD' 字串比較
  - 禁裝任何 npm 套件（package.json / package-lock.json diff 為 0）
  - 舊 localStorage 資料（無 buyDate、無新 key）載入不炸、既有功能行為不變
---

# Phase 10 PLAN：庫存歷史損益折線圖（快照＋回推＋賣出帳本＋台美雙圖）

決策背景與否決方案見同目錄 `10-CONTEXT.md`（D-01〜D-15）。本檔為執行規格，Codex 照本檔做，規格衝突時停下回報，不要自行仲裁。

## 給冷啟動執行者的前提（Codex 必讀，逐條遵守）

### 拍板決策摘要（詳見 CONTEXT，不得重新發明）
- D-01 hybrid：live 快照＋backfill 回推。D-02 賣出功能＋已實現帳本（股利計入已實現）。D-03 三線可切換（預設總損益＋未實現）。D-04 台美分圖、原幣別（美股 TWD 計價成本/股利除以即時匯率換 USD，為僅有的換匯點）。
- D-05 快照存分解量不存損益結果。D-06 賣出時股利守恆移轉 divCarried。D-07 已實現累計只來自帳本（不存快照）；per-lot floor 對齊 StatCards，symbol 列既有 1 元不一致**不得順手修**。D-08 live 覆蓋一切、backfill 永不覆蓋、重算先清 backfill。D-09 回推手動觸發＋持久化。D-10 美股 TWD 計價 lot 回推用執行當下匯率，記入 usdTwdRate。D-11 回推區間不畫已實現線。D-12 快照＝debounced effect。D-13 快照日期來自 getLatestPrice 擴充回傳的交易所當地日期。D-14 回推用 raw close。D-15 回推區間用 ReferenceArea 底色標示。

### 環境鐵則
1. 路徑含空格（`E:\My Project\...`）——一切指令加引號；PowerShell 用 `npx.cmd`。
2. **禁裝任何 npm 套件**——recharts/lucide-react 都已在依賴。
3. `.env` 不碰；不動任何 api/**、services/gemini.ts。
4. 每任務收尾 `npx.cmd tsc --noEmit` 0 錯誤才 commit；一任務一 commit；T1 起每任務 `npm run test` 全綠。
5. git 大動作前確認無殘留 node 子程序（`tasklist //FI "IMAGENAME eq node.exe"`）。
6. 下列行號為 2026-07-21 快照（Phase 09 合併後之 main @ b9a7ccd）——**動手前開檔確認，對不上就先停下回報，不要猜**。
7. 新寫的日期程式碼 grep 自檢：`toISOString` 在本 phase 新增/修改的行中必須 0 命中（Portfolio.tsx:895 是既有債，不碰不修）。

### 既有程式碼事實（行號快照，動手前開檔確認）
- `types.ts:100-114` `PortfolioItem`：id/symbol/avgCostPrice/totalShares/totalCost(含買費)/brokerDiscount(虛設)/buyFee?/cashDividends/stockDividends/purchaseCurrency?/totalCostUSD?/isUsEtf?。**無日期欄位**。
- `components/Portfolio.tsx`
  - `:25-29` `isTwStock`（.TW/.TWO 後綴或數字代號）
  - `:33-46` `getTwStockType`／`getTaxRate`（個股 0.003、ETF 0.001、債券 ETF 0）
  - `:49-56` `calcTwBuyFee = max(1, floor(base×0.001425))`／`calcTwSellFeeAndTax`（賣費 0.001425、稅依類型；**動手前確認其 floor/max 精確寫法**，測試以搬出後的實際函式為準）
  - `:60-61` `calcUsFee`（ETF 固定 $3、個股 0.008%、無稅）
  - `:64-72` `groupLotsBySymbol`；`:75-76` module-local `fmt`/`fmtUsd`（未 export）
  - `:160-405` `TwGroupTable`（表頭 per-lot 費稅 `:181-186`；symbol 列 pnl `:242-244`；lot 明細列 `:315-317` 一帶）
  - `:407-700` `UsGroupTable`（`toDisplay` `:426`；`itemCostInDisplay` `:429-435` 用當前匯率；美股股利 TWD 計價註記 `:448-449`；pnl `:526-528`）
  - `:706` 主元件起點；`:711` `includeDividend`；`:740-741` AI 用 `form.buyDate`（datetime-local，**不動**）；`:747-762` `fetchPrice`／`fetchExchangeRate`（`USDTWD=X`，fallback 32）；`:764-773` `fetchAllPrices`＋symbol 清單變動 effect；`:846-887` `handleAdd`（totalCost=base+buyFee）；`:1019-1028` 健檢 3-worker 游標池（回推併發照抄此 pattern）；`:1092-1127` 全局 aggregate；`:1164-1182` StatCards；`:1199`／`:1207` 兩張表；`:1216-1469` 新增 Modal
- `App.tsx:71-82` portfolio_items 讀寫鏡射（lazy useState initializer＋useEffect）；`:84-117` CRUD handlers（handlePortfolioAdd/Delete/Update）；**`:163-204` 進場分析串流區（handleOpenAnalysisModal＋handleRunAnalysis，Phase 09 產物）＝禁區，diff 必須為 0**（已對合併後 main 實讀驗證）
- `services/yahoo.ts:48` `formatExchangeDate`；`:286` `fetchRawData`；`:454-471` `getLatestPrice`（fetchRawData '1d','5d' 取最後有效 close，現只回 {price, name}；result 內有 `timestamp[]` 與 `meta.exchangeTimezoneName` 可用）
- `components/fundamentals/MonthlyRevenueChart.tsx`：圖表範本（ui/Card 包裹、ResponsiveContainer h-72、grid `#334155`、軸 `#94a3b8` fontSize 11、自訂 Tooltip bg-slate-900、`isAnimationActive={false}`、紅漲 `#f0405a` 綠跌 `#22c55e`）
- localStorage 既有 keys：`portfolio_items`、`tw_stock_directory_v1`(+`_ts_v1`)；sessionStorage 為行情快取（勿混用）

### 雷區（用 diff 形狀定義，改完 git diff 自檢，出現不允許的形狀即回退）
1. **T1 的 Portfolio.tsx**：只准兩類 diff——「刪除本地函式定義（isTwStock/getTwStockType/getTaxRate/calcTwBuyFee/calcTwSellFeeAndTax/calcUsFee）」與「新增 import 行」。出現任何邏輯改寫行即回退。
2. **services/yahoo.ts**：只准 `getLatestPrice` 函式體內新增取日期邏輯與回傳物件加 `date` 欄位；其他任何函式 diff=0。既有兩個呼叫端不改也能跑（解構容忍新欄位）。
3. **App.tsx**：只准 (a) `:71-117` 鄰域新增 state/handler、(b) 對 `<Portfolio …>` 傳 props 的行、(c) import 行。`:163-204` diff=0。
4. **utils/math.ts、utils/entryFilter.ts、StockChart.tsx**：diff=0（改前先跑 `npm run test` 確認基線 32 案例綠）。

---

## 資料模型與演算法規格（照抄，不自創）

### S1. 型別（types.ts，additive）

```ts
export interface PortfolioItem {
  // ……既有欄位全部不動……
  buyDate?: string;   // 'YYYY-MM-DD'。undefined＝舊資料/未填→回推排除該 lot
}

export interface RealizedTrade {
  id: string;              // `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  lotId: string;           // 來源批次 id（批次刪除後帳仍留存）
  symbol: string;
  market: 'TW' | 'US';
  sellDate: string;        // 'YYYY-MM-DD'，可回填歷史日期
  sharesSold: number;
  sellPrice: number;       // 市場幣別（TW=TWD、US=USD）
  grossProceeds: number;   // sellPrice × sharesSold
  sellFee: number;         // TW: calcTwSellFeeAndTax；US: calcUsFee 後 round2
  sellTax: number;         // TW: 依 getTaxRate；US: 0
  costBasis: number;       // (lot.totalCost × sharesSold) / lot.totalShares（乘先除後）
  realizedPnl: number;     // grossProceeds − sellFee − sellTax − costBasis
  divCarried: number;      // 隨賣出移轉到已實現側的現金股利（等比；市場幣別）
  currency: 'TWD' | 'USD';
  usdTwdRateUsed?: number; // 僅美股 TWD 計價 lot 賣出時記錄
  createdAt: number;
}

export interface DailyPnlSnapshot {
  date: string;            // 該市場交易日（＝最後一根有效 close 的交易所當地日期）
  market: 'TW' | 'US';
  source: 'live' | 'backfill';
  marketValue: number;     // Σ lot(close × shares)；TW=TWD、US=USD
  totalCost: number;       // Σ 持有批次 totalCost（含買費）；US 圖為 USD（TWD 計價 lot 依 D-10 換算）
  estSellCosts: number;    // Σ per-lot 費稅（per-lot floor，對齊 StatCards）
  cashDividends: number;   // 快照時點持有批次現金股利累計（US 已換 USD）
  usdTwdRate?: number;     // 有做任何 TWD→USD 換算時必填
  symbolCount: number;
  capturedAt: number;
}
```

渲染期組合：`未實現 = marketValue − totalCost − estSellCosts (+ includeDividend ? cashDividends : 0)`；`已實現累計(d) = Σ trades[sellDate≤d].realizedPnl + Σ trades[sellDate≤d].divCarried`；`總損益 = 未實現 + 已實現累計`。

### S2. localStorage keys（utils/portfolioHistoryStore.ts）

| key | 內容 | 規則 |
|---|---|---|
| `portfolio_items` | 既有，僅 additive 加 buyDate? | 不 bump 版本 |
| `portfolio_realized_trades_v1` | `{ version: 1, trades: RealizedTrade[] }` | 讀取驗 version：未知版本→原樣保留、回空陣列＋console.warn（不破壞資料） |
| `portfolio_snapshots_v1` | `{ version: 1, rows: DailyPnlSnapshot[] }`（依 market,date 排序） | 同上 |

`setItem` 一律 try/catch：QuotaExceededError → 裁掉最舊的 backfill 列重試一次，再失敗回傳 false 由 UI 提示。容量估算 ~90KB/年，離 5MB 甚遠，但守衛必須在。

### S3. 快照引擎（live）

1. **觸發**：Portfolio.tsx 內單一 effect：`useEffect on [items, prices, usdTwdRate]` → debounce 800ms → `snapshotTick()`。只寫 localStorage，不 setState。
2. **getLatestPrice 擴充**（services/yahoo.ts）：回傳加 `date?: string`＝最後有效 close 同 index 的 `timestamp` 經 `formatExchangeDate(ts, meta.exchangeTimezoneName, '1d')`。timestamps 缺失或對不上 index → `date: undefined`。Portfolio.tsx 的 `PriceData` 加 `date?`，`fetchPrice` 塞入。
3. **每市場獨立執行**（TW、US 各一次，一邊失敗不拖累另一邊）：
   - 守衛 A（完整性）：該市場任一 symbol `loading || error || price<=0 || !date` → 本輪跳過該市場（部分報價的快照是毒資料，寧缺勿錯）。
   - 守衛 B（美股匯率）：US 存在 TWD 計價 lot 或任一 US lot cashDividends>0，而 `usdTwdRate<=0` → 跳過 US。**fallback 32 只准表格顯示用，禁止寫入持久化快照**。
   - `snapshotDate = max(該市場各 symbol 的 price.date)`；個別 symbol 日期較舊（停牌）沿用其最新價。
   - 依 S1 公式聚合（per-lot floor），呼叫 upsert。
4. **upsert 規則（僅兩條，各有測試）**：key=(market,date)。live 覆蓋一切同鍵舊列；backfill 永不覆蓋既有列。

### S4. 賣出引擎（utils/portfolioLedger.ts，純函式）

`buildSellResult(lot, { sharesSold, sellPrice, sellDate }, usdTwdRate?) → { trade: RealizedTrade, updatedLot: PortfolioItem | null }`

```
等比量一律乘先除後：x_sold = (x × sharesSold) / totalShares
costBasis  = (totalCost × sharesSold) / totalShares
             // US TWD 計價 lot：先算 TWD costBasis，再 /usdTwdRate 得 USD，rate 記入 trade.usdTwdRateUsed
divCarried = (cashDividends × sharesSold) / totalShares   // US：TWD 計價股利同樣 /rate 換 USD
feeCarried = ((buyFee ?? 0) × sharesSold) / totalShares   // 僅縮減 lot 紀錄，不進損益
剩餘 lot：totalShares/totalCost/cashDividends/buyFee 各自扣減；avgCostPrice 不變（數學必然，測試鎖定）
sharesSold === totalShares → updatedLot = null（呼叫端刪除 item）
費稅：TW 用 calcTwSellFeeAndTax(gross, symbol)；US 用 calcUsFee(gross, isUsEtf) 後 round2
realizedPnl = grossProceeds − sellFee − sellTax − costBasis（US 各金額元件先 round2 再相減；USD 入帳一律 round2）
驗證：0 < sharesSold ≤ totalShares；sellPrice > 0；sellDate 合法且 ≤ 今天（本地日期字串比較）
stockDividends 不移轉、留在原 lot（不入損益，純資訊）
```

### S5. 回推演算法（utils/portfolioHistory.ts，純函式＋PnlHistorySection 編排）

1. **參與者**：該市場有 `buyDate` 的 lots。無 buyDate 的 lot 排除（不是排除整個 symbol），回傳 `excludedLots` 給 UI 顯示提示。
2. **資料**：每 symbol `getStockData(symbol,'1d')`（3-worker 游標池照抄 :1019-1028 pattern；執行中顯示 m/N 進度）。用 raw `close`（D-14）。
3. **日期軸**：參與 symbols 的 close 日期序列**聯集**、升冪，裁剪到 `[min(參與 lots 的 buyDate), 邊界日)`；邊界日＝該市場第一筆 live 快照日（無 live 快照則填到最新可得 close）。
4. **as-of 逆推**（用帳本還原賣出前組成）：對每個 lot 在日 d：
   `shares(d) = lot.totalShares + Σ trades{lotId, sellDate>d}.sharesSold`；`cost(d)`、`cashDiv(d)` 同式用 costBasis、divCarried。全賣 lot 不參與（D-12 已知限制）。
5. **active 判定**：lot 於日 d active ⇔ `buyDate ≤ d` 且該 symbol 存在任何 `close 日期 ≤ d`（上市前不 carry-backward）。active 但當日無 close → 用最後一筆 ≤ d 的 close carry-forward。
6. **逐日聚合**：同 S1 快照公式（per-lot floor 費稅按當日市值算）；產出 `source:'backfill'` 列。
7. **寫入**：重算語意＝刪該市場全部 backfill 列 → 重生成 → 只寫入無同鍵 live 列的日期。
8. **US 幣別**：TWD 計價 lot 成本整段用執行當下 `usdTwdRate` 換算（D-10）；rate 不可得時 UI 禁止啟動回推並提示先更新報價。

### S6. 圖表（components/portfolio/）

- `PnlHistoryChart.tsx`（單張圖，不知市場概念）props：
  `{ title, currency: 'TWD'|'USD', points: { date, unrealized, unrealizedWithDiv, realizedCum, total, source }[], backfillEndDate?, includeDividend }`
- `PnlHistorySection.tsx` 編排：兩張圖（台股 TWD／美股 USD，各自「該市場有 lots 或有快照」才渲染）、「建立歷史曲線／重算回推」按鈕與進度、excludedLots 提示、空狀態階梯（無資料→引導文案；有持股全無 buyDate→提示補填；有 buyDate 無 backfill→主按鈕）。
- 視覺：範本照 MonthlyRevenueChart（Card/h-72/#334155 grid/#94a3b8 軸/自訂 Tooltip/isAnimationActive=false）。三條 `Line` 用系列色：總損益 `#38bdf8`、未實現 `#fbbf24`、已實現 `#a78bfa`；`ReferenceLine y={0} stroke="#64748b"`；漲跌紅綠留給 tooltip 數值。回推區間 `ReferenceArea fill="#334155" fillOpacity={0.25}`＋label「回推區間」，x1/x2 必須取自實際資料點的 date 值（category 軸上任意字串會靜默不畫）。
- 互動：三線 checkbox 膠囊列（自製，不用 recharts Legend onClick），預設勾總損益＋未實現；帳本空時已實現項 disabled＋tooltip。範圍膠囊 `1M/3M/6M/1Y/全部`（日期字串比較 slice），預設 3M。Tooltip 千分位（TWD 整數／USD 兩位）、backfill 點附「（回推）」灰字。
- 插入點：Portfolio.tsx StatCards（:1164-1182）之後、TwGroupTable（:1199）之前，同層 space-y-6。

### S7. 賣出與帳本 UI

- 入口：兩張 GroupTable 的**展開明細列**（lot 級）操作欄，刪除鈕旁加賣出鈕（lucide `Banknote`）。symbol 彙總列不加。
- `SellModal.tsx`（ui/Modal，max-w-md）：唯讀 symbol/名稱/持有股數/成本均價；輸入賣出股數（預設全部＋「全部」快捷）、賣出單價、賣出日期（`type="date"` 預設今日＝本地 getter 組字串）；即時預覽：賣出總額/手續費/證交稅(台股)/淨收入/成本基礎/**已實現損益**（紅綠＋%）。US TWD 計價 lot 且 rate 不可得 → 確認鈕 disabled＋提示。
- App.tsx 新增（庫存區）：`realizedTrades` state（比照 portfolio_items 的 initializer＋useEffect 鏡射到 `portfolio_realized_trades_v1`）、`handlePortfolioSell(lotId, input)`（utils 純函式算→append trade→更新或移除 lot）、`handlePortfolioUpdateMeta(id, { buyDate })`（既有 onUpdate 是 number-only 簽名，**不動舊簽名**、新開 handler）。
- buyDate 輸入：(a) 新增 Modal 主表單加「買進日期」`type="date"` 選填欄（AI 用 datetime-local 欄不動）；(b) 兩表明細列加小型 date input（新 `EditableDateCell`，比照 EditableCell 樣式）→ onUpdateMeta，讓存量 lot 補填。
- `RealizedLedger.tsx`：兩張表之後可折疊「已實現損益帳本」Card：日期/代號/股數/賣價/費/稅/成本基礎/已實現損益/股利移轉/操作；表頭 TW（TWD）與 US（USD）累計小計；刪除沿用兩段確認模式，文案明示「**僅刪除帳面紀錄，不會回復持股**」。

---

## 手算對數案例（金額鐵證——寫進 vitest，覆核者獨立重算，數字對不上就是 bug）

**Case 1｜台股個股全賣（2330，稅 0.003）**
買 1000 股 @600：base=600,000；buyFee=max(1,⌊855⌋)=**855**；totalCost=**600,855**。
賣 1000 股 @650：gross=650,000；sellFee=⌊926.25⌋=**926**；tax=⌊1,950⌋=**1,950**；
**realizedPnl = 650,000−926−1,950−600,855 = 46,269**。

**Case 1b｜同 lot 部分賣 400 股 @650（縮減語意）**
gross=260,000；sellFee=⌊370.5⌋=**370**；tax=⌊780⌋=**780**；costBasis=(600,855×400)/1000=**240,342**；**realizedPnl=18,508**。
剩餘 lot：600 股；totalCost=**360,513**；avgCostPrice=**600.855（不變，斷言）**；buyFee=855−342=**513**；原 cashDividends=5,000 → divCarried=**2,000**、lot 剩 **3,000**。

**Case 2｜台股 ETF 全賣（0050，稅 0.001）**
買 2000 股 @190：buyFee=⌊541.5⌋=**541**；totalCost=**380,541**。
賣 2000 股 @210：gross=420,000；sellFee=⌊598.5⌋=**598**；tax=⌊420⌋=**420**；**realizedPnl=38,441**。

**Case 3｜美股個股全賣（NVDA，0.008%）**
買 10 股 @180：fee=round2(0.144)=**0.14**；totalCostUSD=**1,800.14**。
賣 10 股 @200：gross=2,000；sellFee=round2(0.16)=**0.16**；tax=0；**realizedPnl=199.70 USD**（`toBeCloseTo(199.70, 2)`）。
**Case 3b｜美股 ETF**：SPY 5 股成本 2,903（含 $3 費），賣 @600：3,000−3−2,903=**94.00 USD**。

**Case 4｜混合兩批某日未實現快照（2330 兩批，close 643）**
Lot A：1000 股 totalCost 600,855、cashDividends 5,000；Lot B：500 股 @620 → buyFee=⌊441.75⌋=**441**、totalCost=**310,441**。
per-lot 費稅：A 市值 643,000 → fee ⌊916.275⌋=**916**、tax=**1,929**；B 市值 321,500 → fee ⌊458.1375⌋=**458**、tax ⌊964.5⌋=**964**。
快照列：marketValue=**964,500**；totalCost=**911,296**；estSellCosts=**4,267**；cashDividends=**5,000**。
**未實現（不含息）= 48,937；含息 = 53,937**。

**Case 5｜per-lot vs per-symbol 1 元差（釘死粒度）**
同 symbol 兩批各市值 100,000：per-lot ⌊142.5⌋×2=**284**；合併一次 floor=**285**。快照斷言採 **284**（per-lot，對齊 StatCards :1111-1121）。symbol 列的 285 是既有不一致，**覆核時不得順手修**。

---

## 任務序列（T1→T7 依序，一任務一 commit）

### T1｜費用純函式抽出＋行為鎖測試
搬 `isTwStock/getTwStockType/getTaxRate/calcTwBuyFee/calcTwSellFeeAndTax/calcUsFee` → `utils/portfolioFees.ts`（**原樣搬出＋export，一個字元的邏輯都不改**），Portfolio.tsx 刪本地定義改 import。新 `utils/portfolioFees.test.ts`：Case 1/2/3 費稅子步驟＋max(1,·) 邊界（base 極小）＋債券 ETF（00xxB）稅 0＋ETF/個股判型。
動：utils/portfolioFees.ts(新)、utils/portfolioFees.test.ts(新)、components/Portfolio.tsx。
驗證：tsc、`npm run test`（32 舊案例＋新案例全綠）、git diff 自檢雷區 1。

### T2｜型別＋賣出引擎純邏輯
types.ts 加三型別（S1 照抄）；utils/portfolioLedger.ts `buildSellResult`＋驗證＋round2。測試：Case 1/1b/2/3/3b 全數＋全賣回 null＋avgCostPrice 不變＋divCarried 守恆（賣出側+持有側=原值）＋US TWD 計價換匯路徑（rate 記錄）＋非法輸入（超量/負數/未來日期）拋錯。
動：types.ts、utils/portfolioLedger.ts(新)、utils/portfolioLedger.test.ts(新)。驗證：tsc、test。

### T3｜快照與回推純邏輯
utils/portfolioHistory.ts：`computeLiveSnapshot`（S3 聚合＋守衛判定函式化）、`upsertSnapshots`（S3.4 兩規則）、`reconstructLotAsOf`（S5.4）、`buildBackfillRows`（S5 全流程，輸入為已抓好的 close 序列 Map——純函式不碰網路）、`buildChartSeries`（S1 渲染組合＋tradesCum/divCarriedCum 階梯＋含息開關）。
測試：Case 4、Case 5、upsert 兩規則×live/backfill 交錯情境、`reconstructLotAsOf` 還原 Case 1b 賣出前組成（1000 股/600,855/5,000）、carry-forward、上市前不 active、含息切換、D-11（無帳本時 realizedCum 全 0）。
動：utils/portfolioHistory.ts(新)、utils/portfolioHistory.test.ts(新)。驗證：tsc、test。

### T4｜儲存層＋getLatestPrice 擴充＋接線
utils/portfolioHistoryStore.ts（S2）；services/yahoo.ts getLatestPrice 加 date（雷區 2 形狀）；Portfolio.tsx：PriceData 加 date?、fetchPrice 塞入、S3.1 debounced effect（含守衛 A/B）；App.tsx：realizedTrades state＋鏡射、handlePortfolioSell、handlePortfolioUpdateMeta、props 下傳（雷區 3 形狀）。
動：utils/portfolioHistoryStore.ts(新)、services/yahoo.ts、components/Portfolio.tsx、App.tsx。
驗證：tsc、test、`npm run build`；**spike 驗證（D-13 假設）**：起 dev 後 console 檢查 2330.TW 與 AAPL 的 `price.date` 是否等於各自市場最近交易日（此假設若破，守衛 A 會跳過快照——不會寫毒資料，但要回報修正取日期邏輯）；DevTools 確認 `portfolio_snapshots_v1` 出現當日 TW/US 兩列且數字對 StatCards。

### T5｜賣出 Modal＋帳本 UI＋buyDate 輸入
S7 全部：SellModal.tsx(新)、RealizedLedger.tsx(新)、兩表明細列賣出鈕＋EditableDateCell、新增 Modal 買進日期欄。
動：components/portfolio/SellModal.tsx(新)、components/portfolio/RealizedLedger.tsx(新)、components/Portfolio.tsx。
驗證：tsc、build；手動照 Case 1 輸入一次，Modal 預覽與帳本入帳數字＝46,269。

### T6｜圖表
S6 全部：PnlHistoryChart.tsx(新)、PnlHistorySection.tsx(新)（含回推按鈕＋3-worker 池＋進度＋excludedLots 提示＋空狀態階梯），插入 Portfolio.tsx :1182 後。
動：兩新元件、components/Portfolio.tsx。
驗證：tsc、build、test 全綠、`grep -r "AIza" dist/` 空。

### T7｜checkpoint:human-verify（做到這裡停下回報，等使用者驗證）
使用者操作步驟（照按）：
1. `/start-dev` 起環境 → 開「我的庫存」。
2. 新增 2330 一批：1000 股、成本均價 600（avg 模式）→ 表格 totalCost 顯示 **600,855**。
3. 在明細列補填買進日期＝三個月前任一交易日 → 圖表區出現「建立歷史曲線」→ 按下 → 台股圖出現帶底色的回推曲線，尾點與 StatCard 總損益一致（含息開關兩態都對）。
4. 賣出 400 股 @650 → Modal 預覽已實現損益 **18,508** → 確認 → 表格剩 600 股/成本 **360,513**、帳本一筆 18,508、圖表總損益線當日連續無跳水、已實現線從當日起出現。
5. 帳本刪除該筆 → 出現「僅刪帳不回復持股」警語 → 確認後持股仍 600 股、已實現線消失。
6. 美股加 NVDA 10 股 @180（USD）→ 賣 10 股 @200 → 帳本 **199.70 USD**（美股圖為 USD 軸）。
7. 關掉 dev server 網路（或斷網）重整 → 圖表仍由 localStorage 渲染（回推＋live 快照都在）。
8. DevTools Application 檢查 `portfolio_realized_trades_v1`／`portfolio_snapshots_v1` JSON 形狀含 version 欄。
失敗路徑製造（一次性臨時改壞法，驗完改回、不 commit）：把守衛 A 的 `!date` 判斷暫時反轉 → 確認該市場快照被跳過且 console 有跡可循 → 改回。

---

<review_checklist>
覆核模型逐條執行，每條 PASS/FAIL＋證據（指令輸出或檔案:行號）。必修項退 Codex 附行號；同一問題最多退 2 輪，第 3 輪升級回報使用者。

1. 範圍紀律：`git diff main --stat` 檔案清單 ⊆ frontmatter files_modified；`git diff main -- App.tsx` 變更行不落在 163-204；`git diff main -- services/gemini.ts services/finmind.ts api/ package.json package-lock.json` 為空。
2. 雷區形狀：T1 的 Portfolio.tsx diff 只有刪函式＋import；services/yahoo.ts diff 只在 getLatestPrice 函式體。
3. 手算案例獨立重算：不看實作，沿 utils 純函式碼徒手重算 Case 1/1b/2/3/3b/4/5，與測試斷言逐一對照（floor/max(1,·)/乘先除後/round2 順序重點檢查）。
4. 快照↔StatCards 一致性：computeLiveSnapshot 組合結果 vs Portfolio.tsx 全局 aggregate（:1096-1127 現後行號）逐項對照：per-lot floor、totalCost 含買費、含息語意、美股換匯路徑；確認**沒有**順手統一 symbol 列的既有 1 元差。
5. 日期紀律：`git diff main | grep toISOString` 新增行 0 命中；新程式日期組字串用本地 getter＋padStart 或 formatExchangeDate；日期比較皆為字串比較。
6. upsert/守衛測試存在且有效：live 覆蓋、backfill 不覆蓋、重算先清 backfill；守衛 A/B 各有測試或程式碼走讀證據。
7. 機械檢查親手跑：`npx tsc --noEmit`＝0 錯、`npm run test` 全綠（含既有 32 案例）、`npm run build` 成功、`grep -r "AIza" dist/` 空。
8. 相容性：手動清 localStorage 新 keys＋保留舊 portfolio_items（無 buyDate）→ App 載入不炸、表格數字與 main 版本一致。
9. UI 語意抽查：帳本刪除警語存在且不動持股；SellModal 驗證擋超量/負值/未來日；全賣移除 lot；US TWD 計價 lot 在 rate 缺失時禁用確認。
10. 誠實揭露核對：CONTEXT「已知限制」1-5 在 UI 文案/tooltip 有對應呈現（至少：排除 lot 提示、回推區間標示）。
</review_checklist>

---

## 未決點與已知限制（設計期誠實聲明）

1. **【spike，T4 內驗證】D-13 假設**：getLatestPrice 的最後有效 close index 與 timestamp[] 對位。若破，守衛 A 保證不寫毒資料（快照跳過），但需回報並改取日期方式。
2. 全賣 lot 不參與回推重算（D-12）；v2 選項＝全賣時在 trade 內留 lot 快照。
3. 盤中快照非收盤價；live 世代缺日不回填（稀疏連線）。
4. 回推曲線＝「今日帳務結構套當日價格」；台股 split 極罕見但 FinMind fallback 為原始價（D-14 記載）。
5. （已解除，2026-07-21）Phase 09 已合併 main（b9a7ccd），本分支重指合併後 main；App.tsx 禁區 :163-204 與庫存區 :71-117 均已對合併後程式碼實讀驗證，Phase 09 未動 Portfolio.tsx／services/yahoo.ts／types.ts。
