---
phase: quick-260613-ixg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [components/StockChart.tsx]
autonomous: true
requirements: [QT-ixg-FREEZE, QT-ixg-COARSEN]

must_haves:
  truths:
    - "During a left-button drag-pan, the two sub-panel charts do NOT re-render (their DOM stays static mid-drag)"
    - "On drag release, both sub-panels snap once to the correct final window (no stale data left on screen)"
    - "The main price chart still pans, clamps to newest/oldest, and re-renders fewer times because the window steps in coarse chunks"
    - "Crosshair is suppressed during drag and restores on hover after release; the fixed OHLC info bar still reads the latest/hovered bar"
    - "Zoom +/- , indicator toggles, Adj/Raw, panel view tabs, syncId, and symbol/interval switching all behave unchanged"
  artifacts:
    - path: "components/StockChart.tsx"
      provides: "Frozen sub-panel data path + coarsened pan stepping, all inside StockChart"
      contains: "frozenSubDataRef"
  key_links:
    - from: "StockChart.handleDragStart"
      to: "frozenSubDataRef.current"
      via: "snapshot of displayDataRef.current at drag start"
      pattern: "frozenSubDataRef\\.current = displayDataRef\\.current"
    - from: "subPanelData"
      to: "both SubPanelChart instances"
      via: "displayData prop (stable ref during drag → React.memo skip)"
      pattern: "displayData=\\{subPanelData\\}"
---

<objective>
Kill the severe drag-pan lag in StockChart. Root cause: each 1-bar pan changes `rightOffset` → `displayData` gets a new identity → all THREE React.memo charts (main ~100 candles + two sub-panels) re-render, costing 40–100ms per step (well over the 16ms frame budget).

User-locked fix (do not revisit), both parts required:
1. **Freeze sub-panels during drag** — feed both `SubPanelChart` instances a referentially STABLE prop while `isDragging`, so React.memo skips them entirely (the ~2/3 win). On release, hand them the live final window so they re-render exactly once to the correct state.
2. **Coarsen pan stepping** — quantize the window step in `handleDragMove` so the main chart jumps in chunks (≈2 bars at 100-bar window, larger when zoomed out), cutting main-chart re-render frequency.

Purpose: bring per-step cost from three-chart repaint down to one chart, fewer times → smooth pan.
Output: modified `components/StockChart.tsx` only. No new deps. No App/services/utils changes.
</objective>

<execution_context>
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/workflows/execute-plan.md
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@components/StockChart.tsx
@CLAUDE.md

Relevant anchors in StockChart.tsx (read fully — do not assume line numbers):
- `displayData` useMemo (deps `[data, barsToShow, rightOffset, settings.useAdjusted, maResultsCache]`) — the per-step new-identity source.
- Drag refs/handlers: `draggingRef`, `isDragging` state, `handleDragStart`, `handleDragMove` (rAF-throttled, `barsDelta = Math.round(deltaX / barPixelWidth)`), `handleDragEnd`, cleanup `useEffect`.
- Cell arrays: `volumeCells` (main, stays live), `macdHistCells`/`foreignCells`/`trustCells` (sub-panels, must freeze), each `useMemo(..., [displayData])`.
- `SubPanelChart` is `React.memo`; re-renders during drag ONLY because its `displayData` prop identity changes. Other props (settings, isTaiwanStock, view, handlers) are already stable.
- Two `<SubPanelChart>` usages pass `displayData={displayData}`.
- `activeData` (info bar source) derived from `displayData[last]` — unaffected; `handleMouseMove` is gated by `draggingRef`.
- Non-strict TS: guard refs against null/undefined.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Freeze sub-panels during drag (the big win)</name>
  <files>components/StockChart.tsx</files>
  <action>
Implement the frozen sub-panel data path inside the `StockChart` component (per QT-ixg-FREEZE).

1. Add two refs near the drag refs (after `displayData` is defined so the initial value is valid):
   - A live mirror: assign on EVERY render `displayDataRef.current = displayData;` (cheap, keeps latest window without a stale closure). Initialize via `useRef(displayData)`.
   - A frozen snapshot: `frozenSubDataRef` initialized via `useRef<any[]>(displayData)`.
   Place the `displayDataRef.current = displayData;` assignment immediately after the `displayData` useMemo so it runs each render. `useRef` import already present.

2. In `handleDragStart`, snapshot the current window into the frozen ref BEFORE pan begins: set `frozenSubDataRef.current = displayDataRef.current;`. This captures the window at drag start from the live mirror (avoids the stale-closure trap of capturing `displayData` directly inside the callback). Do this alongside the existing `draggingRef.current = true; setIsDragging(true);` lines.

3. Compute the data the sub-panels consume, after `displayData`:
   `const subPanelData = isDragging ? frozenSubDataRef.current : displayData;`
   - During drag: `frozenSubDataRef.current` is the SAME object reference every render → `subPanelData` is referentially stable → both `SubPanelChart` (React.memo) skip re-render.
   - On drag end (`isDragging` flips false): `subPanelData` becomes the live final `displayData` → sub-panels re-render exactly ONCE to the correct window.

4. Re-point the THREE sub-panel Cell memos to `subPanelData` so they also freeze during drag (else they recompute each step and partly defeat the win):
   - `macdHistCells`, `foreignCells`, `trustCells` → change dep array to `[subPanelData]` and map over `subPanelData`.
   - LEAVE `volumeCells` on `displayData` (it belongs to the main chart, which stays live).

5. Pass `displayData={subPanelData}` to BOTH `<SubPanelChart>` instances. The `<MainPriceChart>` keeps live `displayData={displayData}` unchanged.

Memo-safety check before finishing: confirm each `SubPanelChart` receives NO other prop whose identity changes per drag step. `settings`, `isTaiwanStock`, `view`, `onMouseMove`, `onMouseLeave` are already stable (memoized callbacks / props); the three cell props are now frozen via `subPanelData`. After the change, during drag the only things re-rendering are the parent and `MainPriceChart`.

Do NOT touch `activeData`, `hasChipData`, `handleMouseMove`'s `draggingRef` gate, or the crosshair logic — they stay correct as-is. Guard the refs for non-strict TS (they are always seeded with a valid array, so no null deref, but keep `<any[]>` typing on `frozenSubDataRef`).
  </action>
  <verify>
    <automated>npx vite build</automated>
  </verify>
  <done>Build passes. During drag, `subPanelData` resolves to the stable `frozenSubDataRef.current` and the three sub-panel cell memos depend on `subPanelData`; both `SubPanelChart` instances receive `displayData={subPanelData}`. On release, `subPanelData === displayData` (live final window). Main chart still receives live `displayData` and live `volumeCells`.</done>
</task>

<task type="auto">
  <name>Task 2: Coarsen pan stepping to cut main-chart re-render frequency</name>
  <files>components/StockChart.tsx</files>
  <action>
Quantize the pan step inside `handleDragMove` so the window jumps in chunks instead of every single bar (per QT-ixg-COARSEN).

1. In `handleDragMove`, after computing `barPixelWidth`, define a step size scaled to the current window so it gets coarser when zoomed out (renders are heavier there):
   `const PAN_STEP = Math.max(1, Math.round(barsToShow / 50));`  // ≈2 at 100 bars, larger when zoomed out.

2. Compute the quantized delta:
   `const rawDelta = deltaX / barPixelWidth;`
   `const barsDelta = Math.round(rawDelta / PAN_STEP) * PAN_STEP;`
   (Replaces the existing `const barsDelta = Math.round(deltaX / barPixelWidth);`.)

3. Keep everything else unchanged:
   - Clamp logic: `maxOffset = Math.max(0, data.length - barsToShow)`, `newOffset` clamped to `[0, maxOffset]`.
   - The existing rAF throttle and the `setRightOffset(prev => (prev === newOffset ? prev : newOffset))` skip (identical offsets must NOT trigger setState — this is what makes coarsening pay off).
   - `handleDragMove` dependency array stays `[barsToShow, data.length]` (no new external deps introduced).

Optional nicety (NOT required — only add if trivial and zero-risk): on `handleDragEnd`, snap to the exact released position by recomputing an unquantized `barsDelta` from the last known `deltaX`. If it adds any closure/ref plumbing, SKIP it — leaving the last coarse value on release is acceptable per the locked design.

Do NOT change drag direction semantics (`deltaX>0` reveals older bars → `rightOffset` increases) or the zoom/symbol-switch reset effects.
  </action>
  <verify>
    <automated>npx vite build</automated>
  </verify>
  <done>Build passes. `handleDragMove` quantizes `barsDelta` to multiples of `PAN_STEP = max(1, round(barsToShow/50))`, preserves clamp + rAF throttle + identical-offset skip, and keeps deps `[barsToShow, data.length]`. Drag direction and clamp behavior unchanged.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none new) | Pure client-side rendering perf change. No new input source, no network call, no secret, no package install, no persisted data. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ixg-01 | Denial of Service (self-inflicted UI jank) | StockChart drag-pan render path | mitigate | This change IS the mitigation: freeze sub-panels + coarsen steps to cut per-frame work below budget. |
| T-ixg-02 | Tampering (stale view shown to user) | frozenSubDataRef snapshot on release | mitigate | On `isDragging=false`, `subPanelData` resolves to live `displayData`, forcing a single correct re-render — no stale sub-panel data persists. Browser-verified by orchestrator. |
</threat_model>

<verification>
Build gate (must pass):
- `npx vite build` succeeds with no TypeScript/transpile errors.

Self-review checklist (executor confirms by reading the diff):
- Only `components/StockChart.tsx` changed.
- No new imports, no new dependencies.
- `displayDataRef.current = displayData;` runs every render (assignment right after the `displayData` useMemo).
- `frozenSubDataRef.current = displayDataRef.current;` set inside `handleDragStart`.
- `subPanelData = isDragging ? frozenSubDataRef.current : displayData;`.
- `macdHistCells`/`foreignCells`/`trustCells` deps + bodies use `subPanelData`; `volumeCells` still uses `displayData`.
- Both `<SubPanelChart>` get `displayData={subPanelData}`; `<MainPriceChart>` keeps `displayData={displayData}`.
- `handleDragMove` uses `PAN_STEP`-quantized `barsDelta`, retains clamp + rAF + identical-offset skip + deps `[barsToShow, data.length]`.

Post-merge browser measurement (orchestrator-run, out of executor scope):
- (a) Sub-panel chart DOM does NOT update mid-drag and snaps to the correct window on release.
- (b) Far fewer long-tasks / lower total blocking time during a drag sweep vs. before.
- (c) Main chart still pans + clamps; crosshair restores on hover after release; OHLC info bar correct; zoom/symbol/interval still fine; indicator toggles + Adj/Raw + panel tabs + syncId unaffected.
</verification>

<success_criteria>
- `npx vite build` passes.
- Sub-panels feed from a referentially stable `subPanelData` during drag (React.memo skip) and from live `displayData` when idle/after release.
- Main-chart pan steps are quantized via `PAN_STEP`, reducing setState/re-render frequency, with clamp and identical-offset skip intact.
- No regression to drag direction/clamp, crosshair restore on release, fixed OHLC info bar, zero-rerender-on-hover (260613-3ab), zoom +/- , indicator toggles, Adj/Raw, panel view tabs, syncId, or symbol/interval reset.
- Changes confined to `components/StockChart.tsx`; no new deps.
</success_criteria>

<output>
Create `.planning/quick/260613-ixg-reduce-stockchart-pan-lag-freeze-sub-pan/260613-ixg-SUMMARY.md` when done.
</output>
