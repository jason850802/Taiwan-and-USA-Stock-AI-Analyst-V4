---
phase: 260711-unf-k-yahoo-ts
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [services/yahoo.ts]
autonomous: true
requirements: [QUICK-260711-unf]

must_haves:
  truths:
    - "含 7/10 平盤假棒（volume=0、O=H=L=C=前收 2415）的日線序列，處理後 7/10 棒被剔除，不進入指標計算"
    - "Yahoo 直接回傳的『非 null』平盤假棒（第二根因）同樣被剔除（走殭屍過濾器，不依賴 _synthetic 標記）"
    - "颱風日 regularMarketTime 停在 7/9＝最後真實棒 → 收緊守衛後不再合成平盤假棒"
    - "正常交易日盤中 regularMarketTime＝今日 > 昨日 → 仍以 regularMarketPrice 合成顯示最新價（原設計保留）"
    - "漲跌停鎖死零成交棒（volume=0 但價≠前收）保留，不被誤殺"
    - "序列第一根（無前一根可比）永不被剔除"
    - "週線/月線（interval=1wk/1mo）不受影響"
    - "npx tsc --noEmit 通過"
  artifacts:
    - path: "services/yahoo.ts"
      provides: "殭屍棒過濾器（getStockData 第4步後、第5步前）＋ 收緊後的最新棒合成守衛（processYahooResult）"
      contains: "interval === '1d'"
  key_links:
    - from: "getStockData 第4步 finalData（FinMind 覆寫後）"
      to: "getStockData 第5步 指標計算（rawCloses/rawHighs/rawLows）"
      via: "殭屍棒過濾器 reassign finalData，介於覆寫與指標計算之間"
      pattern: "volume === 0"
    - from: "processYahooResult 最新棒合成區塊"
      to: "cleanData 最後一根真實棒的日期"
      via: "getExchangeTime(synthTs, ...).dateStr 與 lastClean 日期字串嚴格大小比較"
      pattern: "getExchangeTime"
---

<objective>
修復颱風假（臨時休市日）假 K 棒污染技術指標的問題。改動集中在 `services/yahoo.ts`，
採兩層修法：(1) 主修「殭屍棒」過濾器（台美股通用，捕捉 App 合成與 Yahoo 直接回傳兩種假棒）；
(2) 收緊最新棒合成守衛（防止一開始就造出平盤假棒）。

Purpose: 颱風臨時休市日 Yahoo 依交易所行事曆回傳 null 棒或非 null 平盤棒（O=H=L=C=前收、量0），
使 KD/MACD/RSI/布林/均線全部指標被平盤日污染，客觀進場判斷失真。此為資料完整性（Tampering）風險。
Output: `services/yahoo.ts` 內兩處邏輯改動 ＋ 一次性 Node 驗證（用完即刪）。
</objective>

<execution_context>
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/workflows/execute-plan.md
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@services/yahoo.ts

# 診斷已完成並實測驗證（見任務規劃 CONTEXT），本計畫直接採用其修法規格，勿重新偵查。
# 重點行號（規劃時實讀確認）：
#   - processYahooResult 最新棒合成區塊：services/yahoo.ts:384-434
#   - null 過濾守衛（第二根因假棒由此通過）：services/yahoo.ts:356
#   - getStockData 第4步 FinMind 覆寫 + finalData 收尾：services/yahoo.ts:652-689
#   - getStockData 第5步 指標計算入口：services/yahoo.ts:691-714
#   - 日期轉換既有函式（沿用確保時區一致）：getExchangeTime / formatExchangeDate
</context>

<tasks>

<task type="auto">
  <name>Task 1: getStockData 第4步後新增日線「殭屍棒」過濾器（主修·台美股通用）</name>
  <files>services/yahoo.ts</files>
  <action>
在 `getStockData` 內、第4步 `finalData` map（約 services/yahoo.ts:689 結束）之後、
第5步指標計算（約 services/yahoo.ts:691 `const rawCloses = ...`）之前，插入日線殭屍棒過濾器，
並把 `finalData` 重新指派為過濾後的序列（後續指標計算與 fullProcessedData map 都吃 finalData，
在此處過濾即可一次涵蓋，索引自然對齊）。

過濾規則（鎖定規格，逐條照做）：
- 僅在 `interval === '1d'` 時執行；週線/月線/盤中（1wk/1mo/60m/15m）不處理，維持原序列。
- 依序掃描 finalData，追蹤「上一根被保留的棒」（prevKept）。判定當前棒為殭屍棒即剔除：
  `bar.volume === 0 && bar.open === bar.high && bar.high === bar.low && bar.low === bar.close && bar.close === prevKept.close`。
  以原始欄位（open/high/low/close/volume）比較，勿用 Adj 欄位。
- 序列第一根無 prevKept → 永遠保留，絕不剔除。
- 追蹤「上一根被保留的棒」而非原陣列前一根，以正確處理連續多根殭屍棒（如連兩天休市）的邊界。

放置理由（寫入繁中註解）：必須在 FinMind 覆寫（第4步）之後執行，確保 FinMind 有真實 OHLC/量的日期
已先被覆寫成真值、不會被誤殺；颱風日 FinMind 無資料列（乾淨）→ 該棒維持 volume=0＋平盤 → 命中剔除。
此過濾器同時捕捉兩種假棒：App 用 regularMarketPrice 合成的 `_synthetic` 平盤棒（步驟4 已 delete 標記），
以及 Yahoo 直接回傳、通過 services/yahoo.ts:356 null 守衛的「非 null」平盤棒（第二根因）。

已知可接受邊界（寫入註解，使用者已確認接受）：極冷門股「真實零成交日」（參考價＝前收）也會被剔除——
無成交即無資訊，對指標更正確；漲跌停鎖死零成交棒（價≠前收，close !== prevKept.close）不受影響、保留。

註解沿用 services/yahoo.ts 既有繁中風格與命名。
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>finalData 在第5步前被重新指派為過濾後序列；過濾僅限 interval==='1d'；判定以 prevKept.close 比較、第一根永不剔除；tsc 通過無新錯誤。</done>
</task>

<task type="auto">
  <name>Task 2: processYahooResult 收緊最新棒合成守衛（防止造出平盤假棒）</name>
  <files>services/yahoo.ts</files>
  <action>
在 `processYahooResult` 的「最新一根 null-close 合成補值」區塊（services/yahoo.ts:384-434）內，
於既有守衛（closes[lastIdx]===null、rmp 有效、timestamp 去重）之外，新增一道「日期必須前進」守衛：
只有當合成棒的日期嚴格晚於序列最後一根真實（非 null）棒的日期時，才允許合成。

實作要點：
- 最後一根真實棒＝`cleanData` 陣列最後一個元素（cleanData 只含通過 null 守衛的真實棒），取其 `rawDateStr`（YYYY-MM-DD）。
- 合成棒候選日期：以 `getExchangeTime(synthTs, meta.exchangeTimezoneName, isTaiwanStock).dateStr` 取得
  （沿用區塊內約 services/yahoo.ts:404-405 已在用的同一套轉換，確保台北/紐約時區一致；勿另造轉換）。
- 新條件：僅當 `synthRawDateStr > lastClean.rawDateStr`（YYYY-MM-DD 字典序＝時序）才 push 合成棒。
- 邊界：若 `cleanData` 為空（無真實棒可比）→ 維持原合成行為（保留現況，不因此退化）。
- 與既有去重守衛（`!lastClean || lastClean.timestamp !== synthTs`）合併，不要移除原有任何守衛。

情境驗證（寫入繁中註解）：
- 颱風日：regularMarketTime 停在 7/9（＝最後真實棒 7/9），synth 日期 7/9 不嚴格晚於 7/9 → 不合成 ✓。
- 正常盤中：regularMarketTime＝今日 > 昨日（最後真實棒）→ 合成，儀表板顯示最新價（原設計保留）✓。

註解沿用既有繁中風格；此為縱深防禦——即使漏網，Task 1 殭屍過濾器仍會兜底剔除平盤棒。
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>合成區塊新增「synth 日期須嚴格晚於最後真實棒日期」守衛，且日期字串經同一 getExchangeTime 轉換取得；原有守衛全數保留；tsc 通過無新錯誤。</done>
</task>

<task type="auto">
  <name>Task 3: 一次性 Node 驗證（模擬序列 + 若可行實測 Yahoo 回應）</name>
  <files>（暫存腳本，放 scratchpad，用完即刪；不新增 repo 檔案）</files>
  <action>
建立一支暫存 Node ESM 腳本於 scratchpad
（C:\Users\jason\AppData\Local\Temp\claude\E--My-Project-Taiwan-and-USA-Stock-AI-Analyst-V4\...\scratchpad\verify-zombie.mjs），
複製 Task 1 殭屍棒判定謂詞與 Task 2「日期前進」判定謂詞（純函式、無外部相依），餵入模擬序列斷言：

(a) 7/10 平盤假棒（volume=0、O=H=L=C=2415、前一根 7/9 close=2415）→ 被剔除。
(b) 正常有量漲/跌棒 → 保留。
(c) 漲跌停鎖死零成交棒（volume=0、O=H=L=C=同一價，但價≠前收）→ 保留。
(d) 序列第一根即使平盤零量 → 保留（無前根可比）。
(e) 日期守衛：synth 日期＝最後真實棒日期（颱風情境）→ 不合成；synth 日期 > 最後真實棒日期（正常盤中）→ 合成。

每條斷言失敗即 process.exit(1) 並印出哪一條失敗；全數通過印 "PASS" 並 exit 0。

若環境可連網／代理可用，額外對 2330.TW range=5d（已知含 7/10 假棒）的真實 Yahoo 回應跑一次判定確認剔除；
若不可行則略過此步、僅以模擬斷言為準（不阻塞）。

跑完刪除暫存腳本（用完即刪）。CLAUDE.md 環境注意：用 Bash 工具跑 node（PowerShell 5.1 無 grep、無 &&）。
  </action>
  <verify>
    <automated>node "C:/Users/jason/AppData/Local/Temp/claude/E--My-Project-Taiwan-and-USA-Stock-AI-Analyst-V4/6e9ca77a-2d70-44e1-a828-7b4e94ed6dfb/scratchpad/verify-zombie.mjs"</automated>
  </verify>
  <done>模擬斷言 (a)-(e) 全數通過（腳本印 PASS、exit 0）；npx tsc --noEmit 亦通過；暫存腳本已刪除。</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Yahoo chart API → App | 非官方端點回傳的 K 棒序列為不受信輸入；交易所行事曆可能塞入臨時休市日的幻影平盤棒（null 或非 null）。 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260711-01 | Tampering | Yahoo 回傳的休市日平盤棒進入指標計算（services/yahoo.ts getStockData 第5步輸入） | mitigate | Task 1 殭屍棒過濾器：第4步後、第5步前剔除 volume=0 且 O=H=L=C=前收之日線棒，兩種假棒（App 合成／Yahoo 非 null）皆兜底。 |
| T-260711-02 | Tampering | App 用 regularMarketPrice 合成的平盤棒（services/yahoo.ts:384-434） | mitigate | Task 2 收緊守衛：僅當 synth 日期嚴格晚於最後真實棒日期才合成，颱風日不產生假棒。 |

無 npm/pip/cargo 套件安裝、無新外部服務、無新金鑰 → 不需要 T-260711-SC 供應鏈檢查點。
</threat_model>

<verification>
- `npx tsc --noEmit` 通過，無新增型別錯誤（用 Bash 工具跑）。
- 暫存 Node 腳本模擬斷言 (a)-(e) 全數通過。
- 前端介面與分析行為契約不變：`StockDataPoint[]` 型別零變動；週線/月線/盤中序列不受過濾器影響。
- 正常盤中最新價顯示（regularMarketPrice 合成）在「日期前進」情境下維持原行為。
</verification>

<success_criteria>
- 含 7/10 颱風平盤假棒的日線序列，經處理後 7/10 棒被剔除，KD/MACD/RSI/布林/均線不再被污染。
- Yahoo 直接回傳的非 null 平盤假棒同樣被剔除（不依賴 _synthetic 標記）。
- 颱風日不再合成平盤假棒；正常交易日盤中仍以 regularMarketPrice 顯示最新價。
- 漲跌停零成交棒（價≠前收）保留；序列首棒不被誤殺。
- `npx tsc --noEmit` 與模擬驗證腳本皆通過。
</success_criteria>

<output>
Create `.planning/quick/260711-unf-k-yahoo-ts/260711-unf-SUMMARY.md` when done
</output>
