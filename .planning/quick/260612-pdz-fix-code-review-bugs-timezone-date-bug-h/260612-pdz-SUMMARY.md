---
phase: quick
plan: 260612-pdz
subsystem: analysis-pipeline
tags: [bugfix, code-review, timezone, intraday-volume, entry-filter, portfolio]
requires: []
provides:
  - 正確本地日期 todayStr（盤中量管線不再因時區換算消失）
  - runEntryFilter 第 4 個可選 volumeProj 參數（盤中攻擊量倍數採預估全日量）
  - 容許【】包裹的健檢決策 regex
  - yahoo 指標欄位 nullish 填充（保留 0 值）
affects:
  - utils/volume.ts
  - utils/entryFilter.ts
  - App.tsx
  - components/Portfolio.tsx
  - services/yahoo.ts
tech-stack:
  added: []
  patterns:
    - 盤中量比改用 projectedVolume/yesterdayVolume
    - nullish coalescing (??) 保留合法 0 值
key-files:
  created: []
  modified:
    - utils/volume.ts
    - utils/entryFilter.ts
    - App.tsx
    - components/Portfolio.tsx
    - services/yahoo.ts
decisions:
  - "盤中攻擊量以預估全日量計算，避免收盤量比低估倍數"
  - "指標欄位用 ?? undefined 而非 || undefined，保留 MACD/macdHist 合法 0 值"
metrics:
  duration: ~12m
  completed: 2026-06-12
---

# Phase quick Plan 260612-pdz: Fix Code Review Bugs Summary

修復程式碼審查發現的 7 個正確性 bug，分屬 3 個 atomic commit：盤中量管線（時區日期＋盤中攻擊量用預估全日量）、App.tsx 雜項（錯誤文案、未解析 symbol、死碼 import）、Portfolio 健檢 regex ＋ yahoo 指標 nullish 填充。無新依賴、無 UI 行為變更，`npx vite build` 全程通過。

## What Was Built

### Task 1 — 盤中量管線修復（CR-BUG-01 + CR-BUG-03）— commit `328620d`
- `utils/volume.ts`：`todayStr` 改用 `localTime` 的本地 getter（`getFullYear`/`getMonth`+1/`getDate`，月日 `padStart(2,'0')`）手動組 `YYYY-MM-DD`，取代會二次 UTC 換算的 `toISOString()`。修正台北凌晨 0–8 點 `todayStr` 變昨天、`isToday` 誤判、`minutesElapsed` 變負、回傳 null、盤中量資訊消失。
- `utils/entryFilter.ts`：
  - 從 `./volume` 匯入 `VolumeProjection` 型別。
  - `runEntryFilter` 新增第 4 個可選參數 `volumeProj?: VolumeProjection | null`。
  - `volRatio`：保留原 `dayVolRatio`（收盤量比）；當 `volumeProj.status === 'Intraday' && yesterdayVolume > 0` 時改用 `projectedVolume / yesterdayVolume`，並以 `usedIntradayProj` flag 記錄。
  - 步驟5 details 在 `usedIntradayProj` 為 true 時後綴「（盤中依預估量）」。
- `App.tsx`：`runEntryFilter(sym, data, weeklyData)` → 傳入第 4 參數 `volumeProj`（component 作用域 useMemo，handleRunAnalysis closure 取當前 render 值）。

### Task 2 — App.tsx 雜項（CR-BUG-04 + CR-BUG-06 + CR-BUG-07）— commit `1a7dd92`
- 移除未使用的 `analyzeStockWithGemini` import（保留 `analyzeEntryWithGemini`，函式本體未動）。
- API Key 缺失訊息 `REACT_APP_GEMINI_API_KEY` → `GEMINI_API_KEY`（與 vite.config 注入變數一致）。
- `useEffect`（interval 切換）與 `handleRefreshQuote` 改用 `info?.symbol || symbol`，避免搜尋框部分輸入。依賴陣列 `[interval]` 未動。

### Task 3 — Portfolio regex + yahoo nullish（CR-BUG-02 + CR-BUG-05）— commit `3251169`
- `components/Portfolio.tsx`：決策 regex 在冒號與表情符號間允許可選 `[【\[]?\s*`，匹配 AI 實際輸出 `**操作決策：【 🟢加碼 】**`；`decisionMatch[1]` 以 `.replace(/\s+/g, '')` 去空白，顯示為「🟢加碼」。
- `services/yahoo.ts`：line 759–781 指標欄位（ma5/ma10/ma20/ma60、rsi、macd、macdSignal、macdHist 及 *Adj 變體）的 `|| undefined` 全改為 `?? undefined`，保留合法 0 值。k/d/j、bb 系列、ma*Dir、priceChange 未動。

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `npx vite build` 在每個 task 後與最終皆通過（無型別/語法錯誤）。
- 心智檢查 bug 1：台北凌晨情境 `todayStr` 等於當天日期，`isToday=true`，不再回傳 null。
- 心智檢查 bug 3：盤中 `volRatio` 採 `projectedVolume/yesterdayVolume`，步驟5 details 含「（盤中依預估量）」。
- 心智檢查 bug 5：`macdLine[i] === 0` 時 `macd` 欄位為 0 而非 undefined。
- 既有 UI 行為不變（未新增/移除元件、未改圖表與提示詞）。

## Commits

- `328620d` fix(260612-pdz): correct intraday volume pipeline (timezone date + projected attack volume)
- `1a7dd92` fix(260612-pdz): App.tsx misc fixes (error text, resolved symbol, dead import)
- `3251169` fix(260612-pdz): portfolio health-check regex + yahoo indicator nullish fill

## Self-Check: PASSED

All modified files present; all 3 commit hashes (`328620d`, `1a7dd92`, `3251169`) found in git history.
