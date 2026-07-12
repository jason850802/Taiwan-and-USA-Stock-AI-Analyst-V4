---
phase: quick-260712-wa0
plan: 01
subsystem: chart-interaction
tags: [performance, drag-to-pan, css-transform, recharts, stockchart]
requires: [quick-260712-qyf]
provides:
  - "utils/panMath.ts：computeWindowBounds / buildPanSession / clampTranslate / commitOffset 純函式＋PanSession 型別"
  - "StockChart 拖曳期間零 React 重繪：CSS translate3d 平移加寬緩衝層"
affects: [components/StockChart.tsx]
tech-stack:
  added: []
  patterns:
    - "拖曳 session 狀態機：dragStart 建 session → mousemove 純 transform → mouseup 提交 re-slice"
    - "ref＋state 雙軌同步（panSessionRef 為事件 handler 權威來源）"
    - "pan 模式 bare ComposedChart 顯式尺寸（繞過 ResponsiveContainer 非同步量測）"
key-files:
  created: [utils/panMath.ts]
  modified: [components/StockChart.tsx]
decisions:
  - "緩衝每側 ceil(barsToShow×0.5)，耗盡且還有資料時 mid-drag re-base（每半視窗一次重繪）"
  - "pan 模式右 YAxis hide＋右緣 60px 固定遮罩（不複製刻度、不平移軸）"
  - "PAN_STEP 量化步幅廢除：其目的（壓低拖曳 setState/重繪頻率）已被 transform 路徑整個取代"
metrics:
  duration: "~40min"
  completed: "2026-07-12"
---

# Quick 260712-wa0: B-3 拖曳體感 — CSS transform translate Summary

**One-liner:** 拖曳期間改以 translate3d 平移「已渲染的 1.5×~2× 加寬緩衝層」，mousemove 熱路徑零 setState／零 Recharts 重繪／零佈局量測；放開才用 commitOffset 吸附整根＋鉗位提交 re-slice，三圖同視窗。

## Commits

| Task | Commit | 內容 |
|------|--------|------|
| 1 | `78ca076` | feat(260712-wa0): utils/panMath.ts 四純函式＋PanSession 型別（一次性 tsx 斷言 89 PASS / 0 FAIL，未 commit 斷言檔） |
| 2 | `851e3bf` | perf(260712-wa0): StockChart 拖曳管線改接 CSS translate 緩衝層 |

## mousemove 熱路徑讀碼證明

`handleDragMove`（deps `[]`，身分穩定）全文邏輯：

```
if (!draggingRef.current) return;
const session = panSessionRef.current;
if (!session || rebasePendingRef.current) return;
const deltaX = e.clientX - startClientXRef.current;
const { t, exhausted } = clampTranslate(session, deltaX);   // 純算術
lastTranslateRef.current = t;
if (exhausted) { /* 一次 re-base 提交：setRightOffset + setPanSession（設計內） */ return; }
const el = panLayerRef.current;
if (el) el.style.transform = `translate3d(${t}px,0,0)`;      // 唯一 DOM 寫入
```

- 只讀 ref（draggingRef/panSessionRef/rebasePendingRef/startClientXRef/panLayerRef）＋純函式＋一行 style 寫入。
- **無 getBoundingClientRect**（grep 閘門：全檔非註解出現 1 次，位於 handleDragStart :842）。
- **無 rAF**（grep 閘門：requestAnimationFrame 僅 :751 hover 路徑 handleMouseMove/rafRef）。
- **無 setState**（grep 閘門：setRightOffset 僅 4 處——useState :576、data.length 歸位 effect :589、re-base 分支 :812、handleDragEnd :831）。
- **PAN_STEP = 0 出現**（含註解與 QT-ixg-COARSEN 段落全數移除）。

## design_rulings 1–13 落地情況

| # | 裁決 | 落地 |
|---|------|------|
| 1 | 緩衝 = ceil(bars×0.5) 每側、夾至資料邊界 | `buildPanSession`（bufferRatio 預設 0.5）；斷言驗證 ro=0/200/400/9999 與 len=120 邊界夾止 |
| 2 | 耗盡＋還有資料 → mid-drag re-base；資料邊界 → 硬鉗住 | `clampTranslate` 回 exhausted 訊號；handleDragMove re-base 分支重建 session＋重設錨點；斷言驗證兩種硬鉗住情形 exhausted=null |
| 3 | pan 模式右 YAxis hide＋60px 右緣遮罩 | MainPriceChart `hide={!!panDims}`；wrapper 內 `{panSession && <div ... width: Y_AXIS_WIDTH />}` |
| 4 | X 軸不特殊處理（日期隨 K 棒平移） | XAxis 一行未動，長在緩衝層內 |
| 5 | Y domain 沿用 ['dataMin','dataMax'] 作用於緩衝資料、拖曳全程凍結 | domain props 未動；session 期間無重繪故 domain 凍結 |
| 6 | PAN_STEP 廢除 | 全檔移除（見下方廢除理由） |
| 7 | pan 模式 bare ComposedChart 顯式尺寸 | chartEl 變數＋`return panDims ? chartEl : <ResponsiveContainer>…`；width/height 由 panDims spread |
| 8 | isDragging 根 div pointer-events-none＋body cursor 命令式 | 根 div className 條件式；dragStart 設 `document.body.style.cursor='grabbing'`，dragEnd/abort/卸載還原 |
| 9 | 拖曳中縮放忽略；data 變更安全中止 | handleZoom 首行 draggingRef guard；`useEffect([data])` 中止 session（移除 listeners、清旗標、還原游標） |
| 10 | resize 期間不重量測 | session 幾何以 dragStart 一次量測為準 |
| 11 | 緩衝層生命週期限 session | panLayer 恆存但閒置時 `{width:'100%'}` 普通容器；panSession 僅 dragStart→dragEnd/abort 之間非 null |
| 12 | 主圖資料與量能 Cell 同一組 mainBounds | `mainBounds → mainDisplayData / mainVolumeCells` 兩個 slice 同源，結構上不可能錯位；閒置時 mainBounds === windowBounds 同參照 |
| 13 | 接受的行為 delta | 見下節 |

## 接受的行為 delta（裁決 13）

1. 拖曳期間 OHLCInfoBar／MALegend 讀數凍結在 session 起點視窗（放開／re-base 時更新）——現況是每步跳動。
2. 拖曳期間 Y 軸刻度暫隱（domain 凍結、數字本就不變；右緣遮罩蓋緩衝 K 棒）。
3. 按下／放開各一次一次性渲染延遲（≤2× 視窗渲染建緩衝層；1× 提交），對照修改前 93–94% 拖曳時間凍結。

## PAN_STEP 廢除理由

PAN_STEP（QT-ixg-COARSEN）的存在目的是「量化平移步幅以壓低拖曳期間 setState／Recharts 重繪頻率」。本包把拖曳期間的重繪路徑整個換成 CSS transform（compositor-only），mousemove 不再 setState，量化失去作用對象；提交顆粒度改由 `commitOffset` 的 `Math.round(t / bpw)` 吸附到整根（1 根），比 PAN_STEP≈2 根更精細。

## 不退化自查清單（逐項讀碼＋grep/diff 確認）

- **十字線**：拖曳中抑制（handleMouseMove 首行 draggingRef 閘門 :746＋根 div pointer-events-none 雙保險；dragStart setActiveIndex(null) :850）；放開恢復（RC↔bare chart remount 重置 recharts hover 狀態）。【260613-if7】
- **鉗位**：commitOffset [0,maxOffset] 鉗位＋computeWindowBounds 夾止（斷言直測含 t=−9999→0、鉗頂 maxOffset）。【260613-if7】
- **縮放 +/-**：閒置照舊（handleZoom 邏輯未動）；拖曳中忽略（首行 guard）。
- **切股票/週期**：`data.length` effect setRightOffset(0) 未動 :589；拖曳中資料變更安全中止 effect 新增。
- **副圖凍結**：displayDataRef/frozenSubDataRef/subPanelData/macdHistCells 鏈一行未動（diff 對 base 無 hit）。【260613-ixg】
- **React.memo 拆分**：MainPriceChart :383／SubPanelChart :492 皆保留 React.memo。【260613-3ab】
- **一字板 2px 線與漲跌色**：CandleStickShape 未動；緩衝 slice 來自同一 mappedData，priceChange 欄位齊全。【260711-v9f】
- **ChipBar 零線錨定**：MIN_CHIP_BAR_H/ChipBar/ForeignBar/TrustBar 未觸碰（diff 無 hit）。【260711-v9f】
- **量能 Cell 對齊**：mainDisplayData 與 mainVolumeCells 同吃 mainBounds（裁決 12）。
- **A2 結構**：maResultsCache :619／mappedData :633／volumeCellsFull :705 未動；windowBounds 改呼叫 computeWindowBounds，語意由 50 點網格斷言證明與舊四行公式逐位元全等。【260712-qyf】
- **OHLCInfoBar/MALegend**：閒置與 hover 照舊（activeData 仍吃 displayData）；拖曳中凍結屬裁決 13。
- **Adj/Raw 切換**：mappedData deps 照舊。

## 驗證結果

- `npx tsc --noEmit`：兩個 task 後各跑一次，皆通過。
- Task 1 tsx 斷言：**89 PASS / 0 FAIL**（含 computeWindowBounds 舊公式網格全等、buildPanSession 幾何、clampTranslate 耗盡/硬鉗住、commitOffset 吸附/鉗位、re-base 連續性不變量、方向性 +bpw→baseOffset+1）。斷言檔在 scratchpad，未 commit。
- Task 2 grep 閘門：getBoundingClientRect=1（handleDragStart 內）；PAN_STEP=0；rAF 僅 hover 路徑；setRightOffset 僅 4 個許可位置。
- Git：兩個原子 commit 各只含本任務檔案；工作樹其他既有變更未觸碰。

## 60fps 實測計畫（非本包阻斷項，Phase B 收尾執行）

依 start-dev skill 起環境（preview 3001 單埠即完整 App）→ 開 2330 日 K → Chrome DevTools Performance 錄製並按住拖曳 3–5 秒（含一次拖到緩衝耗盡觸發 re-base）→ 預期：長任務（>50ms）只出現在 mousedown（建緩衝層）、mouseup（提交）、re-base 三個瞬間；拖曳中間段幀全為 compositor-only，FPS 計 60；對照影片基線（凍結占比 93–94%）記錄改善數據。

## Deviations from Plan

None - plan executed exactly as written.（唯一自主補充：把原 volumeCells 位置的過時註解改指向 mainVolumeCells/mainBounds，屬註解正確性維護。）

## Known Stubs

無。

## Threat Flags

無新增安全面（純前端渲染路徑重構，不觸網路/金鑰/儲存；T-wa0-01/T-wa0-02 緩解均已落地——grep 閘門＋斷言直測＋四變異點 ref/state 同步＋useLayoutEffect transform 歸零）。

## Self-Check: PASSED

- utils/panMath.ts 存在 ✓
- components/StockChart.tsx 修改 ✓
- commit 78ca076 存在 ✓
- commit 851e3bf 存在 ✓
- tsc --noEmit 通過 ✓
