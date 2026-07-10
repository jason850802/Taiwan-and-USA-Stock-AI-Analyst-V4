---
quick_id: 260710-wsq
slug: bug-index-css
status: complete
commit: 46a2464
completed: 2026-07-10
---

# Quick Task 260710-wsq Summary

**修正台股名錄快取中毒 bug（失敗不快取＋空快取自癒）＋移除 index.css 死引用**

## Problem

1. **快取中毒**：`ensureTaiwanDirectory` 抓取失敗（後端 403/502、FinMind 故障、
   `msg!=='success'`）時仍把空陣列寫入 localStorage 並蓋新鮮時間戳——空目錄被
   快取 7 天，期間搜尋無台股中文名錄（只剩 Yahoo 英文），修好後也不自動痊癒。
   2026-07-10 部署驗收實測踩中（ALLOWED_ORIGIN 未回填＋壞 token 兩個時間窗），
   當時需手動清 localStorage 恢復。
2. **死引用**：`index.html` 的 `/index.css` link 指向不存在檔案，每次載入 404。

## Fix

- `services/stockDirectory.ts`
  - 寫入端：`list.length > 0` 才寫 localStorage，失敗/空絕不快取。
  - 讀取端：快取 parse 出空陣列視同 cache miss，續走重抓——已中毒使用者
    下次載入自動痊癒，無須手動清。
- `index.html`：刪除 `<link rel="stylesheet" href="/index.css">`。

## Verification

- `grep index.css index.html` = 0
- `npx tsc --noEmit` 0 error；`vite build` 通過（僅既有 chunk-size 警告）
- node 模擬五情境：中毒空快取→MISS 重抓 ✓、正常快取→HIT ✓、過期→MISS ✓、
  抓失敗→不寫入 ✓、抓成功→寫入 ✓
- 部署後（待使用者瀏覽器確認）：console 無 index.css 404；搜尋中文名正常

## Commit

- `46a2464` fix(260710-wsq): prevent directory cache poisoning + remove dead index.css link
  （2 files: services/stockDirectory.ts, index.html）

## Deviations

None。
