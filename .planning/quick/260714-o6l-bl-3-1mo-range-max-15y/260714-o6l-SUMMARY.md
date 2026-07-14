---
quick_id: 260714-o6l
description: "BL-3 1mo range收斂max到15y加載入骨架屏"
source_spec: .planning/optimization/BL-PLAN.md §BL-3
status: complete
completed: 2026-07-14
files_modified:
  - api/_lib/yahoo.ts
  - services/yahoo.ts
  - App.tsx
commits:
  - a589911: "perf(bl-3): 1mo range 收斂 max→15y"
  - 03dac9e: "feat(bl-3): 切週期載入覆蓋層改 K 線骨架 shimmer"
---

# Quick Task 260714-o6l：BL-3 1mo range 收斂（max→15y）＋載入骨架屏 Summary

**一句話**：1mo 主圖 range 由 `max` 收斂到 `15y`（~180 根月棒、payload 明顯下降），並把切週期／換標的的載入覆蓋層由「blur 舊圖」改為不透明 K 線骨架 shimmer，消除舊週期誤導。

## Task 1：1mo range 收斂（commit a589911）

- `api/_lib/yahoo.ts`：`INTERVAL_RANGE_MAP['1mo']` 由 `['max']` → `['max', '15y']`。`15y` 為前端現行請求值；`max` **刻意保留**供部署過渡期 CDN 上舊 bundle 不被 `validateChartParams` 400 擋下。
- `services/yahoo.ts`：`fetchStockDataUncached` 開頭 mainRange if-chain，`interval === '1mo'` 的 `mainRange` 由 `'max'` → `'15y'`。`1wk` 的 `5y` 未動、其餘週期未動。
- 驗證：`npx tsc --noEmit` 綠（EXIT=0）。

## Task 2：載入覆蓋層改 K 線骨架屏（commit 03dac9e）

- `App.tsx:440` 的 `<div className="relative">` 加 `min-h-[420px]`——首載 `data=[]` 時容器不塌陷、無白屏；有舊圖時高度由 StockChart 撐、min-h 不起作用。
- 覆蓋層（`loading &&`）改寫：
  - 外層由 `bg-slate-900/60 backdrop-blur-sm`（半透明＋模糊，會透出舊週期的圖）→ **不透明 `bg-surface`**（#0f172a，完全遮住舊圖），移除 `backdrop-blur`。
  - K 線骨架：一排 10 根交錯高度垂直棒（heights 40-78%、`bg-slate-700` `rounded-sm`），用 Tailwind 內建 `animate-pulse` ＋每根 inline `animationDelay: i*90ms` 交錯產生 shimmer 流動感。**未新增 CSS keyframes、未改 tailwind.config**，只用既有 utility。
  - 文案 `載入中…` → `載入 K 線中…`（`text-slate-400 text-sm`）。
  - 保留 `loading &&` 條件與 z-20 語意（不覆蓋 ChartToolbar，z-20 > StockChart 縮放鈕 z-10）；快取命中切回 loading 不觸發 → 骨架屏自然不出現（零額外邏輯）。
- `Loader2` import 保留：`App.tsx:27` Suspense fallback 仍在用（非死 import），故不移除。
- 驗證：`npx tsc --noEmit` 綠（EXIT=0）；`grep backdrop-blur App.tsx` 無結果（已從覆蓋層移除）。

## Deviations from Plan

**1. [Rule 3 - 阻塞排除] 後端白名單保留 'max' 為 BL-PLAN 未列細節，比照 BL-1 補上**
- BL-PLAN §BL-3 未明列後端白名單改法；不加 `'15y'` 會被 `validateChartParams` 直接 400 擋下（阻塞任務目標）。比照 BL-1（1d 加 '2y'）的作法，加入 `'15y'` 並**保留 `'max'`**，讓部署過渡期 CDN 上舊 bundle（仍請求 max）不被 400。此為 PLAN 已預期並要求記錄的處置（PLAN §Task1 註解）。
- 檔案：`api/_lib/yahoo.ts`；commit：a589911。

其餘依 PLAN 執行，無其他偏離。

## Known Stubs

無。骨架屏為刻意的載入態視覺（非資料 stub），資料鏈與指標計算未改。

## 留給統測（preview 3001 實跑）

- 2330/AAPL 1mo 改前後 payload size 對比、月線左移 ~15 年、最近端 MA60/MACD 一致（<0.01%）。
- 骨架屏視覺／容器高度不跳動、不透明遮住舊圖、切週期 shimmer 流動觀感。

## Self-Check: PASSED

- 檔案：api/_lib/yahoo.ts、services/yahoo.ts、App.tsx 皆存在。
- Commits：a589911、03dac9e 皆在 git log。
