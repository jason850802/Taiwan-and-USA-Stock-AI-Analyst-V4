# Technology Stack

**Analysis Date:** 2026-10-01（整份對照現況核對；原始分析 2026-05-31）

> 2026-10-01 逐點核對並修正，改動處附對證的指令或檔案。主要更正：金鑰不再經 `vite.config.ts` 的
> `define` 注入前端（2026-07-05 起只在後端）；Gemini SDK 與型號移到後端；補上後端執行環境與
> `@upstash/*`；`dist/` 不進 git；部署目標是 Vercel（靜態前端＋Serverless 函式），不是任意靜態主機。
> 數字（行數、檔案大小）是 2026-10-01 的快照。與 `CORE_RULES.md` 衝突時以 CORE_RULES 為準。

## Languages

**Primary:**
- TypeScript `~5.8.2` - 前端（`App.tsx`、`index.tsx`、`types.ts`、`components/`、`services/`、`utils/`、
  `config/`）與後端（`api/`）的全部原始碼
- TSX/JSX - React components (`jsx: "react-jsx"` in `tsconfig.json`)

**Secondary:**
- HTML - Single entry document `index.html`
- Markdown - `prompts/持股庫存健檢系統_AI提示詞_adapted.md`：參考用的 prompt 文件，程式沒有引用它
  （`git grep -n "prompts/" -- '*.ts' '*.tsx'` 無命中）；實際的 system instruction 寫在 `services/gemini.ts`
- JavaScript（ESM）- 開發腳本 `scripts/*.mjs`（例：`scripts/run-gate.mjs`＝`npm run gate`），以及
  `postcss.config.js`、`tailwind.config.js`
- Python - `scripts/sync_skills_mirror.py`（`npm run sync:skills`）與 `.claude/skills/_shared/*.py`
  （skill 的抓資料腳本）
- Batch script - `start-stock-analyst.bat`（舊的 Windows 啟動腳本，已過時，見 Platform Requirements）

## Runtime

**Environment:**
- Node.js：版本沒有在 repo 釘住（沒有 `.nvmrc`、`package.json` 沒有 `engines`、沒有 `vercel.json`）；
  `@types/node` 是 `^22.14.0`。本機用途：Vite 開發／建置、vitest、`npm run gate`，以及 `vercel dev`
  跑後端函式。
- Browser（前端）：modern ES2022 browser。前端用到的 npm 依賴由 Vite 從 `node_modules` 打包進 bundle，
  不從 CDN 載入模組（esm.sh importmap 已於 2026-07-13 `e6e4140` 移除）。
- Vercel Serverless Functions（後端）：`api/` 內非 `_`／`.` 開頭的 `.ts` 各部署成一支函式，目前 5 支——
  `api/gemini.ts`、`api/gemini-stream.ts`、`api/finmind.ts`、`api/yahoo/chart.ts`、`api/yahoo/search.ts`；
  共用模組在 `api/_lib/`。後端專用依賴（`@google/genai`、`@upstash/*`）只被 `api/` import，不進前端 bundle。
  - 對證：`git ls-files api/ ':!api/_lib/*' ':!*.test.ts'`。`api/` 底下的測試檔由 `.vercelignore` 排除部署
    （`utils/vercelIgnoreGuard.test.ts` 鎖住）。

**Package Manager:**
- npm
- Lockfile: present (`package-lock.json`，199,384 bytes ≈ 195 KB)

## Frameworks

**Core:**
- React `^19.2.3` - UI framework (`react`, `react-dom`). Entry mounts via `ReactDOM.createRoot` in
  `index.tsx` inside `<React.StrictMode>`，`<App />` 外層包 `components/ErrorBoundary.tsx`。`App.tsx`（631 行）是根容器，
  儀表板狀態用 `useState`；庫存分頁的狀態邏輯拆在 `components/portfolio/use*.ts` hooks。沒有 router：以
  `currentView` 切換三個分頁（`type AppView = 'dashboard' | 'portfolio' | 'fundamentals'`，`App.tsx:54`、
  `:92`）。`Portfolio`、`FundamentalsPanel`、`StockChart`、`AnalysisResult` 以 `lazy()` 載入（`App.tsx:27-30`；
  後兩個由 `utils/appLazyBoundaries.test.ts` 鎖住）。

**Testing:**
- Vitest（devDependency `~3.2.7`，2026-07-13 `6ed7713` 建立跑道）：`npm run test`（＝`vitest run`），
  機械驗收 `npm run gate` 的第 2 道就是它；設定寫在 `vite.config.ts` 的 `test` 區塊。2026-09-30 時
  49 個測試檔、811 個案例。現況、慣例與已知缺口見同目錄的 `TESTING.md`（本點 2026-10-01 更正，
  舊版寫「沒有測試」）。

**Build/Dev:**
- Vite `^6.2.0` - Dev server（port 3000、host `0.0.0.0`；`server.proxy` 把 `/api` 轉給 `http://localhost:3001`
  的 `vercel dev`）and bundler. npm scripts：`dev`（`vite`）、`build`（`vite build`）、`preview`（`vite preview`）、
  `test`（`vitest run`）、`gate`（`node scripts/run-gate.mjs`，機械驗收五道）、`sync:skills`
  （`python scripts/sync_skills_mirror.py`，同步 skills 鏡像）。
- `@vitejs/plugin-react` `^5.0.0` - React Fast Refresh / JSX transform for Vite.
- TypeScript `~5.8.2` - Type checking only (`noEmit: true`; transpilation handled by Vite/esbuild). 沒有獨立的
  `typecheck` script；型檢是 `npm run gate` 的第 1 道（`npx tsc --noEmit`）。

## Key Dependencies

**Critical:**
- `@google/genai` `^1.35.0` - Google Gemini SDK（`GoogleGenAI` client），**只在後端**：`api/_lib/http.ts` 的
  `callGeminiWithTimeout` 每次呼叫 `new GoogleGenAI({ apiKey })`。前端 `services/gemini.ts` 不 import 它，
  改打 `/api/gemini`、`/api/gemini-stream`。
  - 對證：`git grep -n -E '@google/genai|GoogleGenAI' -- '*.ts' ':!*.test.ts'` 只命中 `api/_lib/http.ts`。
- `react` / `react-dom` `^19.2.3` - Application UI.

**Backend（`api/`）:**
- `@upstash/ratelimit` `^2.0.8`＋`@upstash/redis` `^1.38.0` - `/api/*` 的跨實例限流（`api/_lib/ratelimit.ts`）：
  Gemini 每 IP 10 次／分＋100 次／日，行情與 FinMind 每 IP 60 次／分。沒設 `UPSTASH_REDIS_REST_URL`／
  `UPSTASH_REDIS_REST_TOKEN` 時不限流；Upstash 出錯時放行（fail-open）。

**UI / Rendering:**
- `recharts` `^3.6.0` - 圖表：`components/StockChart.tsx`（K 線／均線／指標，資料形狀＝`types.ts` 的
  `StockDataPoint`）、`components/fundamentals/MonthlyRevenueChart.tsx`、
  `components/fundamentals/QuarterlyTrendCharts.tsx`、`components/portfolio/PnlHistoryChart.tsx`。
- `lucide-react` `^0.562.0` - Icon set (e.g. `Search`, `Wallet`, `BrainCircuit` imported in `App.tsx`).
- `react-markdown` `^10.1.0`＋`remark-gfm` `^4.0.1` - AI 報告的 Markdown 渲染（含 GFM 表格），集中在
  `components/ui/MarkdownReport.tsx`，由 `AnalysisResult.tsx` 與 `Portfolio.tsx` 使用。

**Styling:**
- Tailwind CSS v3 (`tailwindcss` `^3.4.19`, build-time devDependency) - 經 PostCSS（`postcss` `^8.5.18`＋
  `autoprefixer` `^10.5.2`）於建置期產出靜態 CSS；設定在 `tailwind.config.js`（含語意色 token，見
  `CONVENTIONS.md` 的 Styling），入口樣式 `index.css`（由 `index.tsx` import，也設 `body` 的深色底）。
  字型 Inter＋JetBrains Mono 由 Google Fonts CDN 載入（`index.html:7`，D-1e 既定決策保留）。

**Testing (dev):**
- `vitest` `~3.2.7` - 見上方 Frameworks 的 Testing 與 `TESTING.md`。

**Type Definitions (dev):**
- `@types/node` `^22.14.0` - Node typings（`tsconfig.json` 的 `types: ["node"]`；`vite.config.ts` 用 `path`）。
- `@types/react` `^19.2.14`、`@types/react-dom` `^19.2.3`。

## Configuration

**Environment:**
- 秘密只在後端（金鑰紅線，`CORE_RULES.md` Constraints）：正式環境放 Vercel 環境變數（清單與設定步驟見
  `docs/DEPLOYMENT.md`），本機放根目錄 `.env`（`.gitignore` 排除 `.env`、`.env.*`，範本 `.env.example`
  進 git）。`GEMINI_API_KEY` 由 `api/_lib/config.ts` 的 `getGeminiApiKey()` 讀 `process.env`；其餘後端設定
  也只在 `api/` 內讀。
- `vite.config.ts` **沒有 `define`**，只設 `envPrefix: 'VITE_'`：只有 `VITE_` 前綴的變數會被內聯進前端
  bundle（目前只有 `VITE_PROXY_SECRET`，設計上不是機密），`GEMINI_API_KEY` 進不去。這條由
  `utils/viteConfigGuard.test.ts` 鎖住（2026-07-26 `dab7508`，gate-audit G3）。
  - 舊版記載的 `define` 注入（`process.env.API_KEY`／`process.env.GEMINI_API_KEY` ← `env.GEMINI_API_KEY`）
    已於 2026-07-05 `0d2800e` 移除。前端的 AI 呼叫改經 `services/gemini.ts` 的 `callGeminiApi`／
    `callGeminiApiStream` 打 `/api/gemini`、`/api/gemini-stream`；缺金鑰時由後端 `api/_lib/llm.ts` 丟
    `ClassifiedError('MISSING_KEY')`。
  - 對證：`git grep -c 'process.env.API_KEY' -- services/ components/ App.tsx` 無命中；變數清單見 `.env.example`。
- Path alias: `@` → project root (defined in both `vite.config.ts` and `tsconfig.json` `paths`). Actual source
  imports use relative paths (`./services/...`), not the `@` alias（`git grep -n "from '@/" -- '*.ts' '*.tsx'` 無命中）。

**Build:**
- `vite.config.ts` - Vite＋vitest 設定：dev server（3000／`0.0.0.0`，不監看 `.claude/`）、`/api` proxy 到
  `http://localhost:3001`、`envPrefix: 'VITE_'`、`@` alias、`test` 區塊（排除 `.claude/`）、
  `build.rollupOptions.output.manualChunks` 把 React 分到 `vendor` chunk。
- `tsconfig.json` - `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`,
  `allowImportingTsExtensions`, `noEmit`, `experimentalDecorators`, `isolatedModules`, `allowJs`；非 strict；
  `exclude` 的內容與理由見 `CONVENTIONS.md` 的 TypeScript Configuration。
- `index.html` - 入口文件僅含 meta（charset/viewport）、title、Google Fonts link、`<div id="root">`、
  `/index.tsx` module script；無 importmap（依賴一律由 Vite 從 node_modules 解析打包）。
- `metadata.json` - AI Studio app metadata (English name/description mentioning MA/RSI/MACD/KDJ and
  "Gemini Pro"; `requestFramePermissions: []`).
- Build output：`dist/`（`.gitignore:11` 排除、不進 git；`tsconfig.json` 也 exclude 它）。

**AI Model Selection（後端 `api/_lib/config.ts`）:**
- `getModelForMode(mode)`：`fast` → `GEMINI_MODEL_FAST`，未設或只有空白時用 `gemini-3.5-flash`；
  `thinking` → `GEMINI_MODEL_THINKING`，同理用 `gemini-3.1-pro-preview`。`.env.example` 列同一組預設值。
- 前端只傳 `mode`、不含型號字串（`git grep -n -E 'gemini-[0-9]' -- App.tsx components/ services/ utils/
  ':!*.test.ts'` 無命中）。`analyzeEntryWithGemini` 用使用者在 `App.tsx` 選的 `analysisMode`
  （`'fast' | 'thinking'`，`App.tsx:90`）；`analyzeTradeDecision`、`analyzePortfolioHealth`、
  `analyzeFundamentals` 固定送 `mode: 'fast'`（`services/gemini.ts`）。
- `LLM_PROVIDER=claude-cli`（只在本機 `vercel dev` 用）改走本機 Claude Code CLI，型號另由
  `CLAUDE_CLI_MODEL_FAST`／`CLAUDE_CLI_MODEL_THINKING` 決定（`api/_lib/llm.ts`、`.env.example`）。
- 改型號（或改 `LLM_PROVIDER`）要動三處，見 `CORE_RULES.md`「本專案關鍵事實」。

## Platform Requirements

**Development:**
- Node.js + npm installed；`npm install`。
- 本機 `.env` 至少設 `GEMINI_API_KEY`（其餘選填變數見 `.env.example`）。
- 前後端各起一個 server：後端 `npx vercel dev --listen 3001`、前端 `npm run dev`（3000），瀏覽器開
  `http://localhost:3000`，前端的 `/api` 由 Vite proxy 轉給 3001（`README.md`「在地執行」；固定流程見
  `start-dev` skill）。
- `start-stock-analyst.bat` 已過時：只跑 `npx vite --port 3000 --host`、不起後端（AI、行情、FinMind 都要
  `/api/*`），而且 `cd` 寫死 `D:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4`。

**Production:**
- Vercel：`vite build` 產出的靜態前端（`dist/`）＋`api/` 的 Serverless 函式；repo 沒有 `vercel.json`
  （零設定），部署排除清單在 `.vercelignore`。AI、行情、FinMind 都經 `/api/*`，所以**不能只當靜態站
  部署到任意主機**。環境變數與 Upstash 設定見 `docs/DEPLOYMENT.md`。
- 執行期唯一的第三方 CDN 是 Google Fonts（`index.html:7`）；舊版列的 public CORS proxies 已於 2026-07-05
  `e7da3c7` 移除。
- UI language is Traditional Chinese (`<html lang="zh-TW">`, app title "Taiwan Stock AI Analyst"; many
  in-code comments and the prompt template are in Chinese).
- 專案源自 Google AI Studio：`metadata.json` 是當時的中繼資料；README 的 ai.studio 連結已在 2026-07-12
  `3421046` 重寫 README 時拿掉。

---

*Stack analysis: 2026-05-31*
*Updated 2026-07-13: D-1b build-time Tailwind + D-1c importmap removal（依賴單軌化）*
*Updated 2026-10-01: 先只改 Testing 一點（指向 `TESTING.md` 現況）；同日第二輪整份核對（見檔頭）*
