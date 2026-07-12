---
phase: 260712-qfi-a1-search-scope-etf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [services/stockDirectory.ts, components/StockSearch.tsx]
autonomous: true
requirements: [QUICK-260712-qfi]

must_haves:
  truths:
    - "Yahoo 搜尋結果僅含 quoteType ∈ {EQUITY, ETF}；`|| x.isYahooFinance` 旁路已移除（期貨/指數/匯率/加密不再混入）"
    - "市場白名單生效：美股交易所（NMS/NYQ/NGM/NCM/ASE/PCX/BTS）＋台股 .TW/.TWO 後綴；其餘市場（港/日/韓等）直接丟棄，不以「海外」badge 顯示"
    - "台股本地搜尋僅回 type ∈ {twse, tpex} 的個股與 ETF；受益證券、存託憑證（DR）、可轉債、ETN、指數類不出現"
    - "合法台股 ETF 不被誤殺（0050、債券型如 00679B、槓反型如 00632R、上櫃 ETF）"
    - "合併結果收斂至約 15 筆"
    - "純中文搜尋仍 0 網路請求（hasCJK 短路路徑不變）"
    - "Market 型別收斂為 'TW' | 'US'，StockSearch.tsx 無 OTHER/海外死碼"
    - "npx tsc --noEmit 通過"
  artifacts:
    - path: "services/stockDirectory.ts"
      provides: "可獨立測試的純過濾函式 mapYahooQuote / isSearchableTaiwanEntry ＋ 收斂後的 searchYahoo / searchTaiwan / searchStocks"
      contains: "isSearchableTaiwanEntry"
    - path: "components/StockSearch.tsx"
      provides: "marketBadge 僅剩 TW / US 兩項"
  key_links:
    - from: "searchYahoo quotes 陣列"
      to: "mapYahooQuote"
      via: "map 後過濾 null（取代原 filter+map 內聯邏輯）"
      pattern: "mapYahooQuote"
    - from: "searchTaiwan 主迴圈"
      to: "isSearchableTaiwanEntry"
      via: "迴圈內先行 continue 過濾（快取資料已含 type/industry 欄位，舊 localStorage 快取同樣適用，無需 bump LS_KEY）"
      pattern: "isSearchableTaiwanEntry"
    - from: "components/StockSearch.tsx marketBadge"
      to: "services/stockDirectory.ts Market 型別"
      via: "Record<Market, ...> — 型別收斂後 tsc 強制同步刪除 OTHER 條目"
      pattern: "Record<Market"
---

<objective>
A1 搜尋限縮：搜尋結果限縮為「美股＋台股」的「個股＋ETF」。
實作規格已由 `.planning/optimization/PLAN.md` §A1 鎖定（本計畫照做、不重新設計）：
移除 isYahooFinance 旁路（§A1 改法1）、市場白名單＋丟棄 OTHER（§A1 改法2）、
searchTaiwan 名錄過濾（§A1 改法3）、合併結果收斂約 15 筆（§A1 改法4）。

Purpose: 現行搜尋會混入期貨/選擇權/指數/匯率（isYahooFinance 旁路）、港日韓標的（OTHER 未排除）、
受益證券/存託憑證/可轉債/ETN（FinMind 名錄零過濾），干擾使用者選股，也讓下游分析拿到不支援的標的。
Output: `services/stockDirectory.ts` 過濾收斂 ＋ `components/StockSearch.tsx` 移除海外 badge ＋
一次性 Node 斷言驗證（用完即刪，不 commit）。

**Git 紀律（紅線）**：工作樹有本任務之外的既有未提交變更（.planning/ 下多個 SUMMARY.md）。
commit 一律逐檔 `git add <path>` 只 stage 本任務實際修改的檔案，**絕不可 `git add -A` 或 `git add .`**。
</objective>

<execution_context>
@E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/workflows/execute-plan.md
@E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@.planning/optimization/PLAN.md
@services/stockDirectory.ts
@components/StockSearch.tsx

# 規劃時已實讀確認的事實（勿重新偵查）：
#   - 旁路過濾式在 services/stockDirectory.ts:113-118（filter + market 三元式）
#   - Market='OTHER' 全 repo 僅兩處引用：stockDirectory.ts（型別＋指派）、StockSearch.tsx:13-17（marketBadge）
#     → 型別收斂為 'TW'|'US' 後，marketBadge 的 OTHER 條目會被 tsc excess property check 抓出，無其他連鎖
#   - searchTaiwan（:84-99）對名錄零過濾；名錄建置段（:44-79）把 FinMind TaiwanStockInfo 的
#     stock_id/stock_name/industry_category/type 存進 StockDirEntry（id/name/industry/type），
#     故「過濾放在 searchTaiwan 搜尋時」對既有 localStorage 舊快取同樣生效，不需 bump LS_KEY 版本
#   - searchStocks（:132-148）：hasCJK 短路（0 網路請求）；searchTaiwan(dir,q,20)；merged.slice(0,24)
#   - services/_shared/apiClient.ts 僅有 optional-chained import.meta.env（node 下安全為 {}），
#     且純函式不碰 localStorage/fetch → 用 npx tsx 直接 import stockDirectory.ts 跑斷言可行
</context>

<tasks>

<task type="auto">
  <name>Task 1: searchYahoo 白名單收斂＋Market 型別收斂（§A1 改法1、2）</name>
  <files>services/stockDirectory.ts, components/StockSearch.tsx</files>
  <action>
    在 services/stockDirectory.ts：

    1. 將 `export type Market` 收斂為 `'TW' | 'US'`（移除 `'OTHER'`——OTHER 市場改為直接丟棄，§A1 改法2）。

    2. 新增 exported 純函式 `mapYahooQuote(x: any): StockDirEntry | null`，將原 :113-125 的
       filter＋map 內聯邏輯改寫為單一可測函式，規則：
       - `x.symbol` 不存在 → null。
       - quoteType 嚴格限定：`x.quoteType === 'EQUITY' || x.quoteType === 'ETF'`，
         **移除 `|| x.isYahooFinance` 旁路**（§A1 改法1——期貨/選擇權/指數/匯率該欄位皆 true，是混入根因）。
       - 市場判定：symbol 以 `.TW` 或 `.TWO` 結尾 → market='TW'；
         `x.exchange` ∈ {NMS, NYQ, NGM, NCM, ASE, PCX, BTS} → market='US'（比現行多 NGM/NCM/BTS 三所）；
         **兩者皆非 → return null（丟棄，不再歸 OTHER）**。
       - 通過者回傳與現行相同形狀的 StockDirEntry（name 用 shortname || longname || symbol，industry 用 exchDisp || exchange）。

    3. `searchYahoo` 改為 `quotes.map(mapYahooQuote).filter((e): e is StockDirEntry => e !== null)`，
       其餘（URL、headers、錯誤處理）不動。

    在 components/StockSearch.tsx：

    4. 刪除 marketBadge 的 OTHER 條目（:16「海外」）。Market 型別收斂後 tsc 會強制此同步；
       確認元件內無其他 OTHER 分支殘留（規劃時已確認僅此一處）。
  </action>
  <verify>
    <automated>用 Bash 工具跑：npx tsc --noEmit 通過；再以一次性斷言腳本（寫在系統暫存區或 .planning/quick/260712-qfi-a1-search-scope-etf/ 下、驗完即刪不 commit）用 `npx tsx` import mapYahooQuote 斷言：{AAPL,EQUITY,NMS}→US 保留、{VOO,ETF,PCX}→US 保留、{QQQ,ETF,NGM}→US 保留、{2330.TW,EQUITY,TAI}→TW 保留、{6488.TWO,EQUITY,TWO}→TW 保留、{NK=F,FUTURE,isYahooFinance:true}→null、{^HSI,INDEX,isYahooFinance:true}→null、{BTC-USD,CRYPTOCURRENCY}→null、{0700.HK,EQUITY,HKG}→null、{7203.T,EQUITY,JPX}→null。（若 npx tsx 不可用，退回 Node ≥22.6 的 --experimental-strip-types，或把純函式邏輯複製進 .mjs 腳本斷言）</automated>
  </verify>
  <done>isYahooFinance 旁路移除、quoteType 嚴格 EQUITY/ETF、市場白名單（美 7 所＋.TW/.TWO）生效且落選者回 null；Market 型別為 'TW'|'US'；StockSearch.tsx 無 OTHER 死碼；tsc 與上述斷言全過</done>
</task>

<task type="auto">
  <name>Task 2: searchTaiwan 名錄過濾（先確認值域）＋合併結果收斂（§A1 改法3、4）</name>
  <files>services/stockDirectory.ts</files>
  <action>
    **Step A — 值域偵查（過濾規則的前置依據，不可憑空猜欄位值）**：
    名錄建置段（stockDirectory.ts:44-79）存的是 FinMind TaiwanStockInfo 的
    industry_category→industry、type→type。用 Bash 工具以 node 直跑 fetch
    `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo`（此 dataset 免 token），
    彙整 distinct `type` 值與 distinct `industry_category` 值（各附筆數），把清單記進 SUMMARY。
    若遇 402/429 限流（本專案常態）：間隔 30-60 秒重試；仍失敗才以 WebFetch 查 FinMind 官方文件
    的欄位值域佐證，並在 SUMMARY 標註「值域未經 API 實測」。

    **Step B — 實作過濾 predicate**：
    新增 exported 純函式 `isSearchableTaiwanEntry(e: StockDirEntry): boolean`，依 Step A 實際值域訂規則。
    候選形狀（最終以實測值域為準，§A1 改法3）：
    - `e.type` 必須 ∈ {'twse', 'tpex'}（排除興櫃等其他 type 值）。
    - industry（=industry_category）黑名單：依實測值涵蓋受益證券、存託憑證、ETN、Index/大盤/指數類等非個股非ETF 類別。
    - 代碼型態白名單：4 碼純數字 → 個股保留；`00` 開頭 5-6 碼（末尾可帶 R/B/L/U 等字母，
      如 00632R/00679B）且 industry 屬 ETF 類 → ETF 保留；其餘代碼型態（91 開頭 DR、
      5 碼可轉債、01 開頭受益證券、02 開頭 ETN 等）丟棄。
    - 注意不可誤殺：債券/槓反 ETF、上櫃 ETF（tpex 的 ETF industry 標籤可能與 twse 不同，以 Step A 實值為準）。

    `searchTaiwan` 主迴圈（:90-97）開頭以 `if (!isSearchableTaiwanEntry(e)) continue;` 先行過濾；
    名錄建置與快取邏輯（ensureTaiwanDirectory）完全不動——舊 localStorage 快取已含 type/industry
    欄位，搜尋時過濾對新舊快取一體生效，不需 bump LS_KEY。

    **Step C — 合併結果收斂（§A1 改法4）**：
    `searchStocks` 內 `searchTaiwan(dir, q, 20)` → 15；`merged.slice(0, 24)` → `slice(0, 15)`。
    hasCJK 中文短路路徑（0 網路請求）與去重邏輯不動；searchYahoo 的 limit 8 不動。
  </action>
  <verify>
    <automated>用 Bash 工具跑：npx tsc --noEmit 通過；一次性斷言腳本（同 Task 1 作法，用完即刪）以 Step A 抓到的真實名錄（或退化為依實測值域構造的 fixtures）跑 isSearchableTaiwanEntry 斷言：'2330'（twse 個股）保留、'0050'（ETF）保留、'6488'（tpex 個股）保留、至少一筆 00 開頭帶字母 ETF（如 00679B）保留、至少一筆上櫃 ETF 保留、至少一筆 91 開頭 DR 排除、至少一筆受益證券排除、至少一筆 ETN 排除、非 twse/tpex type 排除；另 log 過濾前後筆數 sanity check（保留數應仍達數千檔量級，防黑名單過殺）；再以真實名錄呼叫 searchTaiwan 搜「台」與「00」確認回傳皆通過 predicate 且 ≤15 筆上限邏輯正確</automated>
  </verify>
  <done>searchTaiwan 僅回 twse/tpex 的個股與 ETF（過濾規則以 API 實測值域為據並記錄於 SUMMARY）；合法 ETF 無誤殺；searchStocks 合併結果 ≤15 筆；中文搜尋仍 0 網路請求；tsc 與斷言全過</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| 瀏覽器 → Yahoo search 回應（經同源代理） | 外部不受信資料直接餵進搜尋建議清單 |
| 瀏覽器 → FinMind 名錄（經同源代理＋localStorage 快取） | 外部名錄資料本地快取 7 天 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-qfi-01 | Tampering | searchYahoo 回應處理 | mitigate | 本任務本體：quoteType＋交易所雙白名單，未知/畸形 quote 一律丟棄（mapYahooQuote 回 null） |
| T-qfi-02 | Spoofing | FinMind 名錄資料 | accept | 免 token 公開名錄、僅作搜尋建議；選定標的後行情另經獨立資料鏈驗證 |
| T-qfi-SC | Tampering | 依賴安裝 | accept | 本任務零新依賴（package.json/importmap 皆不動）；npx tsx 僅為一次性驗證工具（知名 esbuild 系 TS runner），不進 repo，可用 Node 原生 --experimental-strip-types 替代 |
</threat_model>

<verification>
1. `npx tsc --noEmit` 通過（兩個 task 各自驗、收尾再驗一次）。
2. 純函式 Node 斷言全過（mapYahooQuote 10 組 fixtures＋isSearchableTaiwanEntry 真實名錄抽查）。
3. 程式碼審視對照 §A1 驗收清單：搜「台積電/2330/AAPL/VOO/0050」的路徑可達（台積電/2330/0050 走
   searchTaiwan 且通過 predicate；AAPL/VOO 走 mapYahooQuote 白名單）；「NK/HSI/BTC/恒生/日經」
   被 quoteType 或市場白名單丟棄（fixtures 已覆蓋）；純中文搜尋 0 網路請求（hasCJK 短路未動）。
   不啟動 dev server。
4. `git status` 確認只 stage services/stockDirectory.ts、components/StockSearch.tsx 與本任務
   .planning/quick/260712-qfi-a1-search-scope-etf/ 文件；一次性斷言腳本已刪除。
</verification>

<success_criteria>
- §A1 改法 1-4 全數落地，無任何一項被簡化或延後
- must_haves.truths 全數成立
- 過濾規則有 API 實測值域佐證並記錄於 SUMMARY（或明確標註退化路徑）
- 原子 commit 只含本任務檔案（絕無 git add -A）
</success_criteria>

<output>
完成後建立 `.planning/quick/260712-qfi-a1-search-scope-etf/260712-qfi-SUMMARY.md`
（含：值域偵查結果、最終過濾規則與依據、斷言結果、commit hash）。
</output>
