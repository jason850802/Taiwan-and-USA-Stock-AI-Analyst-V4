---
phase: quick-260712-qyf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [components/StockChart.tsx]
autonomous: true
requirements: [OPT-A2]

must_haves:
  truths:
    - "拖曳平移期間，每次 mousemove 的熱路徑不呼叫 getBoundingClientRect（無強制 reflow）"
    - "拖曳每一步不再對視窗內 K 棒做全量物件重建：displayData 降級為對預映射全量陣列做 slice，同一根 K 棒物件在拖曳期間參照穩定"
    - "行為完全不變：拖曳平移方向/放開位置、鉗位最新/最舊、hover 十字線（拖曳中抑制）、縮放 +/-、切股票/週期歸位、拖曳中副圖凍結（frozenSubDataRef）、一字板/漲跌色全部照舊"
    - "priceChange 語意不變：現行即以全量陣列的前一根（data[originalIndex-1]）計算，預映射到全量陣列後語意逐位元相同"
    - "npx tsc --noEmit 通過"
  artifacts:
    - path: "components/StockChart.tsx"
      provides: "dragWidthRef（dragStart 量測一次的容器寬度）＋ mappedData 全量預映射 useMemo ＋ slice 化的 displayData/volumeCells"
  key_links:
    - from: "handleDragStart"
      to: "dragWidthRef"
      via: "wrapperRef.current.getBoundingClientRect().width 量測一次寫入 ref"
      pattern: "dragWidthRef\\.current\\s*="
    - from: "handleDragMove"
      to: "dragWidthRef"
      via: "讀 ref，不再呼叫 getBoundingClientRect"
      pattern: "dragWidthRef\\.current"
    - from: "displayData"
      to: "mappedData"
      via: "mappedData.slice(startIndex, endIndex)"
      pattern: "mappedData\\.slice"
---

<objective>
A2（P1-A）K 棒圖拖曳平移低風險效能快贏：消除 per-mousemove 強制 reflow 與每步全量重建，
把拖曳單步成本從「getBoundingClientRect + 100 筆物件×MA 欄位迴圈全量 map」降為「純 ref 讀取＋O(視窗) slice（元素參照穩定）」。

Purpose: .planning/optimization/PLAN.md §A2 鎖定規格；量測後若仍不順才做 Phase D 的 P1-B（transform 平移）。
Output: components/StockChart.tsx 兩個原子 commit（Task 1 / Task 2 各一），行為零變化。
</objective>

<context>
@.planning/optimization/PLAN.md          # §A2 為本任務鎖定規格（不得偏離、不得擴 scope）
@components/StockChart.tsx               # 唯一要改的檔案
@.planning/quick/260613-ixg-reduce-stockchart-pan-lag-freeze-sub-pan/260613-ixg-SUMMARY.md  # 前一輪拖移優化（副圖凍結＋量化步幅），不可退化
</context>

<interface_notes>
現行資料流（行號以任務執行當下實讀為準，下列為規劃時實測）：

- `maResultsCache`（:599-607）：全量 data 上預算各 MA 的 SMA 陣列，deps `[data, settings.useAdjusted, settings.maLines]`。
- `displayData`（:610-674）：每次重算 maxOffset/clampedOffset/endIndex/startIndex → `data.slice` → **對切片全量 `.map`** 建含 open/close/high/low（Adj 切換）、candleBody、`ma_5/ma_10/..._dir` 動態欄位、rsi/macd/bb 系列（Adj 切換）、priceChange/priceChangePercent 的新物件。deps `[data, barsToShow, rightOffset, settings.useAdjusted, maResultsCache]` → **拖曳每步（rightOffset 變）全量重建 100 筆新物件**。
- **priceChange 現行語意**（:630-635）：`originalIndex > 0` 時取 `data[originalIndex - 1]` 的收盤——是**全量陣列的前一根**，非切片內前一根。切片第一根本來就用全域前一根算漲跌。→ 遷移到全量預映射**語意完全一致**，無「修正」疑慮（規格第 4 點的顧慮不成立，需在 SUMMARY 註明此讀碼結論）。
- 副圖凍結鏈（:679-684，260613-ixg 建立，不可動）：`displayDataRef`（即時鏡像，每 render 賦值）→ `frozenSubDataRef`（dragStart 快照）→ `subPanelData = isDragging ? frozen : displayData`。`macdHistCells`（:780-782）吃 subPanelData。
- `activeData`（:686）：拖曳中 activeIndex 已被 dragStart 清為 null → 恆取 `displayData[length-1]`。
- `handleDragMove`（:718-737）：**:720 每次 mousemove 呼叫 `wrapperRef.current?.getBoundingClientRect().width`**（rAF 之外 → 強制 reflow）；`PAN_STEP = Math.max(1, Math.round(barsToShow / 50))`（:726）；rAF 節流＋同值跳過 setRightOffset。deps `[barsToShow, data.length]`。
- `handleDragStart`（:750-763）：快照 frozenSubDataRef、setIsDragging(true)、清十字線、掛 window listeners。deps `[rightOffset, data.length, barsToShow, handleDragMove, handleDragEnd]`。
- `volumeCells`（:775-777）：`displayData.map` 生 100 個 `<Cell key={vol-${index}}>`，deps `[displayData]` → 拖曳每步重生。
- 空資料 guard（:787）在所有 hooks 之後 early-return，預映射空陣列安全。
</interface_notes>

<tasks>

<task type="auto">
  <name>Task 1: dragStart 量測一次容器寬度存 ref，handleDragMove 不再碰 getBoundingClientRect</name>
  <files>components/StockChart.tsx</files>
  <action>
依 .planning/optimization/PLAN.md §A2 改法 1（規格鎖定項 1）：

1. 在拖曳 refs 區塊（:711-716，wrapperRef/draggingRef/startClientXRef 旁）新增
   `const dragWidthRef = useRef(0);`，附註解說明用途（拖曳期間視為固定的容器寬度快照，
   消除 per-mousemove 強制 reflow；視窗 resize 期間拖曳不重量測，下次 dragStart 自然更新）。
2. `handleDragStart`（:750-763）：在掛 window listeners 前加
   `dragWidthRef.current = wrapperRef.current?.getBoundingClientRect().width ?? 0;`。
3. `handleDragMove`（:718-737）：把 :720 的
   `const width = wrapperRef.current?.getBoundingClientRect().width ?? 0;`
   改為 `const width = dragWidthRef.current;`。其餘邏輯（barPixelWidth 換算、PAN_STEP 量化、
   clamp、rAF 節流、同值跳過）一行不動。useCallback deps 維持 `[barsToShow, data.length]`
   （ref 讀取不需列 deps）。
4. **PAN_STEP 維持現值 `Math.max(1, Math.round(barsToShow / 50))` 不調整**（規格鎖定項 3）。
   理由：量化的目的是壓 setState 頻率，本包降的是「單步成本」而非步幅顆粒度；
   顆粒度屬體感問題，由使用者在 Phase A 收尾統一人工驗證，此處調整會混淆前後對照基準。

提交：只 stage components/StockChart.tsx，commit 訊息
`perf(260712-qyf): cache pan container width at dragStart to kill per-mousemove reflow`。
**絕不可 git add -A**（工作樹有本任務外的既有未提交變更，不可觸碰）。
  </action>
  <verify>
    <automated>npx tsc --noEmit 通過；用 Bash 工具跑 grep -cv 檢查：grep -c "getBoundingClientRect" components/StockChart.tsx 輸出 1（唯一出現處在 handleDragStart 內，以 grep -n 行號對照函式範圍確認）</automated>
  </verify>
  <done>handleDragMove 函式體內無任何 getBoundingClientRect / offsetWidth / clientWidth 等佈局量測 API；拖曳換算與鉗位邏輯逐行不變；tsc 過；原子 commit 完成。</done>
</task>

<task type="auto">
  <name>Task 2: 全量預映射 useMemo，displayData/volumeCells 降級為 slice（元素參照穩定）</name>
  <files>components/StockChart.tsx</files>
  <action>
依 .planning/optimization/PLAN.md §A2 改法 2（規格鎖定項 2、4）：

1. **新增 `mappedData` useMemo**（放在 maResultsCache 之後、現 displayData 位置）：把現行
   displayData 內 `.map` 的完整轉換（Adj 切換的 open/close/high/low、candleBody:[lowVal,highVal]、
   `ma_N`/`ma_N_dir` 動態欄位、rsi/macd/macdSignal/macdHist/bbUpper/bbMiddle/bbLower/bbBand 的
   Adj 切換、priceChange/priceChangePercent、`...d` 展開）搬到**全量 data** 上執行，
   `originalIndex` 即陣列索引 i。deps：`[data, settings.useAdjusted, settings.maLines, maResultsCache]`
   ——**絕不可含 barsToShow / rightOffset**，這是「拖曳期間元素參照穩定」的根據。
   priceChange 沿用 `data[i - 1]` 前收計算：與現行切片版的 `data[originalIndex - 1]` 逐位元
   相同語意（現行本來就用全量前一根，非切片內前一根——讀碼已確認，SUMMARY 需註明）。
2. **切片邊界單一事實來源**：新增 `windowBounds` useMemo（deps `[data.length, barsToShow, rightOffset]`），
   內容即現行的 maxOffset/clampedOffset/endIndex/startIndex 四行 clamp 數學，回傳
   `{ startIndex, endIndex }`。不得把這段數學複製到兩處造成 drift。
3. **`displayData` 降級為 slice**：`useMemo(() => mappedData.slice(startIndex, endIndex),
   [mappedData, windowBounds])`。slice 產生新外層陣列（觸發 MainPriceChart 重繪，主圖本
   來就要動），但**元素物件是 mappedData 的原參照**——拖曳期間 mappedData deps 全不變 →
   同一根 K 棒物件不重建，React/Recharts 比對成本降到最低。
4. **`volumeCells` 改吃預映射**：新增 `volumeCellsFull` useMemo（deps `[mappedData]`）在全量
   陣列上生成 `<Cell key={`vol-${index}`} fill={entry.close >= entry.open ? '#f0405a' : '#22c55e'} fillOpacity={0.15}/>`，
   再以 `volumeCellsFull.slice(startIndex, endIndex)`（deps `[volumeCellsFull, windowBounds]`）
   得出 volumeCells。key 變為全域索引：Cell 與 bar 的對應是**位置序**而非 key，渲染結果不變；
   key 僅影響 React 調和，全域 key＋穩定元素參照反而讓未變動的 Cell 整棵 bail out。
   fill 邏輯讀映射後的 close/open（Adj 切換後值），與現行完全一致。
5. **hooks 順序與凍結鏈不可動**：mappedData → windowBounds → displayData → volumeCellsFull/volumeCells
   全部放在 `displayDataRef.current = displayData;`（:679-680）**之前**；`displayDataRef`、
   `frozenSubDataRef`、`subPanelData = isDragging ? frozen : displayData`（:679-684）、
   `macdHistCells`（吃 subPanelData）、`activeData` 一行不改。原 :775-777 的舊 volumeCells
   定義移除（新定義已上移）。
6. **行為不變清單（規格鎖定項 4，逐項自查後寫入 SUMMARY）**：拖曳平移/放開位置、鉗位、
   hover 十字線（拖曳中抑制、放開恢復）、縮放 +/-（含鍵盤）、切股票/週期 rightOffset 歸 0、
   拖曳中副圖凍結與放開單次補正、一字板最小 2px 線與 priceChange 顏色（CandleStickShape 讀
   payload.priceChange，預映射欄位齊全）、OHLCInfoBar 讀數、MALegend 方向箭頭、Adj/Raw 切換
   （settings.useAdjusted 變 → mappedData 全量重算，正確）。

提交：只 stage components/StockChart.tsx，commit 訊息
`perf(260712-qyf): pre-map full dataset once so pan steps only slice with stable refs`。
**絕不可 git add -A**。
  </action>
  <verify>
    <automated>npx tsc --noEmit 通過；用 Bash 工具 grep -n 確認 displayData 的 useMemo 體內只有 slice 無 .map（.map 僅存在於 mappedData 與 volumeCellsFull 兩個 useMemo，其 deps 不含 barsToShow/rightOffset）</automated>
  </verify>
  <done>
拖曳單步（rightOffset 變化）重算的 memo 只剩 windowBounds（O(1)）、displayData slice（O(視窗)）、
volumeCells slice（O(視窗)）；mappedData/volumeCellsFull/maResultsCache/macdHistCells 全部命中快取；
subPanelData 回傳凍結參照。SUMMARY 內附「每次 mousemove 會執行的函式清單」（規格鎖定項 5）：
mousemove → handleDragMove（讀 dragWidthRef＋純算術＋rAF 排程）→ rAF → setRightOffset（同值跳過）→
（僅量化步幅跨界時）StockChart 重渲染 → windowBounds/兩個 slice → MainPriceChart 重繪（元素參照穩定）、
SubPanelChart×2 經 React.memo 跳過——證明熱路徑無 getBoundingClientRect、無全量 .map。
tsc 過；原子 commit 完成。
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| （無新增） | 純前端渲染路徑重構：不新增依賴、不觸網路、不碰金鑰/儲存，無新信任邊界 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-qyf-01 | DoS（效能退化屬可用性） | StockChart 拖曳熱路徑 | mitigate | 本計畫本身即緩解：驗證條款要求熱路徑無 reflow/全量重建，且 260613-ixg 凍結機制以 grep＋讀碼確認未退化 |
| T-qyf-SC | Tampering | 套件安裝 | accept | 本任務零安裝（無 npm/pip/cargo install），不適用 |
</threat_model>

<verification>
1. `npx tsc --noEmit` 通過（每個 task 後各跑一次）。
2. Bash 工具 grep：`getBoundingClientRect` 全檔僅 1 處且位於 handleDragStart；displayData useMemo 體內無 `.map`。
3. 讀碼列出「每次 mousemove 會執行的函式清單」寫入 SUMMARY（見 Task 2 done），證明熱路徑乾淨。
4. 260613-ixg 不退化自查：frozenSubDataRef 快照時機（dragStart）、subPanelData 三元式、macdHistCells deps、PAN_STEP 公式皆未變動。
5. **不啟 dev server**——人工體感驗證由使用者於 Phase A 收尾統一做（規格鎖定項 5）。
6. Git：`git status` 確認只有 components/StockChart.tsx 與本任務 .planning/quick/260712-qyf-* 檔案被 commit；工作樹既有的其他 .planning/**/SUMMARY.md 未提交變更原封不動。
</verification>

<success_criteria>
- 兩個原子 commit 存在，僅含 components/StockChart.tsx（＋GSD 收尾文件）。
- must_haves.truths 全數成立（reflow 消除、slice 化＋參照穩定、行為零變化、priceChange 語意一致、tsc 過）。
- SUMMARY 記錄：熱路徑函式清單、priceChange「現行即全量前一根」讀碼結論、PAN_STEP 維持不動的理由。
</success_criteria>

<output>
完成後建立 `.planning/quick/260712-qyf-a2-chart-pan-quick-wins-k/260712-qyf-SUMMARY.md`
</output>
