---
quick_id: 260710-w7y
slug: tw-two-bug
status: complete
commit: c8997fd
completed: 2026-07-10
---

# Quick Task 260710-w7y Summary

**修正前端 7 處 `.TW/.TWO` 後綴剝除 bug，讓上櫃股（.TWO）的 FinMind 資料恢復正常**

## Problem

`stockId.replace('.TW', '').replace('.TWO', '')` 對 `6488.TWO` 會先匹配 `.TWO`
內的 `.TW`，留下孤兒 `O` → `6488O`，導致上櫃股所有 FinMind 查詢（中文股名、
外資/投信籌碼、價量、K線 fallback）查無而失效。上市股 `2330.TW → 2330` 正常，
故只有上櫃壞。真環境部署驗收（2026-07-10）發現。

## Fix

7 處 `.replace('.TW', '').replace('.TWO', '')` → `.replace(/\.TWO?$/i, '')`
（錨定字尾 `$`、`O` 選填、大小寫不敏感，`.TW` 與 `.TWO` 皆正確剝除）。
- services/yahoo.ts：6 處（fetchInstitutionalData / fetchFinMindPriceVolume /
  fetchFinMindStockInfo / fetchFinMindDailyData / fetchRawData 的 cleanSymbol /
  getStockData 的 cleanId）
- services/stockDirectory.ts：1 處（合併 Yahoo 結果去重的 bare id）

後端 `api/_lib/finmind.ts:57` 已用正確 `/\.TWO$/i`，不受影響、未改。

## Verification

- 舊 pattern 全專案 0 殘留；新 regex 7 處就位（fixed-string grep 確認）
- 邏輯：`6488.TWO→6488`、`2330.TW→2330`、`00981A.TWO→00981A`、`AAPL→AAPL`
- `npx tsc --noEmit`：0 error
- 真環境：待部署後搜尋 6488 確認「環球晶」中文名與籌碼顯示（部署後驗收）

## Commit

- `c8997fd` fix(260710-w7y): correct .TW/.TWO suffix stripping for OTC stocks
  （2 files, 7 insertions, 7 deletions）

## Deviations

None — 純機械式替換，範圍與計畫一致；`.TWO` 用於 K 線 fallback query（如
`performQuery(${coreCode}.TWO)`）等非剝除用途未觸碰。
