---
phase: 11-statement-import
branch: gsd/phase-statement-import
files_modified:
  - package.json / package-lock.json          # 唯一允許的新依賴：xlsx 解析（懶載）
  - types.ts                                  # additive：ParsedTxn／ImportPlan／ImportGap／ImportLog
  - utils/statementParsers/sinopac.ts         # 新增：永豐金 xlsx → ParsedTxn[]
  - utils/statementParsers/cathay.ts          # 新增：國泰 Big5 CSV → ParsedTxn[]
  - utils/statementParsers/index.ts           # 新增：格式偵測＋分派＋錯誤型別
  - utils/statementParsers/*.test.ts          # 新增：合成 fixture（禁放真實帳單）
  - utils/importReplay.ts                     # 新增：FIFO 重播引擎（純函式）
  - utils/importReplay.test.ts                # 新增：Case A~H 手算鎖
  - utils/importStore.ts                      # 新增：已匯入鍵 localStorage 薄 IO
  - components/portfolio/ImportStatementModal.tsx  # 新增：上傳→預覽→補缺口→確認
  - components/Portfolio.tsx                  # 只准：新增「匯入對帳單」按鈕＋掛 Modal
  - App.tsx                                   # 只准庫存區：handleStatementImport（批次套用）
must_haves:
  - GEMINI_API_KEY 不進前端 bundle：npm run build 後 `grep -r "AIza" dist/` 必須無結果
  - 新依賴只准一個（xlsx 解析）且必須動態 import 懶載：build 後首屏 chunk 不得包含它
  - services/**、api/**、utils/math.ts、utils/entryFilter.ts、utils/portfolio{Fees,Ledger,History,HistoryStore}.ts：git diff 必須為 0
  - Phase 10 既有行為零變化：npm run test 既有 80 案例全綠；手動賣出/快照/回推路徑不得改動
  - 匯入一律使用對帳單實際費用與稅，不得呼叫 calcTwBuyFee/calcTwSellFeeAndTax/calcUsFee 重算
  - 去重有效：同一份對帳單連續匯入兩次，第二次新增 0 筆（台股 64 筆全數略過）
  - 真實對帳單（含個人財務資料）絕不進 repo：測試 fixture 一律合成資料
---

# Phase 11 PLAN：券商對帳單匯入（永豐金台股 xlsx＋國泰複委託美股 CSV）

決策背景、兩份帳單的實測欄位結構與否決方案見同目錄 `11-CONTEXT.md`（D-01〜D-13）。

## 給冷啟動執行者的前提（必讀，逐條遵守）

### 拍板決策摘要
D-01 加 xlsx 套件並懶載｜D-02 期初缺口列出讓使用者補成本（不猜數字）｜D-03 歷史交易全部匯入餵滿已實現帳本｜D-04 配息計入 cashDividends｜D-05 統一中間格式 ParsedTxn｜D-06 費用取帳單實數不重算｜D-07 成本含買費｜D-08 FIFO 且 lot 池含既有庫存｜D-09 跨 lot 賣出拆多筆 trade、費稅等比分攤末筆吃餘數｜D-10 美股一律 USD 計價｜D-11 台股用委託單號、美股用複合鍵去重｜D-12 增量併入非取代｜D-13 缺口 lot 買進日預設賣出日前一交易日。

### 環境鐵則
1. 路徑含空格（`E:\My Project\...`）——指令加引號；PowerShell 用 `npx.cmd`。
2. **本期唯一允許的新依賴＝xlsx 解析套件**，且必須 `await import()` 動態載入。其餘一律禁裝。
3. 每任務收尾 `npx.cmd tsc --noEmit` 0 錯誤＋`npm run test` 全綠才 commit；一任務一 commit。
4. git 大動作前確認無殘留 node 程序（`tasklist //FI "IMAGENAME eq node.exe"`）。
5. **隱私鐵則**：使用者真實對帳單在 `C:\Users\jason\OneDrive\Desktop\{永豐金對帳單.xlsx,國泰複委託對帳單.csv}`，僅供 spike 與人工驗證讀取，**絕不複製進 repo、絕不寫進測試 fixture、絕不貼進 commit message**。測試一律用結構相同、數字取自本檔手算案例的合成資料。
6. 下列事實為 2026-07-21 實測（python openpyxl／cp950 解碼）——動手前用 spike 重新確認，對不上就停下回報。

### 對帳單格式事實（實測，非推測）
**永豐金 xlsx**：Sheet 1，67×18。row 0 摘要／row 1 標題／**row 2~65 資料（64 筆）**／**row 66「合計」需跳過**。
欄序：`0 成交日 | 1 商品 | 2 交易別 | 3 數量 | 4 成交價 | 5 價金 | 6 手續費 | 7 交易稅 | 8 應付金額 | 9 應收金額 | 10 融資金額 | 11 保證金 | 12 利息 | 13 融券手續費 | 14 委託單號 | 15 幣別`
商品欄格式 `代號 空格 名稱`，名稱可含 `*`／`-KY`；代號可含字母（`00631L`、`00988A`）。交易別實測只有 `現買`／`現賣`。

**國泰 CSV**：**Big5(CP950) 編碼**，多區塊。必須掃描找到以 `交易日期` 開頭的標題列（實測 index 4），其後才是資料；遇到空行或非 `YYYY/MM/DD` 開頭即結束該區塊。
欄序：`0 交易日期 | 1 商品代號 | 2 商品名稱 | 3 交易市場 | 4 交易種類 | 5 交易幣別 | 6 交割幣別 | 7 股數 | 8 價格 | 9 匯率 | 10 成交金額 | 11 手續費 | 12 其他費用 | 13 應收/付(-)金額`
交易種類值域 `買進`／`賣出`／`除息`。**每欄前有 tab 或空白需 trim**。匯率可為 `--`（不影響 USD 計價）。股數可為小數。

### 既有程式碼事實（Phase 10 產物，行號為合併後 main）
- `types.ts` `PortfolioItem`（含 `buyDate?`）／`RealizedTrade`（含 `lotId`／`divCarried`／`currency`）／`DailyPnlSnapshot`。
- `utils/portfolioLedger.ts` `buildSellResult(lot, input, rate)` 是**單 lot** 賣出，且**用 App 公式算費稅**——本期跨 lot＋帳單實數的需求與它不同，**新寫 `utils/importReplay.ts`，不要改它**（Phase 10 手動賣出路徑必須零變化）。
- `utils/portfolioFees.ts` `isTwStock`／`getTwStockType` 可重用於市場判定與 ETF 判定；`calcUsFee` 的 0.008% 已知偏低（CONTEXT），**本期不呼叫、不修**。
- `App.tsx` 庫存區：`portfolioItems` state（:71-82 鏡射）、`realizedTrades` state＋`saveRealizedTrades`、`handlePortfolioSell`／`handlePortfolioUpdateMeta`／`handleRealizedTradeDelete`。**進場分析串流區（handleOpenAnalysisModal/handleRunAnalysis）為禁區，diff 必須為 0**。
- `components/Portfolio.tsx` header 按鈕列（含息 toggle／更新報價／全部健檢／新增持股／新增持股與分析）＝「匯入對帳單」按鈕的插入點。

### 雷區（用 diff 形狀定義，改完自檢）
1. **utils/portfolio{Fees,Ledger,History,HistoryStore}.ts**：diff 必須為 0（Phase 10 行為鎖）。
2. **components/Portfolio.tsx**：只准三類 diff——新增 import、header 新增一顆按鈕、底部掛 `<ImportStatementModal>`。出現既有表格/快照/圖表邏輯改動即回退。
3. **App.tsx**：只准庫存區新增 `handleStatementImport` 與傳 props；串流區 diff＝0。
4. **package.json**：只准新增一個 dependency。出現第二個即停下回報。

---

## T1 spike 結果（2026-07-21 實跑，計畫要求先驗後做）

**套件定案：`read-excel-file@9.3.4`**（已安裝，`package.json` 僅此一個新依賴）。三項驗證：

1. **xlsx 回傳格式有陷阱（必須兼容）**：`readXlsxFile(file)` 對永豐金這個檔回傳的是
   `[{ sheet: 'Sheet 1', data: [...67 列] }]` **包裝格式**，不是裸 rows 陣列。直接當 rows 用只會看到「1 列」。
   解析器必須偵測：`Array.isArray(res[0]) ? res : res[0].data`。
2. **型別**：日期為 **string**（`'2026/07/02'`，非 Date 物件，無時區問題）、數量/價格/金額為 **number**（精度正確：203.5／11.66）、委託單號為 **string**。
3. **`TextDecoder('big5')` 在 Node 與瀏覽器皆可用**（node v26 實測 `encoding='big5'`）→ vitest 測試可直接跑 Big5 解碼，不需 polyfill。
4. 國泰 CSV 實測：總行數 123、交易明細標題在 index 4、解析出 **114 筆**（買進 76／賣出 34／除息 4）——與規劃一致。

**⚠️ 修正規劃期的數字錯誤**：永豐金真實交易為 **64 筆**（xlsx 共 67 列＝1 摘要＋1 標題＋**64 資料**＋1 合計）。
規劃期統計腳本誤把「合計」行計入才得 65。本檔與 CONTEXT 中所有「65 筆」一律以 **64 筆** 為準，
去重驗證與 T6 驗收步驟同步改為 64。

## 資料流與型別規格

### S1. 統一中間格式（types.ts，additive）

```ts
export type TxnKind = 'buy' | 'sell' | 'dividend';

export interface ParsedTxn {
  broker: 'sinopac' | 'cathay';
  market: 'TW' | 'US';
  date: string;        // 'YYYY-MM-DD'（本地字串，禁 toISOString）
  symbol: string;      // '2327'／'NVDA'（台股不含 .TW 後綴，與現有庫存一致）
  name: string;        // '國巨*'／'NVIDIA Corp'
  kind: TxnKind;
  shares: number;      // 可為小數（美股碎股）
  price: number;       // 市場幣別單價
  gross: number;       // 成交金額/價金（市場幣別）
  fee: number;         // 帳單實付手續費
  tax: number;         // 帳單實付交易稅（美股恆 0；除息時為代扣稅）
  netTwd?: number;     // 應收/付台幣（美股除息用來寫 cashDividends；審計）
  dedupeKey: string;   // D-11
  orderRef?: string;   // 台股委託單號（跨 lot 拆帳時回溯用）
  rawLine: string;     // 原始列摘要（預覽顯示；不落 localStorage）
}

export interface ImportGap {          // 找不到買進紀錄的賣出（D-02）
  txnIndex: number;                   // 對應 ParsedTxn 陣列索引
  symbol: string; name: string; market: 'TW' | 'US';
  sellDate: string; sharesMissing: number; sellPrice: number;
  costPerShare?: number;              // 使用者填入
  buyDate?: string;                   // 預設賣出日前一日（D-13），可改
}

export interface ImportPlan {
  txns: ParsedTxn[];                  // 已去重、已排序
  skippedDuplicates: number;
  unsupported: { rawLine: string; reason: string }[];
  gaps: ImportGap[];
  preview: { newLots: number; sells: number; dividends: number };
}
```

localStorage 新 key `portfolio_import_log_v1`：`{ version: 1, keys: string[], batches: { at: number; broker: string; count: number }[] }`（`utils/importStore.ts`，比照 `portfolioHistoryStore` 的版本驗證＋quota 守衛寫法）。

### S2. 重播引擎（utils/importReplay.ts，純函式，不碰網路/DOM）

```
replayStatement(txns, existingLots, existingTrades, gapsFilled, now) → {
  lots: PortfolioItem[],          // 套用後的完整庫存
  newTrades: RealizedTrade[],     // 新產生的已實現紀錄
  gaps: ImportGap[],              // 尚未補值的缺口
  applied: { buys, sells, dividends, skipped }
}
```

規則：
1. **排序**：`txns` 依 `date` 升冪；同日維持原檔順序（買在賣前的檔序即券商實際順序）。**國泰 CSV 實測非嚴格日期排序，必須排序**。
2. **buy** → 新 lot：`{ id: 生成, symbol, buyDate: date, totalShares: shares, buyFee: fee, ... }`
   - 台股：`totalCost = gross + fee`（＝帳單應付金額，可交叉驗證）
   - 美股：`purchaseCurrency:'USD'`、`totalCostUSD = gross + fee`、`totalCost: 0`、`isUsEtf` 由代號判定（本期以「帳單手續費恰為 3.00」或使用者於預覽勾選；**預設 false，預覽可改**）
   - `avgCostPrice = (台股 totalCost / shares) 或 (totalCostUSD / shares)`
3. **sell** → FIFO 吃 lot 池（同市場同 symbol，依 `buyDate` 升冪；無 buyDate 視為最早）：
   - 每吃一個 lot 產生一筆 `RealizedTrade`（帶該 lot 的 `lotId`、`orderRef`）
   - `costBasis = lot成本 × 吃掉股數 / lot總股數`（乘先除後）
   - 費稅**等比分攤、最後一筆吃餘數**：`fee_i = round(fee × shares_i / totalSold)`，末筆 `= fee − Σ前面`（台股整數、美股 round2）
   - `realizedPnl = shares_i × price − fee_i − tax_i − costBasis_i`
   - `divCarried` 沿 Phase 10 守恆語意等比移轉
   - 吃完仍有剩餘股數 → 產生 `ImportGap`（不猜成本）
4. **dividend** → 該 symbol 現存 lots 依股數等比加 `cashDividends`；台股加 `gross`、美股加 `netTwd`（App 的美股股利為 TWD 計價）。無 lot 可加 → 記入 `unsupported`（附原因）。
5. **gapsFilled**：使用者補了 `costPerShare` 的缺口 → 先插入 synthetic lot（`totalShares = sharesMissing`、`totalCost = costPerShare × sharesMissing`、`buyDate = 使用者填/預設`、`buyFee` 不設），再照 3 正常賣出。

---

## 手算對數案例（全部取自使用者真實帳單，寫進 vitest；覆核者須獨立重算）

**Case A｜台股買進**：2327 國巨 30股 @1115 → 價金 33450、費 47 → `totalCost=33497`、`buyFee=47`、`avgCostPrice=33497/30=1116.5667`。（交叉驗證：帳單應付金額欄＝33497）

**Case B｜台股單 lot 全賣**：2351 順德 買 250@212（價金 53000、費 75 → cost 53075）；賣 250@203.5（價金 50875、費 72、稅 152）
→ `costBasis=53075`、**`realizedPnl = 50875−72−152−53075 = −2424`**。（交叉驗證：帳單應收 50651 − 應付 53075 = −2424 ✓）

**Case C｜台股跨 lot 賣出（D-09 核心）**：3711 日月光投控
- 買 7/02 50@726（cost 36351）、7/06 30@685（cost 20579）、7/08 20@636（cost 12738）
- 賣 7/14 70@623（價金 43610、費 62、稅 130、應收 43418）
- FIFO：吃 lot1 全 50 股 ＋ lot2 的 20 股（lot2 剩 10 股）
- 費稅分攤：lot1 `fee=round(62×50/70)=44`、`tax=round(130×50/70)=93`；lot2 末筆吃餘數 `fee=62−44=18`、`tax=130−93=37`
- `costBasis`：lot1 = **36351**；lot2 = 20579×20/30 = **13719.3333**
- **`realizedPnl`：lot1 = 31150−44−93−36351 = −5338；lot2 = 12460−18−37−13719.3333 = −1314.3333；合計 −6652.3333**
- 交叉驗證：43418 − (36351+13719.3333) = **−6652.3333** ✓
- lot2 剩餘：10 股、`totalCost = 20579−13719.3333 = 6859.6667`

**Case D｜美股買進**：NVDA 5@179 → 成交 895、費 0.72 → `totalCostUSD=895.72`、`purchaseCurrency='USD'`。
（若誤用 `calcUsFee` 重算會得 0.07，差 10 倍——**這是 D-06「用帳單實數」的存在理由，測試須斷言用的是 0.72**）

**Case E｜美股單 lot 全賣**：MRVL 買 20@82.15（成交 1643、費 1.31 → cost 1644.31）；賣 20@85.10（成交 1702、費 1.36、稅 0）
→ **`realizedPnl = 1702−1.36−1644.31 = 56.33 USD`**

**Case F｜美股除息**：GOOGL 3/17 除息，股數 2、每股 0.21、成交 0.42 USD、代扣稅 0.13、**應收台幣 9.00**
→ GOOGL lot 的 `cashDividends += 9`（TWD 計價，D-10）

**Case G｜碎股**：MU 買 2.3209@861.7368（成交 2000.00、費 1.60 → cost 2001.60）；賣 2.3209@902.2611（成交 2094.05、費 1.68）
→ **`realizedPnl = 2094.05−1.68−2001.60 = 90.77 USD`**

**Case H｜期初缺口補值**：2484 希華 7/03 賣 1000@91.3（價金 91300、費 130、稅 273），帳單無買進
→ 產生 `ImportGap`；使用者填成本均價 85 → synthetic lot（1000 股、`totalCost=85000`、`buyDate=2026-07-02`）
→ **`realizedPnl = 91300−130−273−85000 = 5897`**

**Case I｜去重**：同一份台股帳單連續匯入兩次 → 第二次 `skippedDuplicates=65`、`newLots=0`、`sells=0`。

---

## 任務序列（T1→T6，一任務一 commit）

### T1｜spike＋兩個解析器＋格式偵測
1. **spike（動手寫解析器前先做）**：安裝候選套件，寫一次性腳本實跑使用者真檔，確認：永豐金拿到 65 筆＋正確跳過合計行；國泰 Big5 解出 114 筆且中文無亂碼。**首選 `read-excel-file`**（輕量、活躍維護、無 SheetJS 0.18.5 已知 prototype-pollution CVE）；不通再評估 SheetJS 較新版。spike 結果（套件名、版本、實測筆數）寫進本檔新節「T1 spike 結果」後再繼續。
2. `utils/statementParsers/sinopac.ts`：xlsx → `ParsedTxn[]`。動態 `await import()` 載套件。商品欄以第一個空白切分代號/名稱；跳過合計行與空列；交易別非 `現買/現賣` → `unsupported`。
3. `utils/statementParsers/cathay.ts`：`File.arrayBuffer()` → `new TextDecoder('big5')` 解碼 → 掃描定位交易明細標題列 → 逐列 trim 切分；`除息` 映射 `dividend`；匯率 `--` 忽略。
4. `utils/statementParsers/index.ts`：依副檔名與內容特徵偵測券商，回傳 `{ txns, unsupported }`；無法辨識丟具名錯誤。
5. 測試（合成 fixture，禁真實資料）：Case A/B/D/F/G 的來源列、合計行跳過、Big5 中文、碎股、`--` 匯率、未支援交易別。
驗證：tsc、test、`git diff package.json` 只有一個新依賴。

### T2｜FIFO 重播引擎
`utils/importReplay.ts` 全部規則（S2）。測試：Case A~I 全數＋同日多筆順序＋跨 lot 餘數分攤（末筆吃餘數後總和等於帳單費稅）＋無 buyDate 既有 lot 排最早＋既有庫存被對帳單賣出扣減（使用者要的「自動從庫存賣出」）。
驗證：tsc、test。

### T3｜去重 store＋ImportPlan 產生
`utils/importStore.ts`（版本驗證＋quota 守衛，比照 portfolioHistoryStore）；`buildImportPlan(txns, importedKeys, existingLots, existingTrades)` 產出預覽統計與缺口清單。測試：Case I 去重、跨券商鍵不互撞。
驗證：tsc、test。

### T4｜上傳＋預覽 UI
`components/portfolio/ImportStatementModal.tsx`：拖放/選檔（accept `.xlsx,.csv`）→ 解析中狀態 → 預覽（券商、期間、將新增 N 筆持股／M 筆賣出／K 筆配息／略過 D 筆重複／U 筆未支援）→ **缺口區塊**（每列：代號名稱、賣出日、股數、賣價、成本均價輸入框、買進日期輸入，未填則標示「將略過」）→ 美股 ETF 勾選 → 確認/取消。錯誤狀態（檔案損毀/格式不符/空檔）具名顯示。
`components/Portfolio.tsx`：header 加「匯入對帳單」按鈕（lucide `Upload`）＋掛 Modal（雷區 2 形狀）。
驗證：tsc、build。

### T5｜套用匯入＋App 接線
`App.tsx` 庫存區新增 `handleStatementImport(result)`：一次性 `setPortfolioItems(result.lots)`＋`setRealizedTrades(prev => [...prev, ...result.newTrades])`＋寫入 importStore 已匯入鍵；props 下傳。確認 Phase 10 的快照 effect 會因 items 變動自動重打當日快照（不需額外程式碼）。
驗證：tsc、test、build、`grep -r "AIza" dist/` 空、確認 xlsx 套件不在首屏 chunk（`dist/assets` 檢查 chunk 分佈）。

### T6｜checkpoint:human-verify（做到這裡停下回報）
使用者操作步驟：
1. `/start-dev` → 庫存頁 → 按「匯入對帳單」→ 丟 `永豐金對帳單.xlsx`。
2. 預覽應顯示：65 筆交易、將新增約 24 筆持股、約 8 檔缺口（00631L／00685L／2481／2484／3131／3413／3481 等）。
3. 在 2484 希華 缺口列填成本均價 85 → 確認匯入。
4. 檢查：2484 產生已實現損益 **+5,897**；3711 日月光投控帳本出現兩筆（合計 **−6,652**）、剩餘持股 10 股＋7/15 買的 50 股；2351 順德已實現 **−2,424**。
5. 再丟同一份 xlsx → 預覽應顯示「略過 65 筆重複、新增 0」。
6. 丟 `國泰複委託對帳單.csv` → 中文名稱無亂碼；MRVL 已實現 **+$56.33**；MU 碎股 **+$90.77**；GOOGL 現金股利 **+9 元**。
7. 匯入後按台股/美股圖的「建立歷史曲線」→ 曲線涵蓋帳單期間、已實現線有真實階梯。
8. DevTools 確認 `portfolio_import_log_v1` 有 keys 與 batches。

---

<review_checklist>
逐條 PASS/FAIL＋證據。必修退回附行號；同一問題最多退 2 輪，第 3 輪升級回報使用者。

1. 範圍紀律：`git diff main --stat` ⊆ frontmatter；`git diff main -- utils/portfolioFees.ts utils/portfolioLedger.ts utils/portfolioHistory.ts utils/portfolioHistoryStore.ts services/ api/` 為空；App.tsx 串流區 diff＝0。
2. 依賴紀律：`git diff main -- package.json` 只有一個新 dependency；程式碼中該套件為 `await import()` 動態載入；build 後首屏 chunk 不含它（列 `dist/assets` chunk 大小佐證）。
3. 手算案例獨立重算：不看實作徒手重算 Case A~I，與測試斷言逐一對照；特別檢查 Case C 的分攤餘數（44+18=62、93+37=130）與 costBasis 乘先除後。
4. D-06 落實：全域搜尋確認 `importReplay.ts` 未呼叫 `calcTwBuyFee`／`calcTwSellFeeAndTax`／`calcUsFee`；Case D 斷言費用為帳單的 0.72 而非公式的 0.07。
5. 隱私：`git log -p` 與工作區搜尋確認無真實對帳單內容（人名/帳號/完整交易列）進 repo；fixture 均為合成。
6. 日期紀律：新程式 `toISOString` 0 命中；日期為本地字串比較。
7. 去重：Case I 有測試；台股用委託單號、美股用複合鍵；跨券商不互撞。
8. Phase 10 零回歸：`npm run test` 既有 80 案例全綠；手動賣出/快照/回推路徑程式碼未改。
9. 機械檢查親跑：`npx tsc --noEmit`、`npm run test`、`npm run build`、`grep -r "AIza" dist/`。
10. 誠實揭露：CONTEXT「已知限制」1-5 在 UI 有對應呈現（至少：缺口需補成本、跨 lot 拆帳說明）。
</review_checklist>

## 未決點（規劃期未驗證，執行期先解）

1. **【spike，T1 第一步】xlsx 套件選型**：`read-excel-file` 能否正確解析永豐金真檔（合併儲存格/日期型別/數字精度）未驗證。結果寫回本檔再繼續。
2. **美股 ETF 判定**：帳單無 ETF 旗標，目前靠「手續費恰為 3.00」推測（實測 DRAM/SOXX/MUU/GLWG/LITX/SNXX 皆 3.00，個股皆 0.08%）。此推測在「個股成交額恰使 0.08% ≈ 3.00」時會誤判（成交額約 3750 USD）——預覽提供勾選讓使用者修正，不靠推測定案。
3. **台股 `*`／`-KY` 名稱標記**：`2327 國巨*`、`6415 矽力*-KY` 的 `*` 是處置股標記還是名稱一部分未確認；代號切分以第一個空白為界不受影響，但顯示名稱會帶 `*`。可接受。
4. **融資/融券/當沖/零股**：本兩份帳單未出現，解析器標為未支援並顯示，不靜默跳過。日後出現需擴充。
5. **既有 `calcUsFee` 0.008% vs 實際 0.08%**：本期不修（見 CONTEXT），需使用者另行決定是否修正與是否重算既有損益。
