# Technology Stack

**Analysis Date:** 2026-05-31

## Languages

**Primary:**
- TypeScript `~5.8.2` - All application source (`App.tsx`, `components/`, `services/`, `utils/`, `types.ts`)
- TSX/JSX - React components (`jsx: "react-jsx"` in `tsconfig.json`)

**Secondary:**
- HTML - Single entry document `index.html`
- Markdown - AI prompt template `prompts/持股庫存健檢系統_AI提示詞_adapted.md`
- Batch script - `start-stock-analyst.bat` (Windows launcher that runs `npx vite --port 3000 --host`)

## Runtime

**Environment:**
- Node.js (version unpinned - no `.nvmrc` or `engines` field). Required only for the Vite dev/build toolchain. `@types/node` `^22.14.0` is installed, implying a Node 22 target.
- Browser runtime: modern ES2022 browser. 所有 npm 依賴由 Vite 打包進 bundle（自 node_modules 解析），不依賴 CDN 載入模組。

**Package Manager:**
- npm
- Lockfile: present (`package-lock.json`, ~154 KB)

## Frameworks

**Core:**
- React `^19.2.3` - UI framework (`react`, `react-dom`). Entry mounts via `ReactDOM.createRoot` in `index.tsx` inside `<React.StrictMode>`. App is a single-component state container (`App.tsx`, ~600 lines) with all view state in `useState` hooks; no router (view toggled by `currentView: 'dashboard' | 'portfolio'`).

**Testing:**
- None detected. No test runner, no test files, no test script in `package.json`.

**Build/Dev:**
- Vite `^6.2.0` - Dev server (port 3000, host `0.0.0.0`) and bundler. Scripts: `dev` (vite), `build` (vite build), `preview` (vite preview).
- `@vitejs/plugin-react` `^5.0.0` - React Fast Refresh / JSX transform for Vite.
- TypeScript `~5.8.2` - Type checking only (`noEmit: true`; transpilation handled by Vite/esbuild). Note: no `typecheck` npm script wired up.

## Key Dependencies

**Critical:**
- `@google/genai` `^1.35.0` - Google Gemini SDK (`GoogleGenAI` client). Core AI engine producing stock analysis. Used in `services/gemini.ts`.
- `react` / `react-dom` `^19.2.3` - Application UI.

**UI / Rendering:**
- `recharts` `^3.6.0` - Charting (price/MA/indicator charts). Used by `components/StockChart.tsx`; data shape = `StockDataPoint` in `types.ts`.
- `lucide-react` `^0.562.0` - Icon set (e.g. `Search`, `Wallet`, `BrainCircuit`, `RefreshCw` imported in `App.tsx`).
- `react-markdown` `^10.1.0` - Renders Gemini's markdown analysis text (`components/AnalysisResult.tsx`).
- `remark-gfm` `^4.0.1` - GitHub-Flavored Markdown plugin for `react-markdown` (tables, etc.).

**Styling:**
- Tailwind CSS v3 (`tailwindcss` `^3.4.19`, build-time devDependency) - 經 PostCSS（`postcss` `^8.5.18`＋`autoprefixer` `^10.5.2`）於建置期產出靜態 CSS；設定在 `tailwind.config.js`，入口樣式 `index.css`（由 `index.tsx` import）。Inter font loaded from Google Fonts (CDN，D-1e 既定決策保留)。Dark slate theme set inline.

**Type Definitions (dev):**
- `@types/node` `^22.14.0` - Node typings for build config (`vite.config.ts` uses `path`).

## Configuration

**Environment:**
- Secrets supplied via a `.env` file (present at repo root; git-ignored). README instructs setting `GEMINI_API_KEY` (it references `.env.local`; runtime loads any env via `loadEnv(mode, '.', '')`).
- `vite.config.ts` injects the key at build time via `define`:
  - `process.env.API_KEY` ← `env.GEMINI_API_KEY`
  - `process.env.GEMINI_API_KEY` ← `env.GEMINI_API_KEY`
  - `services/gemini.ts` reads `process.env.API_KEY` and constructs `new GoogleGenAI({ apiKey: process.env.API_KEY })`. The key is therefore baked into client-side code (see CONCERNS scope).
- Path alias: `@` → project root (defined in both `vite.config.ts` and `tsconfig.json` `paths`). Note: actual source imports use relative paths (`./services/...`), not the `@` alias.

**Build:**
- `vite.config.ts` - Vite config (server port/host, env injection, `@` alias).
- `tsconfig.json` - `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `allowImportingTsExtensions`, `noEmit`, `experimentalDecorators`, `isolatedModules`.
- `index.html` - 入口文件僅含 meta（charset/viewport）、title、Google Fonts link、`<div id="root">`、`/index.tsx` module script；無 importmap（依賴一律由 Vite 從 node_modules 解析打包）。
- `metadata.json` - AI Studio app metadata (English name/description mentioning MA/RSI/MACD/KDJ and "Gemini Pro"; `requestFramePermissions: []`).
- Build output: `dist/` directory (present/committed).

**AI Model Selection (`services/gemini.ts`):**
- Fast mode: `gemini-3.5-flash`
- Thinking mode: `gemini-3.1-pro-preview`
- Some calls hardcode `gemini-3.5-flash` (e.g. entry/secondary analyses around lines 686, 1017).
- Mode chosen at runtime via `analysisMode: 'fast' | 'thinking'` state in `App.tsx`.

## Platform Requirements

**Development:**
- Node.js + npm installed.
- `GEMINI_API_KEY` configured in `.env`.
- `npm install` then `npm run dev` (or `start-stock-analyst.bat` on Windows, which hardcodes the project path `D:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4`).

**Production:**
- Static build (`vite build` → `dist/`). Project originates from Google AI Studio (README links ai.studio app). Deployable to any static host. Note: runtime third-party CDN 依賴僅剩 Google Fonts 與 public CORS proxies（行情鏈）。
- UI language is Traditional Chinese (`<html lang="zh-TW">`, app title "Taiwan Stock AI Analyst"; many in-code comments and the prompt template are in Chinese).

---

*Stack analysis: 2026-05-31*
*Updated 2026-07-13: D-1b build-time Tailwind + D-1c importmap removal（依賴單軌化）*
