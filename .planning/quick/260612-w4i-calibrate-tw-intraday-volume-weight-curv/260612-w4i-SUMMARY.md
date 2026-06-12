---
phase: quick-260612-w4i
plan: 01
subsystem: volume-projection
tags: [calibration, taiwan-market, volume, entry-filter, offline-tooling]
requires: []
provides:
  - "Empirically-calibrated TW intraday cumulative-volume-weight table (TW_CUM_WEIGHT)"
  - "Market-aware Insufficient cutoff (TW T*=105, US 5)"
  - "Reproducible offline calibration script + methodology report"
affects:
  - "utils/volume.ts:getTaiwanVolumeWeight (now table-driven)"
  - "utils/entryFilter.ts step 5 / SOP④ 攻擊量 judgment (consumes projectedVolume)"
tech-stack:
  added: []
  patterns: ["lookup-table + linear interpolation over empirical grid", "offline calibration script (no runtime network)"]
key-files:
  created:
    - scripts/calibrate-tw-volume-curve.mjs
    - scripts/tw-volume-curve-report.md
  modified:
    - utils/volume.ts
    - .gitignore
decisions:
  - "TW weight curve derived from median cumulative share of 2505 real stock-days (50 large caps × ~60 trading days)"
  - "Insufficient cutoff T*=105 min = earliest grid point where projection-error p10..p90 ⊆ ±35%"
  - "Curve forced monotonic non-decreasing with last point pinned to 1.0"
metrics:
  duration: ~15m
  completed: 2026-06-12
---

# Phase quick-260612-w4i Plan 01: Calibrate TW Intraday Volume-Weight Curve Summary

Replaced the hand-written 25/55/13 three-segment `getTaiwanVolumeWeight` with a table-driven linear interpolation over an empirically-calibrated 54-point cumulative-volume curve (real Yahoo 5m/1d data, 50 large caps, 2505 stock-days), and replaced the arbitrary `< 5 min` Insufficient guard with a data-derived TW cutoff T*=105 min (US stays at 5).

## What Was Built

- **scripts/calibrate-tw-volume-curve.mjs** — offline Node ESM script (native fetch, no new deps). Fetches 50 large-cap symbols' 5m (60d) + 1d (3mo) series, reconciles the missing 13:30 closing-auction volume via daily totals, builds per-stock-day cumulative shares onto a 5-minute grid, takes per-grid median (with p25/p75), runs a projection-error analysis, and prints the ready-to-paste `TW_CUM_WEIGHT` array + `T*`. Caches raw JSON to a gitignored scratch dir for cheap re-runs.
- **scripts/tw-volume-curve-report.md** — methodology, sample/exclusion counts, median curve table, error-by-time table, chosen T*.
- **utils/volume.ts** — `TW_CUM_WEIGHT` const + table-driven `getTaiwanVolumeWeight` (signature `(mins)=>number`, `[0,270]→[0,1]` semantics preserved) + market-aware `insufficientCutoff`.
- **.gitignore** — ignores `scripts/.cache-volume-calib/`.

## Calibration Results (real script output — NOT fabricated)

- Symbols attempted: **50**; succeeded (≥1 usable stock-day): **50**
- Surviving stock-days: **2505**
- **T\* = 105 minutes** (earliest grid point where projection-error p10..p90 ⊆ ±35%)

### Exclusion stats (by reason)

| Reason | Count |
|---|---|
| bar count ≠ 54±1 (half-day / abnormal) | 155 |
| sum_5m > daily_total (leftover negative) | 105 |
| sum_5m < 50% daily_total (low coverage) | 35 |
| 1d series missing that date | 0 |
| 期指結算日 (3rd Wednesday) | 150 |

### Final TW_CUM_WEIGHT (54 values; index i ↔ minute (i+1)*5; last = 1.0)

```
[ 0.0346, 0.0650, 0.0936, 0.1186, 0.1411, 0.1654, 0.1856, 0.2067, 0.2255, 0.2455,
  0.2637, 0.2821, 0.2988, 0.3150, 0.3316, 0.3457, 0.3609, 0.3758, 0.3893, 0.4031,
  0.4163, 0.4285, 0.4427, 0.4538, 0.4669, 0.4803, 0.4910, 0.5022, 0.5149, 0.5267,
  0.5380, 0.5490, 0.5598, 0.5698, 0.5802, 0.5921, 0.6041, 0.6148, 0.6265, 0.6380,
  0.6494, 0.6624, 0.6742, 0.6875, 0.7001, 0.7135, 0.7283, 0.7459, 0.7652, 0.7838,
  0.8055, 0.8348, 0.8348, 1.0000 ]
```

### Sanity checks (all passed)

- length 54, monotonic non-decreasing ✓
- first value 0.0346 > 0 ✓; last value === 1.0 ✓
- minute 30 (idx 5) = 0.1654 ∈ [0.10, 0.40] ✓
- minute 240 (idx 47) = 0.7459 ∈ [0.60, 0.92] ✓

## Verification

- `node scripts/calibrate-tw-volume-curve.mjs` → 50/50 symbols, 2505 stock-days, emits `TW_CUM_WEIGHT` + `T* = 105`. Re-runs read cache.
- `rg "TW_CUM_WEIGHT|tw-volume-curve-report|insufficientCutoff" utils/volume.ts` → all present.
- `npx vite build` → ✓ built in ~9.5s, 2621 modules.
- `git status` clean; `scripts/.cache-volume-calib/` (100 files) gitignored, NOT committed.
- `getUSVolumeWeight`, `VolumeProjection` interface, `estimateVolumeTrend` external shape, `'Closed'` branch, and pre-market guard all unchanged. services/yahoo.ts, entryFilter.ts, App.tsx untouched. No new npm deps. Zero runtime network calls added.

## Deviations from Plan

**1. [Rule 1 - Plan internal inconsistency] Array is 54 values, not 55**
- **Found during:** Task 1 (grid construction).
- **Issue:** The plan text says "exactly 55 numbers" but its own indexing rule (`index i ↔ minute (i+1)*5`, minutes 5,10,…,270, last value 1.0) produces exactly **54** values (270/5 = 54). 55 would require either a minute-0 point or a duplicate.
- **Resolution:** Followed the authoritative index formula and the [0,270]→[0,1] semantics (the load-bearing contract), producing 54 grid points (09:05…13:25 = 53 points + 13:30). The runtime interpolation, clamps, and sanity bands are all defined against this indexing and pass. No fabrication — the array is the script's real output.
- **Files:** scripts/calibrate-tw-volume-curve.mjs, utils/volume.ts.

Note on the curve: indices 51 and 52 (minutes 260, 265) are both 0.8348 — the monotonic-non-decreasing clamp flattened a tiny empirical dip there. This is the intended guard behavior (weights must be well-defined for `currentVolume/weight`), not a data error.

## Commits

- `4d61572` feat(volume): calibrate TW intraday cumulative-volume curve from real 5m data; market-aware Insufficient cutoff

## Self-Check: PASSED

- FOUND: scripts/calibrate-tw-volume-curve.mjs
- FOUND: scripts/tw-volume-curve-report.md
- FOUND: utils/volume.ts (modified)
- FOUND: .gitignore (modified)
- FOUND: commit 4d61572
