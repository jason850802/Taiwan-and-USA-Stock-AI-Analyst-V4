# Codebase Structure

**Analysis Date:** 2026-05-31

## Directory Layout

```
Taiwan-and-USA-Stock-AI-Analyst-V4/
├── index.html               # HTML shell; #root, Tailwind CDN, esm.sh importmap, loads index.tsx
├── index.tsx                # React bootstrap (ReactDOM.createRoot)
├── App.tsx                  # Root container: dashboard state + analysis pipeline (421 lines)
├── types.ts                 # Shared domain interfaces (128 lines)
├── metadata.json            # App metadata
├── vite.config.ts           # Vite config: @ alias, env injection, dev port 3000
├── tsconfig.json            # TypeScript config
├── package.json             # Deps + scripts (dev/build/preview)
├── package-lock.json
├── start-stock-analyst.bat  # Windows launcher script
├── README.md
├── .env.local               # GEMINI_API_KEY (gitignored, secret — never read)
├── components/              # Presentational React components (default exports)
│   ├── Sidebar.tsx              # interval / indicator toggles / view switch (223)
│   ├── StockSearch.tsx          # autocomplete search (156)
│   ├── StockChart.tsx           # Recharts chart (636)
│   ├── AnalysisResult.tsx       # markdown report renderer (85)
│   ├── EntryChecklist.tsx       # six-step filter result UI (111)
│   └── Portfolio.tsx            # holdings + AI health check (1379)
├── services/               # External data + AI access
│   ├── yahoo.ts                 # Yahoo + FinMind fetch/normalize/indicators (722)
│   ├── stockDirectory.ts        # TW directory + Yahoo search, cached (135)
│   └── gemini.ts                # Gemini calls + prompt builders (1030)
├── utils/                  # Pure compute (no I/O)
│   ├── math.ts                  # SMA/EMA/RSI/MACD/KDJ/Bollinger (168)
│   ├── entryFilter.ts           # 六六大順 long-entry filter (282)
│   └── volume.ts                # intraday volume projection (107)
├── prompts/
│   └── 持股庫存健檢系統_AI提示詞_adapted.md   # reference prompt text (Chinese)
└── .claude/                # Tooling + user skills (NOT the runtime app)
    ├── get-shit-done/          # GSD tooling (gitignored)
    └── skills/                 # Chu Chia-hung (朱家泓) entry-analysis Claude skills
        ├── _shared/fetch_stock.py
        ├── trend-analysis/  ma-structure/  position-analysis/
        ├── kline-signal/  volume-analysis/  indicator-analysis/
        └── entry-decision/
```

## Directory Purposes

**Project root:**
- Purpose: Entry points, configuration, shared types.
- Key files: `App.tsx`, `types.ts`, `index.tsx`, `vite.config.ts`.

**components/:**
- Purpose: React UI. Most are presentational (props + callbacks from `App.tsx`); `Portfolio.tsx` is a large self-contained feature that calls services directly.
- Convention: default-exported function components, Tailwind utility classes, `lucide-react` icons.
- Key files: `StockChart.tsx`, `Portfolio.tsx`, `StockSearch.tsx`.

**services/:**
- Purpose: All external I/O — market data, symbol directory, and AI inference. Async functions returning typed domain objects or markdown strings.
- Key files: `yahoo.ts` (the central data pipeline), `gemini.ts`, `stockDirectory.ts`.

**utils/:**
- Purpose: Pure deterministic computation; no network, no React. Safe to unit test in isolation.
- Key files: `math.ts`, `entryFilter.ts`, `volume.ts`.

**prompts/:**
- Purpose: Reference/adapted prompt documentation (markdown). The active prompts live inline in `services/gemini.ts`.

**.claude/skills/:**
- Purpose: User-authored Chu Chia-hung (朱家泓) entry-analysis Claude skills + a shared `fetch_stock.py`. Domain knowledge, not part of the TS runtime.

## Key File Locations

**Entry Points:**
- `index.html`: HTML shell with `#root`, Tailwind CDN, esm.sh importmap.
- `index.tsx`: mounts the app.
- `App.tsx`: root component and dashboard orchestrator.

**Configuration:**
- `vite.config.ts`: build config, `@` alias → root, `GEMINI_API_KEY` injection, port 3000.
- `tsconfig.json`: TypeScript options.
- `.env.local`: holds `GEMINI_API_KEY` (gitignored; never read contents).

**Core Logic:**
- `services/yahoo.ts`: market data fetch + indicator computation.
- `utils/entryFilter.ts`: objective entry decision engine.
- `services/gemini.ts`: AI report generation.
- `types.ts`: shared domain contracts.

**Testing:**
- None present (no test files, runner, or config).

## Naming Conventions

**Files:**
- Components: `PascalCase.tsx` (e.g. `StockChart.tsx`).
- Services / utils: `camelCase.ts` (e.g. `entryFilter.ts`, `stockDirectory.ts`). Note: service files use short names (`yahoo.ts`, `gemini.ts`), not `*Service.ts`.
- Config / shared: lowercase (`types.ts`, `vite.config.ts`).

**Directories:**
- lowercase, plural by role: `components/`, `services/`, `utils/`, `prompts/`.

**Symbols:**
- Components: default-exported `PascalCase` consts/functions.
- Services/utils: named exports (`getStockData`, `runEntryFilter`, `calculateSMA`).
- Interfaces/types: `PascalCase` (`StockDataPoint`, `EntryFilterResult`, `IndicatorSettings`).
- Some shared types are exported from util/service modules (e.g. `EntryFilterResult` from `utils/entryFilter.ts`, `VolumeProjection` from `utils/volume.ts`) rather than from `types.ts`.

## Where to Add New Code

**New UI component:**
- Implementation: `components/<Name>.tsx` (default export, typed props interface).
- Wire into `App.tsx` (dashboard) or compose inside `Portfolio.tsx` for portfolio features; pass state/callbacks as props.

**New external data source / integration:**
- Implementation: `services/<name>.ts` exporting async functions returning domain types.
- Reuse the proxy-rotation pattern from `services/yahoo.ts`; return normalized `StockDataPoint[]` so charts/filter/prompts work unchanged.

**New indicator or deterministic rule:**
- Indicator math: add to `utils/math.ts` and wire into `services/yahoo.ts:getStockData` so it lands on every `StockDataPoint`.
- New entry/exit rule: extend `utils/entryFilter.ts` (keep it pure).

**New AI feature:**
- Add an exported function + prompt/systemInstruction builder to `services/gemini.ts`. Prefer feeding it an objective result object (like `EntryFilterResult`) and instructing the model not to override it. Consider extracting shared formatters to a `prompts/` module.

**New domain type:**
- Add to `types.ts` for cross-cutting types; co-locate feature-specific result types with their producing module (the existing pattern).

## Special Directories

**.claude/get-shit-done/:**
- Purpose: GSD tooling/machinery. Generated: Yes. Committed: No (gitignored).

**.claude/skills/:**
- Purpose: User-authored Chu Chia-hung analysis skills. Generated: No. Committed: Yes.

**.planning/codebase/:**
- Purpose: Generated codebase-map documents (this file). Generated: Yes.

**node_modules/:**
- Purpose: Dependencies. Committed: No.

---

*Structure analysis: 2026-05-31*
