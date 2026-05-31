# Coding Conventions

**Analysis Date:** 2026-05-31

> Scope: application source only — `App.tsx`, `index.tsx`, `types.ts`,
> `components/`, `services/`, `utils/`, `prompts/`. The `.claude/` directory
> (GSD tooling) and `node_modules/` are excluded.

## Naming Patterns

**Files:**
- React components: **PascalCase** `.tsx`, one component per file —
  `components/AnalysisResult.tsx`, `components/Sidebar.tsx`,
  `components/StockSearch.tsx`, `components/Portfolio.tsx`,
  `components/StockChart.tsx`, `components/EntryChecklist.tsx`.
- Services & utilities: **camelCase** `.ts` — `services/yahoo.ts`,
  `services/gemini.ts`, `services/stockDirectory.ts`, `utils/math.ts`,
  `utils/volume.ts`, `utils/entryFilter.ts`.
- Shared types: single root `types.ts`.
- Entry: `index.tsx` mounts root `App.tsx` (both at repo root, no `src/`).

**Functions:**
- camelCase throughout. Exported util/service functions are descriptive verbs:
  `calculateSMA`, `calculateRSI`, `calculateMACD`, `calculateKDJ`,
  `calculateBollingerBands` (`utils/math.ts`); `getStockData`,
  `getLatestPrice` (`services/yahoo.ts`); `analyzeStockWithGemini`,
  `analyzeEntryWithGemini`, `analyzeTradeDecision`, `analyzePortfolioHealth`
  (`services/gemini.ts`); `runEntryFilter` (`utils/entryFilter.ts`);
  `estimateVolumeTrend` (`utils/volume.ts`); `searchStocks`, `searchTaiwan`,
  `searchYahoo`, `ensureTaiwanDirectory` (`services/stockDirectory.ts`).
- Internal helpers are also camelCase and often module-private (not exported):
  `formatPromptData`, `formatHealthCheckData` (`services/gemini.ts`);
  `detectSwings`, `classifyTrend`, `trendOf`, `fmt` (`utils/entryFilter.ts`);
  `queryYahoo`, `fetchRawData`, `processYahooResult`, `fetchFinMindStockInfo`
  (`services/yahoo.ts`).
- React event handlers use the `handle*` prefix: `handleRunAnalysis`,
  `handlePortfolioAdd`, `handleZoom`, `handleMouseMove`, `handleSingleHealthCheck`.
- Boolean locals/derived flags use `is*`/`has*`/`pass*` prefixes:
  `isTaiwanStock`, `isRedCandle`, `isAttackVol`, `hasChipData`, `hasHolding`,
  `passPriceCheck`, `passVolumeCheck` (`App.tsx`, `services/gemini.ts`,
  `utils/entryFilter.ts`).

**Variables:** camelCase. Module-level constants are UPPER_SNAKE_CASE:
`PROXIES`, `YAHOO_BASE`, `FINMIND_BASE` (`services/yahoo.ts`); `FINMIND`,
`LS_KEY`, `LS_TS`, `TTL` (`services/stockDirectory.ts`); `Y_AXIS_WIDTH`
(`components/StockChart.tsx`).

**Types:**
- Interfaces & type aliases: **PascalCase** — `StockDataPoint`, `StockInfo`,
  `PortfolioItem`, `IndicatorSettings`, `TimeInterval` (`types.ts`);
  `EntryFilterResult`, `FilterStep`, `StepStatus`, `Decision`
  (`utils/entryFilter.ts`); `VolumeProjection` (`utils/volume.ts`);
  `StockDirEntry`, `Market` (`services/stockDirectory.ts`);
  `PortfolioHealthItem` (`services/gemini.ts`).
- String-literal union types are used heavily instead of enums:
  `type TimeInterval = '15m' | '60m' | '1d' | '1wk' | '1mo'` (`types.ts`);
  `type StepStatus = 'pass' | 'warn' | 'fail'`,
  `type Decision = 'GO' | 'WAIT' | 'NO_GO'` (`utils/entryFilter.ts`);
  `type Market = 'TW' | 'US' | 'OTHER'`; `type AppView = 'dashboard' |
  'portfolio'` (declared locally in both `App.tsx` and `components/Sidebar.tsx`).
  Inline field unions are common too, e.g. `ma5Dir?: 'up' | 'down' | 'flat'`.

## Code Style

**Formatting:**
- No formatter configured (no `.prettierrc`, `.editorconfig`, no Prettier dep).
- De-facto style observed across all files: 2-space indent, single quotes,
  semicolons present, trailing commas in multiline literals. Some files use
  extra alignment whitespace in object literals (e.g. `Portfolio.tsx` aligns
  `useState` declarations and form fields in columns) — match the local file.
- Bilingual code is the norm: comments and many user-facing strings are in
  Traditional Chinese; identifiers are English. Section dividers use box-drawing
  comment banners (`// ── ... ──`) — follow this when adding sections.

**Linting:**
- No linter configured (no ESLint/Biome dep, no config file). One inline
  `// eslint-disable-next-line react-hooks/exhaustive-deps` exists in
  `components/Portfolio.tsx` (line ~609), implying ESLint may have been run
  ad-hoc historically, but it is not part of the committed toolchain.

## TypeScript Configuration

From `tsconfig.json`:
- `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`.
- `jsx: react-jsx` — automatic runtime; `React` import is still written
  explicitly in every component (existing convention — keep doing it).
- `noEmit: true` (Vite/esbuild transpiles); `allowImportingTsExtensions: true`;
  `allowJs`, `isolatedModules`, `moduleDetection: force`.
- **`strict` is NOT enabled.** Consequence: implicit `any` is allowed and used.
  The codebase leans on this — note `config: any` in `services/gemini.ts`,
  `const p: any = {}` accumulators in `services/yahoo.ts`, and `(props: any)`
  for Recharts custom shapes/tooltips in `components/StockChart.tsx`. When the
  shape is known, prefer explicit interfaces (as `types.ts` does); fall back to
  `any` only for third-party callback payloads, matching existing usage.

## Import Organization

**Order (observed):**
1. React (`import React, { useState, ... } from 'react'`).
2. Other third-party packages (`recharts`, `lucide-react`, `react-markdown`,
   `remark-gfm`, `@google/genai`).
3. Local modules via relative paths (`./types`, `../utils/math`,
   `../services/yahoo`).

**Path style:** Components/services/utils import each other with **relative**
paths (`../types`, `../utils/math`). The `@/*` alias is configured in
`tsconfig.json` and `vite.config.ts` but is **not** used in app source —
relative imports are the actual convention. Match relative imports for
consistency.

## Error Handling

- Service functions that require the key throw early:
  `if (!process.env.API_KEY) throw new Error("API Key is missing.");` at the
  top of every Gemini call (`services/gemini.ts`).
- Network/parse failures are caught and logged with `console.warn` /
  `console.error`, then either return a safe fallback (`[]`, `null`) or rethrow
  a normalized `Error`. Examples: proxy rotation in `queryYahoo`, the
  Yahoo→FinMind fallback in `getStockData` (`services/yahoo.ts`), and
  `catch { /* ignore */ }` for non-critical paths (`stockDirectory.ts`).
- UI layer catches with `catch (err: any)` and sets an error state string
  (`App.tsx` `fetchData`), or renders a fallback markdown error message
  (`App.tsx` `handleRunAnalysis`, `Portfolio.tsx` health-check handlers).
- Empty `catch {}` blocks with an explanatory comment are an accepted pattern
  for best-effort enrichment (e.g. weekly-data fetch in `App.tsx`).

## Logging

- No logging library — `console.warn` for recoverable issues, `console.error`
  for caught exceptions before rethrow, `console.log` sparingly for fallback
  tracing (`services/yahoo.ts`). Keep `console.warn` for non-fatal paths.

## Comments

- No JSDoc/TSDoc convention. Comments are inline `//` (often Chinese),
  describing business rules (the 朱家泓 "六六大順" trading logic in
  `utils/entryFilter.ts` and the rule library in `services/gemini.ts`).
- Use comments to explain non-obvious financial/domain logic and numeric
  thresholds (e.g. why volume ratio > 1.3 = "攻擊量"), not to restate code.

## Function & Module Design

- **Exports:** Components use `export default` at end of file plus a
  `const X: React.FC<Props> = ...` declaration. Services/utils use **named**
  `export const` / `export function`; types use `export interface` /
  `export type`. No barrel `index.ts` files — import from concrete paths.
- **Component typing:** `React.FC<Props>` with a dedicated `interface XProps`
  declared just above the component (`StockChartProps`, `SidebarProps`,
  `PortfolioProps`, `StockSearchProps`, `AnalysisResultProps`). Inline prop
  types are used for tiny components (`EntryChecklist`, sub-tooltips).
- **Hooks:** `useState`/`useEffect`/`useMemo`/`useCallback`/`useRef`. Expensive
  derived data is memoized (`maResultsCache`, `displayData`, cell arrays in
  `StockChart.tsx`). `useCallback` wraps handlers passed down or used in effect
  deps. Lazy `useState` initializers read `localStorage` (`App.tsx`
  `portfolioItems`). Persisted state mirrors to `localStorage` via an effect.
- **Pure utils:** `utils/math.ts` functions are pure, take/return number arrays,
  default parameters for periods (`period: number = 14`), and guard short input
  (`if (data.length < period) return new Array(...).fill(null)`). Indicator
  outputs are `(number | null)[]` with `null` padding for the warm-up window.
- **Domain layering:** indicators (`utils/math.ts`) → data assembly
  (`services/yahoo.ts`) → objective rule filter (`utils/entryFilter.ts`) → AI
  interpretation (`services/gemini.ts`) → UI. The filter pre-computes the
  GO/WAIT/NO_GO decision in code; Gemini only narrates it (see the explicit
  comment banner in `services/gemini.ts` `analyzeEntryWithGemini`). Preserve
  this separation — do not move rule logic into prompts.

## Styling

- **Tailwind CSS utility classes** inline in `className` (no CSS modules,
  no styled-components). Tailwind is loaded via `index.html` (not a build dep
  in `package.json`). Dark theme: `slate-800/900` surfaces, `blue/indigo`
  accents. Domain color convention: **red = up/bullish, green/emerald =
  down/bearish** (Taiwan market convention) — see candle colors in
  `StockChart.tsx` (`#ef4444` up, `#10b981` down) and `AnalysisResult.tsx`
  keyword coloring. Keep this inverted-from-Western mapping.
- Icons come from `lucide-react`; charts from `recharts`; AI markdown via
  `react-markdown` + `remark-gfm` with custom component renderers
  (`AnalysisResult.tsx`).

## Environment & Secrets

- `.env` holds `GEMINI_API_KEY` (git-ignored). Build-time injection in
  `vite.config.ts` `define` exposes it as `process.env.API_KEY` /
  `process.env.GEMINI_API_KEY`. Service code reads `process.env.API_KEY`.
  Never hardcode or echo the key value.

## Where to Add New Code

- New UI component → `components/<PascalCase>.tsx`, `React.FC<Props>` + default
  export, Tailwind classes, red/green = up/down.
- New data/AI integration → `services/<camelCase>.ts`, named exports,
  `process.env.API_KEY` guard for AI calls, proxy + fallback for network.
- New pure calculation → `utils/<camelCase>.ts`, pure functions over arrays,
  null-padded warm-up, default-param periods.
- New shared type → root `types.ts` (or co-located `export interface` next to
  its sole consumer, as services do for their result types).

---

*Convention analysis: 2026-05-31*
