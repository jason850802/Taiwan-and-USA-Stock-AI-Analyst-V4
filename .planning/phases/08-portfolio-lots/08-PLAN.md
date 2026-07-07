---
phase: 08-portfolio-lots
plan: 01
type: execute
wave: 1
depends_on: [07-ui-portfolio]
files_modified:
  - types.ts
  - components/Portfolio.tsx
  - App.tsx
autonomous: false
requirements: [PF-LOTS, PF-FEE]

must_haves:
  truths:
    - "同一 symbol 多筆買入：總覽一檔一列（加權平均成本、總股數、總損益），點列展開看各批明細"
    - "localStorage 資料零遷移：舊資料原樣可讀，不在載入時改寫；lots 仍逐筆保存"
    - "健檢改餵聚合後總部位（修掉現行只拿第一筆的 bug）；healthResults 仍以 symbol 為 key"
    - "新增持股表單：『券商折扣』改為『手續費』金額欄，預設＝成交金額×0.1425%，點欄全選可直接覆蓋，不顯示最低費"
    - "賣出估算：手續費全費率 0.1425%＋證交稅（個股0.3%/股票ETF0.1%/債券ETF0%，僅賣出）；買賣各算一次手續費"
    - "明細列可編輯/刪除各批（沿用既有 EditableCell/onUpdate/onDelete）；聚合列唯讀"
  artifacts:
    - path: "components/Portfolio.tsx"
      provides: "按 symbol 聚合的總覽列＋可展開明細；手續費新輸入模型；聚合健檢"
    - path: "types.ts"
      provides: "PortfolioItem 新增選填欄位 buyFee?: number（實付買入手續費）"
---

<objective>
庫存功能強化：(1) 同標的多筆買入在總覽聚合成一列＋展開明細（lots 保留、渲染時聚合），
並讓健檢使用聚合後的真實部位；(2) 手續費輸入模型從「折扣數」改為「可覆蓋的金額欄」，
賣出估算統一全費率＋既有稅率規則。**這是資料呈現＋計算語意的改造，localStorage 結構零遷移。**

Purpose: 修掉「同檔多筆各自為政＋健檢只看第一筆」的錯誤模型；把手續費輸入變成使用者實際的心智模型
（看見金額、可直接覆蓋），為之後的實際費用記帳打底。
Output: types.ts（buyFee 選填欄）、Portfolio.tsx（聚合列/明細/表單/費用計算）、App.tsx（onUpdate 支援 buyFee）。
</objective>

<context_for_cold_start_executor>
## 給冷啟動執行者的前提（無對話背景，先讀完本節）

**專案路徑 `E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4`（E 槽，路徑含空格必加引號）。分支 `gsd/phase-portfolio-1`。**

### 鐵則
1. **localStorage 零遷移**：key `portfolio_items` 不變；載入時**不得改寫**既有資料；
   `buyFee` 是**選填**新欄位（舊筆沒有它必須一切正常）。lots 永遠逐筆保存——
   `handleAdd` 仍然每次 push 新 lot（**不要**做「同 symbol 自動合併成一筆」的資料合併），
   合併只發生在**渲染層聚合**。
2. 既有計算函式的位置與語意（偵查已確認，動手前開檔對照）：
   - `calcTwBuyFee(base, discount)`＝`max(1, floor(base*(discount/10)*0.001425))`（Portfolio.tsx:48-49）
   - `calcTwSellFeeAndTax`（L50-55）、`getTaxRate`（L40-45：一般 0.3%／股票ETF 0.1%／債券ETF(00xxxB/C) 0%）
   - `calcUsFee`（ETF 固定 $3／個股 0.008%）
   - 台股損益：`pnl = 市值 - totalCost - sellFee - tax + (含息? cashDividends:0)`（L210-215 單列、L153-167 群組）
   - 美股損益與幣別換算：`itemCostInDisplay`（L336-342）、`toDisplay`、rate fallback 32
   - **股票股利不入損益公式**（僅顯示）——維持現狀，不要「順便修」。
3. UI 一律用既有 token 與 `components/ui/` 元件（Badge/Button/StatCard/Modal 等），
   禁止 emerald/rose/漸層/彩色陰影/emoji 狀態碼（Phase C 已歸零，不要弄髒）。
4. 驗證：Git Bash `npx tsc --noEmit`／PowerShell `npx.cmd`；一任務一 commit；
   git 大動作前收乾淨 node 程序（taskkill）。禁止安裝 npm 套件。

### 現況關鍵事實（偵查 2026-07-06，行號為快照）
- `PortfolioItem`（types.ts:99-112）：`id/symbol/avgCostPrice/totalShares/totalCost/brokerDiscount
  (折數,2.8=2.8折)/cashDividends/stockDividends/purchaseCurrency?/totalCostUSD?/isUsEtf?`。
- `handleAdd`（Portfolio.tsx:671-709）永遠 push 新 lot；表單 preview（L623-668）已把買入手續費
  灘平進 `adjAvg`；「台股 total 模式」直接吃使用者總成本、`buyFee=0`。
- **健檢 bug**：`handleSingleHealthCheck`（L749-793）`items.find(i=>i.symbol===symbol)` 只拿第一筆；
  `healthResults` 以 symbol 為 key（L569）。傳給 AI 的欄位：`symbol,name,avgCostPrice(報價幣別),
  currentPrice,totalShares,profitPct,recentData,volumeProjection`。
- 兩表各 11 欄（台股含「券商折扣」可編欄；美股無折扣欄）；`onUpdate(id,field,value)` 的交叉同步
  在 App.tsx:81-102（改 totalCost⇒重算 avgCostPrice 等）；刪除＝每列垃圾桶＋二次確認。
- 全域摘要與 group reduce 都是逐 item 加總——**聚合列不改變總計正確性**，只是把列組織起來。
- `fetchAllPrices`（L606-610）同 symbol 會重複抓報價（可順手用 Set 去重）。
- `analyzeTradeDecision`（新增持股與分析）語意是「分析這一筆買入決策」——**維持單筆**，不要改聚合。

### 設計決策（已拍板，照做）
- **D-01 聚合＝渲染層**：每個表內按 `symbol` 分組。聚合列顯示：健檢鈕、代號-名稱、
  加權均價（=Σ成本/Σ股數，美股以顯示幣別各 lot 換算後加總）、總股數、總成本、現價、市值、
  Σ現金股利、Σ股票股利、Σ買入手續費（見 D-03）、總損益、展開箭頭。**聚合列全部唯讀**
  （數字是算出來的）。點列或箭頭展開 → 明細列（各 lot 沿用既有可編輯欄與刪除鈕）。
  單一 lot 的 symbol 也走同一套（聚合列＋可展開的一筆明細），不做兩種模式。
- **D-02 健檢餵聚合**：`handleSingleHealthCheck` 改為把該 symbol 全部 lots 聚合
  （加權均價、總股數、聚合損益%）後傳給 `analyzePortfolioHealth`；services 簽章不變。
- **D-03 手續費輸入模型**：
  - 表單「券商折扣」欄改為「手續費」金額欄：預設值＝`floor(成交金額×0.001425)`（**全費率、無折扣、
    下限 1 元不顯示說明**），成交金額變動時自動重算預設；**一旦使用者手動改過**（feeTouched flag）
    就不再自動覆蓋。`onFocus` 全選（`e.target.select()`）讓使用者直接打數字覆蓋。
  - 新 lot 儲存 `buyFee`（實付金額）；`totalCost = base + buyFee`、`adjAvg` 灘平邏輯照舊；
    新 lot 的 `brokerDiscount` 存 10（無折，僅為相容舊欄位）。
  - 美股表單同樣改成「手續費」金額欄：預設＝現行 `calcUsFee` 算出的金額（ETF $3/個股 0.008%），
    可覆蓋；儲存 `buyFee`（USD 購入存 USD 金額）。
  - **台股「total 模式」**（使用者直接輸入總成本）：手續費欄隱藏或停用（總成本已含一切），
    `buyFee` 不存（維持現狀語意）。
- **D-04 賣出估算統一全費率**：`calcTwSellFeeAndTax` 的手續費部分改為全費率
  `max(1, floor(value×0.001425))`（不再吃折扣參數）；稅率規則 `getTaxRate` 不變。
  **此改動會讓含舊折扣 lots 的損益估算略為保守（賣費變高）**——刻意為之，人工驗證時向使用者確認。
- **D-05 表格欄位**：台股表「券商折扣」欄改為「手續費」欄——聚合列顯示 Σ`buyFee`
  （舊 lots 無 buyFee 記為 0 並顯示 `—`）；明細列該欄顯示/可編輯該 lot 的 `buyFee`
  （舊 lot 顯示 `—`，可回填）。**編輯 buyFee 不做任何交叉重算**（totalCost 是既定事實，
  buyFee 僅記錄用）——在 App.tsx `onUpdate` 加 `buyFee` 分支：純寫入、無 side effect。
  美股表維持無費用欄（明細不加，避免欄位爆炸；費用已在損益內估算）。
- **D-06** `fetchAllPrices` 用 `new Set(items.map(i=>i.symbol))` 去重（一行優化，順手做）。
</context_for_cold_start_executor>

<tasks>

<task type="auto">
  <name>Task 1: 按 symbol 聚合列＋展開明細＋聚合健檢</name>
  <files>components/Portfolio.tsx, types.ts</files>
  <action>
1. `types.ts`：`PortfolioItem` 加 `buyFee?: number;`（選填，註解：實付買入手續費，購入幣別）。
   （本任務先加型別，表單寫入在 Task 2。）
2. `Portfolio.tsx` 建聚合輔助（放檔頭 calc 函式區旁，純函式）：
   `groupLotsBySymbol(items)` → `Map<symbol, PortfolioItem[]>`（保序）；
   聚合值計算沿用**既有的單列公式逐 lot 加總**（台股：Σ totalCost、Σ shares、
   Σ(sellFee+tax) 用聚合市值算一次；美股：逐 lot `itemCostInDisplay` 加總）——
   加權均價＝Σ成本/Σ股數。**不要發明新公式，把既有 L153-167/L336-360 群組 reduce 的算法
   套在「單一 symbol 的 lots」上即可。**
3. Tw/Us 兩表改為：每個 symbol 渲染一條**聚合列**（欄位見 D-01/D-05；唯讀；健檢鈕在此列；
   末欄展開箭頭 chevron，`useState<Set<string>>` 記展開的 symbols）＋展開時渲染該 symbol 的
   **明細列**（縮排或底色 `surface-inset` 區別；沿用既有 EditableCell/onUpdate/刪除鈕/
   二次確認，逐 lot 操作）。刪到 symbol 的最後一筆 lot 時該 symbol 整組消失（自然行為）。
4. `handleSingleHealthCheck`：改為取該 symbol 全部 lots → 聚合（加權均價換算報價幣別、
   總股數、聚合損益%）→ 傳給 `analyzePortfolioHealth`。找不到任何 lot 時行為同現狀。
5. `fetchAllPrices` symbol 去重（D-06）。
6. 摘要 4 卡與各 group 總計的 reduce **不動**（逐 lot 加總本來就對）。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && grep -q "groupLotsBySymbol" components/Portfolio.tsx && grep -q "buyFee" types.ts</automated>
  </verify>
  <done>同 symbol 多 lot 顯示為一條聚合列＋可展開明細；健檢用聚合部位；tsc 0 錯誤；localStorage 讀寫零變化。</done>
</task>

<task type="auto">
  <name>Task 2: 手續費輸入模型＋賣出全費率</name>
  <files>components/Portfolio.tsx, App.tsx</files>
  <action>
1. **新增持股表單**（台股 avg 模式與美股）：「券商折扣」欄改「手續費」金額欄（D-03）：
   - `feeInput` state＋`feeTouched` flag：未 touched 時隨成交金額重算預設
     （台股 `floor(base×0.001425)` 下限1；美股用既有 `calcUsFee`）；touched 後不再自動蓋。
   - `onFocus={e => e.target.select()}`；不顯示任何「最低手續費」文案。
   - 台股 total 模式：手續費欄隱藏/停用（維持現狀語意）。
   - preview 與 `handleAdd`：`buyFee = feeInput 實際值`；`total = base + buyFee`、
     `adjAvg = total/shares` 照舊灘平；新 lot 存 `buyFee`、`brokerDiscount: 10`。
     美股 USD 購入 `buyFee` 存 USD 金額，TWD 購入比照既有換算流程。
2. **賣出估算**（D-04）：`calcTwSellFeeAndTax` 手續費部分改全費率 `max(1, floor(value×0.001425))`，
   移除折扣參數的使用（呼叫處同步整理）；`getTaxRate` 與稅的公式不動。
3. **台股表欄位**（D-05）：「券商折扣」欄→「手續費」：聚合列 ΣbuyFee（無記錄顯示 `—`）；
   明細列顯示/可編輯 lot 的 `buyFee`（舊 lot `—` 可回填）。
4. **App.tsx `onUpdate`**：加 `buyFee` 分支——純寫入該欄位，**不做任何交叉重算**
   （在該分支加一行繁中註解說明原因：totalCost 為既定事實，buyFee 僅記錄）。
5. 確認 `新增持股與分析`（analyzeTradeDecision）流程照舊吃這次新增的單筆（語意不變）。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && grep -q "feeTouched" components/Portfolio.tsx && grep -qE "buyFee" App.tsx && npm run build 2>&1 | tail -1</automated>
  </verify>
  <done>表單為可覆蓋的手續費金額欄（預設全費率自動算）；新 lot 存 buyFee；賣出估算全費率＋稅率不變；表格欄位替換完成；tsc 0、build 成功。</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: 人工驗證（含手算對數）</name>
  <what-built>
同標的聚合列＋展開明細（lots 保留、健檢餵聚合部位）；手續費金額欄（預設 0.1425% 可覆蓋）；
賣出估算全費率；台股表「券商折扣」欄改「手續費」。localStorage 零遷移。
  </what-built>
  <how-to-verify>
起環境（兩終端機：`npx.cmd vercel dev --listen 3001`＋`npm.cmd run dev`），localhost:3000 → 我的庫存。

**手算對數案例（照做，數字要對上）**：
1. 新增 2330：1000 股 @1000。表單手續費欄應自動顯示 **1425**（=1,000,000×0.1425%）。
   直接點欄位→應全選→打「1000」應直接覆蓋（不用刪）。用預設 1425 送出。
2. 再新增 2330：1000 股 @1100。手續費預設應為 **1567**。送出。
3. 總覽應**只有一列 2330**：總股數 **2000**、總成本 **2,102,992**（=1,001,425+1,101,567）、
   加權均價 **1051.50**（=2,102,992/2000，允許顯示位數差異）。
4. 點列展開 → 兩筆明細各自可編輯/刪除；明細的手續費欄分別顯示 1425/1567。
5. 對 2330 按健檢 → 報告裡的持股數應是 **2000**、均價 **約1051.5**（證明吃的是聚合，不是第一筆）。
6. 舊資料相容：你既有的舊持股照常顯示（一檔一列）、損益數字合理；舊筆明細的手續費欄顯示 `—`。
7. 賣出成本抽查：任一台股個股列，損益 = 市值−總成本−賣費(市值×0.1425%)−稅(市值×0.3%；
   若是 0050 這類股票 ETF 稅率 0.1%)±股利——抓一列用計算機粗對，量級要對。
8. 美股新增一筆：手續費欄預設為 calcUsFee 金額（個股極小/ETF $3）、可覆蓋；損益照常。
9. F12 無紅字錯誤；新增/編輯/刪除後重新整理頁面，資料仍在（localStorage 正常）。
  </how-to-verify>
  <resume-signal>輸入 "approved" 或描述問題（哪一步、預期 vs 實際數字）</resume-signal>
</task>

</tasks>

<review_checklist>
## 給 fresh-context 覆核者的固定清單（逐條執行，不即興）

1. `npx tsc --noEmit`＝0；`npm run build` 成功；`grep -rn "AIza" dist/`＝0。
2. **範圍**：diff 只含 types.ts / components/Portfolio.tsx / App.tsx；services/、utils/、api/ 零 diff。
3. **零遷移**：diff 中不得出現「載入時改寫 localStorage」的邏輯（App.tsx:62-70 讀寫流程語意不變）；
   `buyFee` 在 types.ts 為選填（`?:`）；`handleAdd` 仍是 push 新 lot（無自動合併資料的分支）。
4. **聚合公式對數**（覆核者親自算）：用計畫 Task 3 的案例——1000@1000(fee1425)＋1000@1100(fee1567)
   → 檢查程式碼的聚合路徑會得出 Σ成本 2,102,992、加權均價 1051.496；賣出估算 @1200：
   fee=floor(2,400,000×0.001425)=3420、稅=floor(2,400,000×0.003)=7200。對照實作公式逐項核。
5. **健檢聚合**：`handleSingleHealthCheck` 不再是 `items.find` 單筆；傳給 services 的欄位名/簽章不變。
6. **賣出全費率**：`calcTwSellFeeAndTax` 不再使用折扣；`getTaxRate`（0.3/0.1/債券0）未被改動。
7. **onUpdate buyFee 分支**：純寫入、無交叉重算；其他欄位的既有交叉同步（App.tsx:81-102）未被波及。
8. **UI 紀律**：新 JSX 無 emerald/rose/漸層/彩色陰影/emoji；用既有 token 與 ui/ 元件。
9. runtime 交使用者 Task 3；未實跑就明說。判定：必修退 Codex 附行號；同題最多 2 輪。
</review_checklist>

<verification>
1. 每任務後 tsc＝0；Task 2 後 build 成功＋dist 無 AIza。
2. Task 3 人工驗證（含手算對數）通過。
3. 合併前收乾淨 node 程序再 merge。
</verification>

<success_criteria>
- [ ] 同 symbol 一列聚合＋展開明細；lots 逐筆保存、可各自編輯刪除；單 lot 同模式
- [ ] 健檢餵聚合部位（總股數/加權均價/聚合損益%）
- [ ] 手續費金額欄：預設全費率自動算、focus 全選可覆蓋、total 模式隱藏；新 lot 存 buyFee
- [ ] 賣出估算全費率；稅率規則不變；買賣各一次手續費
- [ ] localStorage 零遷移、舊資料完全相容（舊 lot 手續費顯示 —）
- [ ] tsc 0、build 成功、人工手算對數通過
</success_criteria>

<output>
Create `.planning/phases/08-portfolio-lots/08-01-SUMMARY.md`. 必記錄：
- 聚合值的實作位置與公式（供日後對帳）
- 舊 lot（無 buyFee）在表格與聚合中的呈現方式
- D-04 全費率統一對舊資料損益顯示的影響說明
- 任何偏差與原因
</output>

## 未決點（誠實列出）
1. **D-04 賣出全費率會讓損益估算略為保守**（原本吃折扣的舊 lots 賣費估變高）——已列入 Task 3
   請使用者確認接受；若要保留折扣估算，改回一參數即可（影響面小）。
2. 美股同 symbol 混合幣別（一筆 USD 購入＋一筆 TWD 購入）的聚合成本以顯示幣別逐 lot 換算後加總，
   換算用即時匯率（fallback 32）——顯示值會隨匯率浮動，屬既有行為的自然延伸，非新問題。
3. 聚合列唯讀是刻意設計（避免「改聚合值要回寫多筆 lots」的分攤歧義）；若使用者日後想在聚合列
   直接改總股數等，需另行設計分攤規則，本期不做。
