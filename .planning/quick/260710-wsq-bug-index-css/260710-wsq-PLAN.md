---
quick_id: 260710-wsq
slug: bug-index-css
description: 修正台股名錄快取中毒 bug＋移除 index.css 死引用
created: 2026-07-10
---

# Quick Task 260710-wsq: 目錄快取中毒修正 ＋ index.css 死引用清除

## Problem

**(1) 快取中毒（功能性 bug）**：`services/stockDirectory.ts` 的 `ensureTaiwanDirectory`
在抓取失敗時（`msg !== 'success'`、後端 403/502、或空資料）仍執行
`localStorage.setItem(LS_KEY, JSON.stringify([]))` 並蓋上新鮮時間戳——把「空目錄」
當成功結果快取 7 天。使用者只要在 FinMind/後端暫時故障的時間窗開過 App，
之後 7 天搜尋都沒有台股中文名錄（只剩 Yahoo 英文結果），修好後也不會自動痊癒。
2026-07-10 真環境部署驗收實際踩中（ALLOWED_ORIGIN 未回填＋token 壞的兩個時間窗），
需手動清 localStorage 才恢復。

**(2) index.css 死引用（console 噪音）**：`index.html:66` 的
`<link rel="stylesheet" href="/index.css">` 指向不存在的檔案，每次載入 404。
全站樣式來自 Tailwind CDN（index.html:7），無任何東西依賴此行。

## Fix

### Task 1: stockDirectory.ts 快取防毒（雙端）
- files: services/stockDirectory.ts
- action:
  1. 寫入端：只在 `list.length > 0` 才寫 localStorage（失敗/空絕不快取）
  2. 讀取端：`JSON.parse(cached)` 結果為空陣列時視同 cache miss，不回傳、
     繼續走重抓路徑（讓已中毒的使用者自動痊癒，無須手動清）
- verify: `npx tsc --noEmit` 通過；node 模擬空陣列快取讀取邏輯
- done: 失敗不寫入、空快取視同 miss

### Task 2: 移除 index.html 死引用
- files: index.html
- action: 刪除 `<link rel="stylesheet" href="/index.css">` 該行
- verify: `grep index.css index.html` 無結果；`npm run build` 通過
- done: 404 來源移除

## Verification
- `npx tsc --noEmit` 0 error；`npm run build` 通過
- 部署後：console 無 index.css 404；模擬中毒快取（手動塞空陣列）重載後自動重抓
