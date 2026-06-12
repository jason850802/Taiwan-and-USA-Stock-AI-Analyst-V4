---
phase: quick-260612-wyt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/calibrate-us-volume-curve.mjs
  - scripts/us-volume-curve-report.md
  - utils/volume.ts
autonomous: true
requirements: [QUICK-260612-wyt]
user_setup: []

must_haves:
  truths:
    - "Running `node scripts/calibrate-us-volume-curve.mjs` fetches real Yahoo 5m/1d data for ~50 US large caps and emits a 78-value empirical curve + a T*_US value, both derived from the run (never fabricated)."
    - "scripts/us-volume-curve-report.md documents methodology, real sample counts, exclusion stats, median curve (with p25/p75), per-time projection error (p10/p90), and the selected T*_US — mirroring the TW report."
    - "utils/volume.ts replaces the hand-written 5-segment getUSVolumeWeight with a US_CUM_WEIGHT lookup-table linear interpolation; insufficientCutoff for US is the empirical T*_US (no longer hardcoded 5)."
    - "`npx vite build` succeeds; TW path (TW_CUM_WEIGHT, T*=105) and VolumeProjection/estimateVolumeTrend external behavior are unchanged."
  artifacts:
    - path: "scripts/calibrate-us-volume-curve.mjs"
      provides: "Offline US calibration script (Node ESM, native fetch, no new deps)"
      contains: "US_CUM_WEIGHT"
    - path: "scripts/us-volume-curve-report.md"
      provides: "US calibration report with real sample counts and selected T*_US"
    - path: "utils/volume.ts"
      provides: "Table-driven US volume weight + empirical US insufficientCutoff"
      contains: "US_CUM_WEIGHT"
  key_links:
    - from: "utils/volume.ts"
      to: "scripts/us-volume-curve-report.md"
      via: "comment citation on US_CUM_WEIGHT (curve provenance)"
      pattern: "us-volume-curve-report"
    - from: "estimateVolumeTrend (US branch)"
      to: "US_CUM_WEIGHT"
      via: "getUSVolumeWeight lookup-table linear interpolation"
      pattern: "US_CUM_WEIGHT"
---

<objective>
Empirically calibrate the US intraday cumulative-volume weight curve from real Yahoo 5-minute data of ~50 S&P large caps, replacing the hand-written 5-segment `getUSVolumeWeight` in `utils/volume.ts` with a 78-point lookup table + linear interpolation, and replace the hardcoded US Insufficient cutoff (5 min) with an empirically derived T*_US. Sister task to TW calibration 260612-w4i — methodology is identical, adapted for US market mechanics (390-min session from 09:30, in-band opening auction, 16:00 closing-auction leftover reconciliation, NY timezone, options-expiration exclusion).

Purpose: Make US intraday full-day volume projection accurate and the Insufficient gating empirically justified, matching the rigor already applied to TW.
Output: `scripts/calibrate-us-volume-curve.mjs`, `scripts/us-volume-curve-report.md`, and an updated `utils/volume.ts`.
</objective>

<execution_context>
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/workflows/execute-plan.md
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

# Sister TW task to mirror exactly (structure, naming, comment style, report layout):
@scripts/calibrate-tw-volume-curve.mjs
@scripts/tw-volume-curve-report.md

# Runtime file to modify (current state: TW already table-driven; getUSVolumeWeight is the function to replace; insufficientCutoff = isTaiwanStock ? 105 : 5):
@utils/volume.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create and run US calibration script, produce report + curve</name>
  <files>scripts/calibrate-us-volume-curve.mjs, scripts/us-volume-curve-report.md</files>
  <action>
Create `scripts/calibrate-us-volume-curve.mjs` by copying the structure of `scripts/calibrate-tw-volume-curve.mjs` and adapting for US market mechanics. Keep the same module layout, helper functions (sleep, fileExists, getChart, median, percentile, round4), the same Node ESM imports, native fetch, no new npm deps, `DELAY_MS = 300`, `MIN_SYMBOLS = 40`, and the same gitignored cache dir `scripts/.cache-volume-calib/` (already in .gitignore). Header comments in the bilingual style of the TW script (繁中 + English).

US-specific adaptations:
- SYMBOLS: the ~50 US large caps listed in the methodology, with comment "S&P 市值前50近似，校準日期 2026-06-12": AAPL, MSFT, NVDA, GOOGL, AMZN, META, AVGO, TSLA, BRK-B, LLY, JPM, WMT, V, UNH, XOM, MA, ORCL, COST, PG, HD, JNJ, NFLX, ABBV, BAC, CRM, KO, MRK, CVX, AMD, PEP, TMO, ADBE, LIN, WFC, CSCO, ACN, MCD, IBM, GE, ABT, NOW, ISRG, PM, CAT, TXN, QCOM, INTU, VZ, AMGN, GS.
- URL: US symbols use the bare ticker (no `.TW` suffix). The TW `getChart` appends `.TW`; the US version must request `${BASE}${symbol}?interval=...` directly. Yahoo accepts hyphenated tickers like `BRK-B` as-is.
- Per symbol fetch: `5m`/`60d` and `1d`/`3mo` (same as TW).
- Timezone: replace Taipei formatting with `America/New_York` (Intl.DateTimeFormat timeZone 'America/New_York'). `toNY(tsSec)` returns `{ date: 'YYYY-MM-DD', mins }` where mins = minutes since 09:30 = (hh-9)*60 + (mm-30).
- GRID: minutes from 09:30 at 5,10,…,385 plus 390 (16:00) = 78 points. Build with `for (let m = 5; m <= 385; m += 5) GRID.push(m); GRID.push(390);`. Index i ↔ minute (i+1)*5; index 0↔5min … index 77↔390min(16:00).
- In-band bars: keep bars with `mins >= 0 && mins <= 390`. Note the 09:30 first bar carries the opening auction volume (in-band, unlike TW) — no special handling needed, the time-grid accumulation already captures it.
- Closing-auction leftover reconciliation (same as TW): the 15:55 last 5m bar does NOT contain the 16:00 closing auction; compute `leftover = dailyTotal - sum5m` and attribute it to the 390-min (16:00) grid point so that grid point's cumulative share = 1.0.
- Standard-day bar count = 78 (09:30…15:55 bar-starts). Exclude stock-days whose bar count differs from 78 (half days = 28 bars, plus anomalies). Use a tolerance band `bars.length < 77 || bars.length > 79` consistent with the TW ±1 approach, since 5m endpoints can vary by one bar.
- Exclusions to count and log (mirror TW exclusions object): barCount (≠ 78±1), leftoverNegative (sum_5m > daily_total), lowCoverage (sum_5m < 50% daily_total), noDaily (1d row missing), optionsExpiration (US monthly options expiration = every month's 3rd Friday; covers triple/quadruple witching). Replace TW's `isFutsSettlement` (3rd Wednesday) with `isOptionsExpiration(dateStr)` computing the 3rd Friday (firstFri = 1 + ((5 - firstDow + 7) % 7); thirdFri = firstFri + 14; using a UTC-constructed date for day-of-week, same technique as TW).
- Median curve + p25/p75, enforce monotonic non-decreasing, last value = 1.0 (identical to TW).
- Error analysis identical to TW: per stock-day per grid point projected = cum/weight; error = projected/daily − 1; per-point p10/p90; T*_US = earliest grid minute where p10 >= -0.35 AND p90 <= 0.35.
- Output report to `scripts/us-volume-curve-report.md` mirroring the TW report's section layout (方法學/Methodology, 樣本/Sample, 排除統計/Exclusions, 中位曲線/Median curve, 投影誤差/Error-by-time, 選定 T*), with US-appropriate wording: 390-min session from 09:30 (America/New_York), opening auction in-band, 16:00 closing-auction leftover reconciliation, 3rd-Friday options-expiration exclusion. In the report's limitation note, document the caveat from the feasibility probe: Yahoo daily volume may include small pre/post-market volume that slightly inflates the 16:00 leftover (~1-4% for large caps) — acceptable noise, documented as a limitation.
- stdout: print `const US_CUM_WEIGHT: number[] = [ … ];` (78 four-decimal values, last = '1.0000') with the index↔minute comment, and `T* = <minute>`.

Then RUN the script: `node scripts/calibrate-us-volume-curve.mjs`. The run fetches live Yahoo data (caching raw JSON to the gitignored dir). It MUST succeed with ≥40 symbols; if fewer than 40 succeed the script exits 1 — STOP and report a blocker (do not fabricate or hand-tune the curve).

After the run, sanity-check the emitted curve before Task 2 embeds it: monotonic non-decreasing, first value > 0, last value === 1.0, exactly 78 values, the minute-30 value roughly in 0.08–0.30, and the minute-360 value roughly in 0.70–0.95. If any sanity check fails, investigate the script logic (do not paper over with manual edits to the numbers).
  </action>
  <verify>
    <automated>node scripts/calibrate-us-volume-curve.mjs 2>&1 | findstr /C:"US_CUM_WEIGHT" /C:"T* ="</automated>
  </verify>
  <done>Script runs end-to-end with ≥40 succeeded symbols; `scripts/us-volume-curve-report.md` exists with real sample counts and a selected T*_US; stdout prints a 78-value `US_CUM_WEIGHT` array and `T* = <minute>`; sanity checks (monotonic, first>0, last=1.0, 78 values, minute-30 ∈ 0.08–0.30, minute-360 ∈ 0.70–0.95) all pass.</done>
</task>

<task type="auto">
  <name>Task 2: Make utils/volume.ts US path table-driven and apply empirical T*_US</name>
  <files>utils/volume.ts</files>
  <action>
Edit `utils/volume.ts` using the real values produced by Task 1's run — never hand-typed or approximated numbers.

1. Add `const US_CUM_WEIGHT: number[] = [ … ];` directly below the existing `TW_CUM_WEIGHT` declaration, populated with the exact 78-value array printed by the script. Add a bilingual comment block in the same style as the TW table's comment: explain it is the empirical US intraday cumulative-volume weight table from ~50 S&P large caps / 60 trading days / 2026-06-12, that index i ↔ minute (i+1)*5 from 09:30 (index 0↔5min … index 77↔390min / 16:00),末值=1.0, and cite `scripts/us-volume-curve-report.md` for provenance/methodology.

2. Replace the body of `getUSVolumeWeight` (currently the 5-segment hand-written function) with lookup-table linear interpolation that mirrors `getTaiwanVolumeWeight`'s pattern but over a 390-min session:
   - `mins <= 0` → 0
   - `mins < 5` → `(mins / 5) * US_CUM_WEIGHT[0]` (linear from origin to first grid point)
   - `mins >= 390` → 1.0 (closing clamp = last grid value)
   - otherwise interpolate between adjacent grid points: `lowIdx = Math.floor(mins / 5) - 1`, `lo = US_CUM_WEIGHT[lowIdx]`, `hi = US_CUM_WEIGHT[Math.min(lowIdx + 1, US_CUM_WEIGHT.length - 1)]`, `loMin = (lowIdx + 1) * 5`, `frac = (mins - loMin) / 5`, return `lo + (hi - lo) * frac`.
   Keep the function name `getUSVolumeWeight` and signature `(mins: number): number` so the existing assignment `getVolumeWeight = getUSVolumeWeight` in the US branch is unchanged.

3. Replace the hardcoded US cutoff: change `const insufficientCutoff = isTaiwanStock ? 105 : 5;` to `const insufficientCutoff = isTaiwanStock ? 105 : <T*_US>;` using the integer T*_US printed by the script. Update the adjacent comment so it no longer says "美股維持 5 分鐘"; instead state the US value is the empirical T*_US (earliest time where projection error p10..p90 ⊆ ±35%, see scripts/us-volume-curve-report.md).

Do NOT touch `TW_CUM_WEIGHT`, `getTaiwanVolumeWeight`, the TW cutoff (105), the `VolumeProjection` interface, or the surrounding `estimateVolumeTrend` orchestration (timezone handling, isToday/Closed logic, minutesElapsed/totalMinutes for the US branch = 390, projection math). External behavior of `estimateVolumeTrend` stays the same aside from the now-accurate US weights and cutoff. Do NOT modify services/yahoo.ts, entryFilter.ts, App.tsx, or any TW calibration artifact.
  </action>
  <verify>
    <automated>npx vite build</automated>
  </verify>
  <done>`utils/volume.ts` contains an 78-value `US_CUM_WEIGHT` (matching the script output) cited to scripts/us-volume-curve-report.md, `getUSVolumeWeight` is lookup-table linear interpolation over the 390-min session, `insufficientCutoff` US branch uses the empirical T*_US (no hardcoded 5), TW path is untouched, and `npx vite build` completes without errors.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Node script → Yahoo Finance (query2.finance.yahoo.com) | Outbound fetch of public market data over HTTPS; offline tool, never runs in the deployed app |
| Curve numbers → committed source (utils/volume.ts) | Empirical data crossing from a generated report into runtime constants |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-wyt-01 | Tampering | Embedded US_CUM_WEIGHT / T*_US | mitigate | Numbers must come verbatim from the script run; sanity checks (monotonic, first>0, last=1.0, 78 values, bounded mid-day values) gate embedding; report file records provenance |
| T-wyt-02 | Denial of Service | Yahoo fetch (rate limiting / 429) | accept | DELAY_MS=300 between requests, raw-JSON caching, browser UA; offline tool, no user impact; ≥40-symbol floor with exit-1 blocker if data unavailable |
| T-wyt-03 | Information disclosure | scripts/.cache-volume-calib/ raw JSON | accept | Public market data only; directory already gitignored, never committed |
| T-wyt-SC | Tampering | npm/pip/cargo installs | mitigate | No new dependencies are added by this plan; nothing to install or audit |
</threat_model>

<verification>
- `node scripts/calibrate-us-volume-curve.mjs` runs to completion with ≥40 succeeded symbols and prints a 78-value `US_CUM_WEIGHT` array plus `T* = <minute>`.
- `scripts/us-volume-curve-report.md` exists and contains: real sample counts (attempted/succeeded/surviving stock-days), exclusion stats table, median curve with p25/p75, per-time p10/p90 error table, and the selected T*_US.
- Sanity checks on the curve pass: monotonic non-decreasing, first > 0, last === 1.0, exactly 78 values, minute-30 ∈ 0.08–0.30, minute-360 ∈ 0.70–0.95.
- `utils/volume.ts` US path is table-driven (US_CUM_WEIGHT + interpolation) and US insufficientCutoff = empirical T*_US; TW path unchanged.
- `npx vite build` succeeds.
</verification>

<success_criteria>
- New `scripts/calibrate-us-volume-curve.mjs` mirrors the TW script's architecture, adapted for the US 390-min session, NY timezone, in-band opening auction, 16:00 closing-auction leftover reconciliation, and 3rd-Friday options-expiration exclusion; no new npm deps; uses the shared gitignored cache dir.
- `scripts/us-volume-curve-report.md` mirrors the TW report layout with real, non-fabricated numbers.
- `utils/volume.ts` `getUSVolumeWeight` is a 78-point lookup-table linear interpolation and the US Insufficient cutoff is the empirical T*_US; TW table/function/cutoff and `VolumeProjection`/`estimateVolumeTrend` external behavior are unchanged.
- Build passes; runtime gains zero additional network calls.
</success_criteria>

<output>
Create `.planning/quick/260612-wyt-calibrate-us-intraday-volume-weight-curv/260612-wyt-SUMMARY.md` when done.
</output>
