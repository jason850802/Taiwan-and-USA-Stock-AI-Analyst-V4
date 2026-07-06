---
phase: 05-ui-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - index.html
  - components/ui/Card.tsx
  - components/ui/Button.tsx
  - components/ui/Badge.tsx
  - components/ui/StatCard.tsx
  - components/ui/Skeleton.tsx
  - components/ui/Banner.tsx
  - components/ui/Modal.tsx
  - components/ui/MarkdownReport.tsx
  - App.tsx
  - components/AnalysisResult.tsx
autonomous: false
requirements: [UI-A]
design_authority: .planning/design/UI-REDESIGN-SPEC.md

must_haves:
  truths:
    - "App 外觀與行為和翻新前幾乎相同（本階段只建地基＋3 個試點，不改版面）"
    - "設計 token 已生效：瀏覽器中 bg-surface-card 等新 class 能算出正確色值"
    - "components/ui/ 八個共用元件存在、可編譯、props 介面與本計畫一致"
    - "3 個試點已替換且可見：錯誤條可關閉、AI loading 用統一骨架、BotIcon 已死"
    - "既有 slate/blue 等 Tailwind 預設色 class 全部照常運作（token 是 extend 不是 override）"
  artifacts:
    - path: "index.html"
      provides: "Tailwind Play 行內 config（theme.extend 之下）＋ JetBrains Mono 字體載入"
    - path: "components/ui/Banner.tsx"
      provides: "可關閉、可重試的錯誤/資訊橫幅"
      exports: ["default"]
    - path: "components/ui/MarkdownReport.tsx"
      provides: "統一的 AI 報告 Markdown renderer（自 AnalysisResult 原樣搬移）"
      exports: ["default"]
  key_links:
    - from: "App.tsx"
      to: "components/ui/Banner.tsx"
      via: "錯誤條試點替換"
      pattern: "from ['\"]\\./components/ui/Banner['\"]"
    - from: "components/AnalysisResult.tsx"
      to: "components/ui/MarkdownReport.tsx"
      via: "Markdown 渲染試點替換"
      pattern: "from ['\"]\\./ui/MarkdownReport['\"]"
---

<objective>
UI 大翻新三期（A 基座／B Dashboard 重排／C Portfolio 收尾）的第一期：建立設計 token（Tailwind Play
行內 config）、等寬字體、八個共用 UI 元件，並以 3 個低風險試點證明整套地基可用。**本階段不改任何版面
佈局**——版面重排是 Phase B 的事。設計權威文件：`.planning/design/UI-REDESIGN-SPEC.md` §0–§2。

Purpose: 先立規矩再動裝潢。B/C 兩期的所有改動都只准從這套 token 與元件取用；地基不穩就大改版面，
會複製現況「三種圓角、三種警示色、四種 loading」的混亂。
Output: index.html（config＋字體）、components/ui/ 八元件、App.tsx 與 AnalysisResult.tsx 的試點替換。
</objective>

<context_for_cold_start_executor>
## 給冷啟動執行者的前提（你沒有任何對話背景，先讀完本節再動手）

**專案路徑是 `E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4`（E 槽；路徑含空格，命令必加引號）。**

### 本階段鐵則（違反即範圍膨脹，前兩個 phase 的執行經驗已證明守住範圍是成敗關鍵）
1. **不改版面佈局**：Sidebar、StockChart、Portfolio、Dashboard 區塊順序一律不動。本階段只有
   「index.html 加東西」「新增 components/ui/」「3 個指定試點替換」三種改動。
2. **禁止安裝任何 npm 套件**（Phase 1 經驗：此環境 npm install 反覆網路逾時且會留半套殘骸；
   且本專案依賴要同時維護 package.json 與 index.html importmap 兩處，能不加就不加）。
   字體走 Google Fonts `<link>`，元件全部手寫，不引入任何 UI 庫。
3. **token 必須放在 `theme.extend` 之下**——這是本階段最大的翻車點：若誤放 `theme.colors` 頂層，
   會**覆蓋掉 Tailwind 全部預設色**，整個既有 App（到處是 slate-800/blue-600）瞬間全部失效變白版。
   `extend` 是「新增」，頂層是「取代」。寫完後必須實際打開 App 確認舊畫面無恙（驗證見 Task 1）。
4. 既有元件的既有 class（emerald、rose、shadow-*、rounded-xl…）**本階段一律不動**——全站色彩收斂
   是 Phase B/C 拿著這套 token 去做的事。本階段結束時 grep emerald 的數量應與開始時相同（試點三處除外）。

### 環境事實（Phase 1/2 SUMMARY 已驗證，照做勿試錯）
- 驗證命令在 **Git Bash** 跑（`npx tsc --noEmit`、`grep`）；若在 PowerShell：`npx` 會被 execution
  policy 擋，改用 **`npx.cmd`**；PowerShell 沒有 grep，改用 **`Select-String`**。
- 本地實跑：Vite `npm run dev`（port 3000）即可驗證本階段（純前端改動，不需 `vercel dev`）。
- 不裝 `@vercel/node`、不動 `api/` 下任何檔案（本階段完全不涉後端）。
- git 分支 `gsd/phase-ui-a`，一任務一 atomic commit，只動每個任務 <files> 列出的檔案，
  絕不 `git add -A`（工作區有未追蹤的 .agents/、.codex/，別掃進來）。

### 設計 token 的語意（來自 UI-REDESIGN-SPEC §1，動手前先讀該節）
- 背景三層：`surface`(#0f172a，等同現用 slate-900)／`surface-card`(#1e293b，等同 slate-800)／
  `surface-inset`(#0b1220)；邊框 `surface-line`(#334155，等同 slate-700)。
  ——前三者刻意對齊現有色值，所以試點替換後**視覺應零變化**，這本身就是驗收條件。
- 漲跌：`up`(#f0405a 紅=漲)／`down`(#22c55e 綠=跌)——**台股慣例**，本階段只定義不套用
  （套用到圖表與報價是 Phase B）。
- 唯一主行動色 `accent`(藍)、AI 專屬 `ai`(紫)、唯一警示色 `warn`(琥珀)。
- 圓角三檔：`rounded-ctl`(0.5rem)／`rounded-card`(0.75rem)／`rounded-modal`(1rem)。
- 數字排版：`font-mono` 映射到 JetBrains Mono；等寬數字用 Tailwind 內建的 `tabular-nums` utility。

### 既有程式碼事實（動手前開檔確認，勿憑本節記憶）
- `index.html`：第 7 行 Tailwind Play CDN `<script src="https://cdn.tailwindcss.com">`；
  第 8 行 Google Fonts Inter；第 9–30 行全局 `<style>`（body 字型/底色/scrollbar）；
  第 31–42 行 esm.sh importmap（**本階段不碰**）；另引用 `/index.css`（可能不存在於 repo，**不碰不管**）。
- `App.tsx`：約 L300-305 錯誤條（`bg-red-500/10` 一段 div，無 dismiss 無 retry）→ 試點 1；
  約 L405-416 自製內聯 SVG `BotIcon` → 試點 3 刪除（改用 lucide `Bot`，該檔已 import lucide）。
  App 內已有 `fetchData` 與當前 symbol 的 state 可供 retry 接線。
- `components/AnalysisResult.tsx`：L13-20 loading pulse → 試點 2 換 `Skeleton`；其餘部分含一整段
  ReactMarkdown 客製 renderer（h2/h3/strong/table 樣式＋GO/WAIT/NO_GO 關鍵字判色）→ 試點 2 同時
  把這段 renderer **原樣搬**進 `MarkdownReport.tsx` 後改為引用。**Portfolio.tsx 裡另外兩份重複的
  renderer 本階段不碰**（Phase C 才收斂）。
- 專案慣例：2 空格縮排、單引號、`React.FC<Props>`＋檔尾 `export default`、繁中註解、無 barrel file。
</context_for_cold_start_executor>

<tasks>

<task type="auto">
  <name>Task 1: 設計 token 與字體（index.html）＋可行性 spike</name>
  <files>index.html</files>
  <action>
UI-REDESIGN-SPEC §8.2 標明「Play CDN 行內 config 未在本專案實測」——所以本任務**先驗證再依賴**：

1. 在 `index.html` 現有的 `<script src="https://cdn.tailwindcss.com"></script>` **之後、
   `</head>` 之前**，新增行內設定（官方 Play CDN 慣例即為 config 寫在 CDN script 之後）：
```html
<script>
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          surface: { DEFAULT: '#0f172a', card: '#1e293b', inset: '#0b1220', line: '#334155' },
          accent:  { DEFAULT: '#3b82f6', hover: '#2563eb' },
          ai:      { DEFAULT: '#8b5cf6' },
          up:      { DEFAULT: '#f0405a', muted: '#f0405a26' },
          down:    { DEFAULT: '#22c55e', muted: '#22c55e26' },
          warn:    { DEFAULT: '#f59e0b' },
        },
        fontFamily: {
          sans: ['Inter', 'Noto Sans TC', 'sans-serif'],
          mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        },
        borderRadius: { ctl: '0.5rem', card: '0.75rem', modal: '1rem' },
      },
    },
  };
</script>
```
   **再三確認 colors/fontFamily/borderRadius 都在 `extend` 之下**（見前提鐵則 #3）。
2. 擴充既有 Google Fonts `<link>`（L8）加載 JetBrains Mono：在 family 清單追加
   `&family=JetBrains+Mono:wght@400;500;700`（維持同一個 `<link>`，不另開請求）。
3. 其餘一概不動（importmap、`<style>` 區塊、`/index.css` 引用都保持原樣）。

**Spike 驗證（本任務的重點，證明 token 真的生效且沒有炸掉預設色）**：
`npm run dev` 起本地站，瀏覽器開 http://localhost:3000，DevTools Console 貼：
```js
const d = document.createElement('div');
d.className = 'bg-surface-card text-up font-mono rounded-card';
document.body.append(d);
const s = getComputedStyle(d);
console.log(s.backgroundColor, s.color, s.fontFamily, s.borderRadius);
```
預期輸出：`rgb(30, 41, 59)`、`rgb(240, 64, 90)`、含 `JetBrains Mono`、`12px`。
同時**目視整個 App**：畫面必須與改動前完全相同（深色 slate 主題無恙）——若整頁變白版/掉色，
代表 config 蓋掉了預設色（沒放在 extend 下），立即修正。
**若 spike 失敗且 30 分鐘內無法解決**：停止本任務，回報「Play CDN 行內 config 不可行＋實際錯誤現象」，
等待改走 CSS variables 備案（SPEC §8.2）——不要自行發明第三種做法。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && grep -c "tailwind.config" index.html && grep -c "JetBrains+Mono" index.html</automated>
  </verify>
  <done>index.html 含 theme.extend 行內 config 與 JetBrains Mono 載入；Console spike 輸出符合預期；既有畫面目視零變化；tsc 0 錯誤。</done>
</task>

<task type="auto">
  <name>Task 2: 八個共用 UI 元件（components/ui/，只建不接）</name>
  <files>components/ui/Card.tsx, components/ui/Button.tsx, components/ui/Badge.tsx, components/ui/StatCard.tsx, components/ui/Skeleton.tsx, components/ui/Banner.tsx, components/ui/Modal.tsx, components/ui/MarkdownReport.tsx</files>
  <action>
新增目錄 `components/ui/`，八個元件各一檔。**本任務只建立元件，不改任何既有檔案**（接線是 Task 3）。
每個元件都是無外部依賴的小元件（React ＋ lucide-react ＋ 已有的 react-markdown，皆為既有依賴）。
props 介面**照下面的規格做，不要自行增刪**（B/C 兩期會照這份介面用）：

1. `Card.tsx`：`{ title?: string; actions?: React.ReactNode; className?: string; children: React.ReactNode }`
   外層 `bg-surface-card border border-surface-line rounded-card p-4`；有 title 時渲染標題列
   （title 左、actions 右、下方 border-b surface-line 分隔）。
2. `Button.tsx`：`{ variant?: 'primary'|'ai'|'ghost'|'danger'; size?: 'sm'|'md'; disabled?: boolean;
   onClick?: () => void; type?: 'button'|'submit'; className?: string; children }`。class 對照：
   primary=`bg-accent hover:bg-accent-hover text-white`；ai=`bg-ai hover:opacity-90 text-white`；
   ghost=`bg-transparent border border-surface-line text-slate-300 hover:bg-surface-card`；
   danger=`bg-warn/15 border border-warn/40 text-warn hover:bg-warn/25`。
   共通：`rounded-ctl font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50
   disabled:opacity-50 disabled:cursor-not-allowed`；size sm=`px-3 py-1.5 text-xs`、md=`px-4 py-2 text-sm`。
   **無彩色陰影**（設計規範：陰影全撤）。
3. `Badge.tsx`：`{ variant: 'up'|'down'|'warn'|'neutral'|'ai'; children }`。
   `inline-flex items-center gap-1 px-2 py-0.5 rounded-ctl text-xs font-medium`＋各 variant：
   up=`bg-up-muted text-up`、down=`bg-down-muted text-down`、warn=`bg-warn/15 text-warn`、
   neutral=`bg-surface-inset text-slate-400`、ai=`bg-ai/15 text-ai`。
4. `StatCard.tsx`：`{ label: string; value: string|number; tone?: 'up'|'down'|'neutral'; sub?: string }`。
   label 小字 slate-400；value `font-mono tabular-nums text-xl font-medium`，tone 決定 text-up/down/白；
   sub 可選小字。容器 `bg-surface-inset rounded-ctl p-3`。
5. `Skeleton.tsx`：`{ variant?: 'card'|'lines'; lines?: number; className?: string }`。
   `animate-pulse`；card=一塊 `bg-surface-inset rounded-card h-32`；lines=N 行（預設 4）
   `h-3 bg-surface-inset rounded` 寬度交錯 92%/100%/84%/70% 循環。
6. `Banner.tsx`：`{ variant: 'error'|'info'; onDismiss: () => void; onRetry?: () => void; children }`。
   error=`bg-warn/10 border border-warn/40 text-warn`、info=`bg-accent/10 border border-accent/40
   text-slate-200`；`rounded-ctl px-4 py-3 flex items-center gap-3`；children 撐滿中間；
   有 onRetry 時渲染「重試」小按鈕（ghost 樣式）；最右固定 ×（lucide `X`，`aria-label="關閉"`，
   點擊熱區至少 w-8 h-8）。
7. `Modal.tsx`：`{ open: boolean; onClose: () => void; title?: string; maxWidth?: string; children }`。
   `open===false` 回傳 null。遮罩 `fixed inset-0 bg-black/60 z-50 flex items-center justify-center`，
   點遮罩關閉（內容區 `stopPropagation`）；`useEffect` 掛 `keydown` 監聽 **Esc 關閉**（unmount 時移除）；
   開啟時 focus 移到內容容器（`ref`＋`tabIndex={-1}`）。內容 `bg-surface-card border border-surface-line
   rounded-modal p-6 max-h-[85vh] overflow-y-auto`＋可選標題列（title 左、× 右）。
8. `MarkdownReport.tsx`：`{ content: string }`。**把 `components/AnalysisResult.tsx` 現有的
   ReactMarkdown＋remark-gfm＋全部客製 renderer（h2/h3/strong/table/li 樣式與 GO/WAIT/NO_GO 等
   關鍵字判色邏輯）原封不動搬進來**——這是「搬家」不是「重寫」，樣式字串逐字保留，
   確保 Task 3 替換後渲染結果 pixel 級一致。

風格：比照專案慣例（React.FC、檔尾 default export、繁中註解、2 空格、單引號、無 barrel）。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && ls components/ui | wc -l</automated>
  </verify>
  <done>components/ui/ 八檔存在且 tsc 0 錯誤；props 介面與本計畫逐字一致；MarkdownReport 內容來自 AnalysisResult 原樣搬移。</done>
</task>

<task type="auto">
  <name>Task 3: 三個試點替換（App.tsx、AnalysisResult.tsx）</name>
  <files>App.tsx, components/AnalysisResult.tsx</files>
  <action>
只做以下三處，**其餘任何看不順眼的地方都不要順手改**：

**試點 1（錯誤條 → Banner）**：`App.tsx` 約 L300-305 的錯誤 div 換成
`<Banner variant="error" onDismiss={() => setError(null)} onRetry={...}>{error}</Banner>`。
retry 接線規則：若能在 ≤10 行內接回既有的重新抓取邏輯（App 內已有 fetchData 與當前 symbol state），
就接上；若發現要動到更多 state 流才能接，**改出 dismiss-only 版本**並在 SUMMARY 記錄原因——
不要為了 retry 重構 App 的資料流（Phase 1/2 的教訓：小改動長出大重構是最常見的範圍膨脹）。

**試點 2（AI loading → Skeleton＋renderer → MarkdownReport）**：`components/AnalysisResult.tsx`
L13-20 的 pulse loading 換 `<Skeleton variant="lines" lines={6} />`（外層卡片結構保留）；
內文渲染段改為 `<MarkdownReport content={analysis} />`（props 名依實際變數）。
替換後**該檔應明顯變短**（renderer 已搬走）；渲染輸出必須與替換前一致（同一份樣式字串）。

**試點 3（BotIcon 之死）**：刪除 `App.tsx` L405-416 自製內聯 SVG `BotIcon`，
使用處改 lucide `Bot`（等 size；該檔已有 lucide import 清單，加一個名字即可）。
改完 `grep -n "BotIcon" App.tsx` 必須 0 命中。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && ! grep -q "BotIcon" App.tsx && grep -q "ui/Banner" App.tsx && grep -q "ui/MarkdownReport" components/AnalysisResult.tsx</automated>
  </verify>
  <done>三試點完成；tsc 0 錯誤；BotIcon 0 殘留；App 其餘畫面零變動。</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: 人工驗證（地基生效＋畫面零回歸）</name>
  <what-built>
設計 token（Tailwind Play 行內 config＋JetBrains Mono）、components/ui/ 八個共用元件、
三個試點替換（可關閉錯誤條、統一 AI loading 骨架、BotIcon→lucide Bot）。版面佈局零改動。
  </what-built>
  <how-to-verify>
1. `npm run dev`（純前端即可，不需 vercel dev），開 http://localhost:3000。
2. **整體目視**：畫面應與翻新前「幾乎一樣」——深色主題、側欄、圖表、卡片全部照舊。
   若出現整頁掉色/白版 → token config 沒放在 extend 下，退回 Task 1。
3. 搜 2330 正常載圖 → 觸發一次 AI 分析：loading 期間應看到**新的骨架動畫**（多行灰條脈動），
   完成後報告樣式與以前一致（標題色、表格、GO/WAIT 判色都在）。
4. 製造一次錯誤（隨便搜 ZZZZZZ）：錯誤條出現，**按 × 可關閉**；若有「重試」鈕，按下應重新請求。
5. DevTools Console 跑 Task 1 的 spike 腳本，確認四個值正確（rgb(30,41,59)／rgb(240,64,90)／
   JetBrains Mono／12px）。
6. 快速回歸：切換週期、開一次庫存頁，無 console 紅字錯誤。
  </how-to-verify>
  <resume-signal>輸入 "approved" 或描述問題（例：畫面掉色、骨架沒出現、關不掉錯誤條）</resume-signal>
</task>

</tasks>

<review_checklist>
## 給 fresh-context 覆核者的固定清單（Opus/Sonnet 接手時逐條執行，不要即興）

Codex 回報完成後，覆核者做以下事（實跑，不是讀 code）：
1. `npx tsc --noEmit` → 0 錯誤；`npm run build` → 成功。
2. **extend 翻車點**：讀 index.html，確認 colors/fontFamily/borderRadius 都在 `theme.extend` 之下
   （若在 theme 頂層＝必修，會炸掉全站預設色）。
3. **範圍紀律 grep**（Phase A 不准動既有樣式）：
   `git diff main --stat` 只含本計畫 files_modified 清單；
   `grep -c "emerald-" components/Portfolio.tsx` 數量與 main 分支相同（沒被順手改）。
4. **試點證據**：`grep BotIcon App.tsx`＝0；`grep "ui/Banner" App.tsx`≥1；
   `grep "ui/MarkdownReport" components/AnalysisResult.tsx`≥1。
5. **MarkdownReport 是搬家不是重寫**：比對 MarkdownReport.tsx 的 renderer 樣式字串與
   main 分支 AnalysisResult.tsx 原版（`git show main:components/AnalysisResult.tsx`），
   關鍵字判色與樣式 class 應逐字可對應；發現「重寫/簡化」＝退回。
6. **props 介面對規格**：八元件的 props 與 PLAN Task 2 規格逐一比對，多欄少欄都要指出。
7. Modal.tsx：確認 Esc 監聽有在 unmount 清除（`return () => removeEventListener`）、
   遮罩 onClick 關閉且內容有 stopPropagation——這兩個是弱模型最常漏的。
8. runtime 驗證交給使用者 Task 4（覆核者無瀏覽器時明說「未實跑視覺」，不要宣稱看過畫面）。
判定規則：任何「必修」退回 Codex 附行號；只有建議項則放行 Task 4。同一問題最多退回 2 輪，
第 3 輪升級回報使用者。
</review_checklist>

<verification>
1. 每任務後 `npx tsc --noEmit`＝0（Git Bash；PowerShell 用 npx.cmd）。
2. 全部完成後 `npm run build` 成功；`grep -r "AIza" dist/`＝0（慣例掃描，Bash 工具）。
3. Task 4 人工驗證通過（spike 四值、畫面零回歸、三試點行為）。
</verification>

<success_criteria>
- [ ] index.html 行內 config 於 theme.extend 下、JetBrains Mono 已載入、spike 四值正確
- [ ] components/ui/ 八元件存在、props 與規格一致、tsc 0 錯誤
- [ ] 三試點生效：錯誤條可關閉（含或不含 retry，SUMMARY 說明）、AI loading 用 Skeleton、BotIcon 0 殘留
- [ ] 版面零回歸：佈局/配色與翻新前一致（試點三處除外）；Portfolio/StockChart/Sidebar 未被改動
- [ ] `npm run build` 成功且 dist 無金鑰
- [ ] 人工 checkpoint 核可
</success_criteria>

<output>
Create `.planning/phases/05-ui-foundation/05-01-SUMMARY.md` when done. 必記錄：
- Play CDN 行內 config 實測結果（成功／或退 CSS variables 備案的原因與實際錯誤）
- 試點 1 的 retry 有沒有接上（沒接的話原因）
- 八元件與規格的任何偏差（理論上應為零）
</output>

## 未決點（誠實列出）
1. Play CDN 行內 config 未在本專案實測——已設計成 Task 1 先 spike、失敗有明確退場（CSS variables）。
2. JetBrains Mono 經 Google Fonts 載入，若使用者網路擋外部字體，`font-mono` 會退到 ui-monospace，
   功能無損、質感略降；Task 4 目視時留意。
3. `up-muted`/`down-muted` 用 8 位 hex（#…26）承載透明度，Tailwind 任意值支援此寫法，
   但若 Play CDN 對 8 位 hex 的 class 生成有異，改用 `bg-up/15` 斜線透明度語法等效替代（執行者可自行換用，
   記入 SUMMARY 即可，不算偏差）。
