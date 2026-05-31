# Testing Patterns

**Analysis Date:** 2026-05-31

## Summary: No Automated Tests

**This project has no automated testing of any kind.** Verified findings:

- `package.json` scripts are only `dev`, `build`, `preview` — no `test`,
  `test:watch`, `coverage`, or `lint`.
- `devDependencies` contains **no** test framework: no Jest, Vitest, Mocha,
  Jasmine, Testing Library, Playwright, or Cypress. (Deps are only
  `@types/node`, `@vitejs/plugin-react`, `typescript`, `vite`.)
- **No** test files exist in application source — no `*.test.ts(x)`,
  `*.spec.ts(x)`, `__tests__/`, or `e2e/`. (The only `*.test.tsx` matches on
  disk are inside `node_modules/@reduxjs/toolkit/`, i.e. third-party package
  tests — a transitive dependency, not this app's tests.)
- **No** runner config: no `jest.config.*`, `vitest.config.*`,
  `playwright.config.*`, or `cypress.config.*`.

## Test Framework

- **None installed.**

## Run Commands

No test command exists. Available scripts:

```bash
npm run dev       # Vite dev server, port 3000, host 0.0.0.0
npm run build     # Production build via Vite
npm run preview   # Preview the production build
```

## Current Quality Safety Net

- TypeScript type-checking during the Vite/esbuild build only. Note
  `tsconfig.json` does **not** set `strict`, and the code uses `any` freely
  (`config: any` in `services/gemini.ts`, `(props: any)` Recharts callbacks in
  `components/StockChart.tsx`), so type coverage is partial.
- No linter, no formatter (see CONVENTIONS.md) — no static analysis beyond loose TS.
- Verification is manual / in-browser via `npm run dev`.

## Test Coverage Gaps (entire app is untested)

Highest-value, deterministic, pure-logic targets to cover first:

| Area | File | Why it matters |
|------|------|----------------|
| Indicators (SMA/EMA/RSI/MACD/KDJ/Bollinger) | `utils/math.ts` | Pure array→array math with warm-up `null` padding, Wilder smoothing, and a known divide-by-zero guard path in `calculateRSI` (`avgLoss === 0`). Easy to unit test against reference values. |
| Entry filter rules | `utils/entryFilter.ts` | Encodes the core 「六六大順」 GO/WAIT/NO_GO decision, SOP 6-checks, precept hits, confidence scoring, swing detection (`detectSwings`/`classifyTrend`). Deterministic given `StockDataPoint[]`. |
| Intraday volume projection | `utils/volume.ts` | Time-of-day weight curves for TW/US markets, `Insufficient`/`Intraday`/`Closed` status transitions, pre-market guard. Pure given a fixed clock — inject/mocked `Date`. |
| Yahoo response parsing & weekly/monthly merge | `services/yahoo.ts` | `processYahooResult`, period aggregation, intraday timestamp shifting — brittle to upstream JSON shape. Test pure transforms with recorded fixtures. |
| Stock directory search | `services/stockDirectory.ts` | `searchTaiwan` ranking (id-prefix → name-contains → id-contains), CJK detection, dedup in `searchStocks`. |
| Gemini prompt assembly | `services/gemini.ts` | `formatPromptData` / `formatHealthCheckData` build the prompt strings; mock `@google/genai`, never call the live API. |
| Portfolio fee/PnL math | `components/Portfolio.tsx` | `calcTwBuyFee`, `calcTwSellFeeAndTax`, `calcUsFee`, `getTaxRate`, currency conversion — money math worth pinning down (currently embedded in the component; consider extracting to `utils/` to make testable). |

UI components (`App.tsx`, `components/*.tsx`) are a secondary priority and need
a DOM environment.

## Recommended Setup (if/when tests are added)

Vite is already present, so **Vitest** is the natural fit:

```bash
npm i -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

Suggested `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest",
"coverage": "vitest run --coverage"
```

Conventions to adopt:
- Co-locate tests next to source (`utils/math.test.ts`) or a `tests/` mirror —
  pick one and stay consistent.
- Mock `@google/genai` in `services/gemini.ts` tests; never hit the live API
  (it costs money and needs `GEMINI_API_KEY`).
- Mock `fetch` for `services/yahoo.ts` and `services/stockDirectory.ts` with
  recorded JSON fixtures; freeze `Date`/`Date.now()` for `utils/volume.ts` and
  the cache-TTL logic in `stockDirectory.ts`.
- Start with pure `utils/` for fast, high-confidence coverage; extract
  `Portfolio.tsx` fee math into a util first so it can be tested without a DOM.

---

*Testing analysis: 2026-05-31*
*Verified against `package.json`, absence of any runner config, and a
project-wide scan (no test files in application source).*
