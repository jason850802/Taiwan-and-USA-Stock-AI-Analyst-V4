---
phase: quick-260612-wyt
plan: 01
subsystem: volume-projection
tags: [volume, calibration, us-market, intraday, yahoo]
requires: []
provides:
  - US_CUM_WEIGHT (78-point empirical US intraday cumulative-volume weight table)
  - empirical US Insufficient cutoff T*_US = 85 minutes
affects:
  - utils/volume.ts (estimateVolumeTrend US branch)
tech-stack:
  added: []
  patterns: [offline-calibration-script, lookup-table-linear-interpolation]
key-files:
  created:
    - scripts/calibrate-us-volume-curve.mjs
    - scripts/us-volume-curve-report.md
  modified:
    - utils/volume.ts
decisions:
  - "US daily total derived from 5m self-sum (not Yahoo 1d), because Yahoo US 1d volume does not reconcile with 5m intraday sum"
  - "US Insufficient cutoff set to empirical T*=85 min (was hardcoded 5)"
metrics:
  duration: ~20m
  completed: 2026-06-12
---

# Phase quick-260612-wyt Plan 01: US Intraday Volume Curve Calibration Summary

Empirically calibrated the US intraday cumulative-volume weight curve from real Yahoo 5-minute data of 50 S&P large caps over 60 trading days (2800 surviving stock-days), replacing the hand-written 5-segment `getUSVolumeWeight` with a 78-point `US_CUM_WEIGHT` lookup table + linear interpolation, and replacing the hardcoded US Insufficient cutoff (5 min) with the empirically derived T*_US = 85 min.

## What Was Built

- **scripts/calibrate-us-volume-curve.mjs** — offline Node ESM calibration tool (native fetch, no new deps). Fetches `5m`/`60d` and `1d`/`3mo` per symbol, NY-timezone aligned, 390-min session grid (78 points: 5,10,…,385,390), 3rd-Friday options-expiration exclusion, monotonic-enforced median curve, per-grid p10/p90 error analysis, T* selection (earliest grid point where p10..p90 ⊆ ±35%). Caches raw JSON to gitignored `scripts/.cache-volume-calib/` with `us-` prefix (coexists with TW cache).
- **scripts/us-volume-curve-report.md** — methodology, sample counts, exclusion stats, median curve (p25/p75), per-time error (p10/p90), selected T*, and Limitations section.
- **utils/volume.ts** — added `US_CUM_WEIGHT` (78 values, cited to the report), table-driven `getUSVolumeWeight`, and `insufficientCutoff = isTaiwanStock ? 105 : 85`.

## Key Results

- **Sample:** 50/50 symbols succeeded, **2800 surviving stock-days**.
- **Exclusions:** barCount (half-days/anomalies) = 50; zeroVolume = 0; optionsExpiration (3rd Friday) = 150.
- **T*_US = 85 minutes** (earliest grid point with projection error p10..p90 ⊆ ±35%).
- **Curve highlights (cumulative share of full-day volume):**
  - minute 5 = 7.72%, minute 30 = 16.77%, minute 85 (T*) ≈ 30.5%
  - minute 195 ≈ 51%, minute 360 = 84.26%, minute 385/390 = 100%
- **US_CUM_WEIGHT (78 values):** `[ 0.0772, 0.0969, 0.1165, 0.1339, 0.1501, 0.1677, 0.1836, 0.1985, 0.2142, 0.2279, 0.2418, 0.2559, 0.2690, 0.2804, 0.2929, 0.3052, 0.3170, 0.3297, 0.3413, 0.3523, 0.3627, 0.3753, 0.3862, 0.3973, 0.4083, 0.4189, 0.4288, 0.4378, 0.4480, 0.4573, 0.4670, 0.4755, 0.4843, 0.4928, 0.5012, 0.5112, 0.5209, 0.5305, 0.5383, 0.5467, 0.5551, 0.5644, 0.5727, 0.5803, 0.5890, 0.5974, 0.6059, 0.6157, 0.6245, 0.6342, 0.6419, 0.6502, 0.6582, 0.6670, 0.6760, 0.6842, 0.6937, 0.7024, 0.7109, 0.7193, 0.7274, 0.7368, 0.7458, 0.7543, 0.7635, 0.7736, 0.7840, 0.7943, 0.8057, 0.8168, 0.8289, 0.8426, 0.8559, 0.8710, 0.8897, 0.9206, 1.0000, 1.0000 ]`

## Sanity Checks (all PASS)

- 78 values; monotonic non-decreasing; first = 0.0772 (> 0); last = 1.0000.
- minute-30 = 0.1677 ∈ [0.08, 0.30]; minute-360 = 0.8426 ∈ [0.70, 0.95].

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Methodology bug] Dropped the 1d-based closing-auction leftover reconciliation for US**

- **Found during:** Task 1 (sanity check on first run — minute-360 = 0.646, below the 0.70 floor).
- **Root cause:** The plan (mirroring TW) computed `leftover = dailyTotal(1d) - sum5m` and attributed it to the 16:00 grid point. Investigation of the cached raw data showed Yahoo's US `1d` daily volume does **not** reconcile with the sum of its own `5m` bars for the same session — the discrepancy `|1d - sum5m| / sum5m` had a median of ~29% and p90 ~56%, with unstable direction (1d sometimes far larger, sometimes far smaller than the 5m sum; per-day leftover ratios ranged from -104% to +53%). This is a known Yahoo US data-feed inconsistency between the two endpoints. Using `1d` as the daily total produced a wildly distorted, back-loaded curve (median cumulative share only 77% at minute 385).
- **Fix:** Use the **5m intraday self-sum** as the daily total (no 1d leftover). Verified that the 15:55 (385-min) bar already carries the 16:00 closing-auction volume — measured median closing-bar share is ~4-10% of the day for large caps (AAPL 6.0%, MSFT 4.8%, NVDA 3.5%, JPM 8.4%, KO 9.7%), a realistic closing-auction magnitude. The 5m series is therefore self-complete and the 390-min point is naturally 1.0. The `1d` data is now only used for a cross-check statistic in the report's Limitations section.
- **Files modified:** scripts/calibrate-us-volume-curve.mjs (accumulation logic, exclusions object, methodology + limitations report text), and consequently the embedded US_CUM_WEIGHT / T* in utils/volume.ts.
- **Commit:** 19df323
- **Note:** This is consistent with the plan's explicit instruction: "If any sanity check fails, investigate the script logic (do not paper over with manual edits to the numbers)." No numbers were hand-edited; the corrected script re-ran and emitted the embedded curve verbatim.

The exclusions object changed accordingly: the TW-style `leftoverNegative` / `lowCoverage` / `noDaily` (all 1d-dependent) were replaced with `zeroVolume` (5m-based), since those exclusion categories no longer apply once 1d is not the daily total.

## TW Artifacts Untouched

`TW_CUM_WEIGHT`, `getTaiwanVolumeWeight`, the TW cutoff (105), `scripts/calibrate-tw-volume-curve.mjs`, and `scripts/tw-volume-curve-report.md` were not modified. `VolumeProjection` interface and `estimateVolumeTrend` orchestration (timezone, isToday/Closed, minutesElapsed/totalMinutes=390 for US, projection math) unchanged.

## Verification

- `node scripts/calibrate-us-volume-curve.mjs` → 50/50 symbols, 2800 stock-days, prints 78-value `US_CUM_WEIGHT` + `T* = 85`.
- All curve sanity checks pass (see above).
- `npx vite build` → success (pre-existing chunk-size warning only; unrelated).
- Runtime gains zero additional network calls (only a static const table added).

## Self-Check: PASSED

- FOUND: scripts/calibrate-us-volume-curve.mjs
- FOUND: scripts/us-volume-curve-report.md
- FOUND: utils/volume.ts (US_CUM_WEIGHT present, T*=85 cutoff)
- FOUND: commit 19df323
