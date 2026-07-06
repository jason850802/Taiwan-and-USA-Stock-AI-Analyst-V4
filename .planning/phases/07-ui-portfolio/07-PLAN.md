---
phase: 07-ui-portfolio
plan: 01
type: execute
wave: 1
depends_on: [05-ui-foundation, 06-ui-dashboard]
files_modified:
  - index.html
  - components/ui/Badge.tsx
  - components/Portfolio.tsx
  - components/EntryChecklist.tsx
  - components/AnalysisResult.tsx
  - components/StockChart.tsx
  - components/Sidebar.tsx
  - App.tsx
autonomous: false
requirements: [UI-C]
design_authority: .planning/design/UI-REDESIGN-SPEC.md §4 §6

must_haves:
  truths:
    - "Portfolio 全部資料/編輯/AI 呼叫邏輯零變化（localStorage key、handler、字串比對判斷全部原樣）"
    - "Portfolio 的 emoji 狀態碼（🟢🔵🟡🟠🔴✅⚠️❌➖🇹🇼🇺🇸）在 UI 呈現層全數換成 Badge/文字徽章"
    - "Portfolio 四個 modal 改用 ui/Modal（Esc/遮罩/focus 自動獲得）；兩份重複 Markdown renderer 刪除、改用 ui/MarkdownReport"
    - "報酬與漲跌一律 up(紅漲/正)/down(綠跌/負)；狀態好壞一律 ok/warn/danger 語意 token"
    - "全站 grep 歸零：emerald-/rose-/彩色陰影/gradient-to/modal 外的 rounded-2xl/UI 層 emoji"
    - "圖表 MACD 柱與法人買賣超柱的紅綠改用 up/down hex（僅色值替換，結構零變化）"
  artifacts:
    - path: "components/ui/Badge.tsx"
      provides: "新增 ok / danger 兩個 variant（語意別名，hex 同 down/up）"
    - path: "components/Portfolio.tsx"
      provides: "呈現層全面 token/元件化：StatCard 摘要、表格 mono 數字、Badge 狀態、ui/Modal、MarkdownReport"
  key_links:
    - from: "components/Portfolio.tsx"
      to: "components/ui/MarkdownReport.tsx"
      via: "AI 結果 modal 渲染"
      pattern: "from ['\"]\\./ui/MarkdownReport['\"]"
    - from: "components/Portfolio.tsx"
      to: "components/ui/Modal.tsx"
      via: "四個 modal 容器"
      pattern: "from ['\"]\\./ui/Modal['\"]"
---

<objective>
UI 翻新最終期：Portfolio 頁套用 Phase A 元件系統、清除全站殘留舊樣式（emoji 狀態碼、emerald/rose、
漸層、彩色陰影）、補齊語意 token（ok/danger）、把 Phase B 刻意跳過的 MACD/法人柱紅綠一併收斂。
**全程只動呈現層——資料流、編輯邏輯、AI 呼叫、字串比對判斷一行不改。**

Purpose: 讓「三種警示色、四種 loading、emoji 與 icon 混用」的病根在全站範圍內清零，
翻新收官後任何新畫面都只有一套語言可抄。
Output: token 補充（index.html/Badge）、Portfolio 呈現層重構、全站一致性掃描歸零、圖表餘色收斂。
</objective>

<context_for_cold_start_executor>
## 給冷啟動執行者的前提（無對話背景，先讀完本節）

**專案路徑 `E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4`（E 槽，路徑含空格必加引號）。分支 `gsd/phase-ui-c`。**

### 鐵則（前四個 phase 的經驗，違反即翻車）
1. **只動呈現層**。Portfolio.tsx 是全專案最大元件（~1200 行），以下東西**一行不改**：
   - `localStorage` 讀寫（key `portfolio_items` 等）、持股 CRUD handler、含息切換的計算邏輯
   - 對 services 的呼叫（`getLatestPrice`/`analyzeTradeDecision`/`analyzePortfolioHealth`）與其參數
   - **AI 決策的字串比對判斷**（如 `includes('停損')`/`includes('續抱')` 一類，約 L225-230、L449-454）
     ——比對邏輯照舊，只把「比對結果 → 顏色」的呈現換成 Badge variant。
   - 任何要送給 AI 或從 AI 回應解析的字串常數。**emoji 只從 JSX 呈現層移除**；
     若某 emoji 出現在「將被送出或被解析的字串」裡，保留並在 SUMMARY 註記位置。
2. **StockChart.tsx 雷區規則同 Phase B**：本期只准「hex 色值替換」一類 diff（MACD 柱與
   法人買賣超柱的 `#ef4444`→`#f0405a`、`#10b981`→`#22c55e`）。**先 grep 記錄原值與語意
   （哪個 hex 對應多方/正值），替換後保持同一語意映射**（正值/多方→up 紅、負值/空方→down 綠，
   與 K 棒一致）。改完 `git diff` 自檢：出現任何非 hex 行即回退。
3. 新寫的 JSX 只准用 token 與 `components/ui/` 元件。全站掃描的目標（Task 4 驗收）：
   `emerald-`、`rose-`、`shadow-(blue|purple|indigo)`、`gradient-to`、modal 元件外的
   `rounded-2xl`、UI 層 emoji 狀態碼——**全部歸零**。
4. 驗證命令：Git Bash `npx tsc --noEmit`/`grep`；PowerShell `npx.cmd`/`Select-String`。
   一任務一 commit，只動該任務 <files>，絕不 `git add -A`。禁止安裝 npm 套件。
   git 大動作前確認 dev 伺服器已收乾淨（node 程序常在 Ctrl+C 後殘留，需 taskkill）。

### 語意色規則（本期新增，弱模型照表選色，不要自行發明）
| 語意 | token | 用在 |
|---|---|---|
| 價格/報酬方向 | `up`(紅=漲/正報酬)/`down`(綠=跌/負報酬) | 漲跌徽章、報酬率、K棒、量柱、MACD柱、法人買賣超 |
| 狀態良好/通過/運作中 | `ok`（新增，hex 同 down 的綠） | 檢核「通過」、系統運作中、健檢「續抱」類 |
| 提醒/等待/注意 | `warn`（琥珀） | 檢核「警示」、WAIT、觀望類 |
| 危險/失敗/停損 | `danger`（新增，hex 同 up 的紅） | NO-GO、停損/賣出類、錯誤 |
| AI 專屬 | `ai`（紫） | AI 按鈕/標題/徽章 |
**設計說明（不要「優化」它）**：ok/danger 與 down/up 共用 hex 是刻意的——整站視覺仍只有一紅一綠，
但程式碼裡「方向」與「好壞」語意分離；由使用情境消歧義（大大的 NO-GO 卡不會被誤認成漲幅）。

### 既有程式碼事實（規劃期快照，動手前開檔確認）
- **`components/Portfolio.tsx`**：Header（標題/含息切換/更新/新增）→ 摘要 4 卡
  （`grid-cols-2 md:grid-cols-4`）→ TwGroupTable/UsGroupTable（各 11 欄、可編輯儲存格、
  健檢按鈕）→ 4 個 modal（新增持股表單、交易分析 loading 全螢幕遮罩約 L1197-1213、
  交易分析結果、健檢結果）。**內含兩份與 ui/MarkdownReport 幾乎相同的 ReactMarkdown renderer——
  本期刪除、改 import**。emoji 狀態碼散佈於表格與決策呈現。正報酬目前用 emerald（美式）→
  本期翻轉為 up 紅（台股慣例，與全站一致；此為規格拍板決策，不要保留綠色獲利）。
- **`components/EntryChecklist.tsx`**：pass/warn/fail 樣式常數在檔頭附近（約 L5-9）。
  只把顏色 class 換成 ok/warn/danger token；判定邏輯、結構、文案不動。
- **`components/AnalysisResult.tsx`**：外殼標題列是 indigo→purple 漸層 → 改平面
  （`bg-ai/15 border-b border-surface-line`，icon/字用 `text-ai`）。內文已走 MarkdownReport 不動。
- **`components/Sidebar.tsx`**：底部「系統運作中」徽章目前用 down token（語意借用）→ 改 ok。
- **`App.tsx`**：掃描殘留（若 Phase B 後仍有 gradient/rounded-2xl/emerald 殘留就順掃；
  QuoteHeader/ChartToolbar 應已乾淨）。
- **`index.html`**：Phase A 的 `tailwind.config` 行內設定（theme.extend.colors）→ 增加
  ok 與 danger 兩色。**仍在 extend 之下，勿動其他既有 token。**
- **`components/ui/Badge.tsx`**：現有 variants up/down/warn/neutral/ai → 增加 `ok`、`danger`。
- 慣例：2 空格、單引號、React.FC、檔尾 default export、繁中註解、無 barrel。
</context_for_cold_start_executor>

<tasks>

<task type="auto">
  <name>Task 1: 語意 token（ok/danger）＋ Badge variant 擴充</name>
  <files>index.html, components/ui/Badge.tsx</files>
  <action>
1. `index.html` 的 `tailwind.config`（theme.extend.colors 內）新增：
   `ok: { DEFAULT: '#22c55e', muted: '#22c55e26' },` 與
   `danger: { DEFAULT: '#f0405a', muted: '#f0405a26' },`——**確認仍在 extend 之下**，
   其他 token 與字體設定零改動。
2. `components/ui/Badge.tsx` 的 variant 型別與 class 對照表新增：
   `ok: 'bg-ok-muted text-ok'`、`danger: 'bg-danger-muted text-danger'`。
   既有五個 variant 原樣保留。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && grep -c "danger" components/ui/Badge.tsx && grep -c "ok:" index.html</automated>
  </verify>
  <done>ok/danger token 與 Badge variant 存在；extend 結構未破壞；tsc 0 錯誤。</done>
</task>

<task type="auto">
  <name>Task 2: Portfolio 摘要卡與表格呈現層</name>
  <files>components/Portfolio.tsx</files>
  <action>
只動呈現層（鐵則 #1 的禁區逐字遵守）：
1. **摘要 4 卡** → `ui/StatCard`（label/value/tone 對應現值；報酬類 tone 用
   正→'up'、負→'down'；含息切換按鈕保留原邏輯，樣式改 `ui/Button` ghost sm）。
   Header 的更新/新增按鈕 → `ui/Button`（ghost / primary）。
2. **兩張 11 欄表格**（TwGroupTable/UsGroupTable，兩張都做、樣式一致）：
   - 表頭 `sticky top-0 bg-surface-card z-10`；隔行底色用 `surface-inset` 系（如 odd 行 40% 透明）。
   - 數字欄（價、成本、市值、損益、報酬率）`text-right font-mono tabular-nums`；
     損益/報酬率上色 正→`text-up`、負→`text-down`（**翻轉自現行 emerald 慣例，刻意為之**）。
   - 🇹🇼/🇺🇸 → `Badge variant="neutral"` 文字「台股」「美股」；其他 emoji 狀態燈 →
     依原 emoji 語意對映 ok/danger/warn/neutral Badge（一對一翻譯，不新增語意）。
   - 健檢欄：**字串比對邏輯原樣**，僅把結果呈現包成 Badge
     （停損/賣出類→danger、續抱/加碼類→ok、觀望/減碼類→warn、無法歸類→neutral，
     對映依既有分支一對一翻譯，不新增分支）。
   - 可編輯儲存格 input 樣式統一（`bg-surface-inset border-surface-line rounded-ctl`），
     onChange/onBlur 邏輯不動。折疊分組開合行為不動，分組標頭樣式 token 化。
3. 空狀態卡（既有設計良好）僅換 token 色與 `ui/Button`。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && ! grep -qE "🇹🇼|🇺🇸|🟢|🔵|🟡|🟠|🔴|✅|⚠️|❌|➖" components/Portfolio.tsx && grep -q "StatCard" components/Portfolio.tsx</automated>
  </verify>
  <done>摘要 StatCard 化；表格 mono 右對齊＋up/down 報酬色＋sticky 表頭；UI 層 emoji 歸零；資料/編輯邏輯零 diff；tsc 0 錯誤。</done>
</task>

<task type="auto">
  <name>Task 3: Portfolio 四個 modal → ui/Modal ＋ MarkdownReport 去重</name>
  <files>components/Portfolio.tsx</files>
  <action>
1. **四個 modal 全改 `ui/Modal`**（open/onClose/title 接既有 state 與 handler）：
   - 新增持股表單：欄位與提交邏輯不動，按鈕改 `ui/Button`。
   - 交易分析 loading（現為全螢幕遮罩約 L1197-1213）：改 `ui/Modal` ＋
     `ui/Skeleton variant="lines"` ＋ 原有進行中文案。
   - 交易分析結果與健檢結果：內文渲染改 `<MarkdownReport content={...} />`。
2. **刪除 Portfolio 內兩份重複的 ReactMarkdown renderer**（含 import）。
3. modal 的觸發/關閉 state、載入流程、資料組裝零改動；Esc/遮罩/focus 由 ui/Modal 自帶。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && ! grep -q "ReactMarkdown" components/Portfolio.tsx && grep -q "ui/MarkdownReport" components/Portfolio.tsx && grep -q "ui/Modal" components/Portfolio.tsx</automated>
  </verify>
  <done>四 modal 皆 ui/Modal；Portfolio 內 ReactMarkdown 歸零、統一走 MarkdownReport；邏輯零改動；tsc 0 錯誤。</done>
</task>

<task type="auto">
  <name>Task 4: 全站一致性掃描歸零＋圖表餘色收斂</name>
  <files>components/EntryChecklist.tsx, components/AnalysisResult.tsx, components/StockChart.tsx, components/Sidebar.tsx, App.tsx</files>
  <action>
1. **EntryChecklist**：pass/warn/fail 顏色常數改 ok/warn/danger token（含邊框/底/字/icon 色）；
   GO/WAIT/NO-GO 結論卡同語意換色（GO→ok、WAIT→warn、NO-GO→danger）。邏輯/文案/結構不動。
2. **AnalysisResult**：標題列漸層改平面 `bg-ai/15` ＋ `text-ai`；其餘不動。
3. **StockChart**：MACD 柱與法人買賣超柱 hex 收斂（鐵則 #2 的做法與 diff 自檢）。
4. **Sidebar**：系統運作中徽章 down→ok（class 一對一換）。
5. **App.tsx 與全站掃描**：跑
   `grep -rnE "emerald-|rose-|shadow-(blue|purple|indigo)|gradient-to|rounded-2xl" App.tsx components/*.tsx`
   逐筆處理：漲跌語意→up/down、好壞語意→ok/warn/danger、AI 語意→ai、
   容器圓角→rounded-card/rounded-modal、漸層→平面 tint、彩色陰影→刪除。
   `components/ui/` 內若命中（不應該）也一併修。**每一筆替換前先判斷語意再選 token（照語意色規則表），
   不要盲目字串替換**。處理完成後該 grep 必須 0 命中（`rounded-modal` 定義處除外）。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && ! grep -rqE "emerald-|rose-|shadow-(blue|purple|indigo)|gradient-to" App.tsx components/ && npm run build 2>&1 | tail -1</automated>
  </verify>
  <done>全站掃描歸零；EntryChecklist/AnalysisResult/Sidebar 語意 token 化；圖表餘色收斂且 diff 僅 hex；build 成功。</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: 人工驗證（Portfolio 全功能＋全站視覺收官）</name>
  <what-built>
Portfolio 呈現層全面元件化（StatCard/Badge/ui-Modal/MarkdownReport、emoji 清零、報酬紅正綠負）、
語意 token ok/danger、EntryChecklist 與 AI 報告外殼 token 化、MACD/法人柱紅綠對齊、全站舊樣式歸零。
  </what-built>
  <how-to-verify>
1. 兩個終端機：`npx.cmd vercel dev --listen 3001` ＋ `npm.cmd run dev`，開 http://localhost:3000。
2. **Portfolio 全功能回歸（本期重點，逐項）**：
   - 新增一筆持股（表單 modal 正常、能存）；編輯成本/股數（可編輯儲存格照舊）；刪除一筆。
   - 含息切換、總覽 4 卡數字正確；**正報酬顯示紅色、負報酬綠色**（刻意翻轉，看你是否接受——
     不習慣的話告訴覆核者，可一行換回）。
   - 🇹🇼🇺🇸 與狀態 emoji 消失、變成文字/彩色徽章；表格橫向捲動正常、表頭 sticky。
   - 跑一次「交易分析」（loading 是骨架 modal、結果報告樣式與 dashboard 的 AI 報告一致）；
     跑一次「健檢」，決策徽章顏色合理（停損紅/續抱綠/觀望黃）。
   - 所有 modal 都能 Esc 與點遮罩關閉。
3. **全站視覺**：dashboard 快速回歸（搜 2330、AI 分析一次）；檢核卡 GO/WAIT/NO-GO 三色仍清楚；
   AI 報告標題列變平面紫、無漸層；側欄運作徽章仍綠；MACD 柱與法人柱紅綠方向與 K 棒一致。
4. F12 模擬 390px：Portfolio 表格可橫滑、頁面無水平爆版。
  </how-to-verify>
  <resume-signal>輸入 "approved" 或描述問題（哪一項、看到什麼）</resume-signal>
</task>

</tasks>

<review_checklist>
## 給 fresh-context 覆核者的固定清單（Opus/Sonnet 逐條執行，不即興）

1. `npx tsc --noEmit`＝0；`npm run build` 成功；`grep -rn "AIza" dist/`＝0。
2. **範圍**：`git diff main --stat` 只含 8 個計畫檔；services/、utils/、api/ 零 diff。
3. **Portfolio 邏輯零變化（本期最重要）**：`git diff main -- components/Portfolio.tsx` 中，
   以下關鍵字所在行**不得有語意變更**（樣式 class 改動可以）：`localStorage`、`portfolio_items`、
   `getLatestPrice`、`analyzeTradeDecision`、`analyzePortfolioHealth`、`includes(`。
   特別檢查字串比對分支：分支條件與順序必須與 main 版一致，只有回傳的呈現（Badge）不同。
4. **emoji 清零但不誤殺**：`grep -nE "🟢|🔴|✅|❌|🇹🇼|🇺🇸" components/Portfolio.tsx`＝0；
   同時確認沒有任何「送往 services 的字串常數」被改動（對照 diff）。
5. **全站掃描**：`grep -rnE "emerald-|rose-|shadow-(blue|purple|indigo)|gradient-to" App.tsx components/`＝0。
6. **StockChart diff 形狀**：只有 hex 替換行；語意映射正確（正值/多方→#f0405a、負值/空方→#22c55e，
   與 main 版原 hex 的正負對應一致）；拖曳/hooks/結構零觸碰。
7. **MarkdownReport 單一來源**：`grep -c "ReactMarkdown" components/Portfolio.tsx`＝0；
   ui/MarkdownReport.tsx 本身未被改壞（diff 應為零或極小）。
8. **token 結構**：index.html 的 ok/danger 在 theme.extend.colors 之下；Badge 新 variant 型別完整。
9. runtime/視覺交給使用者 Task 5；未實跑就明說。
判定：必修→退 Codex 附行號；同一問題最多退 2 輪，第 3 輪升級回報使用者。
</review_checklist>

<verification>
1. 每任務後 tsc＝0；Task 4 後 `npm run build` 成功＋dist 無 AIza（Bash 工具）。
2. Task 5 人工驗證通過（Portfolio CRUD/AI 流程/視覺收官）。
3. 合併前收乾淨 node 程序再 merge（既有教訓）。
</verification>

<success_criteria>
- [ ] ok/danger token 與 Badge variant 就緒；語意色規則表落地
- [ ] Portfolio：StatCard 摘要、mono 表格、emoji 清零、四 modal ui/Modal 化、MarkdownReport 去重
- [ ] Portfolio 資料/編輯/AI 邏輯與 main 逐行等價（僅呈現差異）
- [ ] EntryChecklist/AnalysisResult/Sidebar/StockChart 餘色收斂；全站 grep 歸零
- [ ] tsc 0 錯誤、build 成功、dist 無金鑰
- [ ] 人工 checkpoint 核可
</success_criteria>

<output>
Create `.planning/phases/07-ui-portfolio/07-01-SUMMARY.md`. 必記錄：
- StockChart 本期替換的 hex 原值/行號與語意對照
- Portfolio 中若有保留的 emoji（因位於送 AI/解析字串內）之位置清單
- emoji→Badge 的語意對映表（原 emoji → variant）
- 任何與計畫的偏差及原因
</output>

## 未決點（誠實列出）
1. Portfolio.tsx ~1200 行是全案最大單檔手術——已用「兩個任務拆分＋只動呈現層＋覆核第 3 條
   逐關鍵字盯 diff」封鎖風險；仍是本期最可能退回重修的地方。
2. 正報酬轉紅色是台股慣例的一致性選擇，但與多數美式介面相反——Task 5 請使用者實看後表態，
   不接受則把表格報酬色一行換回（token 化後成本極低），不影響其他交付。
3. MACD 柱的紅綠語意（正柱/負柱對應哪個 hex）以 main 版現況為準做同語意替換；若 grep 發現
   現況本身語意混亂（不同處相反），執行者停下記錄並沿用各處原語意，不要自行統一，留待使用者裁決。
