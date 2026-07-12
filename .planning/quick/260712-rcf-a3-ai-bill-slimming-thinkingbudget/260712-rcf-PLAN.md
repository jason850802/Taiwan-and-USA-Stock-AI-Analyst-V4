---
phase: quick-260712-rcf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [services/gemini.ts, services/_shared/geminiCache.ts]
autonomous: true
requirements: [OPT-A3]

must_haves:
  truths:
    - "同 mode＋同台北日期＋同 systemInstruction＋prompt 的重複分析呼叫命中 localStorage 快取直接回傳，0 次 /api/gemini fetch；輸入任一字元變動（行情變→prompt 變）hash 即變、自動失效"
    - "localStorage 不可用（隱私模式/配額滿/解析失敗）時完全退化為現行為（直接打 API），不拋錯、不影響分析結果"
    - "analyzeStockWithGemini 與 formatPromptData 全 repo 零引用（已刪 ~237 行）；VolumeProjectionInfo 介面保留（PortfolioHealthItem 仍使用）"
    - "三處 flash thinkingBudget 硬編（8192／10240／8192）統一為單一具名常數 FLASH_THINKING_BUDGET = 4096（單一定義處）"
    - "UI 零改動：不加「重新分析」按鈕；Portfolio.tsx 一行不動（批次健檢明確延到 Phase C）"
    - "npx tsc --noEmit 通過；npm run build 後 grep -r \"AIza\" dist/ 無結果"
  artifacts:
    - path: "services/_shared/geminiCache.ts"
      provides: "fnv1aHash / taipeiTodayStr / buildCacheKey / readCache / writeCache——零 import 純模組（可用 esbuild 轉 CJS 後 node 直測）"
      exports: ["fnv1aHash", "taipeiTodayStr", "buildCacheKey", "readCache", "writeCache"]
    - path: "services/gemini.ts"
      provides: "callGeminiApi 咽喉點快取整合＋FLASH_THINKING_BUDGET 常數；死碼已刪"
      contains: "FLASH_THINKING_BUDGET"
  key_links:
    - from: "services/gemini.ts"
      to: "services/_shared/geminiCache.ts"
      via: "import { buildCacheKey, readCache, writeCache, taipeiTodayStr }"
      pattern: "from '\\./_shared/geminiCache'"
    - from: "callGeminiApi"
      to: "readCache"
      via: "fetch 之前先查快取，命中直接 return"
      pattern: "readCache\\("
    - from: "callGeminiApi"
      to: "writeCache"
      via: "API 成功且 data.text 非空才寫入（不快取 fallbackText、不快取錯誤）"
      pattern: "writeCache\\("
    - from: "analyzeTradeDecision / analyzePortfolioHealth / analyzeFundamentals"
      to: "FLASH_THINKING_BUDGET"
      via: "thinkingConfig 引用常數"
      pattern: "thinkingBudget:\\s*FLASH_THINKING_BUDGET"
---

<objective>
A3（P4B）AI 帳單瘦身三件套：刪 gemini.ts 死碼（~237 行）、在 callGeminiApi 單一咽喉點加透明分析結果快取（UI 零改動）、flash thinkingBudget 統一降為具名常數 4096。

Purpose: .planning/optimization/PLAN.md §A3 鎖定規格（本 PLAN 依交辦 constraints 的更新版裁決執行，兩點與總計畫原文不同，見 <decisions>）；不換供應商即降 Gemini 帳單——同日重複分析 0 計費、thinking tokens 減半以上。
Output: services/gemini.ts＋新檔 services/_shared/geminiCache.ts，2 個原子 commit（Task 1 刪碼／Task 2 快取＋常數），Task 3 純驗證不產碼。
</objective>

<context>
@.planning/optimization/PLAN.md          # §A3 為本任務範圍；下方 <decisions> 對其中兩點有更新裁決
@services/gemini.ts                      # 主要修改檔（1136 行，規劃時已完整實讀）
@services/finmind.ts                     # 僅參考 :62-72 taipeiTodayStr 的 Intl 實作模式（module-private，不可直接 import）
</context>

<decisions>
本 PLAN 依交辦 constraints 的更新版裁決，覆蓋總計畫 §A3 原文兩點：

1. **不做「重新分析」按鈕**（總計畫原文有）：prompt 內含最新行情算出的濾網結論／K 棒數列，
   資料一變 hash 即變、快取自動失效；hash 相同代表輸入完全相同，重打必然得到語意相同的報告，
   純屬重複計費。故快取命中直接回傳即可——不需 force 選項、不改任何 UI。
2. **批次健檢明確延到 Phase C**（總計畫原文為「評估」）：現行從自由文字用 regex 抓決策
   （Portfolio.tsx:965），多檔合併回應會讓解析更脆弱；Phase C 做 JSON 結構化輸出時一起做。
   本包不動 Portfolio.tsx。此裁決須寫進 SUMMARY。

規劃時偵察發現的規格外事實（執行者須知）：

3. **thinkingBudget 硬編實際有三處**，非規格所列兩處：:722-724（analyzeTradeDecision, 8192）、
   :1041-1043（analyzePortfolioHealth, 10240）、**:1131-1134（analyzeFundamentals, 8192——
   基本面功能於規格撰寫後才合併）**。三處全部統一為 FLASH_THINKING_BUDGET = 4096，
   與規格「統一改為具名常數（單一定義處）」的意圖一致；此 delta 寫進 SUMMARY。
4. **VolumeProjectionInfo（:38-44）不可刪**：PortfolioHealthItem.volumeProjection（:737）與
   formatHealthCheckData 仍使用；死碼刪除範圍是 :46-282（formatPromptData＋analyzeStockWithGemini）。
5. 刪碼後四個既有 import（StockDataPoint／TwFundamentals／EntryFilterResult／proxyHeaders）
   均仍被存活函式使用，規劃時已逐一確認——執行者仍須 grep 復核（tsconfig 非 strict，tsc 不會抓未用 import）。
6. 基本面面板（FundamentalsPanel.tsx）既有記憶體快取與本層並存無害，不要動它；
   analyzeFundamentals 走 callGeminiApi 亦自然受惠於本快取層，屬預期行為。
</decisions>

<tasks>

<task type="auto">
  <name>Task 1: 刪死碼 analyzeStockWithGemini＋formatPromptData（保留 VolumeProjectionInfo）</name>
  <files>services/gemini.ts</files>
  <action>
1. 先復核死碼事實（規劃時已確認，執行時重跑）：
   `grep -rn "analyzeStockWithGemini\|formatPromptData" --include="*.ts" --include="*.tsx" --include="*.html" .`
   ——結果必須只有 services/gemini.ts 內的 :46（定義）、:207（定義）、:214（內部呼叫）三筆，
   無任何外部 import/呼叫。若出現其他引用，停止並回報，不得硬刪。
2. 刪除 :46-282：`formatPromptData`（:46-205）＋ `analyzeStockWithGemini`（:207-282，含 :206 空行）。
   **保留 :38-44 的 `interface VolumeProjectionInfo`**（PortfolioHealthItem 仍用）。
   :37 註解 `// Helper to format data for the prompt` 描述的是被刪函式，改寫為描述
   VolumeProjectionInfo 的用途（盤中量能預估資訊，供健檢 prompt 使用）。
3. 復核 import 是否有隨之未使用：對 StockDataPoint／TwFundamentals／EntryFilterResult／proxyHeaders
   逐一 grep 檔內剩餘使用處（規劃結論：四者皆仍被 analyzeTradeDecision／analyzeFundamentals／
   analyzeEntryWithGemini／callGeminiApi 使用，應全部保留）。
4. 原子 commit（只 stage services/gemini.ts）：`refactor(quick-260712-rcf): 刪除 gemini.ts 死碼 analyzeStockWithGemini＋formatPromptData（~237 行）`
  </action>
  <verify>
    <automated>npx tsc --noEmit 通過；grep -rn "analyzeStockWithGemini\|formatPromptData" --include="*.ts" --include="*.tsx" . 零筆結果</automated>
  </verify>
  <done>gemini.ts 少 ~237 行；VolumeProjectionInfo 與四個 import 保留；tsc 過；全 repo 零引用</done>
</task>

<task type="auto">
  <name>Task 2: callGeminiApi 透明快取層＋FLASH_THINKING_BUDGET = 4096</name>
  <files>services/_shared/geminiCache.ts, services/gemini.ts</files>
  <action>
**A. 新檔 services/_shared/geminiCache.ts——零 import 純模組**（零依賴是硬需求：Task 3 要用
esbuild 轉 CJS 後 node 直測；localStorage 只能在函式內部觸碰並以 `typeof localStorage === 'undefined'`
守衛，模組頂層不得存取，否則 node 載入即炸）：

- `export const CACHE_PREFIX = 'gemini_cache_v1|';`、`const MAX_ENTRIES = 50;`
- `export function fnv1aHash(str: string): string`——FNV-1a 32-bit：offset basis 0x811c9dc5，
  逐字元 `hash ^= charCode; hash = Math.imul(hash, 0x01000193);`，最後 `(hash >>> 0).toString(16)`。
  ~10 行、不加依賴（規格鎖定）。
- `export function taipeiTodayStr(): string`——回傳台北時區 YYYY-MM-DD；比照 services/finmind.ts:62-72
  的 Intl.DateTimeFormat formatToParts 實作（該函式 module-private 不可 import，為保持本模組
  零依賴故自帶一份，SUMMARY 註明鏡像來源）。
- `export function buildCacheKey(mode: string, dateStr: string, systemInstruction: string, prompt: string): string`
  ——回傳 `` `${CACHE_PREFIX}${mode}|${dateStr}|${fnv1aHash(systemInstruction + ' ' + prompt)}` ``
  （key 設計為鎖定規格；dateStr 由呼叫端注入而非內部取當日，讓「日期參與 key」可被 node 斷言）。
- `export function readCache(key: string): string | null`——整體 try/catch：localStorage 不存在→null；
  `getItem` 後 `JSON.parse` 出 `{text, ts}`，`typeof text === 'string' && text.length > 0` 才回傳 text，
  否則一律 null（含 parse 失敗）。
- `export function writeCache(key: string, text: string): void`——整體 try/catch、失敗靜默放棄：
  1. 先收集所有 CACHE_PREFIX 開頭的 key（先 for-loop `localStorage.key(i)` 收進陣列、再刪，
     不可邊迭代邊刪）；key 以 `|` split 後 index 2 為日期段，凡日期段 ≠ 今日（taipeiTodayStr()）
     一律 removeItem（跨日順手清，鎖定規格）。
  2. `setItem(key, JSON.stringify({ text, ts: Date.now() }))`；若丟 quota 錯誤，
     依 ts 淘汰最舊一筆後重試一次，再失敗即放棄。
  3. 寫入後若同 prefix 條目數 > MAX_ENTRIES(50)，依 ts 升冪淘汰最舊直到 ≤ 50（鎖定規格）。

**B. services/gemini.ts 整合**（Task 1 刪碼後行號已位移，以 pattern 搜尋定位，不可用舊行號）：

- 頂部 import：`import { buildCacheKey, readCache, writeCache, taipeiTodayStr } from './_shared/geminiCache';`
- `callGeminiApi` 內、`fetch('/api/gemini', ...)` 之前：
  `const cacheKey = buildCacheKey(payload.mode, taipeiTodayStr(), payload.systemInstruction, payload.prompt);`
  `const cached = readCache(cacheKey); if (cached) return cached;`
- fetch 成功路徑：僅當 `response.ok` 且 `data.text` 為非空字串時 `writeCache(cacheKey, data.text);`
  ——**不快取 fallbackText、不快取錯誤**（空回應/失敗快取一整天會把壞結果釘死）。
  回傳邏輯 `data.text || fallbackText` 不變。
- readCache/writeCache 自身已全 try/catch，storage 不可用時整條路徑退化為現行為（直接打 API）——
  這是 must_have，不可讓快取層任何錯誤外洩到呼叫端。

**C. FLASH_THINKING_BUDGET 常數**（同檔）：

- 在 GeminiApiPayload 型別附近加：
  `const FLASH_THINKING_BUDGET = 4096; // flash 模式 thinking tokens 上限（計費項），統一單點調整`
- 以 pattern 搜尋 `thinkingBudget:` 定位三處硬編並全部改為 `thinkingBudget: FLASH_THINKING_BUDGET`：
  analyzeTradeDecision（原 8192）、analyzePortfolioHealth（原 10240）、analyzeFundamentals（原 8192）。
  改完 `grep -n "thinkingBudget" services/gemini.ts` 應恰好 4 筆：型別宣告 1＋常數引用 3，
  且 8192/10240 字面量零殘留。
- analyzeEntryWithGemini 用的是 `thinkingLevel: 'MEDIUM'` 無 thinkingBudget，不動。

不要動：components/Portfolio.tsx（批次健檢延 Phase C，見 <decisions> 2）、
components/FundamentalsPanel.tsx 記憶體快取（<decisions> 6）、api/ 後端任何檔案。

原子 commit（只 stage services/gemini.ts 與 services/_shared/geminiCache.ts）：
`feat(quick-260712-rcf): callGeminiApi 透明分析快取（同日同輸入 0 重複計費）＋thinkingBudget 統一降至 4096`
  </action>
  <verify>
    <automated>npx tsc --noEmit 通過；grep -n "thinkingBudget" services/gemini.ts 恰 4 筆且無 8192/10240 殘留；grep -n "readCache\|writeCache" services/gemini.ts 各至少 1 筆</automated>
  </verify>
  <done>快取命中直接回傳、未命中打 API 且僅非空 text 寫入；storage 失敗全退化；三處 budget 統一為常數 4096；UI 檔案零 diff</done>
</task>

<task type="auto">
  <name>Task 3: 驗證套件——node 直測 hash/key、tsc、build＋金鑰紅線 grep</name>
  <files>（不改任何 repo 檔案；臨時檔一律放 session scratchpad 目錄）</files>
  <action>
1. **node 直測 hash/key**（geminiCache.ts 零 import，單檔轉譯即可）：
   - `npx esbuild services/_shared/geminiCache.ts --format=cjs --outfile="<scratchpad>/geminiCache.cjs"`
   - 在 scratchpad 寫 assert 腳本 `node <scratchpad>/test-cache.cjs`，require 上述 CJS，斷言：
     a. 同 (mode, date, systemInstruction, prompt) 呼叫 buildCacheKey 兩次結果相同（同 key 穩定）；
     b. prompt 差一字元 → key 不同；systemInstruction 差一字元 → key 不同；
     c. mode 'fast' vs 'thinking' → key 不同；
     d. date '2026-07-12' vs '2026-07-13' → key 不同（日期參與 key）；
     e. key 格式符合 /^gemini_cache_v1\|(fast|thinking)\|\d{4}-\d{2}-\d{2}\|[0-9a-f]+$/；
     f. taipeiTodayStr() 符合 /^\d{4}-\d{2}-\d{2}$/；
     g. node 環境（無 localStorage）下 readCache('任意key') 回傳 null 且不拋錯（退化路徑）。
   全部通過印 PASS；任一失敗即修 geminiCache.ts 後重跑。
2. **死碼零引用**：`grep -rn "analyzeStockWithGemini\|formatPromptData" --include="*.ts" --include="*.tsx" .` 零筆。
3. **tsc**：`npx tsc --noEmit` 通過。
4. **金鑰紅線**（用 Bash 工具跑，PowerShell 5.1 無 grep）：`npm run build` 後
   `grep -r "AIza" dist/`——必須無任何輸出（grep exit code 1 即乾淨；有輸出立即停止並回報，紅線違反）。
5. 臨時檔留在 scratchpad，不進 repo、不 commit。
  </action>
  <verify>
    <automated>node 斷言腳本全 PASS；npx tsc --noEmit 通過；npm run build 成功且 grep -r "AIza" dist/ 無輸出；死碼 grep 零筆</automated>
  </verify>
  <done>五項驗證全綠；工作樹除本任務兩檔＋.planning 產物外零額外變更（git status 確認未觸碰既有未提交的舊 SUMMARY）</done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` 通過（每個 commit 前）。
- `npm run build` ＋ `grep -r "AIza" dist/` 無結果（金鑰紅線，Bash 工具）。
- node 直測：同 key 穩定／不同 prompt、systemInstruction、mode、date 皆不同 key／無 localStorage 環境 readCache 安全回 null。
- 死碼 `analyzeStockWithGemini`／`formatPromptData` 全 repo 零引用。
- `git diff --stat` 只含 services/gemini.ts 與 services/_shared/geminiCache.ts（＋.planning 產物）；
  Portfolio.tsx／FundamentalsPanel.tsx 零 diff。
- （選配人工抽查，非阻斷）preview 起 3001 對同一標的連按兩次分析：第二次即時回傳、
  Network 面板 /api/gemini 僅 1 次請求；隔日或行情更新後自動重打。
</verification>

<success_criteria>
- 同日同輸入的重複分析呼叫 0 次 API 計費（快取命中直接回傳），輸入變動自動失效，UI 零改動。
- flash thinking tokens 上限由 8192/10240 統一降為 4096，單一常數定義處。
- gemini.ts 淨減 ~237 行死碼，無殘留引用、無未使用 import。
- 批次健檢延 Phase C 的裁決與 thinkingBudget 第三處（analyzeFundamentals）delta 均記入 SUMMARY。
- Git 紀律：2 個原子 commit，只 stage 本任務檔案，絕不 git add -A；
  工作樹既有的 .planning 舊 SUMMARY 未提交變更一概不觸碰。
</success_criteria>

<output>
完成後建立 `.planning/quick/260712-rcf-a3-ai-bill-slimming-thinkingbudget/260712-rcf-SUMMARY.md`，
必須包含：<decisions> 1（免「重新分析」按鈕的理由全文）、<decisions> 2（批次健檢延 Phase C）、
<decisions> 3（第三處 thinkingBudget 的規格外 delta）、快取層設計摘要（key 格式／50 筆上限／
跨日清理／退化行為）與五項驗證結果。
</output>
