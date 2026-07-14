---
quick_id: 260714-nfn
description: "BL-2 台股1d籌碼三件套與chart並行起跑"
source_spec: .planning/optimization/BL-PLAN.md §BL-2
status: ready
files_modified:
  - services/finmind.ts
  - services/yahoo.ts
must_haves:
  truths:
    - "台股 1d 冷抓時，三支 /api/finmind 與 /api/yahoo/chart 同時起跑（不再等 chart 完成）"
    - "使用者冷抓中切換標的時，已起跑的 FinMind 投機請求一併被 abort"
    - "美股／台股週月線／名錄未命中（裸代碼）路徑行為零改變"
    - "chipDataUnavailable 語意不變：法人資料為 null 才設 true"
    - "既有 fetchFinMindRows 呼叫端（getTwFundamentals 等）零改動即可編譯"
  artifacts:
    - "services/finmind.ts: fetchFinMindRows 帶選配 signal"
    - "services/yahoo.ts: 投機起跑 + 步驟3 消費投機 promise"
  key_links:
    - "services/yahoo.ts:926 abort 寫快取守衛（不動它，靠它保證降級結果不落快取）"
---

# Quick Task 260714-nfn：BL-2 台股 1d 籌碼三件套與 chart 並行起跑

**規格來源**：`.planning/optimization/BL-PLAN.md` §BL-2（2026-07-13 定案）。本 PLAN 已依 2026-07-14 現行程式碼重新核實所有行號錨點。

**目標**：台股 1d 冷抓路徑上，籌碼三件套（中文名 `fetchFinMindStockInfo`＋法人 `fetchInstitutionalData`＋量能 `fetchFinMindPriceVolume`）在 `fetchStockDataUncached` 一進場就投機起跑，不再被 chart 網路往返（~0.4-1.0s prod／~4s dev）＋前端處理間隙（~0.2-0.6s）串行扣住。

**現況錨點（已核實）**：
- `services/finmind.ts:26-46`：`fetchFinMindRows(dataset, params)` — 無 signal，`fetch('/api/finmind?...', { headers })`。
- `services/yahoo.ts:193-224`：三支籌碼函式，內部 try/catch 吞錯回 null/[]，永不 reject。
- `services/yahoo.ts:475`：`fetchStockDataUncached(symbol, interval, signal?)` 進場時 symbol 已由外殼（:889-895 名錄預解析）帶好 `.TW`/`.TWO` 後綴（裸代碼＝名錄未命中）。
- `services/yahoo.ts:635-652`：步驟 3——`namePromise` 與 `shouldFetchFinMindChips` 下的 `Promise.all([namePromise, fetchInstitutionalData, fetchFinMindPriceVolume])`，全部在 chart 完成後才起跑。
- `services/yahoo.ts:510-537`：FinMind fallback（`usedFallback=true`），fallback 塊內另行 await `fetchFinMindStockInfo(cleanSymbol)`（:522）。
- `services/yahoo.ts:926`：外殼寫快取前 abort 守衛（**不動**，投機被 abort 吞成降級結果時靠它擋住不落快取——planner_rulings #4 不變）。

---

## Task 1：AbortSignal 透傳（signal plumbing）

**Files**: `services/finmind.ts`, `services/yahoo.ts`

**Action**:
1. `services/finmind.ts` — `fetchFinMindRows` 簽名加第三選配參數 `signal?: AbortSignal`，透傳給 `fetch(url, { headers: {...proxyHeaders}, signal })`。參數選配、預設 undefined，既有呼叫端（本檔 `getTwFundamentals` 一帶與 `services/yahoo.ts`）零改動。
2. `services/yahoo.ts` — 三支籌碼函式（`fetchInstitutionalData` :193、`fetchFinMindPriceVolume` :203、`fetchFinMindStockInfo` :213）各加尾參 `signal?: AbortSignal`，透傳給 `fetchFinMindRows(..., signal)`。**內部 catch 行為不變**：AbortError 一樣被吞成 null/[]（console.warn 照舊），由外殼守衛把關。
3. `fetchFinMindDailyData`（:227，fallback OHLC）**不加** signal——H-1 語意保留（AbortError 在 Yahoo 階段就上拋，走不到 fallback）。

**Verify**: `npx tsc --noEmit` 通過；grep 確認 `getTwFundamentals` 等呼叫端無需改動。

**Done**: 三支籌碼函式與 fetchFinMindRows 可收 signal；無呼叫端 breaking change。

**Commit**: `feat(bl-2): fetchFinMindRows 與籌碼三件套加選配 AbortSignal 透傳`

## Task 2：台股 1d 投機起跑＋步驟 3 消費

**Files**: `services/yahoo.ts`

**Action**:
1. `fetchStockDataUncached` 開頭（`try { fetchRawData }` 之前、mainRange 計算之後）加投機起跑塊：
   ```ts
   // BL-2 投機起跑：台股 1d 且 symbol 已帶後綴（名錄已解析）時，籌碼三件套與 chart 同時起跑。
   // 條件不符（美股／週月線／裸代碼）→ null，步驟 3 照舊當場起跑。
   type ChipSpec = {
     name: Promise<string | null>;
     inst: Promise<any[] | null>;
     pv: Promise<any[]>;
   } | null;
   let chipSpec: ChipSpec = null;
   if (interval === '1d' && /\.TWO?$/i.test(symbol)) {
       const specStart = new Date();
       specStart.setFullYear(specStart.getFullYear() - 5);
       const specStartStr = specStart.toISOString().split('T')[0];
       const specCleanId = symbol.replace(/\.TWO?$/i, '');
       chipSpec = {
           name: fetchFinMindStockInfo(specCleanId, signal),
           inst: fetchInstitutionalData(specCleanId, specStartStr, signal),
           pv: fetchFinMindPriceVolume(specCleanId, specStartStr, signal),
       };
   }
   ```
   （型別可用內聯或具名 type，實作裁量；三支函式現簽名為 (stockId, startDate?)，投機呼叫傳 cleanId 亦可——函式內部 replace 對 cleanId 是 no-op。）
2. 步驟 3 改為消費投機結果：
   - `namePromise`（:635）改：`chipSpec ? chipSpec.name : (isTaiwanStock && !usedFallback ? fetchFinMindStockInfo(symbolInfo.symbol, signal) : Promise.resolve(null))`。
   - `shouldFetchFinMindChips` 分支（:640-652）：有 `chipSpec` → `const [fetchedName, institutionalData, finMindPriceData] = await Promise.all([chipSpec.name, chipSpec.inst, chipSpec.pv])`；無 → 照舊當場起跑（現有程式碼原樣，但三支呼叫補傳 `signal`）。
   - **fallback 路徑（usedFallback=true）投機結果仍有效**：cleanId 相同、該路徑必為台股 1d，直接沿用 chipSpec，不重抓。（fallback 塊 :522 的中文名 inline await 保持原樣——同值冪等，投機 name 結果會在步驟 3 被 await，重複的一次名字請求僅發生在罕見降級路徑且 CDN 快取到午夜，可接受。）
   - 後續 chipMap/volumeMap/ohlcMap/chipDataUnavailable 組裝邏輯**一行不動**。
3. 非 1d／非台股／裸代碼：`chipSpec === null`，步驟 3 走現有路徑，零行為差。

**Verify**:
- `npx tsc --noEmit` 通過。
- 讀 diff 確認：(a) chipMap 組裝邏輯未動；(b) chipDataUnavailable 僅在 institutionalData===null 時 true；(c) 926 abort 守衛未動。

**Done**: 台股 1d 路徑 chart 與三件套同刻起跑；其餘路徑零改動。

**Commit**: `perf(bl-2): 台股 1d 籌碼三件套與 chart 並行起跑（投機起跑＋步驟3消費）`

---

## 驗收（本包內能做的）

- `npx tsc --noEmit` 全綠（兩個 commit 各自過）。
- 程式碼層面確認並行結構：投機塊在 `await fetchRawData` 之前發起三個 promise。
- 行為驗收（Network waterfall 並行、abort canceled、sessionStorage 無殘留）留待統測階段（preview 3001）與 BL-4b。

## 明確不做

- 不動 `getStockData` 外殼、快取層、SWR（BL-1 的事）。
- 不動 `fetchFinMindDailyData`、FinMind fallback 塊內 inline 名字抓取。
- 不改 range 常數（BL-3 的事）。
