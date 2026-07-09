---
created: 2026-07-09T11:28:31.568Z
title: Fix invalid FinMind OTC dataset names
area: api
files:
  - api/_lib/finmind.ts
  - services/yahoo.ts
---

## Problem

`TaiwanOTCStockInstitutionalInvestorsBuySell` 與 `TaiwanOTCStockInfo` **不是真實存在的 FinMind
dataset**。直接對 FinMind 上游打這兩個字串會被拒絕（422，enum 驗證錯誤，回傳訊息列出全部 93 個
合法 dataset，兩者皆不在其中）。已於 2026-07-09 Phase 3 人工驗證（Task 4）用真實上櫃股 6488
（GlobalWafers/環球晶）實測確認：FinMind 完整合法清單裡沒有任何 `*OTC*InstitutionalInvestors*`
或 `*OTCStockInfo*` 條目。

**這不是 Phase 3 的回歸**——對照 `main`（Phase 3 之前）的 `services/yahoo.ts:184-227`，這兩個
字串本來就在原始程式碼裡（`fetchInstitutionalData` 的 `isOTC` 分支、`fetchFinMindStockInfo` 的
`for (const dataset of ['TaiwanStockInfo', 'TaiwanOTCStockInfo'])` 迴圈），Phase 3 只是照計畫
「以現碼為準抄錄」把它們原樣搬進後端白名單（`api/_lib/finmind.ts` 的 `ALLOWED_DATASETS`）。
也就是說：**上櫃股的法人買賣超（外資/投信）資料與 FinMind 中文股名查詢，從專案存在以來就一直
靜默失敗**——舊行為是回傳 `[]`/`null`，圖表把它當成「無買賣超」顯示假的 0（Phase 1-2 時代的
既有問題）。Phase 3 的籌碼誠實化功能（PROXY-05）意外地正確揭露了這個舊 bug：上櫃股現在會誠實
顯示「籌碼暫時不可用」徽章，而不是繼續假裝是 0——這是 Phase 3 帶來的正確結果，但根因（dataset
名稱錯誤）本身沒有被修。

**實測驗證**（curl 直打 FinMind 上游，2026-07-09）：
- 用統一（無 OTC 前綴）的 `TaiwanStockInfo`／`TaiwanStockInstitutionalInvestorsBuySell` dataset
  查詢上櫃股 6488，**完全正常**：`TaiwanStockInfo` 回傳 `"type":"tpex"`（上櫃）；
  `TaiwanStockInstitutionalInvestorsBuySell` 正常回傳外資/投信買賣超數字。
  → FinMind 用**同一個 dataset** 涵蓋上市（`type":"twse"`）與上櫃（`"type":"tpex"`），
  不需要（也沒有）分開的 OTC 版本 dataset。

## Solution

1. `services/yahoo.ts`：`fetchInstitutionalData` 移除 `isOTC` 分支邏輯，統一呼叫
   `TaiwanStockInstitutionalInvestorsBuySell`（不分上市櫃，同一 dataset 對兩者都有效）。
   `fetchFinMindStockInfo` 的迴圈 `for (const dataset of ['TaiwanStockInfo', 'TaiwanOTCStockInfo'])`
   簡化為只查 `TaiwanStockInfo` 一次（同上，該 dataset 本身已含上櫃股，用 `type` 欄位可分辨
   但目前程式碼似乎不需要分辨，只取中文股名）。
2. `api/_lib/finmind.ts`：`ALLOWED_DATASETS` 白名單移除
   `TaiwanOTCStockInstitutionalInvestorsBuySell`、`TaiwanOTCStockInfo` 這兩個不存在的條目
   （移除後呼叫端也不再需要它們，見上）。
3. 移除後 `isOTC` 參數/變數若無其他用途一併清理（檢查是否還有 `.TWO` 後綴判斷用在別處，
   例如 K 線 fallback 邏輯，那部分不受影響、不要順手改）。
4. 驗證：對 6488（上櫃）與 2330（上市）分別搜尋，兩者外資/投信買賣超都應顯示真實資料，
   不再出現「籌碼暫時不可用」。

**範圍提醒**：這是 API 層級的小修正（純粹改對 dataset 名稱），不涉及 Phase 3 的白名單/快取/
誠實化架構——那些設計都是對的，這裡只是修一個更早就存在、剛好被誠實化功能照出來的資料源錯誤。
