---
phase: 260712-qyf-a2-chart-pan-quick-wins-k
plan: 01
subsystem: chart
tags: [stockchart, performance, drag-to-pan, recharts, memoization]
requires: []
provides:
  - "dragWidthRef：dragStart 量測一次的容器寬度快照，handleDragMove 熱路徑零佈局量測"
  - "mappedData：全量預映射 useMemo（Adj/Raw、MA 欄位、priceChange），deps 不含 barsToShow/rightOffset"
  - "windowBounds：切片邊界夾止數學單一事實來源（O(1)）"
  - "displayData/volumeCells 降級為 slice，拖曳期間元素參照穩定"
affects: [components/StockChart.tsx 拖曳平移/縮放渲染路徑]
tech-stack:
  added: []
  patterns: ["全量預映射＋視窗 slice：昂貴 map 的 deps 與視窗參數解耦，讓平移/縮放只付 O(視窗) slice 成本"]
key-files:
  created: []
  modified:
    - components/StockChart.tsx
key-decisions:
  - "PAN_STEP 維持 Math.max(1, Math.round(barsToShow/50)) 不動：本包降單步成本，顆粒度屬體感問題，由使用者 Phase A 收尾統一驗證，避免混淆前後對照基準"
  - "volumeCells key 改為全域索引：Cell 與 bar 對應是位置序而非 key，渲染結果不變；全域 key＋穩定元素參照讓未變動 Cell 調和 bail out"
  - "priceChange 遷移全量預映射無語意變化（讀碼確認舊版本來就用全量陣列前一根）"
metrics:
  duration: "4 min"
  completed: "2026-07-12"
---

# Quick Task 260712-qyf: A2 K 棒圖拖曳平移低風險效能快贏 Summary

拖曳單步成本從「getBoundingClientRect 強制 reflow＋100 筆物件×MA 欄位全量 map」降為「純 ref 讀取＋O(視窗) slice（元素參照穩定）」，行為零變化。

## 變更內容（§A2 改法 1-2 全數落地）

### Task 1 — dragStart 量測一次容器寬度存 ref（commit c2b91b5）

- 新增 `dragWidthRef = useRef(0)`（拖曳 refs 區塊，附用途註解：resize 期間拖曳不重量測，下次 dragStart 自然更新）。
- `handleDragStart`：掛 window listeners 前 `dragWidthRef.current = wrapperRef.current?.getBoundingClientRect().width ?? 0;`。
- `handleDragMove`：`const width = dragWidthRef.current;` 取代 per-mousemove 的 `getBoundingClientRect()`。barPixelWidth 換算、PAN_STEP 量化、clamp、rAF 節流、同值跳過逐行不變；useCallback deps 維持 `[barsToShow, data.length]`。
- 驗證：`grep -c "getBoundingClientRect"` = 1，唯一出現處在 handleDragStart 函式體內（:764）；全檔無 offsetWidth/clientWidth。

### Task 2 — 全量預映射＋slice 化（commit 70905f7）

- **`mappedData` useMemo**：原 displayData 內的完整轉換（Adj/Raw 的 OHLC、candleBody、`ma_N`/`ma_N_dir` 動態欄位、rsi/macd/bb 系列 Adj 切換、priceChange/priceChangePercent、`...d` 展開）搬到全量 `data` 上執行，`originalIndex` 即陣列索引 i。deps `[data, settings.useAdjusted, settings.maLines, maResultsCache]`——不含 barsToShow/rightOffset。
- **`windowBounds` useMemo**（deps `[data.length, barsToShow, rightOffset]`）：maxOffset/clampedOffset/endIndex/startIndex 四行夾止數學，單一事實來源，回傳 `{startIndex, endIndex}`。
- **`displayData`** = `mappedData.slice(startIndex, endIndex)`（deps `[mappedData, windowBounds]`）：外層陣列每步新建（主圖本就要重繪），元素物件是 mappedData 原參照。
- **`volumeCellsFull`**（deps `[mappedData]`）全量預生 `<Cell>`；**`volumeCells`** = slice（deps `[volumeCellsFull, windowBounds]`）。key 改為全域索引——Cell 與 bar 對應是位置序，渲染結果不變。fill 讀映射後 close/open（Adj 切換後值），與現行一致。原 :775-777 舊 volumeCells 定義移除。
- hooks 順序：maResultsCache → mappedData → windowBounds → displayData → volumeCellsFull/volumeCells，全部位於 `displayDataRef.current = displayData;` 之前；凍結鏈與 activeData 一行未改。

## 每次 mousemove 執行函式清單（熱路徑證明，規格鎖定項 5）

```
mousemove
 └─ handleDragMove
     ├─ 讀 dragWidthRef.current（純 ref 讀取，無佈局量測、無強制 reflow）
     ├─ 純算術：deltaX / barPixelWidth / PAN_STEP 量化 / maxOffset clamp
     └─ requestAnimationFrame 排程（已排程則直接 return）
         └─ rAF tick → setRightOffset(prev => prev === newOffset ? prev : newOffset)
             ├─ 同值 → bail out，整條到此為止（無重渲染）
             └─ 量化步幅跨界（值變）→ StockChart 重渲染：
                 ├─ windowBounds 重算（O(1) 四行算術）
                 ├─ displayData = mappedData.slice(...)（O(視窗)，元素參照穩定）
                 ├─ volumeCells = volumeCellsFull.slice(...)（O(視窗)，元素參照穩定）
                 ├─ mappedData / volumeCellsFull / maResultsCache / macdHistCells → memo 快取全命中
                 ├─ subPanelData = frozenSubDataRef.current（isDragging=true，凍結參照）
                 ├─ MainPriceChart 重繪（外層陣列變，本就要動；元素參照穩定壓低 Recharts 比對）
                 └─ SubPanelChart×2 → React.memo props 全同 → 跳過重繪
```

熱路徑無 getBoundingClientRect、無全量 `.map`、無新物件重建——每步只付 O(1) 邊界計算＋兩個 O(視窗) slice。

## priceChange 讀碼結論（規格鎖定項 4 顧慮不成立）

現行切片版即以 `data[originalIndex - 1]`（**全量陣列的前一根**，非切片內前一根）計算 priceChange——切片第一根本來就用全域前一根算漲跌。預映射版改用 `data[i - 1]`（i 為全量索引）語意逐位元相同，無任何「修正」或行為變化。

## PAN_STEP 維持不動的理由（規格鎖定項 3）

維持 `Math.max(1, Math.round(barsToShow / 50))`。量化的目的是壓 setState 頻率，本包降的是「單步成本」而非步幅顆粒度；顆粒度屬體感問題，由使用者在 Phase A 收尾統一人工驗證，此處調整會混淆前後對照基準。

## 行為不變清單自查（逐項讀碼確認）

| 項目 | 結論 |
|---|---|
| 拖曳平移方向/放開位置 | handleDragMove 換算邏輯逐行未動（僅 width 來源改 ref） |
| 鉗位最新/最舊 | windowBounds 夾止數學與原四行逐字相同；handleDragMove 的 maxOffset clamp 未動 |
| hover 十字線（拖曳中抑制、放開恢復） | handleMouseMove 的 draggingRef 閘門、dragStart 清 activeIndex 皆未動 |
| 縮放 +/-（含鍵盤） | handleZoom/keydown effect 未動；barsToShow 變 → windowBounds 重算，行為同舊版 |
| 切股票/週期 rightOffset 歸 0 | data.length effect 未動 |
| 拖曳中副圖凍結＋放開單次補正 | displayDataRef 鏡像、frozenSubDataRef 快照時機（dragStart）、subPanelData 三元式、macdHistCells deps 全未動（260613-ixg 不退化） |
| 一字板最小 2px 線＋漲跌色 | CandleStickShape 讀 payload.priceChange，mappedData 欄位齊全且值同舊版 |
| OHLCInfoBar / MALegend | activeData 取值邏輯未動，欄位齊全 |
| Adj/Raw 切換 | settings.useAdjusted 變 → mappedData deps 命中 → 全量重算，正確 |

## Deviations from Plan

**[微調] Task 1 註解措辭**：dragWidthRef 註解原稿含 "getBoundingClientRect" 字樣，使 `grep -c` 輸出 2（含註解）；為滿足驗證條款「全檔僅 1 處且在 handleDragStart」，註解改寫為「佈局量測」。程式邏輯無任何偏離。

其餘照計畫逐字執行。

## Known Stubs

None.

## Threat Flags

None——純前端渲染路徑重構，零安裝、不觸網路、不碰金鑰/儲存。T-qyf-01（效能退化）之 mitigation 即本任務本體：熱路徑無 reflow/全量重建已以 grep＋讀碼證明，260613-ixg 凍結機制確認未退化。

## Commits

| Task | Commit | 內容 |
|---|---|---|
| 1 | c2b91b5 | dragStart 量測一次容器寬度存 dragWidthRef，handleDragMove 零佈局量測 |
| 2 | 70905f7 | mappedData 全量預映射＋windowBounds＋displayData/volumeCells slice 化 |

## 驗證

- `npx tsc --noEmit`：Task 1 後、Task 2 後各跑一次，全過。
- grep：getBoundingClientRect 全檔 1 處（handleDragStart :764）；displayData useMemo 體內只有 slice；`.map` 僅存在於 mappedData/volumeCellsFull（deps 不含 barsToShow/rightOffset）與 macdHistCells（吃 subPanelData，原樣）。
- 未啟 dev server（依規格鎖定項 5，人工體感驗證由使用者 Phase A 收尾統一做）。
- git：兩個 commit 僅含 components/StockChart.tsx（diff --stat 確認），無檔案刪除。

## Self-Check: PASSED

- components/StockChart.tsx 存在且含 dragWidthRef / mappedData / windowBounds / mappedData.slice
- commits c2b91b5、70905f7 皆存在於 git log
- 兩個 commit 均無檔案刪除；工作樹無本任務殘留未追蹤檔
