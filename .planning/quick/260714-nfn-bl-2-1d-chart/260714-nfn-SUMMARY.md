---
quick_id: 260714-nfn
description: "BL-2 台股1d籌碼三件套與chart並行起跑"
status: complete
completed_at: "2026-07-14"
files_modified:
  - services/finmind.ts
  - services/yahoo.ts
commits:
  - 2619d87  # feat(bl-2): AbortSignal 透傳
  - c098491  # perf(bl-2): 投機起跑＋步驟3消費
---

# Quick Task 260714-nfn Summary：BL-2 台股 1d 籌碼三件套與 chart 並行起跑

**一句話**：台股 1d 冷抓時，籌碼三件套（中文名／法人／量能）在 `fetchStockDataUncached` 一進場就投機起跑，與 chart 網路往返並行，不再被 chart 完成＋前端處理間隙串行扣住；已起跑的投機請求由既有 signal 透傳可一併 abort。

## 做了什麼

### Task 1（commit 2619d87）：AbortSignal 透傳
- `services/finmind.ts`：`fetchFinMindRows` 簽名加第三選配參數 `signal?: AbortSignal`，透傳給 `fetch(url, { headers, signal })`。參數選配、預設 undefined。
- `services/yahoo.ts`：三支籌碼函式 `fetchInstitutionalData`／`fetchFinMindPriceVolume`／`fetchFinMindStockInfo` 各加尾參 `signal?: AbortSignal`，透傳給 `fetchFinMindRows(..., signal)`。內部 catch 行為不變（AbortError 一樣被吞成 null/[]，console.warn 照舊）。
- `fetchFinMindDailyData`（fallback OHLC）未加 signal——H-1 語意保留。
- 既有呼叫端（`getTwFundamentals` 兩處呼叫皆二參）零改動即編譯。

### Task 2（commit c098491）：投機起跑＋步驟 3 消費
- `fetchStockDataUncached` 進場（mainRange 計算後、`try{fetchRawData}` 前）加投機起跑塊：`interval === '1d' && /\.TWO?$/i.test(symbol)` 時，用 5 年起始日與 stripped cleanId 同刻發起 `chipSpec = { name, inst, pv }` 三個 promise；條件不符 → `chipSpec = null`。
- 步驟 3：`namePromise` 改為 `chipSpec ? chipSpec.name : (isTaiwanStock && !usedFallback ? fetchFinMindStockInfo(symbolInfo.symbol, signal) : Promise.resolve(null))`。
- `shouldFetchFinMindChips` 分支重構為二路：有 `chipSpec` → `await Promise.all([chipSpec.name, chipSpec.inst, chipSpec.pv])` 收割投機結果；無 → 照舊當場起跑（三支呼叫補傳 `signal`）。後續 chipMap/volumeMap/ohlcMap/chipDataUnavailable 組裝邏輯一行不動。
- fallback 路徑（usedFallback=true）沿用同一份 chipSpec，不重抓（cleanId 相同、必為台股 1d）。fallback 塊內 inline 名字 await 保持原樣。

## 驗證
- `npx tsc --noEmit` 兩個 commit 各自綠燈（EXIT=0）。
- 並行結構確認：投機塊在 `await fetchRawData` 之前發起三個 promise。
- 不變式確認（git diff grep）：`chipDataUnavailable` 判準行、:926 `signal?.aborted` abort 守衛均未出現在 diff → 未觸碰。
- 提交無檔案刪除（`git diff --diff-filter=D` 空）。

## must_haves 對照
- 台股 1d 冷抓三支 FinMind 與 chart 同時起跑 ✓（投機塊於 fetchRawData 前發起）
- 冷抓中切換標的時投機請求一併 abort ✓（signal 透傳三支函式→fetchFinMindRows→fetch）
- 美股／台股週月線／裸代碼路徑零改變 ✓（chipSpec===null 走 else 原路徑）
- chipDataUnavailable 語意不變 ✓（該行未動，仍僅 institutionalData===null 才 true）
- 既有 fetchFinMindRows 呼叫端零改動即編譯 ✓（tsc 綠）

## Deviations from Plan
無——計畫錨點與現行程式碼一致，依規格等價落地。實作裁量：`ChipSpec` 用具名內聯 type（PLAN 允許裁量）；步驟 3 二路以 `let` 宣告後解構賦值（PLAN 示意的原地三元展開的等價寫法，避免重複組裝邏輯）。

## 明確不做（依 PLAN）
- 未動 `getStockData` 外殼、快取層、SWR、`fetchFinMindDailyData`、fallback 塊 inline 名字抓取、range 常數、:926 abort 守衛。
- 行為驗收（Network waterfall 並行、abort canceled、sessionStorage 無殘留）留待統測階段（preview 3001）與 BL-4b。

## Self-Check: PASSED
- services/finmind.ts、services/yahoo.ts 存在且已修改（tsc 綠）
- commit 2619d87、c098491 均存在於 worktree-agent-a1bf1f5dbea10c86b 分支
