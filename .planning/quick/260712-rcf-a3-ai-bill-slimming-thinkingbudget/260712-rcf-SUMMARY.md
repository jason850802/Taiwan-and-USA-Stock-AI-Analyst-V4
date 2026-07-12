---
phase: quick-260712-rcf
plan: 01
subsystem: ai-analysis
tags: [gemini, cache, cost-optimization, dead-code, thinking-budget]
requires: []
provides:
  - "services/_shared/geminiCache.ts：零 import 純快取模組（fnv1aHash/taipeiTodayStr/buildCacheKey/readCache/writeCache）"
  - "callGeminiApi 咽喉點透明快取：同台北日期＋同 mode＋同輸入 0 次 API 計費"
  - "FLASH_THINKING_BUDGET = 4096 單一常數（原三處硬編 8192/10240/8192）"
affects: [services/gemini.ts 全部四個分析入口（entry/trade/health/fundamentals）]
tech-stack:
  added: []
  patterns: ["localStorage 透明快取（try/catch 全退化）", "FNV-1a 32-bit content hash 作快取 key"]
key-files:
  created: [services/_shared/geminiCache.ts]
  modified: [services/gemini.ts]
decisions:
  - "不做「重新分析」按鈕：hash 相同＝輸入完全相同，重打必然語意相同、純屬重複計費"
  - "批次健檢明確延到 Phase C（JSON 結構化輸出時一起做），本包 Portfolio.tsx 零改動"
  - "thinkingBudget 第三處（analyzeFundamentals）納入統一，規格外 delta"
metrics:
  duration: "~10 min"
  completed: "2026-07-12"
---

# Quick Task 260712-rcf: A3 AI 帳單瘦身（死碼清除＋透明快取＋thinkingBudget 統一 4096）Summary

**One-liner:** gemini.ts 刪除 238 行死碼、callGeminiApi 咽喉點加 localStorage 透明分析快取（同日同輸入 0 重複計費、UI 零改動）、三處 flash thinkingBudget 硬編統一為 FLASH_THINKING_BUDGET = 4096 單一常數。

## 完成內容

### Task 1（commit 7bc35f1）：刪死碼
- 刪除 `formatPromptData`（:46-205）＋`analyzeStockWithGemini`（:207-282）共 238 行——執行前重跑全 repo grep 復核，僅定義處與內部呼叫三筆，零外部引用。
- **保留 `VolumeProjectionInfo` 介面**（PortfolioHealthItem.volumeProjection 與 formatHealthCheckData 仍使用），:37 註解改寫為「盤中量能預估資訊（供持股健檢 prompt 使用）」。
- 四個既有 import（StockDataPoint／TwFundamentals／EntryFilterResult／proxyHeaders）逐一 grep 復核，均仍被存活函式使用，全部保留。

### Task 2（commit 2c1107d）：透明快取層＋thinkingBudget 常數

**快取層設計摘要：**
- **Key 格式**：`gemini_cache_v1|{mode}|{台北日期 YYYY-MM-DD}|{fnv1aHash(systemInstruction + ' ' + prompt)}`——dateStr 由呼叫端注入（非模組內部取當日），讓「日期參與 key」可被 node 直測斷言。
- **命中路徑**：callGeminiApi 在 fetch `/api/gemini` 之前先 readCache，命中直接回傳（0 次 API 計費）；行情一變 → prompt 變 → hash 變 → 自動失效。
- **寫入條件**：僅 `response.ok` 且 `data.text` 為非空字串才 writeCache——不快取 fallbackText、不快取錯誤（避免壞結果被釘一整天）。
- **50 筆上限**：寫入後同 prefix 條目數 > 50 時依 ts 升冪淘汰最舊；quota 滿時淘汰最舊一筆重試一次，再失敗即放棄。
- **跨日清理**：每次寫入順手掃 prefix 下所有 key（先收集再刪、不邊迭代邊刪），日期段 ≠ 台北今日者一律移除。
- **退化行為**：readCache/writeCache 整體 try/catch＋`typeof localStorage === 'undefined'` 守衛；隱私模式／配額滿／解析失敗一律靜默退化為現行為（直接打 API），錯誤不外洩到呼叫端。
- geminiCache.ts 為**零 import 純模組**，localStorage 只在函式內部觸碰；`taipeiTodayStr` 鏡像自 services/finmind.ts:62-72 的 Intl.DateTimeFormat formatToParts 實作（該函式 module-private 不可 import，為保持零依賴自帶一份）。

**FLASH_THINKING_BUDGET：**
- `const FLASH_THINKING_BUDGET = 4096` 單一定義處（GeminiApiPayload 型別下方）。
- 檔內 `thinkingBudget` 恰 4 筆：型別宣告 1＋常數引用 3；8192/10240 字面量零殘留。
- analyzeEntryWithGemini 用 `thinkingLevel: 'MEDIUM'` 無 thinkingBudget，未動。

## 交辦裁決（覆蓋總計畫 §A3 原文兩點）

1. **不做「重新分析」按鈕**（總計畫原文有）：prompt 內含最新行情算出的濾網結論／K 棒數列，資料一變 hash 即變、快取自動失效；hash 相同代表輸入完全相同，重打必然得到語意相同的報告，純屬重複計費。故快取命中直接回傳即可——不需 force 選項、不改任何 UI。
2. **批次健檢明確延到 Phase C**（總計畫原文為「評估」）：現行從自由文字用 regex 抓決策（Portfolio.tsx:965），多檔合併回應會讓解析更脆弱；Phase C 做 JSON 結構化輸出時一起做。本包 Portfolio.tsx 一行未動。

## Deviations from Plan

### 規格外 Delta（規劃時已預告、執行時落實）

**1. thinkingBudget 硬編實際三處（規格原列兩處）**
- **Found during:** 規劃偵察，Task 2 落實
- **Issue:** 總計畫 §A3 規格撰寫時只列 analyzeTradeDecision（8192）與 analyzePortfolioHealth（10240）兩處；基本面功能（analyzeFundamentals，8192）於規格撰寫後才合併進 main，成為第三處硬編。
- **Fix:** 三處全部統一為 `FLASH_THINKING_BUDGET = 4096`，與規格「統一改為具名常數（單一定義處）」意圖一致。
- **Files modified:** services/gemini.ts
- **Commit:** 2c1107d

其餘照 PLAN 執行，無臨場偏差。

## 五項驗證結果

| # | 驗證項 | 結果 |
|---|--------|------|
| 1 | node 直測（esbuild 轉 CJS）：同 key 穩定／prompt·systemInstruction·mode·date 任一變動 key 即變／key 與 taipeiTodayStr 格式／無 localStorage 環境 readCache 安全回 null 不拋錯 | PASS（全部斷言通過；node 無 localStorage 警告恰好實證退化路徑） |
| 2 | 死碼零引用：`grep -rn "analyzeStockWithGemini\|formatPromptData"` | ZERO |
| 3 | `npx tsc --noEmit` | PASS（每個 commit 前均跑） |
| 4 | `npm run build`＋`grep -r "AIza" dist/` | Build 成功、AIza 零輸出（金鑰紅線乾淨） |
| 5 | 工作樹紀律：`git diff --stat` 僅 services/gemini.ts＋services/_shared/geminiCache.ts；Portfolio.tsx／FundamentalsPanel.tsx 零 diff；臨時測試檔已刪 | PASS |

## Known Stubs

None——本包無 UI 改動、無資料佔位。

## Commits

| Commit | Message |
|--------|---------|
| 7bc35f1 | refactor(quick-260712-rcf): 刪除 gemini.ts 死碼 analyzeStockWithGemini＋formatPromptData（~237 行） |
| 2c1107d | feat(quick-260712-rcf): callGeminiApi 透明分析快取（同日同輸入 0 重複計費）＋thinkingBudget 統一降至 4096 |

## Self-Check: PASSED

- [x] services/_shared/geminiCache.ts 存在
- [x] services/gemini.ts 含 FLASH_THINKING_BUDGET／readCache／writeCache
- [x] commit 7bc35f1 存在
- [x] commit 2c1107d 存在
