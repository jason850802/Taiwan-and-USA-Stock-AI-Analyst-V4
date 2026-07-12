# 台股基本面分頁（Fundamentals Tab）完整實作計畫

> 執行方式：本計畫交給 Claude Code（Opus 模型）單獨執行，不經 Codex。
> 已拍板：**只做台股**（美股留待下一輪）＋ **含 AI 基本面解讀**（走既有 Gemini 後端）。
> 執行時建議走 GSD 入口（`/gsd:import` 吃本計畫，或依 Step 逐一 `/gsd:quick`），至少維持每 Step 一個 atomic commit；每 Step 完成後 `npx tsc --noEmit` 零錯誤才 commit。

## Context（為什麼做）

使用者早有規劃在 App 加入基本面資料（`.planning/design/fundamentals-tab-PLAN.md` 2026-07-04 設計稿＋`.planning/todos/pending/2026-07-08-add-tw-stock-fundamentals-tab.md` 待辦），Sidebar 也已預留 disabled 的「基本面」按鈕（`components/Sidebar.tsx:43-52`）。但舊設計稿早於兩件大事：(a) UI 大翻新（現在有 `components/ui/` 設計 token）、(b) 後端代理層（FinMind 現在必須走 `/api/finmind` 白名單，不能前端直呼）。本計畫取代舊設計稿。

資料層零研究成本：`.claude/skills/_shared/fetch_fundamentals.py` 已實測 7 個 FinMind dataset（對 2330 一般股、2882 金融股驗證過），移植成 TypeScript 即可。**執行全程把該 py 檔當黃金參考，欄位候選碼、單位換算、pivot 邏輯照抄，不要重新研究 FinMind 欄位。**

## 一、內容與版面（由上到下）

排序邏輯（只做多的個人投資者視角）：先看「最近有沒有在成長」→「賺不賺錢、賺錢品質」→「安不安全」→「配息」→「AI 總結」。

| # | 區塊 | 資料來源（FinMind dataset） | 視覺形式 |
|---|------|---------------------------|---------|
| 1 | 台股搜尋列 | 復用 `StockSearch`（選到非台股顯示 Banner「僅支援台股」） | 既有元件 |
| 2 | 公司摘要＋估值卡 | TaiwanStockInfo ＋ TaiwanStockPER | `Card`：股名/代碼/產業 `Badge`/資料日期 ＋ 3 張 `StatCard`（PER / PBR / 現金殖利率%） |
| 3 | 月營收趨勢（近 13 月） | TaiwanStockMonthRevenue | recharts `ComposedChart`：Bar=營收(億元)＋右軸 Line=YoY%；YoY 正紅負綠（台股慣例） |
| 4 | 近 8 季營收與三率 | TaiwanStockFinancialStatements | `ComposedChart`：Bar=季營收(億)＋右軸 3 條 Line=毛利率/營益率/淨利率(%)，色系沿用 MA 線 `#fbbf24`/`#38bdf8`/`#a78bfa` |
| 5 | EPS 趨勢（近 8 季） | 同上（EPS 欄） | `BarChart` 每根標值；與 #4 以 `xl:grid-cols-2` 並排 |
| 6 | 財務體質 ＋ 現金流 | TaiwanStockBalanceSheet ＋ TaiwanStockCashFlowsStatement | 兩張 `Card` 並排（`md:grid-cols-2`），各 4-6 張 `StatCard`：負債比%（>60 警示色）/現金/流動資產/總資產/股東權益 ‖ 營業CF/投資CF/籌資CF/資本支出/**FCF**（正紅負綠） |
| 7 | 股利發放紀錄（近 5 期） | TaiwanStockDividend | HTML 表格（比照 MarkdownReport 表格風格）：期別/現金股利/股票股利/除息日 |
| 8 | AI 基本面解讀卡 | 上述全部 → `/api/gemini` | 未生成：虛線佔位框＋`Button variant="ai"`「AI 基本面解讀」；生成中 `Skeleton`；完成 `AnalysisResult`（ai 紫 header＋`MarkdownReport`） |
| 9 | 頁尾 | — | 小字：「資料來源：FinMind ・ 金額單位：新台幣億元 ・ 本頁為資料呈現與 AI 輔助解讀，非投資建議」 |

**刻意不做**：現金流 8 季趨勢圖（FinMind 現金流量表是**年度累計 YTD**，畫季度圖會誤導——Q3 天生比 Q1 大；UI 標籤寫「年度累計至 {date}」）；ROE 歷史（需逐季權益配對，v1 省略）。

## 二、架構設計

### 新增/修改檔案總表

| 檔案 | 動作 | 職責 |
|---|---|---|
| `api/_lib/finmind.ts` | 修改 | `ALLOWED_DATASETS`（:23）擴充 6 個；新增 `cacheSecondsForDataset()` |
| `api/finmind.ts` | 修改 | Cache-Control 改用 `cacheSecondsForDataset(dataset)` |
| `types.ts` | 修改 | 新增 7 個基本面型別（見下） |
| `services/finmind.ts` | **新建** | `fetchFinMindRows`（從 yahoo.ts 搬來）＋ pivot ＋ `getTwFundamentals()` ＋ 雙層快取 |
| `services/yahoo.ts` | 修改（小） | 刪本地 `fetchFinMindRows`/`FinMindDataset`（:183-206），改 import 自 `services/finmind.ts`，行為零改動 |
| `services/gemini.ts` | 修改 | 新增 `formatFundamentalsData()` ＋ `analyzeFundamentals()` |
| `components/FundamentalsPanel.tsx` | **新建** | 分頁容器：搜尋/載入/錯誤/版面編排/AI 觸發 |
| `components/fundamentals/ValuationHeader.tsx` | **新建** | 區塊 2 |
| `components/fundamentals/MonthlyRevenueChart.tsx` | **新建** | 區塊 3 |
| `components/fundamentals/QuarterlyTrendCharts.tsx` | **新建** | 區塊 4＋5（同檔兩張圖，共用季度 X 軸格式化） |
| `components/fundamentals/FinancialHealthCards.tsx` | **新建** | 區塊 6 |
| `components/fundamentals/DividendTable.tsx` | **新建** | 區塊 7 |
| `components/AnalysisResult.tsx` | 修改（小） | 加 optional `title` prop（預設 `'AI 技術分析報告'`，dashboard 舊用法不變） |
| `App.tsx` | 修改 | `AppView`（:21）加 `'fundamentals'`＋渲染分支 |
| `components/Sidebar.tsx` | 修改 | **注意 :4 有自己的一份 `AppView` 型別要同步**；:43-52 disabled 預留鈕改真按鈕（樣式比照上方兩顆，移除「預留」badge 與 `disabled`/`title`） |

拆子元件理由：recharts JSX 冗長，單一大 Panel 會超過 500 行；且各區塊資料獨立，正好對應「部分失敗仍渲染其餘區塊」的降級邊界。無新 npm 依賴（recharts/lucide/react-markdown 皆已存在），**不動 `index.html` importmap**。

### types.ts 新型別（草案，欄位對照 fetch_fundamentals.py）

```ts
export interface TwQuarterIncome {
  quarter: string;              // 'YYYY-MM-DD' 財報日
  revenueYi: number | null;     // 億元
  grossProfitYi: number | null;
  operatingIncomeYi: number | null;
  pretaxIncomeYi: number | null;
  netIncomeYi: number | null;
  eps: number | null;           // 元
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
}
export interface TwBalanceSheetSummary {
  date: string;
  cashYi: number | null; receivablesYi: number | null; inventoriesYi: number | null;
  currentAssetsYi: number | null; ppeYi: number | null;
  totalAssetsYi: number | null; totalLiabilitiesYi: number | null; equityYi: number | null;
  debtRatioPct: number | null;
}
export interface TwCashFlowSummary {
  date: string;                 // YTD 累計截止日
  operatingCfYi: number | null; investingCfYi: number | null; financingCfYi: number | null;
  capexYi: number | null; freeCashFlowYi: number | null;
}
export interface TwValuation { date: string; per: number | null; pbr: number | null; dividendYieldPct: number | null; }
export interface TwMonthlyRevenue { ym: string; revenueYi: number | null; yoyPct: number | null; }
export interface TwDividendRecord {
  period: string | number; announceDate: string | null;
  cashDividend: number; stockDividend: number; exDate: string | null;
}
export interface TwFundamentals {
  stockId: string;
  name: string | null;
  industry: string | null;
  asOf: string;                          // 抓取日
  valuation: TwValuation | null;
  incomeQuarters: TwQuarterIncome[];     // 近 8 季，舊→新
  balanceSheet: TwBalanceSheetSummary | null;
  cashFlow: TwCashFlowSummary | null;
  monthlyRevenue: TwMonthlyRevenue[];    // 近 13 月，舊→新
  dividends: TwDividendRecord[];         // 近 5 期
  warnings: string[];                    // 失敗的 dataset 標籤，供降級 UI
}
```

### services/finmind.ts 介面

```ts
export type FinMindDataset =
  | 'TaiwanStockInstitutionalInvestorsBuySell' | 'TaiwanStockPrice' | 'TaiwanStockInfo'
  | 'TaiwanStockFinancialStatements' | 'TaiwanStockBalanceSheet'
  | 'TaiwanStockCashFlowsStatement' | 'TaiwanStockPER'
  | 'TaiwanStockMonthRevenue' | 'TaiwanStockDividend';

// 從 yahoo.ts:188 原樣搬來（放寬 dataset 型別，保留 json.msg==='success' 判斷與 proxyHeaders）
export const fetchFinMindRows = async (
  dataset: FinMindDataset,
  params: { data_id?: string; start_date?: string } = {},
): Promise<any[]>

// 主入口：只接受純代碼（呼叫端先 strip .TW/.TWO）；force=true 略過快取（重試鈕用）
export const getTwFundamentals = async (
  stockId: string, opts?: { force?: boolean },
): Promise<TwFundamentals>
```

內部（不 export）逐函式對照 fetch_fundamentals.py 移植：
- `pivotByDate(rows, want)` ← py `pivot_latest`（L64-82）：長格式 `[{date,type,value}]` 依 date 分組、抽 want 內的 type、取最後 N 個日期。
- 淨利候選碼順序照抄：`['IncomeAfterTaxes','IncomeAfterTax','TotalConsolidatedProfitForThePeriod','IncomeFromContinuingOperations']`；負債/權益也有候選碼，照 py 版。
- `toYi(v)`：÷1e8 保留 2 位、null 安全 ← py `yi()`（L56-61）。
- `buildIncome/buildBalance/buildCashflow/buildMonthlyRevenue/buildDividends` ← py L85-199。
- **兩個必須保留的細節**：capex 為負值，`FCF = OCF + capex`（是加號）；股利現金＝`CashEarningsDistribution + CashStatutorySurplus`，全零期跳過。

**start_date 穩定化**（提升 CDN 快取命中）：不要用「今天減 3 年」（每天變、天天 cache miss），改「**當月 1 號**減 3 年」——同月內 URL 完全相同。PER 用「當月 1 號減 2 個月」（只取最新一筆）。Dividend 固定 `'2019-01-01'`（同 py 版）。

**前端雙層快取**：模組層 `Map<string, TwFundamentals>`（切頁往返不重抓）＋ sessionStorage key `tw_fund_<id>_<台北今日日期>`（F5 不重抓、跨日自動失效）。`force` 時兩層都清。

### 後端改動

`api/_lib/finmind.ts`：`ALLOWED_DATASETS` 擴充成 9 個（上表 FinMindDataset 全列）；新增 `cacheSecondsForDataset(dataset)`：

| dataset | s-maxage | 理由 |
|---|---|---|
| FinancialStatements / BalanceSheet / CashFlowsStatement / Dividend | **259200（3 天）** | 季更/年度公告；換 FinMind 命中率大降 |
| PER / MonthRevenue | `secondsUntilTaipeiMidnight()` | 每交易日更新／每月 10 日前後公布 |
| 既有 3 個 | `secondsUntilTaipeiMidnight()` | 維持現狀不動 |

`api/finmind.ts`：Cache-Control 改 `` `public, s-maxage=${cacheSecondsForDataset(dataset)}, stale-while-revalidate=60` ``。其餘全不動——guard、限流、錯誤分類、`FINMIND_TOKEN` 附掛在白名單擴充後自動生效；`TAIWAN_DATA_ID_PATTERN`（3-6 碼）天然涵蓋上櫃。

### App.tsx 接線

- `App.tsx:21`：`type AppView = 'dashboard' | 'portfolio' | 'fundamentals';`
- 渲染分支（:305 附近）：`{currentView === 'fundamentals' && <FundamentalsPanel initialSymbol={...} />}`——若 dashboard 正在看台股，把代碼（strip `.TW/.TWO`）帶進去，預設 `'2330'`；面板內部自管 state。

## 三、AI 解讀設計

### gemini.ts 新函式

```ts
const formatFundamentalsData = (fund: TwFundamentals): string => { ... }

export const analyzeFundamentals = async (fund: TwFundamentals): Promise<string> =>
  callGeminiApi({
    prompt: formatFundamentalsData(fund),
    systemInstruction: FUNDAMENTALS_SYSTEM_INSTRUCTION,
    mode: 'fast',
    temperature: 0.3,
    thinkingConfig: { thinkingBudget: 8192 },
  }, '無法生成基本面解讀。');
```

比照 `analyzePortfolioHealth`（gemini.ts:851）＋`formatHealthCheckData`（:740）的 pattern。v1 只用 fast 模式（結構化數據總結，fast＋thinkingBudget 足夠），不做模式選擇 Modal。

### Prompt 要點

`formatFundamentalsData` 輸出純文字表格（比照 `formatHealthCheckData` 風格）：股名/代碼/產業/資料日期、估值三數、近 8 季表（季別/營收億/三率/EPS）、近 13 月營收＋YoY、資產負債摘要（含負債比）、現金流摘要（**明確標註為年度累計**）＋FCF、近 5 期股利。null 一律 `N/A`。

systemInstruction：
- 角色：台股基本面研究助理，服務「只做多、中長線的個人投資者」，繁體中文。
- 固定六段輸出（配合 MarkdownReport 的 h3 渲染）：`### 一、體質總評`（2-3 句定調）→ `### 二、成長動能` → `### 三、獲利能力與品質`（含淨利 vs 營業現金流是否背離）→ `### 四、財務安全`（金融股註明負債比天然高、不套一般標準）→ `### 五、估值與股利`（PER/PBR/殖利率放在成長性脈絡下評「偏貴/合理/偏低」，須說明推理）→ `### 六、風險與觀察清單`（3-5 點，含下次該盯的數字）。
- 指令性建議拿捏：**允許**「估值偏貴/合理/偏低」「基本面轉強/轉弱」等資訊性判斷；**禁止**目標價、具體買賣點、部位建議（那是技術面分頁的職責，且本頁資料不含 K 線）。結尾固定「以上為資料解讀，非投資建議」。
- 資料紀律：只根據 prompt 數據；缺漏欄位明說「資料未提供」不臆測；粗體只下在真正的結論詞（MarkdownReport 會對多空關鍵字自動著色）。

### UI 觸發

股利表之下：資料載入成功前按鈕隱藏；未生成時虛線佔位框＋置中 `Button variant="ai"`「AI 基本面解讀」；點擊 → loading → 結果存以 stockId 為 key 的 Map state（切股票不污染、切回免重生成）→ `<AnalysisResult content={...} loading={...} title="AI 基本面解讀報告" />`。錯誤：佔位框顯示錯誤字＋重試。換股票時清空當前顯示（快取保留）。

## 四、抓取策略

- **`Promise.allSettled` 平行打滿 7 個請求**：走自家 Vercel 代理，Edge cache 命中根本不打 FinMind；免 token 限流是小時級配額，7 筆遠低於閾值；分批只會拉長首屏。
- **429 退避**：allSettled 後對 RATE_LIMITED 的失敗項等 2 秒**只重試那幾個**一次；再失敗進降級。不做指數退避。
- **降級**：每 dataset 失敗寫進 `warnings`、對應欄位 null/[]；各區塊元件對 null/空顯示灰字「本區資料暫時無法取得」。**整頁失敗判準**沿用 py 版：incomeQuarters＋balanceSheet＋valuation 全空 → `Banner variant="error"`＋重試鈕（`force:true`）。部分成功但有 warnings → 頁頂 `Banner variant="warning"` 列缺的區塊＋重試鈕。
- AI 請求與資料抓取完全解耦：AI 只吃已在手的 `TwFundamentals`，不觸發 FinMind 請求。

## 五、任務拆解（每 Step 一個 commit）

**Step 1 — 後端白名單與快取**（`api/_lib/finmind.ts`、`api/finmind.ts`）
驗證：tsc；起 `vercel dev`（3001），DevTools console 帶 proxyHeaders 打 `/api/finmind?dataset=TaiwanStockPER&data_id=2330&start_date=2026-06-01` → 200＋data 非空＋Cache-Control 正確；打白名單外 dataset 仍 400。

**Step 2 — 型別與資料服務**（`types.ts`、新 `services/finmind.ts`、`services/yahoo.ts` 搬遷）
先跑 `python .claude/skills/_shared/fetch_fundamentals.py 2330` 與 `2882` 留存 JSON 當黃金樣本。驗證：tsc（實測比對放 Step 3）。

**Step 3 — 導覽接線＋面板骨架**（`App.tsx`、`Sidebar.tsx`、`FundamentalsPanel.tsx`、`ValuationHeader.tsx`）
驗證：tsc；實跑搜 2330，估值三數對黃金樣本；搜 AAPL 顯示「僅支援台股」；**dashboard 回歸**：K 線與法人買賣超照常（yahoo.ts 搬遷零行為改動的證明）。

**Step 4 — 三張趨勢圖**（`MonthlyRevenueChart.tsx`、`QuarterlyTrendCharts.tsx`）
驗證：tsc；2330 實跑：YoY 正紅負綠、三率量級合理（毛利率 ~55-60%）、tooltip 標「億元 / %」。

**Step 5 — 體質、現金流、股利＋降級 UI**（`FinancialHealthCards.tsx`、`DividendTable.tsx`、warnings Banner）
驗證：tsc；2330 核對 FCF＝OCF＋capex；**2882**：null 欄顯示「—」不崩、負債比 >90% 正常；**0050**（ETF 無財報）走整頁友善失敗不白屏。

**Step 6 — AI 解讀**（`services/gemini.ts`、`AnalysisResult.tsx` 加 title、Panel 接按鈕）
驗證：tsc；2330 生成：六段結構、繁中、無目標價/買賣指令、結尾免責句；dashboard 的 AnalysisResult 舊用法不變；模擬失敗時錯誤態＋重試可用。

**Step 7 — 收尾**（上櫃驗證、快取行為、頁尾、樣式對齊、文件）
驗證：tsc；**6488**（上櫃）全區塊正常；切 portfolio 再切回不發新請求、F5 後 sessionStorage 命中（Network 面板佐證）；窄視窗圖表不溢出。文件收尾：舊 `.planning/design/fundamentals-tab-PLAN.md` 標註已被本計畫取代、`.planning/todos/pending/2026-07-08-add-tw-stock-fundamentals-tab.md` 移到 done。

## 六、風險清單

| 風險 | 對策 |
|---|---|
| 金融股（2882）缺毛利/存貨等欄 | 候選碼照抄 py 版（已實測 2882）；UI null 顯示「—」；AI prompt 註明金融股負債比不套一般標準 |
| ETF/特殊代碼無財報 | py 版整頁失敗判準 → 友善錯誤訊息，不白屏 |
| 上櫃股 | 後端 pattern 已容許 3-6 碼；前端統一 strip `.TW/.TWO`；6488 實測 |
| FinMind 限流 429 | CDN 長快取＋start_date 月初量化＋前端雙層快取＋單次退避重試＋部分渲染降級；後端 RATE_LIMITED 繁中訊息直接透傳 |
| pivot 移植錯誤 | 黃金樣本逐數字比對；特別留意 FCF=OCF**+**capex（capex 為負）與股利兩欄加總 |
| 現金流 YTD 被誤讀為單季 | 不畫現金流趨勢圖；StatCard 標籤「(年度累計至 {date})」；AI prompt 同步註明 |
| yahoo.ts 搬遷回歸 | 只搬一個函式與型別、行為零改動；Step 3 驗證 K 線/籌碼照常 |
| 淨利候選碼命中錯欄 | 保持 py 版候選順序；淨利率量級異常（>100% 或深負）時人工核對 |
| MarkdownReport 關鍵字著色誤染 | prompt 要求粗體只下結論詞；目視檢查，可接受小瑕疵不擋收尾 |

## 七、整體驗證（全部完成後）

1. `npx tsc --noEmit` 零錯誤；`npm run build` 後 `grep -r "AIza" dist/` 無結果（金鑰紅線，用 Bash 工具跑）。
2. 黃金樣本比對：2330／2882 的前端數字對 `fetch_fundamentals.py` 輸出。
3. 實跑矩陣（vercel dev 3001 單埠即完整 App，或照 start-dev skill）：2330 全亮、2882 降級正常、6488 上櫃全通、0050 友善失敗。
4. AI：2330 與 2882 各生成一次，檢查六段/繁中/金融股標準/免責句。
5. 回歸：dashboard 技術分析（K 線/法人/AI 進場分析）與 portfolio 健檢全程不受影響。
