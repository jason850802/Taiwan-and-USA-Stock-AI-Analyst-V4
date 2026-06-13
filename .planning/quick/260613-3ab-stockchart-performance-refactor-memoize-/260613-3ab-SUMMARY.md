---
phase: quick-260613-3ab
plan: 01
subsystem: charting (components/StockChart.tsx)
tags: [performance, react-memo, recharts-hooks, crosshair, refactor]
requires: [recharts@3.8.0 public hooks]
provides: [memoized MainPriceChart + SubPanelChart, hooks-based CursorPriceLine, centered crosshair]
affects: [components/StockChart.tsx]
tech-stack:
  added: []
  patterns: [React.memo chart bodies, in-chart recharts hook subscription, one-bar-per-x-axis centering]
key-files:
  created: []
  modified: [components/StockChart.tsx]
decisions:
  - "Crosshair centering via Candidate 1 (one bar series per x-axis), confirmed against recharts compiled getBarPositions."
  - "Close-price tracking line moved from parent-state ReferenceLine/Label to an in-chart hooks-based CursorPriceLine so hover never touches parent chart props."
metrics:
  duration: ~25m
  completed: 2026-06-13
---

# Phase quick-260613-3ab Plan 01: StockChart Performance Refactor + Crosshair Fix Summary

One-liner: Memoized the three recharts chart bodies and replaced the parent-state close-price line with an in-chart `CursorPriceLine` so hover no longer re-renders any chart, and centered the crosshair by giving the volume bar its own hidden x-axis.

## What changed

`components/StockChart.tsx` only:

1. **`CursorPriceLine`** (new, in-chart component) — replaces the old `cursorData`-driven `ReferenceLine`+`Label`. Subscribes to the recharts store via public 3.x hooks `useActiveTooltipDataPoints` (active datum → `close`), `useYAxisScale('right')` (value → pixel y), and `usePlotArea` (line extent). Renders a dashed `#94a3b8` horizontal line + a right-aligned `#e2e8f0` fontSize-11 price label, matching the old visual. Guards all undefined returns → renders `null` when not hovering. Uses ONLY public exports (no `recharts/es6/...` internal imports); maintenance comment notes the recharts 3.x hook dependency.

2. **`MainPriceChart`** (new, `React.memo`) — wraps the 450px `ResponsiveContainer`/`ComposedChart` price chart, renders `CursorPriceLine` inside it. Props: `displayData`, `settings`, `isTaiwanStock`, `volumeCells`, `onMouseMove`, `onMouseLeave` (dedicated `interface MainPriceChartProps`).

3. **`SubPanelChart`** (new, `React.memo`) — wraps the foreign/trust/macd/kdj/rsi sub-panel body. Props: `view`, `displayData`, `settings`, `isTaiwanStock`, `macdHistCells`, `foreignCells`, `trustCells`, `onMouseMove`, `onMouseLeave` (dedicated `interface SubPanelChartProps`). Panel toggle buttons + `<h3>` title stay in the parent.

4. **Module-level constants** — `CHART_MARGIN`, `SYNC_ID`, `Y_AXIS_WIDTH`, `COMMON_Y_AXIS_PROPS` hoisted out of the parent render so they don't get recreated per render and silently defeat `React.memo`.

5. **Crosshair centering (Task 2)** — volume Bar moved to its own hidden `<XAxis xAxisId="volume" dataKey="date" hide />`; `barGap="-100%"` removed. Each x-axis now owns exactly one bar series, so both the candle (default axis) and volume bar are centered at the band center, which is where the Tooltip cursor draws.

## Memo-correctness trace (every interactive state change still reaches the charts via changed prop identity)

On a **hover**, only `setActiveIndex` fires. `displayData` (`useMemo` over `[data, barsToShow, settings.useAdjusted, maResultsCache]`), the four Cell arrays (`useMemo` over `[displayData]`), `settings`/`isTaiwanStock` (props), and the `useCallback([])` handlers all keep referential identity → `React.memo` skips both chart bodies. The close-price line and crosshair update via the recharts store (inside the memoized chart); MALegend updates via `activeIndex` state in the parent. No chart body re-renders on hover.

Each non-hover interaction still flows correctly:

| Interaction | Mechanism | Reaches charts? |
|---|---|---|
| symbol / interval change | new `data` prop → `maResultsCache` + `displayData` recompute → new identity | Yes, both charts re-render |
| zoom +/- (buttons + keyboard) | `barsToShow` state → `displayData` recomputes → new identity | Yes, both charts re-render |
| RSI / K / D / J / BB / MACD toggle | `settings` prop changes identity | Yes, both charts re-render |
| MA color / period edit | `settings.maLines` → `maResultsCache` + `displayData` recompute | Yes, both charts re-render |
| Adj / Raw switch (`useAdjusted`) | `settings.useAdjusted` → `displayData` recomputes | Yes, both charts re-render |
| sub-panel view switch | parent `panel1View`/`panel2View` state → affected `SubPanelChart` gets new `view` prop | Yes, that panel re-renders; main chart + other panel do not |

## Recharts source confirmation (centering cause)

Read `node_modules/recharts/es6/state/selectors/combiners/combineAllBarPositions.js` (`getBarPositions`). With 2 bars sharing one band, `barCategoryGap="20%"`, `barGap="-100%"`:
`_offset = 0.2*band`, `realBarGap = -1.0*band`, `originalSize = (band - 0.4*band + band)/2 = 0.8*band`.
- volume (i=0): offset `0.2*band` → center `0.6*band`
- candle (i=1): offset `0` → center `0.4*band`
The Tooltip `CrosshairCursor` draws at the band center `0.5*band` → right of the candle center `0.4*band` (the reported bug). With one bar per x-axis (`len=1`): offset `0.2*band`, size `0.8*band` → center `0.5*band` = band center, so candle + volume + crosshair all align. Candidate 1 confirmed; Candidate 2 not needed.

## Scope guard

Sub-panels each have a single Bar already centered in its band — their `CrosshairCursor` and axes were not touched. Only `components/StockChart.tsx` changed; no new dependencies; no changes to services/, utils/, App.tsx, Sidebar, or types.ts.

## Deviations from Plan

None — plan executed as written. Task 1 = memoization + `CursorPriceLine`; Task 2 = centering (Candidate 1).

## Known Stubs

None.

## Manual browser-verification checklist (for the orchestrator, post-merge)

Run `npm run dev`, load a TW stock (chips visible) and a US stock:

1. Hover across the K-line chart — crosshair, the dashed close-price line + right-edge price label, and the MA legend values follow the cursor with no visible lag.
2. The vertical crosshair line is horizontally centered on the candle body AND the volume bar for the hovered date (not offset to the right).
3. The dashed close-price line is `#94a3b8`, the price label `#e2e8f0` / fontSize 11 — visually identical to before.
4. Tooltip content (OHLC, 漲跌/漲跌%, volume in 張 for TW, BB rows when BB on) unchanged.
5. syncId cross-chart sync: hovering the main chart moves the sub-panel crosshairs to the same date and vice-versa.
6. Sub-panel crosshairs remain centered on their bars.
7. Sidebar toggles: MA enable/period/color, RSI, K, D, J, MACD, BB, Adj/Raw — each updates the charts correctly.
8. Zoom +/- (both buttons and `+`/`-`/`=` keys) re-slices the chart correctly.
9. Sub-panel view tabs (外資/投信/MACD/KDJ/RSI) switch only the affected panel.
10. TW chip panels (外資/投信) render bars + tooltips.

## Commits

- `ea10c95` perf(260613-3ab): memoize StockChart bodies + hooks-based CursorPriceLine
- `03e4e21` fix(260613-3ab): center crosshair on candle/volume bar (Candidate 1)

## Self-Check: PASSED
