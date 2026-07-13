---
phase: quick-260713-len
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - tailwind.config.js
  - postcss.config.js
  - index.css
  - index.html
  - index.tsx
autonomous: true
requirements: [D-1b]
tags: [tailwind, postcss, vite, build-pipeline, purge]

must_haves:
  truths:
    - "npm run build 產出獨立 CSS asset（dist/assets/*.css），且 dist/index.html 引用它"
    - "dist/index.html 無 cdn.tailwindcss.com 字樣（Play CDN 已移除）"
    - "建出的 CSS 含自訂 token（bg-surface/text-up/text-down/rounded-card）與自訂卷軸 selector（::-webkit-scrollbar）"
    - "dist/index.html 仍含 Google Fonts link（1 處）與 esm.sh importmap（6 處）——D-1e/D-1c 範圍未被觸碰"
    - "grep -r AIza dist/ 無結果（金鑰紅線）"
  artifacts:
    - path: "tailwind.config.js"
      provides: "content globs＋theme.extend（colors/fontFamily/borderRadius 逐鍵照搬自 index.html:9-29）"
      contains: "content"
    - path: "postcss.config.js"
      provides: "tailwindcss＋autoprefixer 插件掛載（Vite 自動載入）"
      contains: "tailwindcss"
    - path: "index.css"
      provides: "@tailwind 三指令＋原內聯 style（body 底色字體＋自訂卷軸）"
      contains: "@tailwind base"
    - path: "index.html"
      provides: "已移除 Play CDN script＋內聯 config script＋內聯 style；保留 Google Fonts link 與 importmap"
    - path: "index.tsx"
      provides: "頂部 import './index.css'"
      contains: "import './index.css'"
    - path: "package.json"
      provides: "devDependencies 新增 tailwindcss ^3.4.x／postcss／autoprefixer"
  key_links:
    - from: "index.tsx"
      to: "index.css"
      via: "頂部 import 讓 Vite 把 CSS 納入建置圖"
      pattern: "import ['\"]\\./index\\.css['\"]"
    - from: "postcss.config.js"
      to: "tailwind.config.js"
      via: "tailwindcss PostCSS 插件自動讀取根目錄 tailwind.config.js"
      pattern: "tailwindcss"
    - from: "tailwind.config.js"
      to: "components/**/*.tsx"
      via: "content globs 掃描 className 產出 utilities"
      pattern: "components/\\*\\*/\\*\\.\\{ts,tsx\\}"
---

<objective>
D-1b Tailwind 改建置期（Phase D 2/7，optimization/PLAN.md §D-1b）：Play CDN（執行時 JIT，123KB gzip 每次載入＋console 警告×6＋CDN 單點故障）改為 tailwindcss v3.4.x 建置期靜態 CSS。內聯 tailwind.config 逐鍵全量遷 tailwind.config.js、內聯 style 遷 index.css、index.html 摘除 CDN 三件（script/config/style）。

Purpose: 消除執行時 JIT 依賴與供應鏈單點，首屏 JS gzip 直降 ~123KB（D-1a 實測 twCDN 407,279B raw／123,343B gzip）。
Output: 1 個原子 code commit（新增 tailwind.config.js/postcss.config.js/index.css＋改 index.html/index.tsx/package.json/package-lock.json）。
</objective>

<execution_context>
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/workflows/execute-plan.md
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/optimization/PLAN.md （§「現況事實」＋§D-1b 規格）
@.planning/quick/260713-kq2-d-1a-importmap-tailwind-cdn-bundle-class/260713-kq2-SUMMARY.md （D-1a 稽核：content globs 定案、零 safelist 判定、14 檔 className 分布、基線數字）
@index.html （遷移對象：行 7 Play CDN script、行 8-30 內聯 config、行 31 Google Fonts〔保留〕、行 32-53 內聯 style、行 54-65 importmap〔本包不動〕）
@index.tsx （import 插入點）
@vite.config.ts （無自訂 css.postcss，Vite 會自動載入根目錄 postcss.config——無衝突）
@package.json （現行 devDependencies 4 件；注意 "type": "module"）
</context>

<critical_facts>
- **鎖 v3.4.x，明確不用 v4**：v4 是 CSS-first 設定、與現行內聯 config 語法不相容。安裝 `tailwindcss@^3.4.0`（^3 range 不會裝到 4.x），裝完必驗主版本＝3。
- **`package.json` 有 `"type": "module"`**：`tailwind.config.js` 與 `postcss.config.js` 都必須用 ESM `export default` 語法（不能 `module.exports`）。Tailwind v3.3+ 經 jiti 載入 config 支援 ESM；Vite 6 的 postcss-load-config 支援 ESM。若 build 時 postcss config 載入失敗，fallback：改名 `postcss.config.cjs`＋`module.exports`（記入偏差）。
- **scope 紀律**：index.html 的 importmap 區塊（行 54-65）是 D-1c 的事，本包一個字元都不動。Google Fonts link（行 31）依 D-1e 拍板保留。
- **D-1a 已判定零 safelist**：51 行模板字串 className 全安全（完整字面量／同檔映射），不加 safelist、不改任何元件碼。
- **執行環境**：全新 git worktree 無 node_modules，第一步 `npm ci`（1-3 分鐘）。無瀏覽器——視覺零回歸由 orchestrator 合併後另行執行；本包驗證上限＝tsc＋build＋dist 靜態 grep。
- Windows：用 Bash 工具跑 grep（PowerShell 5.1 沒有 grep）；路徑含空格必加引號。
</critical_facts>

<tasks>

<task type="auto">
  <name>Task 1: 裝依賴＋建三個新檔（tailwind.config.js／postcss.config.js／index.css）</name>
  <files>package.json, package-lock.json, tailwind.config.js, postcss.config.js, index.css</files>
  <action>
1. `npm ci`（還原現有依賴，全新 worktree 必要，約 1-3 分鐘）。
2. `npm install -D tailwindcss@^3.4.0 postcss autoprefixer`。裝完立即驗證：`npm ls tailwindcss` 顯示 3.4.x（主版本必須是 3，出現 4.x 即改用 `tailwindcss@3` 精確 range 重裝）。此步更新 package.json＋package-lock.json＝本包 commit 內容之一。
3. 建 `tailwind.config.js`（根目錄，ESM `export default`，因 "type": "module"）：
   - `content`（D-1a 定案，絕不含 `.claude/**`）：`'./index.html'`、`'./*.{ts,tsx}'`、`'./components/**/*.{ts,tsx}'` 三條。
   - `theme.extend` 從 index.html 行 9-29 的內聯 `tailwind.config` **逐鍵照搬、值一個字元不改**。鍵位清單（防漏核對用）：colors——surface{DEFAULT '#0f172a', card '#1e293b', inset '#0b1220', line '#334155'}、accent{DEFAULT '#3b82f6', hover '#2563eb'}、ai{DEFAULT '#8b5cf6'}、up{DEFAULT '#f0405a', muted '#f0405a26'}、down{DEFAULT '#22c55e', muted '#22c55e26'}、ok{DEFAULT '#22c55e', muted '#22c55e26'}、danger{DEFAULT '#f0405a', muted '#f0405a26'}、warn{DEFAULT '#f59e0b'}；fontFamily——sans ['Inter', 'Noto Sans TC', 'sans-serif']、mono ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']；borderRadius——ctl '0.5rem'、card '0.75rem'、modal '1rem'。不加 safelist（D-1a 判定 51 行全安全）。
   - 不加 plugins、不加其他自作主張的設定。
4. 建 `postcss.config.js`（根目錄，ESM `export default`）：plugins 物件掛 `tailwindcss: {}` 與 `autoprefixer: {}` 兩鍵。Vite 自動載入根目錄 postcss config，vite.config.ts 不需改。
5. 建 `index.css`（根目錄）：先三行 `@tailwind base;`／`@tailwind components;`／`@tailwind utilities;`，其後把 index.html 行 33-52 內聯 `<style>` 的內容**原樣**貼入（body 的 font-family/background-color/color 三條＋Custom Scrollbar 四條 ::-webkit-scrollbar 規則，含原註解）。不改任何值、不加新規則。

用 Write 工具建檔（禁 heredoc）。
  </action>
  <verify>
    <automated>npm ls tailwindcss | grep -E 'tailwindcss@3\.4\.' && grep -c 'components/\*\*' tailwind.config.js && grep -c '@tailwind base' index.css && grep -c 'webkit-scrollbar' index.css</automated>
  </verify>
  <done>tailwindcss 3.4.x／postcss／autoprefixer 進 devDependencies 且 lockfile 更新；tailwind.config.js 含三條 content globs＋theme.extend 全部鍵（colors 8 組／fontFamily 2 鍵／borderRadius 3 鍵）；postcss.config.js 掛兩插件；index.css＝三指令＋原內聯 style 原樣。</done>
</task>

<task type="auto">
  <name>Task 2: index.html 摘除 CDN 三件＋index.tsx 掛 CSS</name>
  <files>index.html, index.tsx</files>
  <action>
1. index.html 刪除三塊（用 Edit 工具精準摘除）：
   - 行 7：`<script src="https://cdn.tailwindcss.com"></script>`
   - 行 8-30：整個內聯 `<script>tailwind.config = {...}</script>` 區塊
   - 行 32-53：整個內聯 `<style>...</style>` 區塊（內容已於 Task 1 遷入 index.css）
2. index.html **保留不動**：行 31 Google Fonts `<link>`（D-1e 拍板保留 CDN）、行 54-65 `<script type="importmap">` 整塊（D-1c 範圍，本包一字不動）、其餘結構（root div、/index.tsx module script）。
3. index.tsx 頂部（第 1 行 import React 之前或之後皆可，慣例放最前）加 `import './index.css';`。
  </action>
  <verify>
    <automated>! grep -q 'cdn.tailwindcss.com' index.html && ! grep -q 'tailwind.config' index.html && ! grep -q '<style>' index.html && grep -q 'fonts.googleapis.com' index.html && grep -q 'importmap' index.html && grep -q "import './index.css'" index.tsx && npx tsc --noEmit</automated>
  </verify>
  <done>index.html 無 Play CDN script／內聯 config／內聯 style；Google Fonts link 與 importmap 區塊原樣保留；index.tsx 首部 import index.css；tsc 綠。</done>
</task>

<task type="auto">
  <name>Task 3: 建置驗證＋purge 抽查＋原子 commit</name>
  <files>（驗證與 commit，無新改檔）</files>
  <action>
1. `npm run build` 成功，且 `ls dist/assets/*.css` 出現獨立 CSS asset、`grep -q '\.css' dist/index.html`（HTML 有引用 CSS）。
2. 靜態驗收（全用 Bash 工具跑 grep）：
   - `grep -c 'cdn.tailwindcss.com' dist/index.html` → 0（`grep -c` 回 0 時 exit code 非零，用 `! grep -q` 形式判定）。
   - `grep -c 'esm.sh' dist/index.html` → 6（importmap 未被誤刪，D-1a 基線值）；`grep -c 'fonts.googleapis.com' dist/index.html` → 1。
   - `grep -r "AIza" dist/` → 無結果（金鑰紅線）。
3. purge 抽查（D-1a 14 檔 className 分布的代表 class，確認建置期抽取沒殺錯）——對 dist/assets/*.css 逐一 grep，全部必須命中：`bg-surface`、`text-up`、`text-down`、`rounded-card`、`rounded-ctl`、`max-w-2xl`、`pointer-events-none`（StockChart:918 邊界例）、`animate-spin`、任意值類 `w-\[92\%\]`（Skeleton lineWidths，CSS 內為跳脫形式，用 `grep -F 'w-\[92\%\]'` 或 grep 'w-.92' 寬鬆比對）、`h-\[450px\]`（StockChart:948）；另 grep `::-webkit-scrollbar`（index.css 自訂卷軸進了產物）與自訂色值 `f0405a`（up/danger 色實際落入 CSS）。任何一項未命中＝purge 設定有誤，回頭查 content globs，不得跳過。
4. 全過後下 1 個原子 commit（7 檔：tailwind.config.js、postcss.config.js、index.css、index.html、index.tsx、package.json、package-lock.json），訊息：`feat(phase-d): D-1b Tailwind 改建置期——v3.4+postcss+autoprefixer、內聯 config/style 遷檔、移除 Play CDN`。SUMMARY.md **不 commit**（orchestrator 收尾）。
5. SUMMARY 記錄：新 CSS asset 的 raw/gzip 大小（D-1a 預期收益對照：取代 twCDN 123,343B gzip）、主 chunk JS 大小是否與基線 967.60KB raw 持平（本包不應動 JS 大小）、purge 抽查逐項結果、若有 postcss.config fallback 改 .cjs 記入偏差。
  </action>
  <verify>
    <automated>npm run build && ls dist/assets/*.css && ! grep -q 'cdn.tailwindcss.com' dist/index.html && [ "$(grep -c 'esm.sh' dist/index.html)" = "6" ] && grep -q 'bg-surface' dist/assets/*.css && grep -q 'webkit-scrollbar' dist/assets/*.css && ! grep -rq 'AIza' dist/</automated>
  </verify>
  <done>build 綠＋獨立 CSS asset 存在；dist/index.html 0 處 twCDN、6 處 esm.sh、1 處 Google Fonts；purge 抽查代表 class 全命中；AIza 零洩漏；1 個原子 commit 含全部 7 檔，SUMMARY 未入 commit。</done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` 綠。
- `npm run build` 綠，dist/assets 出現獨立 CSS asset 且 dist/index.html 引用。
- dist/index.html：cdn.tailwindcss.com 0 處、esm.sh 6 處（importmap 原封）、fonts.googleapis.com 1 處。
- dist CSS：bg-surface/text-up/text-down/rounded-card/rounded-ctl/max-w-2xl/pointer-events-none/animate-spin/任意值類（w-[92%]、h-[450px]）全命中＋::-webkit-scrollbar＋色值 f0405a。
- `grep -r "AIza" dist/` 無結果。
- 視覺零回歸（dev＋preview 逐頁比對：市場分析/庫存/基本面/AI modal/圖表 hover 拖曳縮放/自訂卷軸/紅漲綠跌）由 orchestrator 合併後執行，不在 executor 範圍。
</verification>

<success_criteria>
- Tailwind 由執行時 Play CDN 改為建置期 v3.4.x 靜態 CSS，內聯 config 逐鍵全量（colors 8 組／fontFamily 2 鍵／borderRadius 3 鍵）遷入 tailwind.config.js，值零改動。
- content globs＝D-1a 定案三條、無 `.claude/**`、無 safelist。
- index.html 只少三塊（CDN script／內聯 config／內聯 style），Google Fonts 與 importmap 原封。
- 1 個原子 commit（7 檔），可單獨回滾；SUMMARY 留給 orchestrator 收尾。
</success_criteria>

<output>
完成後建 `.planning/quick/260713-len-d-1b-tailwind-tailwindcss-v3-4-x-postcss/260713-len-SUMMARY.md`（不 commit）。
</output>
