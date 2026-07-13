---
phase: quick-260713-buv
plan: 01
subsystem: llm-integration
tags: [gemini, system-instruction, prompt-caching, cost-optimization]
requires: [quick-260713-1t8 (C-1 llm adapter), quick-260713-2am (C-2 決策區契約)]
provides:
  - "services/gemini.ts 四個 SI 全部 module 級 const、對所有輸入位元組穩定"
  - "implicit 前綴快取與 A3 hash 穩定的架構前提"
affects: [phase-c-acceptance]
tech-stack:
  added: []
  patterns: ["module-level static systemInstruction consts（命名照 FUNDAMENTALS_SYSTEM_INSTRUCTION 慣例，不 export，置於消費函式正上方）"]
key-files:
  created: []
  modified: [services/gemini.ts]
key-decisions:
  - "拒絕 PLAN.md 原文的 Gemini explicit caching（cachedContents API），改做 SI 靜態化＋依賴零成本 implicit caching——經濟模型數字見下"
  - "entry SI 的 5 個動態值改由 promptData 單一來源供給（promptData 零改動，資訊對等成立）"
metrics:
  duration: "~25 min"
  completed: "2026-07-13"
  tasks: 2
  files: 1
---

# Quick 260713-buv: C-3 systemInstruction 靜態化 Summary

四個分析函式的 systemInstruction 全部提升為 module 級 const（entry 版同步去除 5 處個股內插），使 SI 逐次呼叫、逐檔股票位元組相同——implicit 前綴快取折扣與 A3 快取 hash 穩定的必要前提，`services/gemini.ts` 單檔改動。

## 完成內容

| Task | 內容 | Commit |
|------|------|--------|
| 1 | 三處 SI hoist 為 module const＋entry 版去內插（2 行改寫）＋呼叫處改用常數 | 2d40726 |
| 2 | 位元組級驗證腳本（scratchpad，不進 repo）＋ build＋金鑰紅線——全 PASS，無新改動故無 commit | —（驗證 only） |

新增 module 常數（皆不 export、置於消費函式正上方）：
- `ENTRY_SYSTEM_INSTRUCTION`（analyzeEntryWithGemini）
- `TRADE_DECISION_SYSTEM_INSTRUCTION`（analyzeTradeDecision）
- `HEALTH_CHECK_SYSTEM_INSTRUCTION`（analyzePortfolioHealth）
- `FUNDAMENTALS_SYSTEM_INSTRUCTION` 既有、零觸碰。

## 機制層偏差裁定：explicit caching 全面拒絕（供 Phase C 驗收覆核）

PLAN.md Phase C 原文寫「Gemini 路徑用 context caching」。planner 獨立覆核後與 orchestrator 先行分析一致，**拒絕 explicit caching（cachedContents API），改做靜態化＋依賴 implicit caching**，理由與數字如下：

1. **經濟模型**：explicit caching 建立時被快取 token 收一次全額 input 費＋儲存費 ~$1/M tokens/hour（Flash 量級）；命中折扣 ~75%。
2. **流量不匹配**：本 App 剩餘 Gemini 流量（A3 同日同輸入歸零＋C-2 批次合併＋C-1 本機走 claude-cli 之後）＝個人單日零星幾次、間隔以小時計，遠大於預設 TTL 1h → 命中率趨近 0。
3. **回本粗算**：健檢規則庫 ~5-8k tokens、Flash input ~$0.30/M → 每次命中省 ~$0.001-0.002；儲存 1 小時成本 ~$0.005-0.008 → **回本需每小時 ≥4-5 次呼叫，實際流量差兩個數量級**；且每次建立 cache 還先付一次全額 input 費。
4. **附加基建成本**：serverless 冷啟需跨實例查 cache name（caches.list 每請求多一趟、或引入外部儲存新基建），複雜度純增。
5. **子情境覆核**：唯一密集重複情境是「數分鐘內連續 entry 分析多檔」——但 entry SI 靜態化後僅 ~1k tokens，低於 Flash explicit cache 最小門檻（1,024 tokens）很可能不合格；且該爆發情境正是零成本 implicit caching（Gemini 2.5 起自動前綴快取折扣，零儲存費、零生命週期程式碼）所覆蓋。**無任何子情境 explicit 划算。**

**結論**：靜態化是 implicit caching 命中的必要前提（SI 逐檔不同＝任何前綴快取全滅），也是 A3 hash 穩定與未來任何快取機制的地基。

**誠實註記**：implicit cache 生命週期短（分鐘級、Google 未承諾），間隔數小時的呼叫命中仍會稀少——本包的價值是「零成本啟用爆發情境折扣＋位元組穩定的架構地基」。實際折扣命中之後從帳單／`usageMetadata.cachedContentTokenCount` 觀察即可，本包不做花錢的即時驗證呼叫。

## A3 快取互動結論

- key = `mode|台北日期|FNV-1a(SI + ' ' + prompt)`（geminiCache.ts 零觸碰）。
- 改後 entry SI 對所有股票相同，但 prompt（promptData）含個股 symbol/日期/價位/六步驟細節——**同日不同股仍是不同 hash＝不同 key，無跨股誤共享**。
- 同日同股命中率不變（改前 SI 的動態值本就是同一 result 的確定性函數）。
- SI 位元組變更使舊快取條目自然 miss 一次重打（與 C-2 先例相同，非中毒、無需遷移）。

## 資訊對等（entry 版去內插）

模型原本從 SI 取得的 5 個動態值，改後全數仍在 promptData（唯一來源、零改動）：

| SI 舊動態值 | promptData 既有對應 |
|---|---|
| `${result.decision}` | `- 最終決策：${result.decision}（信心 ${result.confidence}/100）` |
| `${result.entryPrice}` | `- 建議進場價 ${result.entryPrice}` |
| `${result.stopPrice}` | `① 固定停損 ${result.stopPrice}（進場價 -5%）` |
| `${result.maGuardPrice ?? '—'}` | `② 關鍵均線防守 ${result.maGuardPrice ?? '—'}（…）`（同款 fallback） |
| `${result.guardMaLabel ?? '中長線MA20'}` | `（${result.guardMaLabel ?? '中長線MA20'}）`（同款 fallback） |

SI 措辭改為靜態指涉（「呼應輸入資料中的最終決策」「照輸入資料『停損雙軌』段」），輸出格式指示語意不變——模型仍被要求輸出進場價、兩個停損防守價與均線名稱。

## 驗證結果

- `npx tsc --noEmit` 綠。
- grep 斷言：函式內 `const systemInstruction` 0 處；三個 module 級 SI const 恰 3 處；git 改動僅 `services/gemini.ts` 一檔（api/、geminiCache.ts、promptData 零觸碰）。
- 位元組級腳本（scratchpad `verify-c3.cjs`，以 `git show HEAD~1:services/gemini.ts` 比對）14 項全 PASS：
  - trade SI 本體 16,905 bytes 全等；health SI 本體 14,470 bytes 全等（含 C-2 轉義反引號 `` \`\`\`json `` 原樣）。
  - entry SI 零 `${`；行數不變；逐行 diff **恰 2 行**（分別含「呼應」「停損防守價」）。
  - promptData 位元組全等且含全部 5 個動態表達式。
  - FUNDAMENTALS_SYSTEM_INSTRUCTION 位元組全等。
- `npm run build` 成功；`grep -r "AIza" dist/` 0 結果（金鑰紅線守住）。

## Deviations from Plan

None - plan executed exactly as written.

（實作手段註記：Task 1 的 hoist 以 node 轉換腳本（scratchpad）機械執行以保證大段模板位元組零漂移，非逐段手改——屬手段選擇，改動範圍與內容完全符合 plan 規格。Task 2 驗證腳本比對基準用 `HEAD~1`（＝改前 base 4507422），因 Task 1 已先 commit，語意與 plan 所寫 `git show HEAD` 相同。）

## 留待 Phase C 收尾驗收

- 品質人工對照（3-5 檔 entry/健檢報告與改前對照）——不在本包內做。
- implicit caching 實際折扣命中：從帳單／`usageMetadata.cachedContentTokenCount` 事後觀察。

## Self-Check: PASSED

- services/gemini.ts 存在且含三個新 module const：FOUND
- Commit 2d40726 存在於 worktree branch：FOUND
- 驗證腳本 ALL ASSERTIONS PASS、build 綠、dist 無 AIza：CONFIRMED
