---
phase: quick-260613-ixg
plan: 01
subsystem: StockChart (drag-pan render path)
tags: [perf, react-memo, recharts, drag-pan]
requires: [components/StockChart.tsx]
provides: ["Frozen sub-panel data path during drag", "Coarsened pan stepping"]
affects: [components/StockChart.tsx]
tech-stack:
  added: []
  patterns: ["live-mirror ref + frozen snapshot ref for referentially stable memo props", "quantized pan step"]
key-files:
  created: []
  modified: [components/StockChart.tsx]
decisions:
  - "Hoisted isDragging useState to component top to let subPanelData reference it without a temporal-dead-zone error"
  - "Skipped the optional release-snap-to-exact-position nicety (would add closure/ref plumbing — not trivial, allowed by locked design)"
metrics:
  duration: ~3 min
  completed: 2026-06-13
---

# Phase quick-260613-ixg Plan 01: Reduce StockChart Pan Lag (Freeze Sub-Panels + Coarsen Stepping) Summary

Killed severe drag-pan lag by freezing the two sub-panel charts during drag (React.memo skip via a referentially stable `subPanelData`) and quantizing the pan step so the main chart re-renders in coarse chunks instead of every single bar.

## What Was Built

**Part 1 — Freeze sub-panels (the ~2/3 win), commit `d4c0eed`:**
- `displayDataRef` — live mirror assigned on every render (`displayDataRef.current = displayData;`) right after the `displayData` useMemo, so drag-start can read the latest window without a stale closure.
- `frozenSubDataRef` — `useRef<any[]>(displayData)`; snapshotted in `handleDragStart` via `frozenSubDataRef.current = displayDataRef.current;`.
- `subPanelData = isDragging ? frozenSubDataRef.current : displayData;` — during drag the same object reference is returned every render → both `SubPanelChart` (React.memo) skip re-render; on release (`isDragging`→false) it resolves to the live final `displayData` → sub-panels re-render exactly once to the correct window.
- `macdHistCells` / `foreignCells` / `trustCells` useMemo deps + bodies re-pointed to `[subPanelData]`. `volumeCells` left on `[displayData]` (belongs to the live main chart).
- Both `<SubPanelChart>` instances (rendered from the panels `.map`) receive `displayData={subPanelData}`. `<MainPriceChart>` keeps live `displayData={displayData}` and live `volumeCells`.
- `isDragging` useState hoisted to the top of the component (with the other `useState` hooks) to avoid a temporal-dead-zone reference from `subPanelData`; a comment marks where it used to live in the drag block.

**Part 2 — Coarsen pan stepping, commit `6e1ced1`:**
- In `handleDragMove`: `PAN_STEP = Math.max(1, Math.round(barsToShow / 50))` (~2 at a 100-bar window, larger when zoomed out).
- `rawDelta = deltaX / barPixelWidth; barsDelta = Math.round(rawDelta / PAN_STEP) * PAN_STEP;` (replaces the unquantized `Math.round(deltaX / barPixelWidth)`).
- Clamp `[0, maxOffset]`, rAF throttle, and the identical-offset skip (`setRightOffset(prev => prev === newOffset ? prev : newOffset)`) all preserved. Deps stay `[barsToShow, data.length]`. Drag direction (right = older bars → `rightOffset` increases) unchanged.

## Memo-Correctness Note (which props stay stable during drag)

During an active drag, the props reaching each `SubPanelChart` (React.memo) are:

| Prop | Source | Stable during drag? |
|------|--------|---------------------|
| `view` | `panel1View` / `panel2View` state | Yes — only changes on tab click, not during drag |
| `displayData` | `subPanelData` = `frozenSubDataRef.current` | Yes — same object reference every render while `isDragging` |
| `settings` | parent prop | Yes — not mutated during drag |
| `isTaiwanStock` | parent prop | Yes |
| `macdHistCells` / `foreignCells` / `trustCells` | useMemo `[subPanelData]` | Yes — frozen because `subPanelData` ref is stable |
| `onMouseMove` / `onMouseLeave` | `useCallback([])` | Yes — stable identities |

Therefore React.memo's shallow prop compare finds no change → both sub-panels skip re-render mid-drag. The only things re-rendering during a drag step are the parent `StockChart` and `MainPriceChart`. On release, `isDragging` flips false → `subPanelData === displayData` (live) → a single correct re-render; no stale sub-panel data persists.

Note: switching a sub-panel's view (tab) sets `panel1View`/`panel2View` state, which is independent of drag and still works — it is not gated by `isDragging`.

## Deviations from Plan

**1. [Rule 3 - Blocking issue] Hoisted `isDragging` useState to avoid TDZ**
- **Found during:** Task 1
- **Issue:** Plan places `subPanelData = isDragging ? ...` right after `displayData` (line ~635), but `const [isDragging, setIsDragging] = useState(false)` was originally declared ~40 lines later in the drag-refs block — a temporal-dead-zone reference that fails to compile/run.
- **Fix:** Moved the `isDragging` useState up to the top of the component beside the other state hooks; replaced its old line with an explanatory comment. No behavior change.
- **Files modified:** components/StockChart.tsx
- **Commit:** d4c0eed

The optional release-snap-to-exact-position nicety in Task 2 was intentionally **skipped** per the plan (it would add closure/ref plumbing; leaving the last coarse value on release is acceptable by the locked design).

## Verification

- `npx vite build` passes after both tasks (2621 modules transformed, no TS/transpile errors).
- Only `components/StockChart.tsx` changed; no new imports, no new dependencies.

### Manual Browser-Verification Checklist (orchestrator-run)
- [ ] Drag-pan: sub-panel (外資/投信/MACD/KDJ/RSI) chart DOM does NOT update mid-drag, then snaps once to the correct final window on mouse release — no stale data left on screen.
- [ ] Main price chart still pans; clamps at newest (offset 0) and oldest (maxOffset); steps in coarse chunks (smoother, fewer long-tasks).
- [ ] Crosshair suppressed during drag, restores on hover after release.
- [ ] Fixed OHLC info bar reads latest bar when idle and the hovered bar on hover.
- [ ] Zoom +/- (buttons and keyboard) still works; symbol/interval switch resets offset to 0.
- [ ] Indicator toggles, Adj/Raw switch, sub-panel view tabs (switching a panel's view), and syncId cross-chart sync all behave unchanged.
- [ ] Zero-rerender-on-hover (260613-3ab) preserved; memoized chart bodies (260613-3ab) not regressed.

## Known Stubs

None.

## Commits

- `d4c0eed` perf(260613-ixg): freeze sub-panels during drag-pan
- `6e1ced1` perf(260613-ixg): coarsen drag-pan stepping to cut re-render frequency

## Self-Check: PASSED
- components/StockChart.tsx: FOUND (modified, build passes)
- d4c0eed: FOUND
- 6e1ced1: FOUND
