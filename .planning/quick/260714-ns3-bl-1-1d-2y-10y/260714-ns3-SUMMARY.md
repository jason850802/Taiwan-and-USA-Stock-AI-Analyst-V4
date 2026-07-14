---
quick_id: 260714-ns3
description: "BL-1 1d兩段式載入 2y快繪背景補全10y"
status: complete
completed: 2026-07-14
files_modified:
  - api/_lib/yahoo.ts
  - services/yahoo.ts
  - components/StockChart.tsx
  - App.tsx
commits:
  - da5c890 refactor(bl-1) 抽 resolveChipContext＋enrichChartData＋range 白名單加 2y
  - 630b805 perf(bl-1) 1d 兩段式載入核心（onPartial＋外殼 miss 路徑）
  - 2ff59dc fix(bl-1) StockChart 視窗重置改 seriesKey identity
---

# Quick Task 260714-ns3：BL-1 1d 兩段式載入 Summary

**一句話**：台股／美股 1d 冷抓改兩段式——t0 同刻併發 2y＋10y，2y 先到即以完整籌碼副圖＋雙軌指標上屏（非陽春圖），10y 到貨後用「同一批籌碼 ctx」重 enrich 無感交換；快取只寫 full（10y），partial 絕不入快取。

## 三個 commit（皆 `npx tsc --noEmit` 綠燈後提交）

1. **da5c890 — Task 1（純重構＋後端白名單）**
   - `api/_lib/yahoo.ts`：`INTERVAL_RANGE_MAP['1d']` 白名單 `['10y','5d']` → `['10y','5d','2y']`。
   - `services/yahoo.ts`：步驟 3 抽 `resolveChipContext`（await 一次、回傳 `ChipContext`）；步驟 4/4.5/5＋name/info 打包抽 `enrichChartData`（純同步、非 mutate info）。`ChipSpec` 型別提升為模組層。`fetchStockDataUncached` 主體收斂為「步驟 1 → 步驟 1.5/2a →（step3）resolveChipContext →（step4/4.5/5）enrichChartData」。
   - 外部行為與改前逐位元相同（單段、同請求數、同輸出）。

2. **630b805 — Task 2（兩段式核心）**
   - `fetchStockDataUncached` 加第 4 選配參數 `onPartial`。步驟 1 改寫：`interval==='1d' && onPartial` 且走 Yahoo 時，`fetchRawData` 同發 2y／10y，`Promise.race([t10y, t2y])` 取先到者。2y 先到 → 解析 meta → `resolveChipContext` 一次 → `enrichChartData` 發 partial → `await p10y` → 用**同一 ctx** 重 enrich 回傳（籌碼不重抓）。
   - catch 順序：`AbortError` 上拋 → **新增** `partialFired` 則拋 `partialDelivered` 錯（絕不進 FinMind fallback）→ 既有 FinMind fallback 原樣。
   - `getStockData` miss 路徑：原 forceRefresh 專屬 inflight 檢查改為**統一 inflight 檢查**（防切走再切回重複兩段式）；`!forceRefresh && interval==='1d'` 走兩段式 Promise 協調——partial `resolve` 不寫快取，full `writeQuoteCacheResult` 後依 settled 決定 `resolve`（10y 先到）或 `onRevalidated`（partial 已上屏）。abort 三態（partial 前／後／full 前）皆不寫快取、不發 onRevalidated；full 補全失敗且 partial 已上屏 → `console.warn`、停留 2y 視圖、無錯誤 UI。
   - `revalidateInBackground`（背景刷新單段）一行未動；`GetStockDataOpts` 未加欄位。

3. **2ff59dc — Task 3（視窗重置 identity）**
   - `StockChartProps` 加 `seriesKey: string`；重置 effect dep 由 `[data.length]` 改 `[seriesKey]`，effect 本體不動。
   - `App.tsx` 傳 `seriesKey={`${info?.symbol ?? symbol}|${interval}`}`（唯一一處 `<StockChart>`）。
   - partial 與 full 同 `info.symbol` → identity 不變 → 補全交換不觸發重置＝天然零跳動；附帶修好「SWR 刷新多一根新棒重置縮放/平移」既有小毛病。

## Deviations from Plan

### 1. [PLAN 已標註 drift] BL-PLAN 檔案清單漏列 api/_lib/yahoo.ts range 白名單
- **內容**：`.planning/optimization/BL-PLAN.md` §BL-1 的檔案清單未含 `api/_lib/yahoo.ts`。不加 `'2y'` 則後端 `validateChartParams` 會以 400 BAD_REQUEST 擋下 2y 請求，兩段式永遠退化單段。
- **處置**：本包補上（Task 1）。PLAN.md 已預先於錨點註記此 drift，本次照辦。
- **Commit**：da5c890。

### 2. [Rule 1 - Bug] 修正 PLAN Promise.race 骨架在「2y 快速失敗」時的空指標崩潰
- **Found during**：Task 2。
- **Issue**：PLAN 骨架 `const first = await Promise.race([t10y, t2y])` 中，`t2y` 失敗時 `onRejected` 回 `null`（註解意圖為「2y 失敗靜默等 10y」）。但若 2y 早於 10y 失敗，`t2y` 先 resolve 成 `null` 贏得 race，`first===null`；骨架的「10y 先到」fall-through 分支直接讀 `first.res` 會對 null 解參崩潰——骨架只考慮了「10y 先到」未考慮「2y 快速失敗」。
- **Fix**：fall-through 改為 `const fullRes = (first && first.which === '10y') ? first.res : await p10y;`——`first===null`（2y 快速失敗）時改 `await p10y`，忠實落實「2y 失敗靜默等 10y」原意；`await p10y` 若 reject 則進 catch（partialFired=false → 既有 FinMind fallback／上拋），語意與單段失敗一致。
- **Files modified**：services/yahoo.ts。
- **Commit**：630b805。

## Verify（本包內驗收）

- 三 commit 各自 `npx tsc --noEmit` EXIT 0。
- diff 人工核對：
  - (a) abort 三態（partial 前／後／full 前）皆不寫快取不發 onRevalidated ✓
  - (b) partial 絕不 `writeQuoteCacheResult`（只在 `.then(full)` 非 abort 分支寫）✓
  - (c) `revalidateInBackground` 未動 ✓
  - (d) `partialFired` 後 catch 先攔 AbortError 再攔 partialDelivered，不可能落入 FinMind fallback ✓
  - (e) `enrichChartData` 非 mutate info（`const info={...symbolInfo}`）雙次呼叫安全；2y/10y 各自獨立 `processedData` 陣列，`_synthetic` mutate 無交叉污染 ✓
  - (f) StockChart 該重置 effect deps 已無 `data.length`，App.tsx 僅一行 prop 增加 ✓

## 邊界（沿用 BL-PLAN 已定，未重新發明）

- FinMind fallback／1wk／1mo／60m／15m 維持單段，行為零變。
- forceRefresh（更新報價）與 SWR 背景刷新維持單段 10y。
- 拖曳中收到補全：沿用既有「data 變更安全拆 session」行為，不另做 defer（BL-PLAN 記為接受的行為 delta）。

## 留待統測（preview 3001）與 Sonnet 覆核

行為驗收：首繪 ≤5s、交換零閃爍、指標值一致、block 10y 模擬失敗、快取只寫 full、abort 無中毒、連點 5 檔、週期切回 <300ms。

## Known Stubs

None.

## Self-Check: PASSED
- 四檔均存在（api/_lib/yahoo.ts、services/yahoo.ts、components/StockChart.tsx、App.tsx）。
- 三 commit 均在 git log（da5c890、630b805、2ff59dc）。
- 工作樹 clean。
