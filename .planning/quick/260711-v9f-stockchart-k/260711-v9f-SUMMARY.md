---
phase: quick-260711-v9f
plan: 01
subsystem: frontend-chart
tags: [stockchart, recharts, ui, rendering]
requires: []
provides:
  - 一字板 K 棒最小可見水平線渲染
  - 外資/投信小量買賣超柱最小高度渲染
  - 切週期圖表區載入動畫
affects:
  - components/StockChart.tsx
  - App.tsx
tech-stack:
  added: []
  patterns:
    - recharts Bar 自訂 shape 元件（薄包裝餵 payload 欄位）強制最小像素高度
    - App 集中式 loading state 驅動區域 overlay（StockChart 維持純呈現）
key-files:
  created: []
  modified:
    - components/StockChart.tsx
    - App.tsx
decisions:
  - 一字板顏色改讀 payload.priceChange（與前收比較），避免 close===open 誤判成灰
  - 法人柱顏色與最小高度改由自訂 shape 自帶，移除 foreignCells/trustCells Cell 與 useMemo 死碼
  - loading overlay 只蓋 K 線＋副圖、不覆蓋 ChartToolbar，讓使用者仍可再切週期
metrics:
  duration: ~20 min
  completed: 2026-07-11
---

# Quick 260711-v9f: StockChart 一字板/法人柱/載入動畫修正 Summary

修正 StockChart 三個顯示問題：漲跌停一字板 K 棒改畫最小可見水平線（依前收判漲紅跌綠平灰）、外資/投信小量買賣超柱以自訂 shape 強制最小像素高度（紅買綠賣、正負錨定零線），並在切換 K 棒週期時於圖表區疊加繁中「載入中…」spinner 覆蓋層。純渲染／UI 層變更，不新增依賴、不改 `StockDataPoint[]` 資料契約。

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | 修正一字板（漲跌停鎖死）K 棒不顯示 | 4cacb36 | components/StockChart.tsx |
| 2 | 修正外資/投信買賣超小量柱不顯示 | a029f8c | components/StockChart.tsx |
| 3 | 切換 K 棒週期時加入讀取動畫 | f534948 | App.tsx |

## What Changed

### Task 1 — 一字板 K 棒
- `CandleStickShape` 的 guard 由 `if (!open || !close || width <= 0 || height <= 0) return null;` 移除 `height <= 0`，改為在 `height <= 0 || high === low` 時走一字板分支。
- 一字板分支：以 `y`（該價位像素位置）為基準，畫一條 `x → x + width` 的水平線，`strokeWidth={2}`（最小可見高度）。
- 顏色改讀 `payload.priceChange`（displayData 已附）：`> 0` 漲停紅 `#f0405a`、`< 0` 跌停綠 `#22c55e`、`=== 0` 灰 `#94a3b8`。避免 close===open 用 close vs open 判成灰。
- 保留 `!open || !close || width <= 0` 無效資料 guard；doji（bodyHeight < 1）與正常 K 棒分支不變；未新增任何過濾/剔除邏輯（殭屍過濾器不受影響）。

### Task 2 — 法人小量柱
- 新增模組層級 `ChipBar` 自訂 shape（Section 1，與 CandleStickShape 同區）＋薄包裝 `ForeignBar`/`TrustBar`（分別餵 `payload.foreignBuySell` / `payload.investmentTrustBuySell`）。
- 值 `null`/`undefined`/`0` → return null（零買賣超不畫，維持一致）；顏色自帶（`> 0` 紅買、`< 0` 綠賣）。
- `MIN_CHIP_BAR_H = 2`：`height >= MIN_H` 照原 x/y/width/height 畫 rect；`height < MIN_H` 撐到 MIN_H，正值 `ry = y + height - MIN_H`（自零線往上）、負值 `ry = y`（自零線往下）。
- 兩個 `<Bar>` 改為 `shape={<ForeignBar />}` / `shape={<TrustBar />}`（`isAnimationActive={false}` 保留），移除 Cell 子元素；一併移除 `foreignCells`/`trustCells` useMemo、`SubPanelChartProps` 欄位、`SubPanelChart` 解構參數、父層 JSX prop 傳遞。`macdHistCells`/`volumeCells`、ReferenceLine y=0 不動。

### Task 3 — 切週期載入動畫
- `App.tsx` lucide-react import 加入 `Loader2`。
- `data.length > 0` 區塊內、`<ChartToolbar>` 之後，將 `<StockChart>` 包一層 `className="relative"` 的 div，條件渲染 `{loading && (...)}` 覆蓋層：`absolute inset-0 z-20`、`bg-slate-900/60 backdrop-blur-sm`、置中 flex-col，內含 `<Loader2 className="animate-spin text-blue-400" size={32} />` 與繁中 `載入中…`（`text-slate-300 text-sm`）。
- 覆蓋層蓋住 K 線與其下所有副圖、不覆蓋 ChartToolbar（z-20 > 內部縮放鈕 z-10）；沿用既有 App 集中式 loading state，StockChart 維持純呈現。

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `npx tsc --noEmit`：三個 task 各自驗證皆 EXIT=0（無新增型別錯誤）。
- 死碼檢查：`git grep foreignCells|trustCells` 僅剩一行說明註解，無殘留 Cell/useMemo/prop。
- Human-check（dev 環境瀏覽器實測）尚待使用者執行：一字板可見且色正確、法人小量柱可見且方向色正確、切週期出現載入動畫；回歸拖曳平移/十字線/收盤價游標線/縮放/正常 K 棒/MACD/KDJ/RSI 行為不變。

## Known Stubs

None.

## Self-Check: PASSED

- Commits 4cacb36 / a029f8c / f534948 存在於 git log。
- components/StockChart.tsx、App.tsx 皆存在且已修改。
- 無 foreignCells/trustCells 死碼殘留（僅說明註解）。
