---
phase: quick-260713-buv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - services/gemini.ts
autonomous: true
requirements: [C-3]
must_haves:
  truths:
    - "四個分析函式的 systemInstruction 全部為 module 級 const，逐次呼叫、逐檔股票位元組相同（隱式前綴快取與 A3 hash 穩定的前提）"
    - "analyzeEntryWithGemini 的 systemInstruction 零 ${ 內插；模型原本從 SI 取得的 5 個動態值（decision/entryPrice/stopPrice/maGuardPrice/guardMaLabel）改後仍可從 promptData 逐一取得（資訊對等）"
    - "analyzeTradeDecision／analyzePortfolioHealth 的 systemInstruction 內容與改前逐位元相同（hoist 純位置移動）；FUNDAMENTALS_SYSTEM_INSTRUCTION 零觸碰"
    - "api/ 目錄零觸碰（claude-cli 路徑 --system-prompt 天然吃靜態常數）；雲端部署行為不變"
    - "A3 快取無跨股誤共享：key 含 prompt hash，同日不同股仍是不同 key；SI 位元組變更使舊條目自然 miss 一次（非中毒，無需遷移）"
  artifacts:
    - path: "services/gemini.ts"
      provides: "ENTRY_SYSTEM_INSTRUCTION / TRADE_DECISION_SYSTEM_INSTRUCTION / HEALTH_CHECK_SYSTEM_INSTRUCTION 三個 module 級 const（FUNDAMENTALS_SYSTEM_INSTRUCTION 既有）"
      contains: "ENTRY_SYSTEM_INSTRUCTION"
  key_links:
    - from: "analyzeEntryWithGemini promptData"
      to: "ENTRY_SYSTEM_INSTRUCTION 靜態指涉措辭"
      via: "5 個動態值唯一來源移至 promptData（:92-96 既有內容，零改動）"
      pattern: "result\\.(decision|entryPrice|stopPrice|maGuardPrice|guardMaLabel)"
    - from: "callGeminiApi 快取 key"
      to: "services/_shared/geminiCache.ts buildCacheKey"
      via: "hash(systemInstruction + ' ' + prompt)——prompt 含個股資料故無跨股共享"
      pattern: "buildCacheKey"
---

<objective>
C-3（Phase C 3/3）：規則庫 systemInstruction 靜態化——四個分析函式的 systemInstruction 全部提升為 module 級 const，並把 `analyzeEntryWithGemini` SI 內的 5 處個股動態內插改為「指涉輸入資料」的靜態措辭（動態值本來就已完整存在於 promptData，promptData 零改動）。

Purpose（上位目標＝PLAN.md Phase C 驗收：重複規則庫不重複計費、本機日常帳單趨近 0、部署行為不變、報告品質無退化）：

**對 PLAN.md 原文「Gemini 路徑用 context caching」的機制層偏差裁定——拒絕 explicit caching，改做靜態化＋依賴 implicit caching**（planner 獨立覆核後與 orchestrator 先行分析一致）：

- Gemini explicit caching（cachedContents API）經濟模型：建立時被快取 token 收一次全額 input 費＋儲存費 ~$1/M tokens/hour（Flash 量級）；命中折扣 ~75%。
- 本 App 剩餘 Gemini 流量（A3 同日同輸入歸零＋C-2 批次合併＋C-1 本機走 claude-cli 之後）＝個人單日零星幾次、間隔以小時計，遠大於預設 TTL 1h → 命中率趨近 0。
- 粗算（健檢規則庫 ~5-8k tokens、Flash input ~$0.30/M）：每次命中省 ~$0.001-0.002；儲存 1 小時 ~$0.005-0.008 → 回本需每小時 ≥4-5 次呼叫，實際流量差兩個數量級；每次建立還先付一次全額 input 費。
- 附加成本：serverless 冷啟需跨實例查 cache name（caches.list 每請求多一趟或外存新基建），複雜度純增。
- 子情境覆核：唯一密集重複情境是「數分鐘內連續 entry 分析多檔」——但 entry SI 靜態化後僅 ~1k tokens，低於 Flash explicit cache 最小門檻（1,024 tokens）很可能不合格，且該爆發情境正是零成本的 implicit caching（Gemini 2.5 起自動前綴快取折扣，零儲存費、零生命週期程式碼）所覆蓋。無任何子情境 explicit 划算。
- **結論：explicit caching 全面拒絕。靜態化是 implicit caching 命中的必要前提（SI 逐檔不同＝任何前綴快取全滅），也是 A3 hash 穩定與未來任何快取機制的地基。**
- 誠實註記（寫進 SUMMARY）：implicit cache 生命週期短（分鐘級、Google 未承諾），間隔數小時的呼叫命中仍會稀少——本包的價值是「零成本啟用爆發情境折扣＋位元組穩定的架構地基」，實際折扣命中需之後從帳單／usageMetadata.cachedContentTokenCount 觀察，本包不做花錢的即時驗證呼叫。

Output: `services/gemini.ts` 單檔改動——三個 SI hoist 為 module const（entry 版同時去內插）；api/、geminiCache.ts、promptData、其餘一切零觸碰。
</objective>

<context>

@services/gemini.ts（callGeminiApi 快取咽喉點 :19-49；analyzeEntryWithGemini :65-135——promptData :81-98、SI :100-126；analyzeTradeDecision :137-502——SI :215-493；analyzePortfolioHealth :627-831——SI :632-820 含 C-2 剛加的機器可讀決策區 :811-819；FUNDAMENTALS_SYSTEM_INSTRUCTION :877-912）
@services/_shared/geminiCache.ts（buildCacheKey＝`prefix|mode|台北日期|FNV-1a(systemInstruction + ' ' + prompt)`——讀懂即可，**不動**）
@api/_lib/llm.ts（C-1 adapter：claude-cli 以 `--system-prompt` 傳 SI，訂閱計費不看 token——讀懂即可，**本包 api/ 零觸碰**）

**既有事實（executor 心裡要有數，不要重查）：**

- 三個大 SI（trade decision :215-493、health check :632-820、fundamentals :877-912）已用 grep 證實**零 `${` 內插**——hoist 是純位置移動，內容一個位元組都不會變。
- entry SI（:100-126）恰有 **5 處內插、分佈在 2 行**：:106 的 `${result.decision}`；:113 的 `${result.entryPrice}`、`${result.stopPrice}`、`${result.guardMaLabel ?? '中長線MA20'}`、`${result.maGuardPrice ?? '—'}`。
- **資訊對等已成立、promptData 零改動**——5 個動態值在 promptData 皆已存在（含同款 fallback）：

  | SI 舊動態值 | promptData 既有對應（改後模型的唯一來源） |
  |---|---|
  | `${result.decision}` | :92 `- 最終決策：${result.decision}（信心 ${result.confidence}/100）` |
  | `${result.entryPrice}` | :93 `- 建議進場價 ${result.entryPrice}` |
  | `${result.stopPrice}` | :95 `① 固定停損 ${result.stopPrice}（進場價 -5%）` |
  | `${result.maGuardPrice ?? '—'}` | :96 `② 關鍵均線防守 ${result.maGuardPrice ?? '—'}（…）`——同款 `?? '—'` fallback |
  | `${result.guardMaLabel ?? '中長線MA20'}` | :96 `（${result.guardMaLabel ?? '中長線MA20'}）`——同款 fallback |

- health SI 模板字面值內含轉義反引號 `\`\`\`json`（C-2 機器可讀決策區 :813-815）——hoist 時原樣照搬，仍是模板字面值故轉義維持有效；這也是位元組比對腳本選終止符時要避開的地雷（見 Task 2）。
- **A3 快取互動推理（executor 驗證此推理成立即可，geminiCache.ts 不動）**：key = `mode|台北日期|FNV-1a(SI + ' ' + prompt)`。改後 entry SI 對所有股票相同，但 prompt（promptData）含個股 symbol/日期/價位/六步驟細節——同日不同股仍是不同 hash＝不同 key，**無誤共享**；同日同股命中率不變（改前 SI 的動態值本就是同一 result 的確定性函數）；SI 位元組變更使舊條目自然 miss 一次重打（與 C-2 先例相同，非中毒、無需遷移）。
- 命名慣例照既有 `FUNDAMENTALS_SYSTEM_INSTRUCTION`：新 const 命名 `ENTRY_SYSTEM_INSTRUCTION`／`TRADE_DECISION_SYSTEM_INSTRUCTION`／`HEALTH_CHECK_SYSTEM_INSTRUCTION`，不 export，各放在其消費函式正上方。

**紅線**：
- 規則庫文字（朱家泓規則、輸出格式段、C-2 決策區契約）除 entry 版 2 行動態指涉改寫外**一字不改**——品質風險紅線，靠 Task 2 位元組比對腳本強制。
- api/ 零觸碰（C-1 剛落地；claude-cli 的 `--system-prompt` 收到靜態常數即為完成，零改動）。
- geminiCache.ts 零觸碰；promptData 零觸碰；callGeminiApi／FLASH_THINKING_BUDGET／各函式簽名與呼叫參數（mode/temperature/thinkingConfig/fallbackText）零觸碰。
- `GEMINI_API_KEY` 金鑰紅線照舊（build 後 grep AIza）。
</context>

<tasks>

<task type="auto">
  <name>Task 1: 四個 systemInstruction 靜態化——三處 hoist＋entry 版去內插</name>
  <files>services/gemini.ts</files>
  <action>
**A. hoist `analyzeTradeDecision` SI（:215-493）**：把函式內 `const systemInstruction = \`...\`;` 整段模板字面值原樣搬到 `analyzeTradeDecision` 函式定義正上方，改名 `const TRADE_DECISION_SYSTEM_INSTRUCTION = \`...\`;`（不 export）；函式內呼叫處改 `systemInstruction: TRADE_DECISION_SYSTEM_INSTRUCTION`。**內容零改動**——開頭換行、結尾換行、每一個字元照舊（模板內容本就 flush-left，搬移不產生縮排差異）。

**B. hoist `analyzePortfolioHealth` SI（:632-820）**：同法搬到 `analyzePortfolioHealth` 正上方（`formatHealthCheckData` 之後），改名 `HEALTH_CHECK_SYSTEM_INSTRUCTION`。內容零改動——特別是 C-2 機器可讀決策區的轉義反引號 `\`\`\`json` 原樣照搬（仍在模板字面值內，轉義維持必要且有效）。

**C. `analyzeEntryWithGemini` SI 去內插＋hoist（本包的實 work）**：先在原位對 SI 做**恰好 2 行**改寫（其餘每一行一字不改），再整段搬到 `analyzeEntryWithGemini` 正上方改名 `ENTRY_SYSTEM_INSTRUCTION`：

1. :106 改寫——
   - 舊：`用 2-3 句說明此股目前的進場結論（呼應系統決策 ${result.decision}），點出最關鍵的通過項與卡關項。`
   - 新：`用 2-3 句說明此股目前的進場結論（呼應輸入資料中的最終決策），點出最關鍵的通過項與卡關項。`
2. :113 改寫——
   - 舊：`- 若決策為 GO：說明進場理由、進場價 ${result.entryPrice}，並列出**兩個停損防守價**（固定 -5%：${result.stopPrice}；${result.guardMaLabel ?? '中長線MA20'}：${result.maGuardPrice ?? '—'}），註明擇一作為主要防守、收盤跌破即出場，以及停利紀律。`
   - 新：`- 若決策為 GO：說明進場理由與輸入資料中的建議進場價，並列出**兩個停損防守價**（照輸入資料「停損雙軌」段：① 固定停損 -5% 價位；② 關鍵均線防守價位與其均線名稱），註明擇一作為主要防守、收盤跌破即出場，以及停利紀律。`

   語意保持：模型仍被要求輸出進場價、兩個停損防守價與均線名稱——只是取值來源從 SI 內插改為 promptData 的「程式濾網客觀結論／停損雙軌」段（該段本就含全部 5 值，見 context 對照表）。**promptData（:81-98）一個字元都不改。**
3. 改寫後該 SI 必須**零 `${`**；函式內呼叫處改 `systemInstruction: ENTRY_SYSTEM_INSTRUCTION`。

**D. 收尾檢查**：`FUNDAMENTALS_SYSTEM_INSTRUCTION`（:877-912）與 `analyzeFundamentals` 零觸碰；全檔不得殘留任何函式內 `const systemInstruction`；callGeminiApi 與四個函式的其餘參數（mode/temperature/thinkingConfig/fallbackText）零改動。
  </action>
  <verify>
    <automated>cd "/e/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && [ "$(grep -c 'const systemInstruction' services/gemini.ts)" -eq 0 ] && [ "$(grep -cE '^const (ENTRY|TRADE_DECISION|HEALTH_CHECK)_SYSTEM_INSTRUCTION = `' services/gemini.ts)" -eq 3 ] && [ "$(git diff --name-only | grep -cv '^services/gemini.ts$')" -eq 0 ]</automated>
  </verify>
  <done>tsc 綠；函式內 systemInstruction 常數 0 處；三個新 module 級 const 各恰 1 處；git 工作區改動僅 services/gemini.ts 一檔（api/、geminiCache.ts 零觸碰）。</done>
</task>

<task type="auto">
  <name>Task 2: 位元組級驗證腳本＋建置金鑰紅線</name>
  <files>（驗證，無新改動；腳本放 scratchpad 不進 repo）</files>
  <action>
**A. node 驗證腳本**（寫在 scratchpad，如 `verify-c3.cjs`，用 Bash 工具跑）：

1. 取舊檔：`execSync('git show HEAD:services/gemini.ts')`；讀新檔 `services/gemini.ts`。
2. 抽取模板字面值本體的方法：舊檔以 `'  const systemInstruction = `'`（兩空格縮排）split——chunk[1]=entry、chunk[2]=trade、chunk[3]=health（依檔案順序）；新檔以 `'const TRADE_DECISION_SYSTEM_INSTRUCTION = `'` 等常數名各自 split。本體終止符一律取**首次出現的 `'\n`;'`**（換行＋反引號＋分號）——health 本體內的 `\`\`\`json` 是「反斜線＋反引號」序列、不含此終止符，不會誤切。
3. 斷言（任一失敗即 exit 1 並印出差異行）：
   - **(c) 位元組相同**：新 `TRADE_DECISION_SYSTEM_INSTRUCTION` 本體 === 舊 trade SI 本體；新 `HEALTH_CHECK_SYSTEM_INSTRUCTION` 本體 === 舊 health SI 本體（`===` 全等，非 includes）。
   - **(a) entry 零內插**：新 `ENTRY_SYSTEM_INSTRUCTION` 本體 `includes('${')` 為 false。
   - **(a') entry 改寫最小化**：舊 entry SI 本體與新本體逐行 diff，不同的行**恰好 2 行**，且分別含「呼應」與「停損防守價」字樣（其餘行逐位元相同——品質紅線的機器證明）。
   - **(b) 資訊對等**：從新檔抽 `analyzeEntryWithGemini` 的 promptData 本體（以 `'  const promptData = `'` split、同終止符），斷言其同時 includes 全部 5 個表達式字串：`'${result.decision}'`、`'${result.entryPrice}'`、`'${result.stopPrice}'`、`"${result.maGuardPrice ?? '—'}"`、`"${result.guardMaLabel ?? '中長線MA20'}"`；並斷言 promptData 本體與舊檔逐位元相同（零改動證明）。
   - **FUNDAMENTALS 零觸碰**：新舊檔各抽 `FUNDAMENTALS_SYSTEM_INSTRUCTION` 本體，`===` 全等。
4. 全部 PASS 印 `ALL ASSERTIONS PASS`。

**B. 建置與金鑰紅線**（Bash 工具；PowerShell 5.1 沒有 grep）：`npm run build` 成功後 `grep -r "AIza" dist/` 必須無結果。

**C. SUMMARY 素材核對**（寫 SUMMARY 時要涵蓋，此處先確認素材齊全）：
- explicit caching 拒絕理由＋數字（objective 段的粗算：命中省 ~$0.001-0.002/次 vs 儲存 ~$0.005-0.008/hr、回本需 ≥4-5 次/hr、實際流量差兩個數量級、entry SI 低於 1,024 token 門檻、serverless cache name 跨實例查找複雜度）——供 Phase C 驗收者（Sonnet）與使用者覆核 PLAN 機制層偏差。
- implicit caching 依賴前綴穩定、生命週期分鐘級，實際折扣命中之後從帳單／usageMetadata.cachedContentTokenCount 觀察；本包不做花錢的即時驗證呼叫。
- A3 互動結論：同日不同股不同 key 無誤共享；SI 變更舊條目自然 miss 一次。
- 品質人工對照（3-5 檔）屬 Phase C 收尾驗收，不在本包內做。
  </action>
  <verify>
    <automated>cd "/e/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && node "$SCRATCHPAD/verify-c3.cjs" && npm run build && [ "$(grep -r 'AIza' dist/ | wc -l)" -eq 0 ]</automated>
  </verify>
  <done>驗證腳本 ALL ASSERTIONS PASS（trade/health/fundamentals SI 位元組全等、entry SI 零 ${ 且僅 2 行差異、promptData 含 5 值且零改動）；build 成功；dist/ 無 AIza。</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| 規則庫文字 → LLM 行為 | SI 措辭改動即分析品質風險；本包紅線是除 2 行動態指涉外一字不改 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-C3-01 | Tampering | 三個規則庫 SI 內容 | mitigate | Task 2 位元組全等腳本（git show HEAD 比對）；entry 版逐行 diff 限定恰 2 行 |
| T-C3-02 | Info Disclosure | GEMINI_API_KEY 紅線 | mitigate | 不新增套件、api/ 零觸碰；build 後 grep AIza dist/ 無結果 |
| T-C3-SC | Tampering | 套件供應鏈 | accept | 本包零 install（無新依賴），供應鏈面不變 |
</threat_model>

<verification>
- `npx tsc --noEmit` 綠（Task 1 改後即跑）。
- grep 斷言：函式內 `const systemInstruction` 0 處；三個 module 級 SI const 恰 3 處；git 改動僅 services/gemini.ts。
- node 位元組級腳本：trade/health/fundamentals SI 全等、entry SI 零 `${` 且僅 2 行差異、promptData 零改動且含全部 5 個動態值。
- `npm run build` ＋ `grep -r "AIza" dist/` 無結果。
</verification>

<success_criteria>
- 四個 SI 皆 module 級 const、對所有輸入位元組穩定——implicit 前綴快取與 A3 hash 穩定的前提成立。
- entry 分析的資訊對等成立：模型原從 SI 拿到的 5 個動態值，改後全數仍在 promptData（唯一來源），輸出格式指示語意不變。
- 機制層偏差有據可查：PLAN 原文 explicit caching 被拒絕的數字寫進本 PLAN objective 與 SUMMARY，Phase C 驗收者可覆核。
- 紅線全守：api/ 不動、geminiCache 不動、promptData 不動、規則庫文字除 2 行指涉改寫外一字不改、金鑰不進 bundle。
</success_criteria>

<output>
完成後建立 `.planning/quick/260713-buv-c-3-systeminstruction/260713-buv-SUMMARY.md`，必含：explicit caching 拒絕理由與數字、implicit caching 依賴與觀察方式（usageMetadata/帳單，事後觀察不即時花錢驗證）、A3 互動結論、品質人工對照留待 Phase C 收尾驗收。
</output>
