---
phase: quick-260713-2am
plan: 01
subsystem: portfolio-health
tags: [llm-contract, json-parsing, batch, gemini, portfolio]
requires: [quick-260713-1t8 (C-1 llm adapter — 契約 provider 無關)]
provides:
  - services/_shared/healthDecision.ts 純解析模組（parseHealthDecisions / extractDecisionByRegex / splitHealthReport / DECISION_EMOJI）
  - analyzePortfolioHealth systemInstruction 機器可讀決策區契約
  - Portfolio 一鍵批次健檢（一次 LLM 呼叫涵蓋全部持股）
affects: [components/Portfolio.tsx, services/gemini.ts]
tech-stack:
  added: []
  patterns: [零 import 純模組 esbuild-CJS node 直測（geminiCache.ts 先例）, LLM 回應機器可讀 json 圍欄契約＋regex fallback 階梯, 3-worker index 游標池限併發]
key-files:
  created: [services/_shared/healthDecision.ts]
  modified: [services/gemini.ts, components/Portfolio.tsx]
decisions:
  - 總覽段（📊 庫存總覽＋💡 整體操作建議）附在每檔切段段尾（\n\n---\n\n 分隔）——零新增 UI 面，靠既有健檢 Modal 保證顯示路徑
  - 不做 chunk 分批（已知限制見下）；截斷時解析器回 null → fallback 全文＋regex，可退化不會壞
  - fallback regex 搬進模組 extractDecisionByRegex，Portfolio 原 :965 regex 刪除
  - 批次資料準備 3-worker index 游標池（getLatestPrice 不暖 getStockData 快取，冷抓打真網路，429 常態）
metrics:
  duration: ~9min
  completed: 2026-07-13
  tasks: 3
  files: 3
---

# Quick 260713-2am: C-2 健檢決策 JSON 結構化＋一鍵批次健檢 Summary

單檔健檢決策改由報告末尾 json 圍欄機器區解析（regex 降級為 fallback 下限），並新增「全部健檢」一次 LLM 呼叫涵蓋全部持股、按標頭切段逐檔顯示。

## Task Commits

| Task | Name | Commit |
|------|------|--------|
| 1 | healthDecision 解析器純模組＋systemInstruction 契約 | 49bba67 |
| 2 | Portfolio 改接——buildHealthItem＋單檔改接＋批次健檢 | 9ee609c |
| 3 | 終端驗證（build／金鑰紅線／迴歸讀碼斷言） | （驗證，無新改動） |

## 實作內容

**services/_shared/healthDecision.ts（新，137 行）**
- `parseHealthDecisions`：全域掃 ```json 圍欄取最後一個 → JSON.parse（try/catch）→ shape 驗證（物件／decisions 非空陣列／symbol 非空字串／decision trim 後屬五值枚舉）；任何失敗回 null 不拋錯；cleanedMarkdown ＝ 剔除該區塊後 trimEnd。
- `extractDecisionByRegex`：原 Portfolio.tsx:965 regex 逐字搬移，命中回 `🟢加碼` 式壓縮字串。
- `splitHealthReport`：按 `### 📋 持股健檢報告：` 標頭切段（📋 可選）；最後一段內截出 📊/💡 總覽；symbols 依長度降冪認領（防 6488.TW／6488.TWO 子字串邊角）；0 標頭／缺段／歧義 → null。
- 零 import 純模組，esbuild CJS 後 node 直測 29 情境全 PASS。

**services/gemini.ts**
- analyzePortfolioHealth systemInstruction 末尾（嚴格執行規範第 4 點後）追加「機器可讀決策區」契約節；模板字面值內 json 圍欄反引號逐一 `\`` 轉義。其餘一字未動。

**components/Portfolio.tsx**
- `buildHealthItem` useCallback：成本/損益換算與資料抓取邏輯自原單檔逐字搬移（單檔/批次共用）。
- 單檔健檢 fallback 階梯：json 機器區（DECISION_EMOJI 補 emoji 前綴）→ extractDecisionByRegex → `分析完成`；Modal 顯示 cleanedMarkdown（json 成功時不含機器區）。
- `handleBatchHealthCheck`：一次 setHealthResults 全部設 loading → 3-worker 游標池組 healthItems → 一次 analyzePortfolioHealth → parse/切段/decisionMap → 一次 setHealthResults 逐檔 done；catch 全部設 error；finally 解鎖。
- header「全部健檢」按鈕（variant="ai"，items 空或批次中 disabled，批次中 Loader2 spinner）。

## 驗證

- `npx tsc --noEmit` 綠（每 task 各跑）。
- node 直測 29/29 PASS：單檔/多檔正常、缺區塊、壞 JSON（截斷/多餘逗號）、枚舉外值（觀望/🟢加碼）、空 decisions、多 json 區塊取最後、最後區塊損壞不回頭、regex 命中/未命中、切段 3 檔/缺檔/子字串認領/0 標頭/漏 📋。
- `npm run build` 成功；`grep -r "AIza" dist/` 0 結果（金鑰紅線）。
- diff 範圍恰為三檔；api/ 零觸碰；geminiCache.ts 零觸碰；analyzeEntryWithGemini/analyzeTradeDecision/analyzeFundamentals/callGeminiApi/FLASH_THINKING_BUDGET 零改動；PortfolioHealthItem 介面零改動。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] splitHealthReport 標頭 regex 的 📋 surrogate pair 陷阱**
- **Found during:** Task 1 node 直測（「標頭漏 📋 仍命中」情境 FAIL）
- **Issue:** plan 指定的 `/^###\s*📋?\s*.../gm` 無 `u` flag——📋 是 surrogate pair，`?` 只作用於低位代理 `\uDCCB`，高位代理仍為必要字元，導致漏 emoji 的標頭無法匹配
- **Fix:** 改為非捕獲組 `(?:📋)?` 並加註解說明
- **Files modified:** services/_shared/healthDecision.ts
- **Commit:** 49bba67

## 已知限制

- **>8 檔可能截斷（未 chunk）**：多檔合併輸出變長；個人庫存規模 <10 檔、systemInstruction 已有防 Token 溢出精簡要求。若截斷實際發生：parseHealthDecisions 回 null → fallback 全文＋regex，行為可退化不會壞（planner 裁定記錄）。
- worktree package-lock.json 與 package.json 不同步（@upstash/* 缺 lock 項，繼承自 main，非本次改動）；`npm ci` 失敗，驗證改走父層 node_modules（worktree 巢狀於主 repo 下，node 解析自然上溯），tsc/esbuild/vite build 均正常。

## Self-Check: PASSED

- FOUND: services/_shared/healthDecision.ts
- FOUND: commit 49bba67（Task 1）
- FOUND: commit 9ee609c（Task 2）
- dist/ AIza 掃描 0 結果
