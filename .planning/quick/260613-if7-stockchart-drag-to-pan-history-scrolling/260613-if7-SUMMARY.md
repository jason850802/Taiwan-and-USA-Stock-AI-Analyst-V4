---
phase: quick-260613-if7
plan: 01
subsystem: charting / StockChart UI
tags: [recharts, drag-to-pan, ohlc-info-bar, memoization, react-hooks]
requires: [260613-3ab]  # memoized chart bodies + hooks-based CursorPriceLine
provides: [IF7-PAN, IF7-INFOBAR]
affects: [components/StockChart.tsx]
key-files:
  created: []
  modified: [components/StockChart.tsx]
decisions:
  - "rightOffset state (hidden-bar count from right edge) drives pan; clampedOffset derived in displayData useMemo, no corrective effect needed"
  - "drag handlers live on the parent wrapper div + window listeners; zero new props on memoized MainPriceChart/SubPanelChart"
  - "main Tooltip content={() => null} keeps cursor active so CursorPriceLine (useActiveTooltipDataPoints) + crosshair survive"
metrics:
  tasks: 2
  files: 1
  commits: 2
  duration: ~15m
  completed: 2026-06-13
---

# Quick Task 260613-if7: StockChart Drag-to-Pan + Fixed OHLC Info Bar Summary

Added drag-to-pan history scrolling (releasing the latest-bar lock at any zoom level) and replaced the floating single-bar OHLC tooltip with a fixed header info bar that never occludes candles — both in `components/StockChart.tsx`, preserving the 260613-3ab memoization/zero-rerender guarantee.

## What Was Done

### Task 1 — Drag-to-pan history scrolling (commit `7e593e5`)
- New `rightOffset` state (`0` = anchored to latest bar / right edge).
- `displayData` useMemo now derives `maxOffset = max(0, data.length - barsToShow)`, `clampedOffset = clamp(rightOffset, 0, maxOffset)`, `endIndex = data.length - clampedOffset`, `startIndex = max(0, endIndex - barsToShow)`, and slices `data.slice(startIndex, endIndex)`. `originalIndex = startIndex + i` keeps `priceChange` and `maResultsCache` lookups index-correct.
- `rightOffset` added to the `displayData` dependency array. No corrective effect: clamping is instantaneous, so zooming out (larger `barsToShow` → smaller `maxOffset`) auto-clamps the offset back into range.
- `rightOffset` reset to `0` folded into the existing `[data.length]` effect (new symbol/interval snaps to latest).
- Wrapper div (`h-[450px]`) gets `wrapperRef`, `onMouseDown={handleDragStart}`, and `cursor-grab` / `cursor-grabbing` + `select-none`.
- Drag mechanics: `onMouseDown` (button 0 only) records `startClientX`/`startOffset`, sets `draggingRef`, clears crosshair, and attaches **window** mousemove/mouseup. mousemove computes `barPixelWidth = max(1, (width - Y_AXIS_WIDTH) / barsToShow)`, `barsDelta = round(deltaX / barPixelWidth)`; dragging right (deltaX>0) increases offset (reveals older bars), clamped to a freshly-recomputed `maxOffset` (no stale closure). rAF-throttled `setRightOffset`. mouseup removes listeners + cancels rAF. An unmount cleanup effect removes any stray listeners.
- `handleMouseMove` early-returns when `draggingRef.current` is true, suppressing the crosshair during drag.

### Task 2 — Fixed OHLC info bar + suppress floating box (commit `9e75132`)
- Main `<Tooltip>` changed to `content={() => null}` while keeping `cursor={<CrosshairCursor />}`.
- Deleted the unused `MainTooltip` component (sub-panel `ChipTooltip` / `MACDTooltip` / `IndicatorTooltip` left untouched — out of scope and still floating by design).
- New `OHLCInfoBar` presentational component reads `activeData` (idle → latest bar, hover → that bar) and renders date / 開高低收 (.toFixed(2), 紅漲綠跌 color by close vs open) / 漲跌 + 漲跌% (±, arrow, undefined-guarded `-` fallback) / 量 (TW `round(volume/1000) 張`, US `toLocaleString()`).
- Header restructured into a vertical stack: title-row (K線圖 + Adj/Raw badge + MALegend) above the info bar; `pr-20` retained so the absolute zoom buttons (`top-4 right-4 z-10`) never overlap. Info bar sits in the header region, never in the 450px plot area, so it cannot occlude candles.

## Memo-Correctness Note
**No new props were added to the memoized `MainPriceChart` or `SubPanelChart`.** Their prop interfaces are unchanged. Drag state (`rightOffset`, `isDragging`, all drag refs) and the info bar live entirely in the parent `StockChart`. The parent recomputes `displayData` on pan and passes the new array (the existing, intended path — the same prop that already changes on zoom), so all three charts pan together and stay `syncId`-synchronized. `isDragging` only toggles a wrapper CSS class. The 260613-3ab zero-rerender-on-hover guarantee is intact: hover still updates only parent `activeData` (read by the info bar + MALegend), not the chart bodies.

**CursorPriceLine survival:** `content={() => null}` controls only what renders inside the floating box, not whether the tooltip's active state is populated. The cursor (`CrosshairCursor`) is still active, so `useActiveTooltipDataPoints` is fed and both the vertical crosshair and the horizontal close-price line (`CursorPriceLine`) still render. Confirmed by reasoning about recharts 3.x active-tooltip state; flagged in the manual checklist below for visual confirmation.

## Verification
- `npx vite build` passed after **each** task (2621 modules transformed, no TS/build errors).
- Only `components/StockChart.tsx` modified; no `App.tsx` / services / utils / types changes; no new npm dependencies.
- No live `MainTooltip` references remain (grep shows comments only).

## Manual Browser-Verification Checklist (for orchestrator, post-merge)
- [ ] Drag left/right on the main chart scrolls through history; clamps at oldest and latest bars (no overscroll, no flicker).
- [ ] Releasing the mouse restores the crosshair; no crosshair jitter while dragging.
- [ ] Dragging RIGHT reveals OLDER bars (and left returns toward latest).
- [ ] Zoom +/- (buttons and `+`/`-` keys) still work; after zooming out, the pan offset auto-clamps with no blank gap on the right.
- [ ] Switching stock / interval snaps back to the latest bar (offset resets to 0).
- [ ] OHLC info bar: hover updates to that bar; idle shows the latest bar; never overlaps the zoom buttons; never occludes candles.
- [ ] Vertical crosshair + horizontal close-price line (CursorPriceLine) both still render on hover.
- [ ] TW volume shows `… 張`; US volume shows raw `toLocaleString()`; 紅漲綠跌 colors correct.
- [ ] Sub-panels (外資/投信/MACD/KDJ/RSI) pan in sync with the main chart (shared displayData); their floating tooltips unchanged; `syncId` cross-chart sync intact.
- [ ] MA legend, indicator toggles, Adj/Raw toggle, panel view tabs all still function.

## Deviations from Plan
None — plan executed exactly as written. The optional ←→ arrow-key pan (nicety) was intentionally skipped to keep scope tight; drag is the must-have and is implemented.

## Self-Check: PASSED
- FOUND: components/StockChart.tsx (modified)
- FOUND commit 7e593e5 (Task 1 — drag-to-pan)
- FOUND commit 9e75132 (Task 2 — fixed info bar)
- Both `npx vite build` runs succeeded.
