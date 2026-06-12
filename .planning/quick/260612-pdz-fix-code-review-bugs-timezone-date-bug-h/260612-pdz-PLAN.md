---
phase: quick
plan: 260612-pdz
type: execute
wave: 1
depends_on: []
files_modified:
  - utils/volume.ts
  - utils/entryFilter.ts
  - App.tsx
  - components/Portfolio.tsx
  - services/yahoo.ts
autonomous: true
requirements: [CR-BUG-01, CR-BUG-02, CR-BUG-03, CR-BUG-04, CR-BUG-05, CR-BUG-06, CR-BUG-07]

must_haves:
  truths:
    - "台北凌晨 0–8 點開盤前後，盤中量資訊不再因時區換算錯誤而消失（todayStr 與本地日期一致）"
    - "庫存健檢卡片能正確擷取並顯示 AI 的操作決策（加碼/續抱/減碼/停利/停損），即使輸出含【】包裹"
    - "盤中執行進場分析時，步驟5量價以預估全日量計算攻擊量倍數，並在 details 標注盤中依預估量"
    - "API Key 缺失時錯誤訊息顯示正確變數名 GEMINI_API_KEY"
    - "MACD/指標值為 0 時不再被誤判為 undefined"
    - "interval 切換與重新整理報價時使用已解析的 symbol（info.symbol）而非搜尋框部分輸入"
    - "App.tsx 不再 import 未使用的 analyzeStockWithGemini"
    - "npx vite build 成功通過（無型別/語法錯誤）"
  artifacts:
    - path: "utils/volume.ts"
      provides: "正確的本地日期 todayStr 組法"
      contains: "getFullYear"
    - path: "utils/entryFilter.ts"
      provides: "runEntryFilter 第 4 個可選 volumeProj 參數與盤中攻擊量倍數修正"
      contains: "projectedVolume"
    - path: "components/Portfolio.tsx"
      provides: "容許【】包裹的健檢決策 regex"
    - path: "services/yahoo.ts"
      provides: "指標欄位 ?? 而非 || 的 nullish 填充"
  key_links:
    - from: "App.tsx handleRunAnalysis"
      to: "runEntryFilter"
      via: "傳入 volumeProj 第 4 參數"
      pattern: "runEntryFilter\\(sym, data, weeklyData, volumeProj\\)"
    - from: "utils/entryFilter.ts 步驟5"
      to: "volumeProj.projectedVolume"
      via: "盤中時 volRatio = projectedVolume / yesterdayVolume"
      pattern: "projectedVolume"
---

<objective>
修復程式碼審查發現的 7 個 bug。全部為點狀修正，集中在 5 個既有檔案，不引入新依賴、不改既有 UI 行為。分為 3 個 task（各一個 atomic commit）：盤中量管線（bug 1+3）、App.tsx 雜項（bug 4+6+7）、Portfolio regex + yahoo nullish（bug 2+5）。

Purpose: 消除時區日期誤判、健檢決策抓取失敗、盤中攻擊量偏低、錯誤訊息誤導、0 值被吃、未解析 symbol、死碼等正確性問題，提升分析可信度。
Output: 修正後的 utils/volume.ts、utils/entryFilter.ts、App.tsx、components/Portfolio.tsx、services/yahoo.ts。
</objective>

<execution_context>
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/workflows/execute-plan.md
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

# Code style：2-space 縮排、單引號、中文註解可、TS 非 strict（允許 implicit any）。無測試框架，驗證以 npx vite build 為準。
@CLAUDE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: 盤中量管線修復（bug 1 時區日期 + bug 3 盤中攻擊量用預估全日量）</name>
  <files>utils/volume.ts, utils/entryFilter.ts, App.tsx</files>
  <action>
修復兩個互相關聯的盤中量問題，並把預估全日量接進進場濾網。

(A) utils/volume.ts:22 時區日期錯誤（CR-BUG-01）：
目前 `const todayStr = localTime.toISOString().split('T')[0];` — localTime 已是用 toLocaleString 轉成台北/紐約「掛在本地時鐘」的 Date，但 toISOString() 會再以 UTC 輸出，等於把該本地時間又往回減時區偏移；台北凌晨 0–8 點會變成昨天，導致 isToday 誤判、minutesElapsed 變負、回傳 null、盤中量資訊消失。
修法：改用 localTime 的本地 getter 手動組 YYYY-MM-DD，並補零。將該行替換為以 localTime.getFullYear()、localTime.getMonth()+1、localTime.getDate() 組字串，月與日用 String(...).padStart(2,'0') 補零。不要動 localTime 本身（line 21）或其他邏輯。

(B) utils/entryFilter.ts runEntryFilter 盤中攻擊量（CR-BUG-03）：
1. 在檔頭 import 區（line 3 附近）從 './volume' 匯入 VolumeProjection 型別：`import { VolumeProjection } from './volume';`（type-only import 即可；非 strict 環境直接 import named type 亦可）。
2. runEntryFilter 簽章（line 85-89）新增第 4 個可選參數 `volumeProj?: VolumeProjection | null`。
3. volRatio 計算（line 98）目前為 `prev && prev.volume ? last.volume / prev.volume : 0`。改為：先算原本的 dayVolRatio（收盤量比），再判斷當 `volumeProj && volumeProj.status === 'Intraday' && volumeProj.yesterdayVolume > 0` 時，volRatio 改用 `volumeProj.projectedVolume / volumeProj.yesterdayVolume`，否則維持 dayVolRatio。用一個布林 flag（如 usedIntradayProj）記錄是否採用了盤中預估，供步驟5 details 標注。
4. 步驟5（量價，line 198-200 的 details 陣列）：當 usedIntradayProj 為 true 時，在 details 加入或標注「(盤中依預估量)」字樣（例如把「今量/昨量」那行後綴或新增一行）。其餘步驟5 判斷邏輯（isAttackVol、divergence 等）沿用 volRatio，無需改動條件式本身。

(C) App.tsx 把 volumeProj 傳入濾網（CR-BUG-03 接線）：
runEntryFilter 呼叫處在 App.tsx:144 `const filter = runEntryFilter(sym, data, weeklyData);`。App.tsx:182 已有 `const volumeProj = useMemo(() => estimateVolumeTrend(...), ...)`，在 component 作用域且 handleRunAnalysis 為 component 內函式，呼叫時 closure 取得當前 render 的 volumeProj。將該呼叫改為 `runEntryFilter(sym, data, weeklyData, volumeProj);`。不需改 services/gemini.ts —— analyzeEntryWithGemini 只吃 EntryFilterResult，濾網結果已反映預估量即足夠。
  </action>
  <verify>
    <automated>npx vite build</automated>
  </verify>
  <done>volume.ts todayStr 用本地 getter 補零組成；entryFilter runEntryFilter 接受第 4 參數並於 Intraday 時改用 projectedVolume/yesterdayVolume 算 volRatio、步驟5 details 標注盤中依預估量；App.tsx:144 傳入 volumeProj；npx vite build 通過。</done>
</task>

<task type="auto">
  <name>Task 2: App.tsx 雜項修復（bug 4 錯誤文案 + bug 6 未解析 symbol + bug 7 死碼 import）</name>
  <files>App.tsx</files>
  <action>
三處獨立小修，全在 App.tsx：

(A) bug 7 死碼 import（CR-BUG-07）：App.tsx:9 `import { analyzeStockWithGemini, analyzeEntryWithGemini } from './services/gemini';` 中 analyzeStockWithGemini 未被使用。移除該 named import，保留 analyzeEntryWithGemini，改為 `import { analyzeEntryWithGemini } from './services/gemini';`。不要刪除 services/gemini.ts 內的函式本體。

(B) bug 4 錯誤文案（CR-BUG-04）：App.tsx:155 的字串提示使用者設定 `REACT_APP_GEMINI_API_KEY`，但本專案實際變數為 GEMINI_API_KEY（.env，由 vite.config.ts 注入）。將該訊息中的 REACT_APP_GEMINI_API_KEY 改為 GEMINI_API_KEY。文案其餘可保留。

(C) bug 6 未解析 symbol（CR-BUG-06）：兩處使用原始 symbol state（搜尋框每鍵入一字即 setSymbol，可能是部分中文輸入）：
- App.tsx:117 useEffect 內 `fetchData(symbol, interval);` —— 改為 `fetchData(info?.symbol || symbol, interval);`
- App.tsx:168 handleRefreshQuote 內 `const result = await getStockData(symbol, interval);` —— 改為 `const result = await getStockData(info?.symbol || symbol, interval);`
此與 handleRunAnalysis（line 136 `const sym = info?.symbol || symbol;`）一致。首次 mount 時 info 為 null → fallback 到 symbol='2330'（預設值）正確，行為不變。
注意：useEffect 的依賴陣列為 [interval]，不要在此 task 改動依賴陣列（避免引入不必要的重抓行為變化）。
  </action>
  <verify>
    <automated>npx vite build</automated>
  </verify>
  <done>App.tsx:9 只 import analyzeEntryWithGemini；錯誤訊息顯示 GEMINI_API_KEY；line 117 與 168 改用 info?.symbol || symbol；npx vite build 通過。</done>
</task>

<task type="auto">
  <name>Task 3: Portfolio 健檢 regex（bug 2）＋ yahoo 指標 nullish（bug 5）</name>
  <files>components/Portfolio.tsx, services/yahoo.ts</files>
  <action>
兩個獨立檔案的點狀修正：

(A) bug 2 健檢決策 regex（CR-BUG-02）：components/Portfolio.tsx:782 現為
`const decisionMatch = result.match(/操作決策[：:]\s*(🟢\s*加碼|🔵\s*續抱|🟡\s*減碼|🟠\s*停利|🔴\s*停損)/);`
AI 實際輸出格式為 `**操作決策：【 🟢加碼 】**`（冒號後有【），現 regex 抓不到。
修法：在冒號與表情符號之間允許可選的【或[ 與空白。將 regex 改為允許 `[【\[]?\s*` 介於 `[：:]\s*` 與群組之間，例如：
`/操作決策[：:]\s*[【\[]?\s*(🟢\s*加碼|🔵\s*續抱|🟡\s*減碼|🟠\s*停利|🔴\s*停損)/`
擷取到的 decisionMatch[1] 可能含空白（如 `🟢 加碼`）。line 783 設定 decision 後，在顯示前移除空白：將 `const decision = decisionMatch ? decisionMatch[1] : '分析完成';` 改為對 matched group 做 `.replace(/\s+/g, '')`（例如 `decisionMatch ? decisionMatch[1].replace(/\s+/g, '') : '分析完成'`），確保顯示為「🟢加碼」。

(B) bug 5 yahoo 指標 nullish（CR-BUG-05）：services/yahoo.ts:759-781 的指標映射使用 `|| undefined`，當指標真值為 0（MACD/macdHist 可合法為 0）時被誤吃成 undefined。calculateSMA/RSI/MACD 對不足資料回傳 null 填充，故 `?? undefined` 行為正確（只把 null/undefined 轉 undefined，保留 0）。
修法：將以下這批欄位的 `|| undefined` 全部改為 `?? undefined`（line 759-781 範圍內）：ma5、ma10、ma20、ma60、rsi、macd、macdSignal、macdHist、ma5Adj、ma10Adj、ma20Adj、ma60Adj、rsiAdj、macdAdj、macdSignalAdj、macdHistAdj。
不要動：line 771-773 的 k/d/j（已直接賦值，無 || ）；line 782-787 的 bb 系列（已是 ??）；ma*Dir getter；priceChange/priceChangePercent。
  </action>
  <verify>
    <automated>npx vite build</automated>
  </verify>
  <done>Portfolio.tsx regex 容許【/[ 包裹且 decision 去除空白後顯示；yahoo.ts line 759-781 該批指標欄位改為 ?? undefined（0 值保留）；k/d/j 與 bb 系列未被誤改；npx vite build 通過。</done>
</task>

</tasks>

<verification>
- npx vite build 全程無錯誤通過（型別/語法心智檢查的最終守門）。
- 心智檢查 bug 1：台北 02:30 開市前情境下 todayStr 應等於 latest.date（當天），isToday=true，不再回傳 null。
- 心智檢查 bug 3：盤中（status==='Intraday'）時 entryFilter 步驟5 volRatio 採 projectedVolume/yesterdayVolume，details 含「(盤中依預估量)」。
- 心智檢查 bug 5：當 macdLine[i]===0 時 macd 欄位為 0 而非 undefined。
- 既有 UI 行為不變（不新增/移除元件、不改圖表與提示詞）。
</verification>

<success_criteria>
- 7 個 bug 全部依審查指定修法修正，分屬 3 個 task（3 個 atomic commit）。
- 無新增依賴、無新增檔案、無測試框架引入。
- 程式風格符合既有慣例（2-space、單引號、中文註解可）。
- npx vite build 通過。
</success_criteria>

<output>
Create `.planning/quick/260612-pdz-fix-code-review-bugs-timezone-date-bug-h/260612-pdz-SUMMARY.md` when done.
</output>
