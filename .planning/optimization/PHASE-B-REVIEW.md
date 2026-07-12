# Phase B 覆核報告（Sonnet）

**Diff 範圍：** `git diff 6e6e465..HEAD -- . ':!.planning'`（9 檔）
**日期：** 2026-07-12

## 三包總判定

| 包 | 判定 |
|---|---|
| B-1（行情載入速度全套） | **ACCEPT_WITH_NOTES** |
| B-2（搜尋 UX 三修） | **ACCEPT** |
| B-3（拖曳體感 CSS transform） | **ACCEPT** |

1 個 HIGH（B-1：AbortController 未真正終止台股 1d 請求被取消後的背景 FinMind 工作）、2 個 MEDIUM（B-1：`handleRefreshQuote` 缺競態守衛／CDN swr 視窗實際大於文件宣稱）、1 個 LOW（既有死碼，本次改動附帶觸碰但非新引入）。無 CRITICAL。B-2／B-3 讀碼深挖後未發現新缺陷，PLAN 驗收項與 SUMMARY 記載的「接受的行為 delta」逐一核實屬實、理由站得住。

---

## Findings（依嚴重度）

### HIGH

**H-1｜B-1｜`services/yahoo.ts:503-527`（`fetchStockDataUncached` 主 catch）與 `services/yahoo.ts:286-335`（`fetchRawData` 的 `.TW`/`.TWO` 重試鏈）——AbortController 對台股 1d 請求不真正終止背景工作，只是延後丟棄結果**

問題：B-1 把 `signal` 一路透傳到 `queryYahoo`（:257）沒錯，但 `fetchStockDataUncached` 的頂層 `catch (err: any)`（:503）完全沒有把 `AbortError` 與「Yahoo 真的失敗」區分開來。只要 `isPotentialTaiwanStock && interval === '1d'`（台股代碼＋日線——App.tsx 預設 interval 正是 `1d`，且台股是本 app 核心使用情境），無論 catch 到的是真實錯誤還是使用者主動 abort，都會觸發 `fetchFinMindDailyData`＋`fetchFinMindStockInfo`（:511-512）這兩個**完全不吃 signal 的**FinMind 網路請求，並繼續往下跑完整條管線（週/月合併、`Promise.all` 籌碼/量能抓取等，:530-660），直到 `getStockData` 外殼最後才 `if (opts?.signal?.aborted) throw ...`（yahoo.ts:916）把結果丟棄。

同樣的問題也出現在 `fetchRawData` 內部：當 canon 在 `getStockData` 外殼層未能預解析成功（名錄查無 / 尚未載入）時，會落入舊有的 `.TW`→`.TWO` 重試鏈（:316-326）或新增的「1.5 名錄後綴預解析」分支（:303-314）；兩者的 `catch` 都是無條件 swallow-and-retry（不分辨是 AbortError 還是真失敗），對已中止的 signal 重試第二個 URL 只是白工（fetch 對已 abort 的 signal 會立即 reject，不會真的打網路，但仍把 `AbortError` 轉型成一個泛用的 `Error('找不到台股代號: ...')`，讓上層 catch 徹底失去判斷「這是不是使用者主動取消」的依據）。

失效情境：使用者在冷抓 2317（台積電週邊、日線）途中快速切到 2330。若當下名錄快取尚未就緒或該代碼未命中 `resolveTaiwanSuffix`（例如剛啟動、名錄還在載入），`fetchRawData` 內層對 `.TW` 的請求被 abort 後，會依上述路徑轉成泛用錯誤，觸發 `fetchStockDataUncached` 對 2317 發出**真正的、不可中止的**FinMind API 請求（`TaiwanStockInfo`/`TaiwanStockPrice` 之類），即使使用者已經不在乎 2317 了。這與 PLAN 明言的「AbortController 防競態」與 CLAUDE.md 記載的「FinMind 429 是常態」直接衝突——連續快速切換台股會讓每次「取消」都額外多打 1-2 次 FinMind 請求，實質上放大既有的限流風險，且與 SUMMARY 宣稱的「abort 不中毒快取」（cache 確實不中毒，已驗證）不是同一件事——**cache 沒中毒，但背景工作沒有真的停**。

orchestrator 的 e2e 實測（#6：2317 chart 請求 ERR:AbortError 主動取消）只證實了 `/api/yahoo/chart` 那一個請求在 Network 面板顯示為取消，並未檢查該次操作是否緊接著又打了一次 `/api/finmind` 請求——這正是本 finding 想指出的缺口，兩者不衝突（chart 請求確實被 abort，但 catch 之後的 FinMind fallback 是全新的、未被追蹤的請求）。

**建議修法：**
```ts
// fetchStockDataUncached 主 catch：先識別 AbortError，直接重拋、不觸發 FinMind fallback
} catch (err: any) {
    if (err?.name === 'AbortError') throw err; // 使用者主動取消，不做任何 fallback
    const cleanSymbol = symbol.toUpperCase().replace(/\.TWO?$/i, '');
    const isPotentialTaiwanStock = /^\d{3,6}[A-Z]?$/.test(cleanSymbol);
    if (isPotentialTaiwanStock && interval === '1d') {
        ...
    }
}
```
```ts
// fetchRawData 的兩個 catch（1.5 段與既有 .TW→.TWO 鏈）：AbortError 直接向上拋，不重試
try {
    return await performQuery(coreCode + suffix);
} catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    // 名錄與 Yahoo 不一致的情境才 fall through
}
```

---

### MEDIUM

**M-1｜B-1（跨 App.tsx）｜`App.tsx:193-206`（`handleRefreshQuote`）——「更新報價」缺 reqId/AbortController 競態守衛，可能被較新的股票切換覆蓋**

問題：B-1 的 PLAN 條目明確是「App.tsx fetchData 加 AbortController＋reqId 防競態」，也確實只對 `fetchData` 做了這件事（:110-147）。但 `handleRefreshQuote`（:193-206）呼叫的是**另一個獨立的** `getStockData(..., {forceRefresh:true})`，完全沒有掛上 `fetchSeqRef`／`fetchAbortRef` 的任何一環——它只在**進入時**檢查 `loading || refreshing`（:194）擋住「正在載入中不能按刷新」，但完全沒有反向保護：刷新已經在飛行中時，使用者透過 `StockSearch` 或首頁快選按鈕切換到不同標的，會呼叫 `fetchData(newSym, interval)`（reqId 遞增、正常運作），但舊的 `handleRefreshQuote` promise 完全不受影響地繼續跑，其 `.then` 區塊（:199-200）在較晚的時間點無條件 `setData(result.data); setInfo(result.info);`，把使用者已經看到的「新標的」畫面用「舊標的的刷新結果」覆蓋回去。

失效情境：使用者在 2330 頁面按「更新報價」（例如網路慢、要等 FinMind 籌碼一起抓完，可能要好幾秒），趁還在等待時立刻用搜尋框切到 2317。2317 的 `fetchData` 正常完成並顯示；接著 2330 的舊刷新請求完成，把畫面又蓋回 2330 的資料——但 `info`/`symbol` 顯示邏輯全部依賴這兩個 state，UI 會呈現「已選 2317 但顯示 2330 報價」的錯置，且不會有任何錯誤訊息。

此問題**非 B-1 本次引入**（`git diff` 顯示 handleRefreshQuote 這段除了新增 `forceRefresh: true` 外零改動，pre-existing），但 B-1 明確把「連點 5 檔無資料錯置」列為 Phase B 驗收標準之一，且此次正好是在同一支函式旁邊加了「防競態」硬化——同類型 bug 近在咫尺卻未一併處理，屬於本次交付範圍內可合理預期會被順手修掉、但沒有修的缺口。

**建議修法：** 讓 `handleRefreshQuote` 共用 `fetchSeqRef`（呼叫前 `const reqId = ++fetchSeqRef.current`，`.then` 內用 `if (fetchSeqRef.current !== reqId) return;` 守衛），或直接改為呼叫 `fetchData(info?.symbol||symbol, interval, {forceRefresh:true})`（需擴充 fetchData 簽名支援 forceRefresh 透傳）統一走同一套防競態管線。

**M-2｜B-1｜`api/yahoo/chart.ts:71`（`Cache-Control: s-maxage=60, stale-while-revalidate=300`）——已接受風險 T-B1-01 的「60 秒視窗」陳述低估了實際的 guard 繞過時間**

問題：SUMMARY 記載的 T-B1-01 接受理由是「60 秒內同 URL 由 Vercel CDN 直接回應、不過 applyGuards」，程式碼註解（chart.ts:68-70）也只提「視窗僅 60 秒」。但實際設的 header 是 `s-maxage=60, stale-while-revalidate=300`——`stale-while-revalidate` 的標準語意是：`s-maxage` 過期後的額外 300 秒內，CDN 仍可**立即**把已經過期的舊回應直接served給用戶端（同時背景觸發一次 revalidate 打回 origin），而不是每次都乖乖等 origin 重新驗證。也就是說，對同一個 URL（同 symbol/interval/range 組合），實際「可能被 CDN 直接回應、不經過 `applyGuards`（PROXY_SHARED_SECRET／限流）」的時間窗是 `60 + 300 = 360` 秒量級，而非文件所稱的 60 秒——差了 6 倍。

由於行情資料本身公開、且 cache miss 仍會完整跑一次 guard/限流（風險本質沒有改變），這仍然是可接受的取捨，但**風險評估依據的數字本身不準確**，若日後基於「僅 60 秒」的假設做進一步決策（例如評估 PROXY_SHARED_SECRET 被繞過造成的濫用上限），會低估實際暴露時間，建議更正註解與 SUMMARY 記載為「60-360 秒視窗（依 swr 命中與否）」。

**建議修法：** 更新 chart.ts:68-70 註解與 SUMMARY 的 T-B1-01 描述，明確寫出 `s-maxage + stale-while-revalidate` 的合計曝光上界；若要嚴格限制在 60 秒，移除 `stale-while-revalidate` 或改用更短的 swr 值。

---

### LOW

**L-1｜B-1｜`api/_lib/yahoo.ts:212-229`（`classifyYahooError`）——本次新增的 `TimeoutError` 判斷分支實質是死碼，兩個分支回傳值相同**

問題：`classifyYahooError` 的 `if` 分支（:224，本次新增 `name === 'TimeoutError'` 判斷）與其後不符合 if 條件時的最終 `return`（:228）都回傳 `new YahooClassifiedError('UPSTREAM_ERROR')`——完全相同的結果。也就是說，無論 `AbortSignal.timeout` 拋出的例外是否被這個 if 條件捕捉到，最終分類結果都一樣，這個判斷式本身（連同其精心撰寫的註解「undici 對 AbortSignal.timeout 拋 DOMException name='TimeoutError'——顯式列名，不賭 message 措辭」）對執行結果沒有任何實質影響。

此結構屬於**既有程式碼**（`return new YahooClassifiedError('UPSTREAM_ERROR')` 的 fallback 並非本次 diff 新增），本次改動只是往一個本來就沒有分支意義的 if 條件裡多加了一個判斷值，維護性上容易誤導後續讀者以為「兩個分支結果不同」。不影響任何線上行為（兩邊都對，只是巧合地殊途同歸），列為 LOW，建議下次觸碰此函式時一併整理（例如讓函式回傳更細緻的分類，或至少刪掉容易誤導的錯覺）。

**建議修法：** 保留判斷式作為未來擴充分類（如將 timeout 獨立分類）的落點，或加註解明講「目前兩分支等價，屬前瞻性佔位」，避免後續維護者誤判其必要性。

---

## PASS 項目（逐項核對，附證據）

### B-2（搜尋 UX 三修）

- **(a) 兩相位契約（local 有命中才發、final 恰一次）**：`services/stockDirectory.ts:189-212` `searchStocks` 內，非 CJK 分支 `if (tw.length > 0) onResults(tw, 'local')`（:203）——空 local 不發射，符合規格；`final` 在函式所有路徑（CJK 單發／非 CJK 併入 Yahoo 後）皆恰好呼叫一次，讀碼確認無遺漏路徑、無重複呼叫路徑。PASS。
- **(b) 「找不到」只在終態**：`components/StockSearch.tsx:139-151` 三態決策鏈 `!dirReady → 載入中 / searching → null / 否則 → 找不到`，`searching` 只在 `phase==='final'` 時才 `setSearching(false)`（stockDirectory.ts 呼叫端 :65），故「找不到」不可能在中間態出現。PASS，與 e2e 實測 #3（ZZZQ9X 進行中僅 spinner、無「找不到」；終態才顯示）一致。
- **(c) 名錄競態根除**：`searchStocks` 函式開頭 `const dir = await ensureTaiwanDirectory();`（stockDirectory.ts:195）——不依賴外部傳入的 `dir` snapshot；消費端 `runSearch` 的 `useCallback` deps 由 `[dir]` 清為 `[]`（StockSearch.tsx:68），stale closure 隨 dir state 一併移除。PASS。
- **(d) CJK 0 網路請求**：`if (hasCJK(q)) { onResults(searchTaiwan(dir, q, 15), 'final'); return; }`（stockDirectory.ts:197-200）——不觸碰 `searchYahoo`，讀碼確認無漏網呼叫路徑。PASS，與 e2e 實測 #2 一致。
- **(e) reqId 防過期**：`StockSearch.tsx:62` `if (myId !== reqIdRef.current) return;`——local/final 兩相位共用同一個檢查點，兩者都會被正確丟棄。PASS。
- **(f) A1 成果零退化**：`git diff 6e6e465..HEAD -- services/stockDirectory.ts` 中 `isSearchableTaiwanEntry`／`mapYahooQuote`／`TW_INDUSTRY_BLACKLIST`／`US_EXCHANGES`／15 筆上限（:198,203,211）全數無觸碰（diff 只新增 `resolveTaiwanSuffix` 與改寫 `searchStocks` 本體）。PASS。

### B-1（行情載入速度全套）

- **(a) 快取 key＝symbol|interval**：`services/yahoo.ts:909` `const key = \`${canon}|${interval}\`;`——canon 為 .TW/.TWO 解析後的正規化代碼。PASS。
- **(b) TTL：盤中 10 分／收盤後沿用到下一交易日開盤（台美各自時區＋DST）**：`services/quoteCache.ts:80-105` `isQuoteCacheFresh` 七步驟演算法，SUMMARY 附帶 35 項純函式直測（TW/US 開收盤界、DST EST/EDT、跨週末）全數 PASS；讀碼複核步驟 4（快取寫入時盤中→其後跨越收盤即視為過期）與步驟 6（30 分鐘取樣掃描曾否開盤）邏輯與斷言結果吻合。PASS。
- **(c) SWR 先舊後新**：`services/yahoo.ts:895-907` stale 分支立即 `return cloneResult(cached)`，同時呼叫 `revalidateInBackground`（不 await）；`onRevalidated` 回呼在背景抓取完成後才觸發。PASS，與 e2e 實測 #5（切回週期 0 次 chart 請求、無載入覆蓋層）一致。
- **(d) forceRefresh 更新報價**：`App.tsx:198` `getStockData(..., {forceRefresh:true})`；`services/yahoo.ts:900-916` `if (!opts?.forceRefresh)` 整段跳過快取讀取，直接走 miss 全新抓取路徑。PASS（惟見 M-1：此路徑本身缺競態守衛）。
- **(e) abort 不中毒快取**：`services/yahoo.ts:916` `if (opts?.signal?.aborted) throw new DOMException(...)` 發生在 `writeQuoteCacheResult` 呼叫之前，讀碼確認順序正確；e2e 實測 #6 證實 sessionStorage 無殘留 2317 條目。PASS（惟見 H-1：這只保證「不中毒」，不保證「真的停止背景工作」——兩者是不同的保證，本項目驗證的是前者）。
- **(f) 台股三段改並行後 chipDataUnavailable 語意守恆**：`services/yahoo.ts:622-666` `namePromise` 建立條件 `(isTaiwanStock && !usedFallback)` 與 `shouldFetchFinMindChips` 條件 `isTaiwanStock && interval==='1d'` 彼此獨立、逐行核對與舊序列版語意相同；`chipDataUnavailable` 僅由 `institutionalData===null`（:645 一帶）觸發，未被本次改動觸碰。PASS。
- **(g) .TW/.TWO 預解析與 fall-through**：`services/stockDirectory.ts:112-121` `resolveTaiwanSuffix` 純函式，`services/yahoo.ts:301-314`／`:895-899` 兩處呼叫點皆有 `try/catch` 包裹、失敗時 fall through 回既有 try-chain（"行為不劣於今日"）。PASS，與 e2e 實測 #4（6488→.TWO 直達、2317→.TW 直達）一致。
- **(h) App.tsx 競態守衛（成功/錯誤/loading/revalidate 四路徑）**：`App.tsx:113-147` 四個路徑皆有 `fetchSeqRef.current !== reqId` 或 `=== reqId` 守衛（:126-130 revalidate、:132 成功、:139 錯誤、:145 loading）。PASS（惟 M-1 指出這套守衛沒有覆蓋到 `handleRefreshQuote`）。
- **(i) 後端 8s timeout（TimeoutError 分類）＋s-maxage 僅 200 路徑**：`api/_lib/yahoo.ts:110,140,185` 三個 upstream fetch 皆掛 `AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)`；`api/yahoo/chart.ts:71` 的 `res.setHeader('Cache-Control', ...)` 在 `res.status(200).json(json)`（:72）之前、且位於所有 `throw` 之後（不會被錯誤路徑執行到）。PASS（惟見 M-2：swr 視窗文件描述不準確）。
- **(j) 殭屍棒/close-null/後綴剝除 regex 零退化**：`git diff` 對 `processYahooResult` 的 null-close 合成補值段（yahoo.ts:385-442）、`.replace(/\.TWO?$/i,'')` 六處呼叫點（:194/204/214/228/636/等）均無觸碰，僅新增外殼函式於檔案尾端（:818-921）。PASS。

### B-3（拖曳體感 CSS transform）

- **(a) mousemove 熱路徑零 setState/零重繪/零佈局量測**：`components/StockChart.tsx:786-818` `handleDragMove` 全文只讀 4 個 ref＋呼叫 `clampTranslate`（純算術）＋一行 `el.style.transform=...`（:816-817）DOM 寫入；`grep getBoundingClientRect` 全檔僅 1 處在 `handleDragStart`（:842）；`grep setRightOffset` 僅 4 處合法位置（useState 宣告、data.length effect、re-base 分支、dragEnd）。PASS。
- **(b) panMath 純函式正確（吸附/鉗位/re-base 連續性）**：`utils/panMath.ts` 四函式逐行核對：`computeWindowBounds`（:17-23）與 A2 舊四行公式邏輯等價；`clampTranslate`（:109-118）的 exhausted 判定用 `bufStart>0`/`bufEnd<dataLength` 正確區分「緩衝耗盡但還有資料」與「已到真正資料邊界」；`commitOffset`（:124-126）吸附＋鉗位公式正確。SUMMARY 附帶 89 項斷言（含網格全等、耗盡/硬鉗住、方向性）全數 PASS，本次複核抽樣核對其中 6 項手算結果一致。PASS。
- **(c) 緩衝耗盡與資料邊界行為**：`clampTranslate`（panMath.ts:112-116）+ `handleDragMove` 的 re-base 分支（StockChart.tsx:793-814）——mid-drag re-base 正確重建 session、重設拖曳錨點（`startClientXRef.current = e.clientX`，:810）、`rebasePendingRef` 於 `useLayoutEffect`（:875-878）在下一次 paint 前歸零 transform 並解除抑制，讀碼確認無中間跳幀路徑。PASS。
- **(d) 拖曳中縮放/週期切換/data 變更安全**：`handleZoom` 首行 `if (draggingRef.current) return;`（:593）；`data` 變更效果（:883-892）在 `draggingRef.current` 為真時正確拆除 session／監聽器／游標樣式，且與 `data.length` 效果（:586-590）的執行順序（宣告順序＝執行順序）不衝突，複核兩效果交互後狀態收斂一致。PASS。
- **(e) 260613-ixg 副圖凍結／260613-if7 十字線／260613-3ab memo／260711-v9f 一字板/ChipBar／A2 結構零退化**：`git diff` 對 `frozenSubDataRef`／`CandleStickShape`／`ChipBar`/`ForeignBar`/`TrustBar`／`MIN_CHIP_BAR_H`／`maResultsCache`／`mappedData`／`volumeCellsFull` 相關程式碼段零觸碰（全部命中僅為新增的 `mainBounds`/`mainDisplayData`/`mainVolumeCells` 包裝層，原函式本體不變）；`React.memo` 包裹的 `MainPriceChart`（:383）/`SubPanelChart`（:492）皆保留。PASS。
- **(f) pan 模式 YAxis hide＋遮罩的視覺一致性**：`YAxis hide={!!panDims}`（StockChart.tsx:434）搭配 60px 固定遮罩 `<div className="absolute top-0 bottom-0 right-0 bg-slate-800" style={{width: Y_AXIS_WIDTH}} />`（:974），且 `panLayerRef` 的 `left: -panSession.leftPx` 定位（:959-961）與註解（:950-955）的幾何推導自洽（bar[startIndex] 落在容器 x=0、bar[endIndex-1] 右緣＝繪圖區寬度）。此為依賴 recharts 3.8.0 `hide` 屬性不保留軸寬的行為假設，靜態讀碼無法完全確認（需 dev 環境肉眼核對無跳動/無露白），列入下方「需人工實跑驗證」。CONDITIONAL PASS。

---

## 已知殘餘風險 / 接受的行為 delta（核驗結果：屬實，理由站得住，不算 finding）

- **B-2 setOpen 提前**（StockSearch.tsx:58）：核驗屬實——查詢開始即開面板是三態面板需要的掛載點；「搜尋進行中點擊外部關閉後、結果到貨不再自動重開」為刻意行為改善，讀碼確認 `onFocus`（:110）仍可在有 results 時重開，非永久失效。理由站得住。
- **B-3 拖曳中 info bar 凍結／Y 軸暫隱**：核驗屬實（見上方 PASS (f) 與 activeData 讀 `displayData`——idle windowBounds slice，拖曳中 `rightOffset` 不變則 `displayData` 天然凍結，re-base 時因 `setRightOffset` 觸發才更新，與 SUMMARY 描述「凍結在 session 起點視窗（放開／re-base 時更新）」逐字吻合）。理由站得住。
- **B-1 T-B1-01（CDN 繞過 guard 取捨）**：理由方向站得住（公開資料、cache miss 仍全額過 guard、CDN 命中不耗 invocation），但**數字不準確**——見 M-2，實際視窗上界應為 60+300=360 秒而非 60 秒。
- **B-1 maxDuration 邊界**：核驗屬實——「attempt1 兩段近逾時成功＋主 fetch 401＋retry 全額 24s」理論上可疊加到超過 chart.ts `maxDuration=30`；SUMMARY 已誠實揭露且正確定性為「先前無界懸掛、本改動嚴格改善」而非「已完全消除風險」。理由站得住，未過度宣稱。
- **B-1 sessionStorage 容量**（1d|10y 一檔約 1.5-2.5MB、~5MB 配額）：核驗屬實，memory 層確實覆蓋同 session 的主要痛點（切週期/切回標的），sessionStorage 僅是 F5 存活的加值層，容量不足時的降級行為（best-effort silent 失敗，見 quoteCache.ts:149-162）不影響正確性。理由站得住。

---

## 跨包互動風險核驗

- **B-1 abort 傳遞 × B-3 拖曳**：兩者無共用狀態，`AbortController` 只影響 `App.tsx`/`services/yahoo.ts` 的資料抓取層；`StockChart` 對「資料變更」的反應是被動的（`useEffect([data])`），不論資料變更是來自正常 fetch、SWR revalidate 或（理論上）H-1 場景下的延遲 FinMind fallback，`StockChart` 都會正確地在 `data` 真正更新時安全中止進行中的拖曳 session。**H-1 的後果侷限在網路/API 層面的資源浪費，不會擴散成圖表層的資料錯位或崩潰**。
- **B-1 canon 解析 × B-2 搜尋選取**：`StockSearch` 選取的台股結果一律是裸代碼（`StockDirEntry.id` 無後綴），`onSelect` 直接傳入 `fetchData`／`getStockData`，兩者共用同一個 `ensureTaiwanDirectory()` 模組級快取，不會重複拉取名錄、解析結果一致。未發現踩腳。
- **B-1 interval 切換 × B-3 pan session**：interval 切換透過 `App.tsx` 的 `useEffect([interval])` 觸發新 `fetchData`，新資料抵達後 `data` 參照必然改變，觸發 `StockChart` 的資料變更效果（:883-892）安全中止任何進行中的 pan session；`data.length` 效果（:586-590）另外重置 `rightOffset`/`barsToShow`。兩條路徑經走讀確認無互相覆蓋或遺漏。未發現踩腳。

---

## 需人工實跑驗證的項目（無法靜態驗證）

1. **B-3 60fps 實測**：Chrome DevTools Performance 面板量測拖曳期間是否無 >50ms long task（SUMMARY 已附「60fps 實測計畫」步驟，尚未執行；orchestrator e2e 僅確認 transform 有隨手勢更新、mousedown/mouseup 的資訊列/游標行為正確，未量測幀率）。
2. **B-3 pan 模式 `YAxis hide` 是否真的不保留 60px 寬度**：本次覆核僅能靜態讀碼確認邏輯自洽，需在瀏覽器實際比對閒置模式與拖曳模式下 K 棒像素位置是否有跳動/露白（對應 PASS (f) 的 CONDITIONAL 標記）。
3. **H-1 的實機重現**：需在較差網路條件或人為節流（Chrome DevTools Network Throttling）下，快速切換多檔台股（日線），同時開啟 Network 面板觀察「取消 chart 請求」之後是否緊接著出現一次 `/api/finmind?...` 請求——藉此量化 H-1 的實際觸發頻率（觸發需要名錄快取未命中或尚未就緒，日常使用中名錄多半已預熱，實際命中率可能低於理論分析，但仍值得一次實測確認）。
4. **B-1 冷抓上櫃股 ≤5 秒／切回 <300ms／連點 5 檔無資料錯置**：orchestrator e2e 已提供初步證據（#4/#5/#6），但「連點 5 檔」的原始 PLAN 措辭涵蓋範圍是否包含「刷新中快速切標的」（M-1 的觸發情境）建議額外驗證一次。
5. **金鑰驗證完整跑一次**：`npm run build` 後 `grep -r "AIza" dist/`——本次覆核信賴 SUMMARY 宣稱結果（本次改動不涉及金鑰處理路徑），未重新執行完整 production build。

---

_Reviewed: 2026-07-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep（含跨檔案呼叫鏈追蹤：App.tsx↔services/yahoo.ts↔services/quoteCache.ts↔services/stockDirectory.ts、components/StockChart.tsx↔utils/panMath.ts）_

---

## 驗收後處置（orchestrator，2026-07-12，比照 Phase A M-1 先例當場修）

| Finding | 處置 | Commit |
|---|---|---|
| H-1（abort 觸發不可中止 FinMind fallback／.TWO 重試） | **已修**：`fetchStockDataUncached` 主 catch 首行 AbortError 直接上拋；`fetchRawData` 預解析分支（內外兩層 catch）與 `.TW→.TWO` 重試鏈（含 e2）四處全數加 AbortError 上拋守衛，取消不再觸發任何 fallback 網路請求 | 49d5ac8 |
| M-1（handleRefreshQuote 缺競態守衛） | **已修**：刷新納入 `fetchSeqRef` 同一序列（起跑遞增 reqId、落地前檢查），刷新在飛行中切換標的/週期時舊結果不再回頭覆蓋 | 49d5ac8 |
| M-2（T-B1-01 視窗數字低估） | **已更正**：chart.ts 註解與 B-1 SUMMARY 的 T-B1-01 皆改記 60+300＝360 秒上界；維持 accept 判定（行為未改） | 5c1866e |
| L-1（TimeoutError 分支殊途同歸易誤導） | **已註記**：classifyYahooError 加註「前瞻性佔位、現行兩分支等價」，供未來獨立分類 timeout 時落點 | 5c1866e |

修復後 `npx tsc --noEmit` 通過。H-1 修法即覆核建議原文（AbortError 識別後直接重拋），未展開重構。
