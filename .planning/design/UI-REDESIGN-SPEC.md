# UI/UX 大翻新設計規格（UI-REDESIGN-SPEC）

> 2026-07-06 由 Fable 5 規劃。品味定調（使用者拍板）：**專業盤面風精修｜TradingView 為參考座標｜
> 範圍＝視覺＋佈局＋資訊架構（功能邏輯不動）｜桌機優先，手機可用即可**。
> 本檔是設計權威；執行拆成 A/B/C 三個 GSD phase（見末節），交 Codex 前各自細化成 PLAN.md。
> 盤點依據：2026-07-06 UI inventory（本檔引用的 檔案:行號 皆出自該盤點，動手前仍要開檔確認）。

## 0. 目標與非目標

**目標**：把「工程師拼裝感」升級成「成熟看盤工具感」——統一設計語言、理清資訊層級、
把設定收到該在的地方、補齊 loading/錯誤/空狀態，讓每天打開它的人覺得可信、順手。

**非目標（出現即範圍膨脹）**：
- 不動任何功能邏輯、資料流、型別（`runEntryFilter`、`getStockData`、AI 呼叫全部照舊）
- 不做淺色主題（token 化後未來可加，本次不做）
- 不改 `StockChart.tsx` 的 X 軸/Bar 結構與拖曳縮放邏輯（盤點列為高風險區，只動顏色與容器）
- 不引入 UI 元件庫/動畫庫（避免 importmap 雙處維護的雷；自寫小元件就夠）
- 不做行動版專屬視圖（表格維持 overflow-x 橫滑；只確保不壞）

## 1. 設計 Token（Phase A 的核心交付）

**落地方式**：Tailwind Play CDN 支援行內設定——在 `index.html` 的 CDN `<script>` 之後加：
```html
<script>
tailwind.config = {
  theme: { extend: {
    colors: {
      surface: { DEFAULT:'#0f172a', card:'#1e293b', inset:'#0b1220', line:'#334155' },
      accent:  { DEFAULT:'#3b82f6', hover:'#2563eb' },      // 唯一主行動色（藍）
      ai:      { DEFAULT:'#8b5cf6' },                        // AI 專屬紫（僅 AI 按鈕/徽章）
      up:      { DEFAULT:'#f0405a', muted:'#f0405a26' },     // 台股慣例：紅=漲
      down:    { DEFAULT:'#22c55e', muted:'#22c55e26' },     // 綠=跌
      warn:    { DEFAULT:'#f59e0b' },                        // 唯一警示色（琥珀）
    },
    fontFamily: {
      sans: ['Inter','Noto Sans TC','sans-serif'],
      mono: ['JetBrains Mono','ui-monospace','monospace'],   // 數字/代號一律用它
    },
    borderRadius: { ctl:'0.5rem', card:'0.75rem', modal:'1rem' },
  } }
}
</script>
```
並在 Google Fonts 加載 `JetBrains Mono`（`index.html:8` 同一行擴充）。

**Token 使用規則（弱模型照做判準）**：
- 背景只准三層：頁面 `surface`、卡片 `surface-card`、卡內嵌塊 `surface-inset`；邊框一律 `surface-line`。
- **漲跌只准用 `up`/`down`**（台股慣例紅漲綠跌，美股標的也統一此慣例——一致性优先；
  未來要切美式只改 config 兩個 hex）。禁止再直接寫 emerald/red-400 表達漲跌。
- 警示/危險一律 `warn`（收斂現況 red/amber/rose 三色混用，盤點第 2 節）。
- 圓角只准三檔：控制項 `rounded-ctl`、卡片 `rounded-card`、modal `rounded-modal`（收斂 lg/xl/2xl 混用）。
- **陰影全撤**：TradingView 式平面感，層次靠邊框與底色深淺；彩色陰影（shadow-blue-600/20 等）全刪。
- 所有數字（價格、漲跌、量、EPS）：`font-mono` + CSS `font-variant-numeric: tabular-nums`（等寬數字不跳動）。

## 2. 共用元件（Phase A 交付，新檔 `components/ui/`）

盤點指出四種 loading、三份重複 Markdown renderer、emoji 與 lucide 混用——收斂成 7 個小元件：

| 元件 | 規格 | 取代現況 |
|---|---|---|
| `Card` | `bg-surface-card border border-surface-line rounded-card`；props: `title?`, `actions?` | 全站手拼卡片 |
| `Button` | variants: `primary`(accent)/`ai`(ai色)/`ghost`/`danger`(warn)；sizes: sm/md；一律含 focus ring | 各處自拼按鈕 |
| `Badge` | variants: `up`/`down`/`warn`/`neutral`/`ai`；**取代所有 emoji 狀態碼**（🟢🔴✅❌➖等，盤點 §2） | Portfolio emoji |
| `StatCard` | 上小字 label、下大 `font-mono` 數字、可選漲跌色 | 資訊卡列、庫存摘要 |
| `Skeleton` | 統一脈動骨架（卡片形/文字行形） | 四種 loading（盤點 §3.1） |
| `Banner` | variants: `error`/`info`；**必含 dismiss ×，可選 retry 按鈕** | App.tsx:300 不可關錯誤條 |
| `MarkdownReport` | 統一 ReactMarkdown renderer（h2/h3/strong/table 樣式＋關鍵字判色集中一處） | 三份重複（AnalysisResult + Portfolio 兩 modal） |

另：`App.tsx:405-416` 自製 BotIcon 刪除，統一用 lucide `Bot`。

## 3. 資訊架構重排（Phase B 核心）

### 3.1 側欄瘦身（Sidebar.tsx 大改）
**現況問題**：6 條 MA 設定＋6 指標開關佔滿側欄（盤點 §1），但這些是「圖表設定」不是「導覽」。
**新側欄（由上而下）**：Logo → 導覽（市場分析｜我的庫存｜**基本面**〔預留，disabled+「即將推出」tooltip，
接 `.planning/design/fundamentals-tab-PLAN.md`〕）→ `mt-auto` 底部狀態徽章。寬度可縮至 `w-56`。
**時間週期／還原權值／指標顯示 → 全部搬到圖表工具列（3.2）**。

### 3.2 圖表工具列（新，StockChart 容器上方）
一條 `h-10` 工具列，TradingView 式：
- 左：週期切換（15分/1時/日/週/月）— segmented control（現側欄 3 欄 grid 改水平一排）
- 中：還原權值 toggle（小型，含現有說明文字改為 tooltip）
- 右：「指標」按鈕 → **popover 面板**（內含現有 6 條 MA 自訂列＋6 個指標 toggle，
  MA 的 color input 熱區從 w-4 放大到 w-6 h-6，盤點 §3 可及性）
popover 為新互動元件：點外關閉、Esc 關閉。**面板內容沿用現有 state/handler，只搬家不改邏輯。**

### 3.3 報價頭（Quote Header，取代現有資訊卡列）
現況 `App.tsx:307-377` 一行 flex-wrap 塞 7 樣東西無主次。改為兩層：
- 主層：`2330 台積電`（大）＋ 現價（`text-3xl font-mono`）＋ 漲跌與 %（`up`/`down` 色徽章）
- 次層：成交量、預估量（小字 StatCard 行內版）；右側動作區：更新（ghost）＋ **AI 分析（primary，全頁唯一主 CTA）**

### 3.4 分析結果雙欄（xl 以上）
現況檢核卡與 AI 報告垂直堆疊，看完要滾很久。改：`xl:grid-cols-12` — EntryChecklist 佔 5、
AnalysisResult 佔 7，並排對照（「規則怎麼判」vs「AI 怎麼說」）；xl 以下維持堆疊。

### 3.5 Dashboard 空狀態（新）
首次載入（無資料未搜尋）不再整頁空白（盤點 §3.3）：置中引導卡 — icon＋「搜尋一檔台股或美股開始分析」＋
3 顆熱門代號 chip（2330/0050/AAPL，點了直接觸發搜尋）。

### 3.6 AI 分析 modal 減負
現況一個 modal 混三件事且 disabled 無提示（盤點 §3.8）。改為兩段式同 modal：
①模式選擇（fast/thinking 兩張可選卡）②持股狀態（空手/持有 segmented；選「持有」才展開成本價欄）；
按鈕 disabled 時下方顯示一行灰字原因（「請先選擇持股狀態」）。邏輯與 state 不變，只重排與加提示。

## 4. Portfolio 頁（Phase C 核心）

- 摘要 4 卡 → 統一 `StatCard`（含息切換保留）。
- 兩張 11 欄表格：**桌機維持表格**（資訊密度是特性不是 bug——Bloomberg 教訓），但：
  表頭 sticky、隔行 `surface-inset`、數字欄右對齊＋`font-mono`、健檢欄的字串比對判色改為
  Badge（比對邏輯照舊，僅呈現統一；盤點 §3.9 的脆弱性記入 CONCERNS 不在本次修）。
- 所有 emoji 狀態（🟢🔵🟡🟠🔴✅⚠️❌➖🇹🇼🇺🇸）→ `Badge`/lucide 旗幟改文字標（「台股」「美股」小徽章）。
- 四個 modal 統一 `rounded-modal`＋標題列樣式；AI 結果 modal 用 `MarkdownReport`。
- Modal 通用行為（A 建元件時就做）：Esc 關閉、遮罩點擊關閉、開啟時 focus 移入（盤點 §3 可及性）。

## 5. 圖表視覺（跨 B/C，小心區）

**只改顏色與容器，不碰結構**（盤點 §4 警告 X 軸置中 workaround 與手刻拖曳）：
- K 棒顏色 → `up`/`down` token（紅漲綠跌）；成交量柱同步。
- 格線統一 `surface-line` 40% 透明；crosshair 與 tooltip 底色 `surface-inset`。
- 高度：主圖 `h-[450px]` 桌機不變，加 `max-md:h-[320px]`；副圖同理縮。
- 工具列（3.2）容器化時，圖表卡片本體只包一層 `Card`，內部 JSX 不動。

## 6. 驗收基準（每 phase 的 checkpoint 都要過）

1. `npx tsc --noEmit` 0 錯誤；`npm run build` 成功；`grep AIza dist/`＝0（慣例）。
2. **功能零回歸**：搜尋 2330/AAPL、切換全部週期、AI 分析（進場/複盤/健檢）、庫存增刪改、匯率——行為與翻新前一致。
3. **視覺一致性抽查**：全站 grep 不得再出現 `emerald-`、`rose-`、`shadow-blue`、`shadow-purple`、
   `rounded-2xl`（modal 外）、emoji 狀態碼；漲跌處只有 `up`/`down` token。
4. 錯誤條可關閉且有重試；四種 loading 已統一為 `Skeleton`；Dashboard 空狀態存在。
5. 桌機 1440/1280 與手機 390 寬各截圖一輪，手機無水平爆版（表格區除外，允許橫滑）。

## 7. 執行分期（各自走「Fable 出 PLAN → Codex 執行 → fresh-context 覆核 → 人工驗證」既有流程）

| Phase | 內容 | 風險 | 預估 |
|---|---|---|---|
| **A 設計基座** | §1 token＋字體、§2 七個共用元件＋Modal 通用行為、BotIcon 統一。**不改版面**，元件先建好但可先只在 1-2 處試點替換 | 低 | 小 |
| **B Dashboard 重排** | §3 全部：側欄瘦身、圖表工具列＋popover、報價頭、雙欄結果、空狀態、AI modal 減負、§5 圖表換色 | 中（動到最多人看的頁） | 中大 |
| **C Portfolio＋收尾** | §4 全部、全站一致性掃描（驗收 §6.3）、可及性補強、手機不壞確認 | 中 | 中 |

依賴：B、C 都依賴 A 的 token 與元件；B/C 之間無依賴可先後亦可並行（建議先 B）。
每個 phase 建議在 `.planning/phases/` 開獨立資料夾（05-ui-a / 06-ui-b / 07-ui-c 之類，
編號避開既有 03 FinMind、04 防濫用——那兩個是使用者明言保留、未取消）。

## 8. 未決點（誠實列出）

1. JetBrains Mono 走 Google Fonts 新增一個 `<link>`——不動 importmap，但多一個外部字體請求；
   若使用者反對外部依賴，退回方案是只用系統 `ui-monospace`（效果略差，零依賴）。
2. Tailwind Play CDN 行內 config 的 token 能力我依官方文件判斷可行，但**未在本專案實測**——
   Phase A 第一個任務就是先驗證這件事（10 分鐘可證），若不行退回 CSS variables 方案（`index.css`）。
3. 台股慣例紅漲綠跌套到美股標的：一致性優先的取捨（同一 App 兩套色更亂）；若使用者用了不習慣，
   token 化後可 5 分鐘加「依市場自動切換」邏輯，屬後續小改。
