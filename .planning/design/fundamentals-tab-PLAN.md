# 設計與實作計畫：台股「基本面」分頁

> 2026-07-04 撰寫。狀態：**規劃中，尚未開工**（使用者選「先只做規劃不寫碼」）。
> 這是給人審閱的計畫，不是程式碼。核准後可走 GSD 執行（`/gsd:plan-phase` → `/gsd:execute-phase`）。

## 1. 目標與範圍

把 `tw-fundamentals` skill 目前只在對話裡看得到的台股基本面資料，變成 App 內一個
**「基本面」分頁**：搜尋一檔台股 → 這一頁用卡片＋圖表顯示估值、獲利趨勢、月營收、股利。

**本階段做（In scope）**
- 新增第三個分頁 `fundamentals`，與現有 `dashboard`／`portfolio` 並列。
- 純前端 + FinMind 直呼（沿用 App 既有的瀏覽器→FinMind 模式），**不需後端、不花 API 錢**。
- 資料：估值(PER/PBR/殖利率)、近 8 季損益三率、月營收 YoY、股利。

**本階段不做（Out of scope，另立階段）**
- ❌ AI 生成的解讀／DCF／財報報告 → 需 LLM，綁在「金鑰搬 Vercel 後端」里程碑一起做。
- ❌ 美股基本面（美股走 SEC，非本頁重點；本頁 TW-only）。
- ❌ financial-services 那 19 個 skill 逐一做按鈕（見主對話評估：大半對散戶無用或需付費源）。

## 2. 為什麼不需要後端

`services/yahoo.ts` 與 `stockDirectory.ts` 已在瀏覽器端直接呼叫 FinMind 公開 API 且可用（CORS 通）。
基本面資料同樣是 FinMind 免 token dataset，因此可**完全比照現有模式**在前端抓取，零後端、零金鑰。
（金鑰紅線只約束 Gemini，不影響 FinMind。）

## 3. 架構落點（對齊現有慣例）

| 動作 | 檔案 | 說明 |
|---|---|---|
| 型別加一個值 | `App.tsx:15`、`components/Sidebar.tsx:5` | `AppView = 'dashboard' \| 'portfolio' \| 'fundamentals'` |
| 導覽加第三顆 | `components/Sidebar.tsx`(~114–130) | 仿現有兩顆 nav 按鈕，加「基本面」 |
| 分頁渲染分支 | `App.tsx`(~286–295) | 加 `{currentView === 'fundamentals' && <FundamentalsPanel .../>}` |
| **新資料服務** | `services/finmind.ts`（新） | 把 `_shared/fetch_fundamentals.py` 的邏輯移植成 TS：抓 6 個 FinMind dataset、pivot、算三率與 YoY，回傳 `TwFundamentals` |
| **新畫面元件** | `components/FundamentalsPanel.tsx`（新） | 卡片＋圖表；`React.FC<Props>`＋default export（比照現有元件） |
| 新型別 | `types.ts` | `TwFundamentals`、`QuarterIncome`、`MonthlyRevenue`、`DividendRecord` |
| 圖表 | 沿用 `recharts` | 已是專案依賴，免加套件 |

**依賴維護提醒**：本階段不新增 npm 套件（recharts/lucide 已有），故**不用動 `index.html` 的 importmap**。

## 4. 資料流

```
使用者在基本面分頁搜尋 2330
  → FundamentalsPanel 呼叫 services/finmind.ts::getFundamentals('2330')
  → finmind.ts 平行抓 6 個 dataset(FinancialStatements/BalanceSheet/CashFlows/PER/MonthRevenue/Dividend)
  → 正規化成 TwFundamentals(金額轉億元、算三率、算月營收 YoY)
  → 回傳給 FundamentalsPanel → 渲染卡片與圖表
失敗(限流 429)→ 顯示「資料暫時無法取得，稍後再試」+ 重試鈕(比照現有 Yahoo 429 處理)
```

移植邏輯已有可信參考：`.claude/skills/_shared/fetch_fundamentals.py`（已對 2330 一般股、2882 金融股實測通過），
TS 版直接照它的 dataset 名、type 候選碼、單位換算搬過來即可，**不用重新研究欄位**。

## 5. UI 版面（初版）

分頁上方沿用現有 StockSearch。下方由上到下：
1. **標題列**：股名＋代碼＋產業＋資料日期(as_of)。
2. **估值卡片列**（3 張小卡）：PER、PBR、現金殖利率。
3. **獲利趨勢圖**（recharts 折線/組合圖）：近 8 季 EPS + 毛利率/淨利率雙軸。
4. **月營收圖**（長條）：近 13 月營收，標 YoY%。
5. **財務體質卡**：負債比、自由現金流、現金部位。
6. **股利表**：近 5 期現金/股票股利與除息日。
7. **頁尾**：資料來源 FinMind ＋「本頁為資料呈現，非投資建議」。

深色主題、Tailwind utility class、lucide 圖示——全部比照現有 dashboard 風格。

## 6. 任務拆解（原子提交，適合 GSD 執行）

1. `types.ts` 加 `TwFundamentals` 等型別（純型別，先立契約）。
2. `services/finmind.ts`：移植 fetch_fundamentals 邏輯 + 一個 `getFundamentals()`。先寫死跑 2330 驗證 JSON 正確。
3. `AppView` 加 `'fundamentals'`＋Sidebar 第三顆導覽鈕（先只切換空白頁，確認導覽通）。
4. `FundamentalsPanel.tsx`：先渲染估值卡＋標題（最小可見）。
5. 加獲利趨勢圖與月營收圖（recharts）。
6. 加財務體質卡與股利表。
7. 429/錯誤狀態與載入中 skeleton。
8. 收尾：金融股(2882)顯示不崩、樣式對齊。

## 7. 驗證計畫（每步）

- 每步改 `.ts/.tsx` 後 `npx tsc --noEmit` 通過。
- 用 preview 工具實跑：搜 **2330**（一般股）與 **2882**（金融股，部分欄位 null 要不崩）各一次。
- 對照 skill 抓的數字（PER 32.87、Q1'26 EPS 22.08…）確認前端顯示一致。
- 完成畫面截圖給使用者看。

## 8. 風險與對策

| 風險 | 對策 |
|---|---|
| FinMind 限流(429) | 比照現有 Yahoo 429：顯示重試、不硬改碼；可加輕量快取(localStorage，比照 tw_stock_directory 快取) |
| 金融/控股股欄位不同 → 部分 null | finmind.ts 沿用 py 版候選碼清單；UI 對 null 顯示「—」不崩（py 版已驗證 2882 可用） |
| 移植 py→ts 出錯 | 用 skill 已驗證的 2330/2882 數字當「黃金樣本」比對 |
| 未來要接後端 | 本頁抓取邏輯集中在 `services/finmind.ts`，日後要改由後端代理只需換這一層 |

## 9. 工作量與後續

- 估：中等（1 個服務 + 1 個主元件 + 導覽接線；無新依賴、無後端）。
- 核准後路徑：`/gsd:plan-phase`（把本文件細化成 PLAN.md）→ `/gsd:execute-phase`。
- **AI 解讀模式**（DCF/財報 AI 報告）獨立成後續階段，與 Vercel 後端金鑰里程碑一起做。
