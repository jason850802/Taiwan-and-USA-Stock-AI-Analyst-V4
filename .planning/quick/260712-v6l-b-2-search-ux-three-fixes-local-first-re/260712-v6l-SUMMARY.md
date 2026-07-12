---
phase: 260712-v6l-b-2-search-ux-three-fixes-local-first-re
plan: 01
subsystem: search
tags: [search-ux, two-phase-emission, race-condition, stock-directory]
requires: [260712-qfi]
provides:
  - "searchStocks 兩段式 callback API（local/final 相位）"
  - "StockSearch 三態下拉面板（載入名錄中／查詢中無面板／終態找不到）"
affects: [services/stockDirectory.ts, components/StockSearch.tsx]
tech-stack:
  added: []
  patterns: ["callback 兩相位發射（local 先上屏、final 收斂）", "資料層內部自行 ensure 依賴（根除外部 snapshot 競態）"]
key-files:
  created: []
  modified:
    - services/stockDirectory.ts
    - components/StockSearch.tsx
key-decisions:
  - "API 形狀採 callback 兩相位發射（planner 裁決照做）：searchStocks(query, onResults(results, phase))——消費端既有 debounce＋reqId 模式 1:1 映射，不引入 AsyncGenerator 或雙 promise"
  - "空 local 不發射：本地 0 命中時不發 local 相位，避免前一清單瞬間塌掉再展開，由 final 一次定案"
  - "setOpen 提前到查詢開始（行為改善）：搜尋進行中點擊外部關閉後、結果到貨不再自動重開"
metrics:
  duration: "~12 min"
  completed: "2026-07-12"
  tasks: 2
  files: 2
---

# Quick 260712-v6l: B-2 搜尋 UX 三修 Summary

兩段式 searchStocks（本地命中不等 Yahoo 冷握手）＋內部自載名錄根除競態＋三態面板終結「找不到符合」誤閃。

## 發射契約（實作定案）

`searchStocks(query, onResults: (results, phase: 'local' | 'final') => void): Promise<void>`

- 函式開頭 `await ensureTaiwanDirectory()`（memCache＋loadingPromise 去重，第二次起零成本；失敗 resolve []）——名錄載入前輸入也拿得到本地結果（B-2 修法3）。
- query trim 空 → 不發射直接 return（防禦）。
- CJK → 單發 `final`，不碰 searchYahoo（0 網路請求，A1 驗收維持）。
- 非 CJK → 本地命中 >0 才發 `local`（不等 Yahoo）；`await searchYahoo`（永不 throw）後 bare-suffix 去重 merge，`final` 無條件恰發一次（Yahoo 空/失敗即本地原樣）。
- 消費端（StockSearch.runSearch）：local/final 兩相位皆過 `myId !== reqIdRef.current` 防過期；`phase === 'final'` 才 `setSearching(false)`；useCallback deps 由 `[dir]` 清為 `[]`（stale closure 隨 dir state 一併移除）。

## 三態面板（B-2 修法2）

`open && value.trim() && results.length === 0` 時：
1. `!dirReady` → 「載入名錄中…」（帶 Loader2 spinner）
2. `dirReady && searching` → 不渲染任何面板
3. `dirReady && !searching` → 「找不到符合「{value}」的股票」（唯一終態）

誤閃三情境走讀全數封死：(a) 名錄未就緒輸入→載入名錄中；(b) 續打字時 setSearching(true) 同步先行→查詢中無面板；(c) 非 CJK 本地 0 命中 Yahoo 未回→無 local 發射、searching 續 true→final 到貨才定案。

## 斷言驗證結果

一次性 tsx 斷言腳本（scratchpad，驗完已刪、未 commit）14 項全過：
1. 冷啟動（不先 ensureTaiwanDirectory）searchStocks('2330') local 相位含 2330，且發射時 yahoo stub 尚未 resolve（本地不等 Yahoo）
2. final 恰一次、AAPL 併入、總數 ≤15
3. CJK（'台積'）恰一次 final、yahoo fetch 計數 0
4. yahoo reject 時 final 仍發射且結果＝本地命中原樣 [2330]
5. yahoo 回 2330.TW 時 bare-suffix 去重、final 無重複

`npx tsc --noEmit` 通過（Task 1 後、Task 2 後、收尾各一次）。

## 行為改善註記（setOpen 提前）

`setOpen(true)` 由「結果到貨後」提前到「查詢開始」（runSearch 同步段）——三態面板的中間態需要掛載點。副作用：搜尋進行中點擊外部關閉下拉後，結果到貨不再自動重開，屬刻意的行為改善。

## A1（260712-qfi）零退化證明

`git diff f099231..HEAD -- services/stockDirectory.ts` 中 `mapYahooQuote`／`isSearchableTaiwanEntry`／`searchTaiwan`／`searchYahoo`／`US_EXCHANGES`／三組黑白名單常數全數無觸碰行；merge 15 筆上限、Market 'TW'|'US'、bare-suffix 去重原樣保留。

## Deviations from Plan

None - plan executed exactly as written.

（環境註記，非 deviation：worktree 所在磁碟非 NTFS 無法建 node_modules junction；Node 模組解析向上層目錄尋找，主 repo 的 node_modules 自然被找到，tsc／tsx 直接可用。）

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 811db54 | feat(260712-v6l): searchStocks 兩段式發射＋內部名錄載入，消費端接線 |
| 2 | 98636cb | feat(260712-v6l): 下拉面板三態化——終結「找不到符合」誤閃 |

## Known Stubs

None.

## Self-Check: PASSED

- services/stockDirectory.ts: FOUND（含 onResults）
- components/StockSearch.tsx: FOUND（含「載入名錄中」恰 1 處、dirReady）
- commit 811db54: FOUND
- commit 98636cb: FOUND
- tsc --noEmit: PASS
