---
phase: 06-ui-dashboard
plan: 01
type: execute
wave: 1
depends_on: [05-ui-foundation]
files_modified:
  - components/ChartToolbar.tsx
  - components/QuoteHeader.tsx
  - components/Sidebar.tsx
  - components/StockChart.tsx
  - App.tsx
autonomous: false
requirements: [UI-B]
design_authority: .planning/design/UI-REDESIGN-SPEC.md §3 §5

must_haves:
  truths:
    - "側欄只剩：Logo、三個導覽項（市場分析／我的庫存／基本面-預留disabled）、底部狀態徽章"
    - "時間週期／還原權值／指標設定全部搬到圖表上方工具列，功能行為與搬家前一致（state 仍在 App）"
    - "報價頭取代舊資訊卡列：股名代號＋大字現價＋紅漲綠跌徽章＋量能小字＋右側 更新/AI分析"
    - "xl 寬度下 EntryChecklist 與 AnalysisResult 並排（5:7），窄螢幕維持堆疊"
    - "首載空狀態存在：引導文案＋2330/0050/AAPL 三顆熱門 chip 可點擊觸發搜尋"
    - "K 棒與成交量柱改用 token 色（紅漲 #f0405a／綠跌 #22c55e）；圖表拖曳/縮放/軸線行為零變化"
    - "AI 參數 modal 改用 ui/Modal，兩段式排版＋disabled 原因提示；分析邏輯與 state 零變化"
  artifacts:
    - path: "components/ChartToolbar.tsx"
      provides: "圖表工具列：週期 segmented、還原權值 toggle、指標 popover（含 MA 設定與指標開關）"
      exports: ["default"]
    - path: "components/QuoteHeader.tsx"
      provides: "報價頭：股名/現價/漲跌徽章/量能/動作按鈕"
      exports: ["default"]
  key_links:
    - from: "App.tsx"
      to: "components/ChartToolbar.tsx"
      via: "interval/settings state 下傳（state 所有權不變）"
      pattern: "from ['\"]\\./components/ChartToolbar['\"]"
    - from: "App.tsx"
      to: "components/QuoteHeader.tsx"
      via: "info/price/量能/handler 下傳"
      pattern: "from ['\"]\\./components/QuoteHeader['\"]"
---

<objective>
UI 翻新第二期：Dashboard 資訊架構重排。把「圖表的設定」從側欄搬到圖表工具列（TradingView 式）、
建立有主次的報價頭、檢核與 AI 報告雙欄並排、補首載空狀態、AI modal 減負、K 棒換台股慣例紅漲綠跌。
**功能邏輯與 state 所有權零變化——這是純 UI 佈局工程，所有既有 useState/handler 留在 App.tsx 原地。**

Purpose: Phase A 立了規矩（token＋八元件），本期拿這套規矩把最常用的頁面排對。
Output: 新元件 ChartToolbar、QuoteHeader；瘦身後的 Sidebar；重排後的 App.tsx dashboard 區；換色後的 StockChart。
</objective>

<context_for_cold_start_executor>
## 給冷啟動執行者的前提（無對話背景，先讀完本節）

**專案路徑 `E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4`（E 槽，路徑含空格必加引號）。分支 `gsd/phase-ui-b`。**

### 鐵則（前三個 phase 的執行經驗，違反即翻車）
1. **state 所有權不變**：`interval`、`settings`(IndicatorSettings)、`analysisMode`、`hasHolding`、`costPrice`
   等 useState 全部留在 `App.tsx` 原地。本期只是把「渲染這些控制項的 JSX」搬家＋下傳 props，
   **不建新 context、不搬 state、不改 handler 簽章**。
2. **新 UI 一律用 Phase A 的 token 與元件**（`components/ui/` 的 Card/Button/Badge/StatCard/Skeleton/
   Banner/Modal）。禁止在新寫的 JSX 裡出現 `emerald-`、`rose-`、彩色陰影、`rounded-2xl`
   （既有未搬動的程式碼除外——本期不做全站色彩清洗，那是 Phase C）。
3. **StockChart.tsx 是雷區**：只准做兩類改動——(a) K 棒/成交量柱的**顏色 hex 替換**
   (b) 圖表容器**高度 className** 加響應式。拖曳縮放邏輯（約 L671-736）、recharts hooks
   （約 L267-301）、雙 X 軸置中 workaround、任何軸線/Bar 結構——**一行都不准動**。
4. 禁止安裝任何 npm 套件；不動 `api/`、`components/Portfolio.tsx`、`components/EntryChecklist.tsx`、
   `components/AnalysisResult.tsx`（後兩者只被 App 重新「擺位」，檔案本身不開不改）。
5. 驗證命令：Git Bash 用 `npx tsc --noEmit`／`grep`；PowerShell 用 `npx.cmd`／`Select-String`。
   一任務一 atomic commit，只動該任務 <files>，絕不 `git add -A`（工作區有未追蹤 .agents/.codex）。
6. **（Phase A 新教訓）合併/切分支前先關 dev 伺服器**：Vite/vercel dev 的檔案監看會鎖住資料夾
   （EPERM: scandir），git 操作會失敗。執行期間開著沒關係，git 大動作前收乾淨。

### 設計 token 速查（Phase A 已建，直接用）
色：`surface`/`surface-card`/`surface-inset`/`surface-line`、`accent`(藍=唯一主行動色)、
`ai`(紫=AI 專屬)、`up`(#f0405a 紅=漲)/`down`(#22c55e 綠=跌)/`warn`(琥珀)。
圓角：`rounded-ctl`/`rounded-card`/`rounded-modal`。數字：`font-mono tabular-nums`。陰影：不用。

### 既有程式碼事實（行號為規劃時快照，動手前開檔確認）
**`components/Sidebar.tsx`（224 行，Phase A 未動它）**：
- L17-23 `intervals` 常數；L135-157 時間週期區塊；L159-184 還原權值 toggle＋說明文字；
  L186-211 指標顯示區（用到 L57-98 `MALineItem` 與 L40-55 `ToggleItem` 兩個內部元件）——
  **這四段整體搬去 ChartToolbar**（常數與兩個內部元件一起搬走，Sidebar 不再需要）。
- L107-133 導覽兩顆按鈕（保留，另加第三顆「基本面」disabled 項）；L213-218 底部狀態徽章（保留）。
- 搬家後 Sidebar props 收斂為 `{ currentView, setView }`；寬度 `md:w-64` 改 `md:w-56`。
**`App.tsx`（~408 行，Phase A 只動過錯誤條/BotIcon/import）**：
- L51 附近 `analysisMode`、`hasHolding`、`costPrice` state；`fetchData(symbol, interval)` 已存在。
- 約 L186-268 AI 參數 modal（手拼 fixed 遮罩＋rounded-2xl 卡）→ 改用 `ui/Modal` 重排（Task 3）。
- 約 L307-377 資訊卡列（flex-wrap 塞代號/價/量/預估量/更新鈕/AI鈕）→ 整段替換為 `<QuoteHeader …/>`。
- 約 L388-397 檢核與 AI 報告目前上下堆疊 → 包進 xl 雙欄 grid。
- `<Sidebar interval={...} setInterval={...} settings={...} setSettings={...} …/>` 的 props 要同步改
  （interval/settings 相關改傳給 ChartToolbar）。
**`components/StockChart.tsx`（~860 行）**：主圖容器 `h-[450px]` 約 L788、副圖 `h-[180px]`；
K 棒與量柱顏色為 JSX 內聯 hex——先 grep 現值（可能是 emerald/red 系）再替換；
**使用者自訂的 MA 線色（settings.maLines[].color）是使用者資料，不准改**。
recharts 是內聯 hex 不吃 Tailwind class，所以直接寫 token 對應的字面 hex 並加註解
（`// token: up`）。

### 慣例
2 空格、單引號、`React.FC<Props>`＋檔尾 default export、繁中註解、無 barrel。
新元件 props 一律顯式 interface，不用 any。
</context_for_cold_start_executor>

<tasks>

<task type="auto">
  <name>Task 1: ChartToolbar 新元件＋側欄瘦身</name>
  <files>components/ChartToolbar.tsx, components/Sidebar.tsx, App.tsx</files>
  <action>
**1a. 新增 `components/ChartToolbar.tsx`**，props：
```ts
interface ChartToolbarProps {
  interval: TimeInterval;
  setInterval: (i: TimeInterval) => void;
  settings: IndicatorSettings;
  setSettings: (s: IndicatorSettings) => void;
}
```
渲染一條工具列（`flex items-center gap-3 flex-wrap px-3 py-2 border-b border-surface-line`，
它將作為圖表卡的頭部，Task 2 接進 App）：
- **左：週期 segmented control**——把 Sidebar 的 `intervals` 常數搬來，渲染成一排相連按鈕
  （外框 `border border-surface-line rounded-ctl overflow-hidden`，選中項 `bg-accent/15 text-accent
  font-medium`，未選 `text-slate-400 hover:text-slate-200`，`px-3 py-1 text-xs`）。
- **中：還原權值**——小型 toggle（沿用 Sidebar 現有的開關邏輯與樣式精神但縮小），原本那段
  說明文字改為 `title` 屬性 tooltip（「若均線數值與券商/Yahoo 網頁不同，可切換此選項…」）。
- **右：「指標」按鈕＋popover**——ghost 小按鈕（lucide `SlidersHorizontal` icon＋「指標」字樣＋
  chevron）。點擊開 popover：`relative` 容器內 `absolute right-0 top-full mt-2 z-40 w-72
  bg-surface-card border border-surface-line rounded-card p-3 max-h-[60vh] overflow-y-auto`。
  popover 內容＝Sidebar 搬來的 `MALineItem`×6 與 `ToggleItem`×6 兩區（元件程式碼原樣搬移，
  含 handler 邏輯 `toggleSetting`/`updateMALine`——它們操作的是 props 下傳的 settings，行為不變）。
  **MA 色票 input 熱區放大為 `w-6 h-6`**（SPEC §3.2 可及性修正，這是搬家時唯一准許的樣式修改）。
  popover 關閉：點擊外部（`useEffect` 掛 `mousedown` 判斷 `ref.contains`）＋ Esc（`keydown`），
  **兩個監聽都要在 cleanup 移除**。
**1b. `components/Sidebar.tsx` 瘦身**：刪除已搬走的四段（intervals 常數、週期區、還原權值區、
指標區、MALineItem/ToggleItem）；props 收斂為 `{ currentView, setView }`；`md:w-64`→`md:w-56`；
導覽區加第三顆「基本面」：disabled 樣式（`opacity-50 cursor-not-allowed`）＋
`title="即將推出：台股基本面分頁"`＋小字「預留」徽章，不綁任何 onClick。
lucide 建議 `FileBarChart` 或 `Landmark`。
**1c. `App.tsx` 接線**：Sidebar 呼叫處移除 interval/settings 四個 props；ChartToolbar 先 import
（實際擺位在 Task 2 做，本任務可先放在 StockChart 上方原位置，確保功能不中斷）。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && ! grep -q "時間週期" components/Sidebar.tsx && grep -q "MALineItem" components/ChartToolbar.tsx</automated>
  </verify>
  <done>週期/還原權值/指標設定全數在 ChartToolbar 且功能不變；Sidebar 只剩導覽（含基本面預留）＋狀態徽章；tsc 0 錯誤。</done>
</task>

<task type="auto">
  <name>Task 2: QuoteHeader 報價頭＋首載空狀態＋圖表卡容器</name>
  <files>components/QuoteHeader.tsx, App.tsx</files>
  <action>
**2a. 新增 `components/QuoteHeader.tsx`**，props（全部由 App 既有 state/衍生值下傳，不新增計算邏輯）：
```ts
interface QuoteHeaderProps {
  info: StockInfo;                       // 股名/代號
  price: number; changeAbs: number; changePct: number;
  volume: number; volumeProjection?: VolumeProjection | null;
  loading: boolean; analyzing: boolean; hasData: boolean;
  onRefresh: () => void; onAnalyze: () => void;
}
```
版面（`Card` 包裹，`flex items-center justify-between gap-4 flex-wrap`）：
- 左群組：股名＋代號（`text-lg font-medium text-white`）；現價 `text-3xl font-mono tabular-nums`；
  漲跌 `Badge`（`changeAbs>=0 ? 'up' : 'down'`，內容如 `▲ +20.00（+0.82%）`，數字 font-mono；
  **紅漲綠跌由 Badge 的 up/down variant 天然達成**）；量能小字列（成交量＋預估量，slate-400 text-xs）。
- 右群組：`Button variant="ghost"`（RefreshCw icon＋更新，接 onRefresh，loading 時轉圈 disabled）＋
  `Button variant="ai"`（Bot icon＋AI 分析，接 onAnalyze，analyzing/loading/!hasData 時 disabled）。
  ——沿用 App 舊按鈕的 disabled 條件，逐字搬。
**2b. `App.tsx`**：舊資訊卡列（約 L307-377）整段刪除，換 `<QuoteHeader …/>`（傳入處把現有的
漲跌計算沿用——若 App 內原本就有 change 計算就直接傳，沒有就在 App 端用 data 最後兩筆算，
**不要在 QuoteHeader 內算**）。
**2c. 圖表卡容器**：把 `ChartToolbar` 與 `StockChart` 一起包進一張 `Card`（無 padding 版：
`className="p-0 overflow-hidden"`，Toolbar 作為卡頭、圖表在下），形成「工具列＋圖」一體的視覺。
**2d. 首載空狀態**：在 dashboard view，`!info && !loading && data.length === 0` 時渲染置中引導卡
（原本這狀態是整頁空白）：`Card` 內置中 `Search` icon（slate-600 大號）＋標題「搜尋一檔台股或
美股開始分析」＋副文案一句＋三顆 chip（`2330 台積電`/`0050 元大台灣50`/`AAPL Apple`），
chip 用 `Button variant="ghost" size="sm"`，onClick 呼叫**既有的**搜尋/抓取入口
（App 內 `fetchData`／StockSearch 的選股 handler，找到現成的那條路直接用；若兩者皆需 StockInfo
物件，就以最小硬編 `{ symbol, name }` 傳入——比照 StockSearch 選股後的呼叫形狀）。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && grep -q "QuoteHeader" App.tsx && grep -q "開始分析" App.tsx</automated>
  </verify>
  <done>報價頭取代舊資訊列（主次分明、紅漲綠跌徽章）；工具列＋圖表同卡；空狀態含三顆可點 chip；tsc 0 錯誤。</done>
</task>

<task type="auto">
  <name>Task 3: 結果雙欄＋AI modal 減負（ui/Modal 化）</name>
  <files>App.tsx</files>
  <action>
**3a. 雙欄**：檢核與報告區（約 L388-397）外包 `grid grid-cols-1 xl:grid-cols-12 gap-4 items-start`；
`EntryChecklist` 包 `xl:col-span-5`、`AnalysisResult` 包 `xl:col-span-7`。兩個子元件檔案不開不改。
既有的「尚未分析」提示卡照舊放報告欄位置。
**3b. AI 參數 modal**：現有手拼 modal（約 L186-268）改用 `ui/Modal`
（`open={showAnalysisModal} onClose={() => setShowAnalysisModal(false)} title="AI 分析參數設定"`），
內容重排為兩段（**所有 state/handler/disabled 條件逐字沿用，只動排版**）：
- 段1「分析模式」：fast/thinking 兩張可選卡（`grid-cols-2 gap-3`，選中 `border-accent bg-accent/10`
  未選 `border-surface-line`，各含 icon＋名稱＋一句說明——文案沿用既有）。
- 段2「持股狀態」：空手/持有 兩顆 segmented（樣式同 Task 1 週期切換）；選「持有」才展開成本價
  input（既有 input 搬入，含既有 onChange）。
- 底部：`Button variant="ai"` 全寬「開始 AI 智能分析」，disabled 條件逐字沿用；
  **disabled 時按鈕下方顯示一行 `text-xs text-slate-500` 原因提示**：
  `hasHolding === null` →「請先選擇持股狀態」；`hasHolding && !costPrice` →「請輸入持有成本價」。
刪除被取代的舊 modal JSX（含它的 fixed 遮罩、rounded-2xl、gradient 按鈕）。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && grep -q "xl:col-span-7" App.tsx && grep -q "請先選擇持股狀態" App.tsx</automated>
  </verify>
  <done>xl 下 5:7 並排、窄幕堆疊；modal 用 ui/Modal 兩段式＋disabled 原因提示；分析邏輯零變化；tsc 0 錯誤。</done>
</task>

<task type="auto">
  <name>Task 4: 圖表換色（紅漲綠跌 token）＋響應式高度</name>
  <files>components/StockChart.tsx</files>
  <action>
**只做以下兩類，其餘一行不動**（雷區警告見前提鐵則 #3）：
1. **顏色**：grep 找出 K 棒漲/跌與成交量柱漲/跌的內聯 hex（先在 SUMMARY 記錄原值與行號），
   替換為 token 字面值＋註解：漲 `#f0405a`（`// token: up 紅漲`）、跌 `#22c55e`
   （`// token: down 綠跌`）。同一 hex 若也被用在「非漲跌語意」處（如某條固定色的線），
   **不要**跟著換——逐處判斷語意，只換漲跌語意的。若既有格線/crosshair 色一眼可辨
   （如 #334155 系），順手統一為 `#334155`（token surface-line）**僅限顏色值替換**；
   找不到就跳過並在 SUMMARY 註明。**settings.maLines[].color（使用者自訂 MA 色）絕不動。**
2. **高度**：主圖 `h-[450px]` → `h-[450px] max-md:h-[320px]`；副圖 `h-[180px]` →
   `h-[180px] max-md:h-[140px]`（有幾處改幾處）。
改完 `git diff` 自檢：diff 應只含 hex 字串與 height className，出現任何邏輯/結構行即代表越界，回退重做。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && grep -q "f0405a" components/StockChart.tsx && grep -q "max-md:h-\[320px\]" components/StockChart.tsx</automated>
  </verify>
  <done>K 棒/量柱紅漲綠跌；手機高度收斂；diff 僅含色值與高度 class；拖曳縮放與軸線零變化；tsc 0 錯誤。</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: 人工驗證（重排後全功能回歸）</name>
  <what-built>
側欄瘦身（導覽＋基本面預留）、圖表工具列（週期/還原權值/指標 popover）、報價頭、xl 雙欄結果、
首載空狀態（三熱門 chip）、AI modal 兩段式、K 棒紅漲綠跌＋手機高度。功能邏輯零變化。
  </what-built>
  <how-to-verify>
1. `npm run dev` 開 http://localhost:3000（本期純前端；要測 AI 分析才需另開 `npx.cmd vercel dev --listen 3001`）。
2. **空狀態**：首載應見引導卡＋三顆 chip；點「2330 台積電」chip 應直接載入圖表。
3. **工具列**：切換全部 5 個週期圖表跟著換；還原權值 toggle 有效（均線數值變化）；
   「指標」popover 開合正常（點外面關、Esc 關）、勾關 MACD/RSI 副圖即時增減、改一條 MA 天數/顏色即時生效。
4. **報價頭**：現價大字等寬字體；漲時徽章紅、跌時綠（可切 AAPL 對照）；更新鈕轉圈；AI 分析鈕在無資料時 disabled。
5. **雙欄**：視窗拉寬（≥1280）檢核與 AI 報告並排 5:7；縮窄變堆疊。
6. **AI modal**：兩段式；未選持股狀態時按鈕 disabled 且下方有灰字原因；選「持有」出現成本價欄；
   Esc 與點遮罩可關閉；實跑一次分析（需 vercel dev）報告正常。
7. **圖表**：K 棒紅漲綠跌、量柱同步；拖曳平移、+/- 縮放、crosshair 全部照舊；
   瀏覽器縮到手機寬（F12 裝置模擬 390px）圖表高度變矮、頁面無水平爆版。
8. **側欄**：只剩導覽＋狀態；「基本面」灰色不可點、hover 有提示。
9. 我的庫存頁快速開一次：完全不受影響（本期未動 Portfolio）。
  </how-to-verify>
  <resume-signal>輸入 "approved" 或描述問題（哪一項、看到什麼）</resume-signal>
</task>

</tasks>

<review_checklist>
## 給 fresh-context 覆核者的固定清單（Opus/Sonnet 逐條執行，不即興）

1. `npx tsc --noEmit`＝0；`npm run build` 成功；`grep -rn "AIza" dist/`＝0。
2. **範圍**：`git diff main --stat` 只含 5 個計畫檔；Portfolio/EntryChecklist/AnalysisResult/api/ 零 diff。
3. **state 所有權**：`grep -n "useState" components/ChartToolbar.tsx components/QuoteHeader.tsx`——
   ChartToolbar 只准有 popover 開合的本地 UI state（如 `open`）；interval/settings 的 useState
   必須仍在 App.tsx（`git diff main -- App.tsx` 中不得出現這些 useState 被刪除/搬移）。
4. **StockChart 雷區**：`git diff main -- components/StockChart.tsx` 逐行看——只准出現
   hex 色值替換與 height className；任何觸及 L671-736 拖曳邏輯、recharts hooks、軸/Bar 結構的行＝必修退回。
5. **搬家非重寫**：MALineItem/ToggleItem 在 ChartToolbar 中與 main 分支 Sidebar 原版逐字比對
   （`git show main:components/Sidebar.tsx`），除了 color input `w-4 h-4`→`w-6 h-6` 外應一致。
6. **token 紀律**：`grep -nE "emerald-|rose-|shadow-(blue|purple)|rounded-2xl" components/ChartToolbar.tsx
   components/QuoteHeader.tsx`＝0；App.tsx 的 diff 新增行中同樣不得出現（舊 modal 刪除行除外）。
7. **popover/監聽清理**：ChartToolbar 的 mousedown 與 keydown 監聽都有 cleanup return。
8. **disabled 條件逐字沿用**：比對 modal 開始分析鈕與 QuoteHeader AI 鈕的 disabled 表達式
   與 main 版原文一致（語意相同即可，寬鬆比對）。
9. runtime/視覺交給使用者 Task 5；覆核者未實跑瀏覽器就明說。
判定：必修→退 Codex 附行號；同一問題最多退 2 輪，第 3 輪升級回報使用者。
</review_checklist>

<verification>
1. 每任務後 tsc＝0；全部完成後 `npm run build` 成功＋dist 無 AIza（Bash 工具）。
2. Task 5 人工驗證 9 項全過。
3. 合併前：關閉所有 dev 伺服器（node 程序收乾淨）再 merge（Phase A 教訓）。
</verification>

<success_criteria>
- [ ] 側欄=導覽（含基本面預留 disabled）＋狀態；週期/權值/指標全在工具列且功能不變
- [ ] 報價頭主次分明、紅漲綠跌徽章、動作按鈕沿用 disabled 條件
- [ ] xl 雙欄 5:7、窄幕堆疊；首載空狀態＋三 chip 可點
- [ ] AI modal 用 ui/Modal 兩段式＋disabled 原因提示，邏輯零變化
- [ ] K 棒/量柱紅漲綠跌；拖曳縮放軸線零變化；手機高度收斂、無水平爆版
- [ ] tsc 0 錯誤、build 成功、Portfolio 零影響
- [ ] 人工 checkpoint 核可
</success_criteria>

<output>
Create `.planning/phases/06-ui-dashboard/06-01-SUMMARY.md`. 必記錄：
- StockChart 漲跌色的原 hex 值與所在行號（替換前後對照）
- 空狀態 chip 接的是哪條既有入口（fetchData 或 StockSearch handler）
- 任何與計畫的偏差及原因
</output>

## 未決點（誠實列出）
1. StockChart 現行漲跌色的確切 hex 與分佈行號未在規劃期窮舉——Task 4 設計成「先 grep 記錄再替換
   ＋diff 自檢只准色值與高度」來封鎖風險。
2. 空狀態 chip 觸發搜尋的最小資料形狀（StockInfo 需要哪些欄位）依 App 實際呼叫形狀而定，
   已授權執行者比照 StockSearch 選股後的呼叫形狀處理，記入 SUMMARY。
3. 還原權值 toggle 的說明文字改為 title tooltip 後，觸控裝置看不到 tooltip——桌機優先的既定取捨
   （SPEC 裝置決策），可接受。
