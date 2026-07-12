---
phase: quick-260712-vno
plan: 01
subsystem: market-data
tags: [cache, swr, abort-controller, yahoo, finmind, cdn, performance]
requires: [260712-qfi (A1 名錄過濾), 260712-v6l (B-2 兩段式搜尋), 260711-unf (殭屍棒過濾器)]
provides:
  - services/quoteCache.ts（台美交易時段 TTL 純函式＋memory/sessionStorage 雙層快取）
  - services/stockDirectory.ts resolveTaiwanSuffix（.TW/.TWO 後綴預解析純函式）
  - services/yahoo.ts getStockData 快取/SWR/forceRefresh/signal 整合
  - App.tsx fetchData reqId＋AbortController 防競態
  - api/_lib/yahoo.ts 握手三段 8s upstream timeout
  - api/yahoo/chart.ts 200 回應 CDN Cache-Control
affects: [行情載入速度, 週期切換, 上櫃股冷抓, 更新報價按鈕]
tech-stack:
  added: []
  patterns: [SWR (stale-while-revalidate), memory 權威層＋sessionStorage best-effort 雙層快取（比照 finmind.ts 先例）, reqId＋AbortController 防競態, AbortSignal.timeout]
key-files:
  created: [services/quoteCache.ts]
  modified: [services/stockDirectory.ts, services/yahoo.ts, App.tsx, api/_lib/yahoo.ts, api/yahoo/chart.ts]
decisions:
  - 快取內容＝getStockData 管線終點最終 {info,data}（planner_rulings #1）
  - chipDataUnavailable 結果只享 10 分鐘短 TTL（planner_rulings #3）
  - AbortSignal 只 plumb 到 queryYahoo＋寫快取前 aborted 守衛（planner_rulings #4）
  - CDN s-maxage=60 繞過 applyGuards 的取捨接受（planner_rulings #7 / T-B1-01）
metrics:
  duration: ~15 min
  completed: 2026-07-12
  tasks: 3
  files: 6
---

# Quick 260712-vno: B-1 行情載入全套 Summary

前端行情雙層快取＋SWR、台股三段串行改並行、.TW/.TWO 名錄預解析、fetchData AbortController＋reqId 防競態、後端握手 8s timeout＋chart CDN Cache-Control——五項全落地，「1d 先抓 2y 快繪」明確未做（計畫內不做項）。

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 | 快取基座 quoteCache.ts＋resolveTaiwanSuffix＋直測 | 2abed37 |
| 2 | yahoo.ts 快取/SWR/並行化/預解析＋App.tsx 防競態 | 691dfef |
| 3 | 後端 upstream timeout＋chart CDN Cache-Control | 72e6204 |

## 純函式直測輸出全文（scratchpad verify-b1-pure.ts，npx tsx，不入 repo）

```
== 基準日 sanity ==
  PASS  2026-07-08 為週三
  PASS  2026-07-10 為週五
  PASS  2026-01-07 為週三
== marketForSymbol ==
  PASS  '2330' -> TW
  PASS  '2330.TW' -> TW
  PASS  '6488.TWO' -> TW
  PASS  '00679B' -> TW
  PASS  'AAPL' -> US
  PASS  'USDTWD=X' -> US
== resolveTaiwanSuffix ==
  PASS  twse '2330' -> '.TW'
  PASS  tpex '6488' -> '.TWO'
  PASS  emerging '1264' -> null
  PASS  查無代碼 -> null
== isQuoteCacheFresh TW ==
  PASS  TW 盤中 10:00 快取、10:05 讀 -> fresh
  PASS  TW 盤中 10:00 快取、10:20 讀 -> stale
  PASS  TW 收盤後 14:00 快取、同日 20:00 讀 -> fresh
  PASS  TW 週五 14:00 快取、週六 15:30 讀 -> fresh
  PASS  TW 週五 14:00 快取、週日 10:00 讀 -> fresh
  PASS  TW 週五 14:00 快取、週一 08:59 讀 -> fresh
  PASS  TW 週五 14:00 快取、週一 09:05 讀 -> stale
  PASS  TW 盤中 10:00 快取、同日 15:00 讀 -> stale
  PASS  TW shortTtlOnly 14:00 快取、16:00 讀 -> stale
  PASS  TW shortTtlOnly 14:00 快取、14:05 讀（10 分內）-> fresh
== isQuoteCacheFresh US ==
  PASS  US 盤中 ET10:00 快取、5 分後讀 -> fresh
  PASS  US 盤中 ET10:00 快取、20 分後讀 -> stale
  PASS  US 收盤後 ET17:00 快取、隔日 ET09:00 讀 -> fresh
  PASS  US 收盤後 ET17:00 快取、隔日 ET09:35 讀 -> stale
  PASS  US 1 月 EST 週三 ET10:00 isMarketOpen === true（Intl 正確處理 DST）
  PASS  US 7 月 EDT 週三 ET10:00 isMarketOpen === true
  PASS  TW 09:00 開盤界 -> open
  PASS  TW 13:30 收盤界 -> closed（[open,close)）
  PASS  TW 週六 10:00 -> closed
== read/write cache（Node 無 sessionStorage 退化）==
  PASS  writeQuoteCache 後 readQuoteCache 命中同一 entry（memory 層）
  PASS  writeMemoryAlias 別名指向同一 entry
  PASS  miss -> null（sessionStorage 取用失敗 silent）

== 結果：35 passed, 0 failed ==
```

Node 下 import 成功本身即證明模組頂層無裸 sessionStorage 取用（grep 確認全部 sessionStorage 取用都在 readQuoteCache/writeQuoteCache 函式體內）。

## planner_rulings 實作落點

| # | 裁決 | 落點 |
|---|------|------|
| 1 | 快取內容＝管線終點最終 {info,data} | yahoo.ts `writeQuoteCacheResult`——快取包在 `fetchStockDataUncached` 整條管線外層，殭屍棒過濾/close-null 補值/量能覆寫結構上不可能被跳過或重複執行；碼註解記錄於「行情快取外殼」區塊 |
| 2 | sessionStorage best-effort、memory 權威 | quoteCache.ts `readQuoteCache`/`writeQuoteCache`——一切 sessionStorage 失敗 silent 退化（QuotaExceeded 清自家前綴重試一次再放棄），絕不 throw |
| 3 | chipDataUnavailable 只享 10 分短 TTL | `writeQuoteCacheResult` 寫入 `shortTtlOnly: result.info.chipDataUnavailable === true`；`isQuoteCacheFresh` 第 2 步在 10 分規則後、沿用判定前攔截 |
| 4 | signal 只 plumb 到 queryYahoo＋寫快取前守衛 | queryYahoo/fetchRawData optional signal 透傳；getStockData 在 `writeQuoteCacheResult` 前 `if (opts?.signal?.aborted) throw new DOMException('Aborted','AbortError')`；背景刷新不傳呼叫端 signal（`revalidateInBackground` 註解） |
| 5 | handleRefreshQuote forceRefresh | App.tsx `getStockData(..., { forceRefresh: true })`（grep 恰 1 處）；handleRunAnalysis 週線抓取零改動（optional opts 相容） |
| 6 | 預解析失敗防禦 | fetchRawData 1.5 段：直達 query 失敗 fall through 回既有 .TW→.TWO try-chain；名錄查無/emerging → null → 走原行為 |
| 7 | CDN 快取安全註記 | chart.ts 200 路徑前碼註解明示取捨（公開資料/60 秒窗/miss 全額過 guard/CDN 命中不耗 invocation）；錯誤路徑不設 header |

## Regression guard 自查結果（git diff 逐項）

- **殭屍棒過濾器 4.5（260711-unf）**：diff 中 `isZombie/prevKept/殭屍` 相關變更行為零（唯一出現處是新快取外殼的說明註解）。
- **_synthetic 合成＋FinMind OHLC 取代鏈（260602-0u1/13g）**：processYahooResult 合成區塊與步驟 4 取代區塊零 diff（唯一 `_synthetic` 變更行是註解）。
- **`.replace(/\.TWO?$/i,'')` 後綴剝除（260710-w7y）**：6 處呼叫點（yahoo.ts :194/:204/:214/:228/:505/:636）全數原樣。
- **A1 搜尋限縮（260712-qfi）**：stockDirectory.ts diff 僅 +16 行（resolveTaiwanSuffix 純新增）；isSearchableTaiwanEntry/mapYahooQuote/TW_INDUSTRY_BLACKLIST 零觸碰（diff 中唯一提及是新函式的註解）。
- **B-2 兩段式搜尋（260712-v6l）**：searchStocks/searchTaiwan 零 diff。
- **並行化語意守恆三點（走讀）**：(1) `chipDataUnavailable=true` 仍只由 `shouldFetchFinMindChips && institutionalData===null` 觸發，非籌碼路徑走 else 分支只 await namePromise；(2) 中文名條件仍 `isTaiwanStock && !usedFallback`（所有 interval），與籌碼條件（僅 1d）獨立；(3) chipMap/volumeMap/ohlcMap 填充邏輯逐行原樣。usedFallback 路徑不動。

## 驗證斷言（bash/grep）

- Task 2：resolveTaiwanSuffix（:305）先於 try-.TW（:318）✓；readQuoteCache（:889）先於 fetchStockDataUncached 呼叫（:912）✓；`signal?.aborted` 守衛 1 處 ✓；App.tsx `fetchSeqRef.current !== reqId` 3 處（成功/catch/onRevalidated）＋finally `=== reqId` ✓。
- Task 3：AbortSignal.timeout 程式碼 3 處（:110 fetchCookie／:140 fetchCrumb／:185 主 fetch；grep -c 回 4 因 classifyYahooError 的說明註解也含該字串——程式碼覆蓋恰為三個 upstream fetch）；TimeoutError 顯式列名 ✓；s-maxage=60 僅在 status(200) 前（:71→:72），錯誤路徑（:79）無 ✓。
- `npx tsc --noEmit`：每 task 後各跑一次＋最終一次，全綠。

## Deviations from Plan

None — plan executed exactly as written. 兩點微幅補充（非偏離）：
1. `revalidateInBackground` 對 `onRevalidated` 回傳淺拷貝（與 fresh/stale 路徑一致的防禦，計畫未明文但同語意）。
2. Task 3 斷言 `grep -c "AbortSignal.timeout" = 3` 實得 4（多的 1 是註解行），程式碼佈點恰 3 處，已以行號證明。

## 已知殘餘風險（記錄，不擋）

- **T-B1-01（accept；數字經覆核 M-2 更正）**：`s-maxage=60, stale-while-revalidate=300` 使同 URL 可由 Vercel CDN 直接回應、不過 applyGuards（PROXY_SHARED_SECRET/限流）的視窗上界為 **60+300＝360 秒**（swr 命中時 CDN 先回過期資料再背景 revalidate），非原記載的 60 秒。接受理由不變：公開行情資料、cache miss 仍全額過 guard 與限流、CDN 命中不消耗 function invocation，360 秒上界仍可接受。
- **maxDuration 邊界**：極端情境「attempt1 兩段近逾時成功＋主 fetch 401＋retry 全額 24s」理論可超 chart.ts maxDuration=30 被 Vercel 砍——先前是無界懸掛，本改動嚴格改善。
- **sessionStorage 容量**：1d|10y 一檔約 1.5-2.5MB，~5MB 配額只放得下 1-2 檔大 entry——主要痛點（同 session 切週期/切回標的）由 memory 層全覆蓋，可接受。
- **背景刷新 onRevalidated 去重侷限**：同 key 刷新進行中時第二個 stale 呼叫端不會另掛 callback（App 單一 fetchData 消費端，實務無影響）。

## Known Stubs

None — 無硬編空值/佔位文字/未接線元件。

## 瀏覽器 e2e（非本包阻斷項）

6488 冷抓 ≤5s、切回 <300ms、連點 5 檔實測屬 Phase B 收尾（Sonnet 覆核＋preview 實跑）範圍。

## Self-Check: PASSED

- services/quoteCache.ts 存在 ✓；resolveTaiwanSuffix 於 stockDirectory.ts ✓
- Commits 2abed37 / 691dfef / 72e6204 皆在 worktree-agent-ae93e30034fed55bc 分支上 ✓
- 最終 `npx tsc --noEmit` 通過 ✓；無未追蹤檔案、無意外刪除 ✓
