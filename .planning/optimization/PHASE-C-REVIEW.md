# Phase C 覆核報告（Sonnet）

**Diff 範圍：** `git diff ab9326d..HEAD -- . ':!.planning'`（6 檔：api/_lib/llm.ts 新、api/gemini.ts、.env.example、services/_shared/healthDecision.ts 新、services/gemini.ts、components/Portfolio.tsx）
**日期：** 2026-07-13

## 三包總判定

| 包 | 判定 |
|---|---|
| C-1（LLM provider adapter＋claude-cli 訂閱橋接） | **ACCEPT_WITH_NOTES** |
| C-2（健檢決策 JSON 化＋一鍵批次健檢） | **ACCEPT_WITH_NOTES** |
| C-3（systemInstruction 靜態化＋explicit caching 拒絕裁定） | **ACCEPT** |

1 個 CRITICAL（C-1：claude-cli 子程序在 spawn 失敗時，`child.stdin.write` 缺 error 監聽器，可能拋出未捕捉例外打死整個 vercel dev 主程序，且探索快取永不失效會讓「app 更新換版本目錄」直接導向此崩潰路徑）、1 個 HIGH（C-2：批次健檢資料準備若任一檔 `getStockData` 失敗／回傳空陣列，會讓 `formatHealthCheckData` 對 `undefined.close` 擲出例外，導致**整批**（含所有正常抓到資料的持股）全部判定為分析失敗，而非誠實降級成單檔失敗——直接牴觸 PLAN／SUMMARY 宣稱的「一檔失敗不拖累整批」）、2 個 MEDIUM（C-1：env 清洗未涵蓋 `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`，可能悄悄讓 claude-cli 改走 API Key 計費而非訂閱、違反本包核心目的且無錯誤徵兆；C-2：單檔健檢與批次健檢對同一 symbol 同時在飛行中缺乏序號/世代守衛，較晚落地者會覆蓋較早落地者的 healthResults，可能讓畫面顯示過期但仍有效的分析結果）。C-3 讀碼深挖後未發現新缺陷，機制層偏差（拒絕 explicit caching）裁定站得住腳。

---

## Findings（依嚴重度）

### CRITICAL

**CR-01｜C-1｜`api/_lib/llm.ts:229-230`（`callClaudeCli` 寫入 `child.stdin`）與 `:70-130`（`findClaudeExecutable` 探索快取）——spawn 失敗時 `child.stdin` 缺 error 監聽器，可能拋出未捕捉例外打死 vercel dev 主程序**

問題：`callClaudeCli` 呼叫 `spawn(exePath, args, {...})` 後，緊接著同步執行：

```ts
child.stdin.write(req.prompt);
child.stdin.end();
```

程式碼只對 `child` 本身掛了 `child.on('error', ...)`（:219-226），但從未對 `child.stdin`（一個獨立的 Writable/Socket EventEmitter）掛任何 `error` 監聽器。Node.js 的 `child_process.spawn` 在 `shell:false` 模式下，stdio pipe 物件（`child.stdin`/`stdout`/`stderr`）是在**呼叫 spawn 的當下同步建立**的，但底層 OS 行程是否真的成功啟動要到**下一個 tick（甚至更晚）** 才知道（libuv 非同步回報 spawn 結果）。若該次 spawn 因任何原因失敗（見下方觸發情境），Node 會在確認失敗後 destroy 這些 stdio handle；此時若 `child.stdin` 已被寫入且沒有掛 `error` 監聽器，寫入端會收到一個獨立於 `child` 的 `'error'`（常見訊息如 `EPIPE`／`ECONNRESET`）——EventEmitter 對「emit `'error'` 但無監聽器」的預設行為是**同步 throw**，若無外層 `try/catch` 攔截（此處是非同步事件迴圈內的 throw，無法被呼叫端的 `try/catch` 捕捉），會直接讓整個 Node 行程（即本機 `vercel dev`）當機——**不是這次呼叫失敗，是整台開發伺服器掛掉**，所有正在服務中的其他請求（不論走 gemini-api 或 claude-cli）一併中斷。

觸發情境並非純理論：
1. **TOCTOU**：`findClaudeExecutable()` 用 `fs.existsSync(candidate)` 判斷可執行檔存在，但存在檢查與實際 `spawn()` 呼叫之間仍有極短視窗，防毒軟體隔離、檔案被移動/刪除、權限被拒（EACCES）等都可能讓 `existsSync` 通過但 `spawn` 仍失敗。
2. **探索快取永不失效**（`cachedClaudeCliPath` 為 module 級變數，:70）：只在同一 `vercel dev` 長駐行程內探索一次、之後永久重用。若使用者在該行程存活期間更新了 Claude Code app（版本目錄從 `2.1.205` 換成新版目錄，舊目錄可能被解除安裝程式移除），快取路徑立即變成失效路徑，之後**每一次**呼叫都會走上這條 spawn 失敗路徑——即本次 SUMMARY 自己在風險清單中提及的「app 更新換版本目錄後長駐程序快取失效」，但程式碼沒有任何重探索或錯誤降級機制，直接命中本 finding 的崩潰路徑。
3. C-1 SUMMARY 記載的三個直測情境（無 provider／無效值／claude-cli 未登入）全部是「`findClaudeExecutable()` 成功找到執行檔、CLI 本身正常啟動並回報『未登入』」的路徑，**沒有任何情境真正演練『executable 存在但 spawn 失敗』**，因此這個崩潰路徑完全未被驗證覆蓋到。

**建議修法：**
```ts
const child = spawn(exePath, args, { cwd: os.tmpdir(), env: buildChildEnv(), windowsHide: true });

// 補：任何 stdio stream 的 error 都不能無人接手
child.stdin.on('error', () => { /* 由 child 的 'error'/'close' 負責收斂結果，這裡只防止未捕捉例外 */ });
child.stdout.on('error', () => {});
child.stderr.on('error', () => {});
```
並考慮讓 `findClaudeExecutable()` 的快取具備一次性重試能力（例如：spawn 的 `error` 事件若判定為 `ENOENT`，清空 `cachedClaudeCliPath` 並在下一次呼叫重新探索一次），避免版本更新後長駐行程永久卡死在錯誤路徑。

---

### HIGH

**H-1｜C-2（跨 services/gemini.ts＋components/Portfolio.tsx）｜`services/gemini.ts:516-625`（`formatHealthCheckData`）×`components/Portfolio.tsx:947-953`（`buildHealthItem` 的 catch）——批次健檢中任一檔資料抓取失敗，會讓整批（含所有正常持股）全部判定為分析失敗**

問題：`buildHealthItem` 對 `getStockData`/`estimateVolumeTrend` 的呼叫包了 `try/catch`，失敗時「continue without data」，讓 `recentData` 維持初始值 `[]`（Portfolio.tsx:947-953）：

```ts
let recentData: StockDataPoint[] = [];
let volProj = null;
try {
  const { data } = await getStockData(symbol, '1d');
  recentData = data;
  volProj = estimateVolumeTrend(data, isTwStock(symbol), '1d');
} catch { /* continue without data */ }
```

這個「安全退化」的假設在 `formatHealthCheckData`（services/gemini.ts:516 起）並不成立：

```ts
const last15 = item.recentData.slice(-15);
const latest = item.recentData[item.recentData.length - 1];   // recentData=[] → undefined
const prev = item.recentData[item.recentData.length - 2];     // undefined（安全，下方有 prev && 守衛）
...
const isRedCandle = latest.close > latest.open;   // ← latest 是 undefined，這裡直接 TypeError
```

當 `item.recentData` 為空陣列時，`latest` 是 `undefined`，隨後 `latest.close`／`latest.open` 存取會同步擲出 `TypeError: Cannot read properties of undefined`。這個例外發生在 `analyzePortfolioHealth` 內部（`formatHealthCheckData` 是該函式呼叫 `callGeminiApi` **之前**的同步步驟），因此會讓整個 `analyzePortfolioHealth(...)` 呼叫直接 reject。

批次路徑（`handleBatchHealthCheck`，Portfolio.tsx:999-1046）把「資料準備」與「單一次 LLM 呼叫」包在同一個 `try { ... } catch { 全部設 error }` 區塊內：只要**任何一檔**（可能是持股清單中的第 7 檔，其餘 9 檔資料都正常）的 `getStockData` 因 429／逾時／網路錯誤而失敗（`buildHealthItem` 吞掉錯誤、留下 `recentData=[]`），最終傳給 `formatHealthCheckData` 的陣列中就會有一個 `recentData.length===0` 的項目，導致 `analyzePortfolioHealth` 拋錯，被批次的外層 `catch` 攔截，**把全部持股（包含資料完全正常的那些）一併標記為「分析失敗」**。

這直接牴觸：
- PLAN.md／2am-PLAN 的「批次資料準備 getStockData 併發上限 3」條款的隱含前提（限制併發是為了降低整批被 429 拖垮的機率，但沒有真正做到「單檔降級不拖累整批」）；
- CLAUDE.md 自己記載的既有事實「FinMind 429 是常態」——這代表批次健檢在真實使用情境下，只要持股數稍多（>3 檔會觸發併發、增加同時打 API 的機率），整批分析失敗的機率並不低；
- 本次覆核任務要求特別核驗的問題「單檔 getStockData 失敗對整批的影響（一檔失敗全批死還是誠實降級）」——答案是**全批死**，不是誠實降級。

註：此崩潰路徑的根因（`formatHealthCheckData` 假設 `recentData` 非空）是**既有程式碼**（C-2 對 `formatHealthCheckData` 本身零改動），單檔健檢原本就有同樣的潛在崩潰點，但影響範圍僅限該單一持股（使用者重試即可）。C-2 新增的批次功能把這個既有的潛在崩潰點的**爆炸半徑從 1 檔放大到全部持股**，且 PLAN／SUMMARY 明確要求批次功能要能「誠實降級」，故列為本次交付範圍內的 HIGH。

**建議修法：** 在 `formatHealthCheckData` 對每個 item 做防禦：
```ts
return items.map((item, idx) => {
  if (item.recentData.length === 0) {
    return `\n========== 持股 ${idx + 1}：${item.name}（${item.symbol}）==========\n（技術面資料暫時無法取得，本次僅能依基本資訊裁定，若近期無明顯風險建議標記為續抱並提示使用者稍後重試）\n`;
  }
  ...
});
```
或在 `buildHealthItem` 層面：資料抓取失敗時直接回傳 `null`（比照 `lots.length===0` 的既有 null 語意），呼叫端把該 symbol 從 `healthItems` 中排除、並單獨標記該 symbol 為「資料取得失敗，請稍後重試」而非讓它混進送給 LLM 的陣列、拖垮整批。

---

### MEDIUM

**M-1｜C-1｜`api/_lib/llm.ts:156-166`（`buildChildEnv`）——env 清洗未涵蓋 `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`，可能悄悄讓 claude-cli 改走 API Key 計費、違反本包「吃訂閱、零 Gemini 帳單」的核心目的**

問題：`buildChildEnv` 目前只剔除 `ANTHROPIC_BASE_URL`、`CLAUDECODE`、`CLAUDE_CODE_*` 開頭鍵，未清洗 `ANTHROPIC_API_KEY`（或 `ANTHROPIC_AUTH_TOKEN`）。Claude Code CLI 的既有行為是：若行程環境變數中存在 `ANTHROPIC_API_KEY`，會優先使用該金鑰走 Anthropic API 直接計費，而非使用者透過 `claude /login` 建立的訂閱 OAuth session。

本包的**唯一存在理由**就是「本機日常分析吃 Claude 訂閱、零 Gemini 帳單」（PLAN.md Phase C 開頭），若開發者的作業系統/shell 環境剛好設有 `ANTHROPIC_API_KEY`（例如同一台機器上其他 Claude Code/Agent SDK 專案設定的全域環境變數——這在使用本專案的開發者身上完全合理發生，因為此人同時也在跑其他 Claude Code 相關工作），子行程會**靜默**改用 API Key 計費：呼叫仍會成功、回應仍然正確，但實際扣款方式與帳戶跟預期完全不同，且沒有任何錯誤訊息可供察覺——這正是本包想避免的「Gemini 帳單」問題换了一個計費對象重新發生，卻缺乏任何偵測手段。

**建議修法：**
```ts
function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_API_KEY;      // 新增：避免悄悄改走 API Key 計費
  delete env.ANTHROPIC_AUTH_TOKEN;   // 新增：同上
  delete env.CLAUDECODE;
  for (const key of Object.keys(env)) {
    if (key.startsWith('CLAUDE_CODE_')) delete env[key];
  }
  return env;
}
```

**M-2｜C-2｜`components/Portfolio.tsx:962-985`（`handleSingleHealthCheck`）×`:988-1047`（`handleBatchHealthCheck`）——同一 symbol 的單檔健檢與批次健檢重疊在飛行中時，缺乏序號/世代守衛，較晚完成者會覆蓋較早完成者的 `healthResults`**

問題：兩個 handler 都用「一次性」`setHealthResults(prev => ({...prev, [symbol]: 最終結果}))` 寫回，沒有任何 request-id/世代標記。使用者可以：先對 2330 按下單檔健檢（`healthResults['2330']` 進入 loading，表格格子改顯示 spinner、按鈕消失），趁其仍在等待 LLM 回應時按下「全部健檢」——`handleBatchHealthCheck` 沒有檢查是否有單檔健檢正在進行中，直接把包含 2330 在內的**全部** symbols 一次設成 loading 並展開批次流程。之後不論單檔或批次哪一個先落地，其結果都會**無條件覆蓋** `healthResults['2330']`；若批次先完成（例如批次資料準備 3-worker 較快），單檔健檢稍後才落地，會把 2330 的顯示結果從「批次視角的完整分析」倒退回「單檔視角的分析」，反之亦然。

與 Phase B M-1（`handleRefreshQuote` 缺競態守衛）同一類問題，但影響範圍較小：兩者都是對**同一支股票**的合法分析結果，不會像 Phase B M-1 那樣把 A 股票的資料錯置到 B 股票畫面上——純粹是「顯示了較舊但仍然有效的分析結果，而非使用者剛觸發、預期看到的那一份」，故列為 MEDIUM 而非 HIGH。

**建議修法：** 為 `healthResults` 的寫回加一個單調遞增的 per-symbol 世代計數器（比照 App.tsx `fetchSeqRef` 的模式），或簡化為：`handleBatchHealthCheck` 開始前，若偵測到任一目標 symbol 目前 `status==='loading'`（代表有單檔健檢正在飛行中），可選擇跳過該 symbol 的批次覆蓋、或直接阻擋批次啟動並提示使用者稍候。

---

## PASS 項目（逐項核對，附證據）

### C-1（LLM provider adapter＋claude-cli 訂閱橋接）

- **(a) 部署環境（無 LLM_PROVIDER）行為逐位元不變**：`git show ab9326d:api/gemini.ts` 對照現行 `api/gemini.ts`——guards→method→validate→（金鑰檢查→模型/config 組裝→callGeminiWithTimeout）→200/catch 語序完全一致；唯一差異是無金鑰時原本直接 `res.status(500).json(...)` 改為 `throw new ClassifiedError('MISSING_KEY')` 經 catch 收斂，兩者的 `errorMessages['MISSING_KEY']` 與原硬編字串逐字相同（"後端尚未設定 Gemini API 金鑰，請聯絡管理員設定環境變數。"）——回應 body/status 逐位元相同，唯一 delta 是 catch 區塊多印一行 `console.error`（log-only，不影響前端契約）。PASS，SUMMARY 宣稱屬實。
- **(b) claude-cli 分支不進入 gemini-api 邏輯、GEMINI_API_KEY 零觸碰**：`generateText` switch 的三分支互斥（:24-38），`callGeminiApiProvider`（:45-63）與 `callClaudeCli`（:175-275）完全獨立呼叫路徑，`getGeminiApiKey()` 只在 `callGeminiApiProvider` 內呼叫。PASS。
- **(c) 命令注入面**：`prompt` 走 `child.stdin.write`（:229），不進 argv；`systemInstruction` 雖進 argv（`--system-prompt`, :186）但 `spawn()` 用陣列參數且 `shell` 選項未設（預設 false），不經 shell 解析，無論內容為何都不會被解釋成額外命令。PASS。
- **(d) `--bare` 禁用**：`grep -c "bare" api/_lib/llm.ts` = 0（本次覆核重跑，確認 SUMMARY「已修正首版註解字面違規」屬實）。PASS。
- **(e) 逾時＋settled 旗標防重複 resolve**：`callClaudeCli`（:189-275）的 `settle()` helper 統一守衛 `timeoutId`／`error`／`close` 三個出口，`settled` 布林正確防止雙重 resolve/reject。PASS（惟見 CR-01：這個機制本身沒問題，問題在於 `child.stdin` 是獨立的 EventEmitter，不受這個 `settled` 守衛保護）。
- **(f) 五種輸出解析出口**：is_error+"Not logged in"→MISSING_KEY 含登入指引、其他 is_error→UPSTREAM_ERROR、空/解析失敗→UPSTREAM_ERROR、exit code 非 0 但 JSON 合法時以 JSON 為準（程式碼確實完全不讀 `close` 事件的 exit code 參數，只信 stdout JSON，與 SUMMARY 描述一致）、is_error===false→resolve。五個分支邏輯與 SUMMARY 描述逐一核對一致。PASS。
- **(g) 執行檔探索三段序**：`CLAUDE_CLI_PATH` 顯式指定 → PATH 掃描（跳過 .cmd）→ `%APPDATA%\Claude\claude-code` 版本目錄掃描（`compareVersionDesc` 逐位數值比較，非字串排序，正確處理 `2.1.205` vs `2.1.30` 這類非等長版本號）。PASS（惟見 CR-01：快取一旦建立永不失效，是崩潰路徑的放大器）。
- **(h) 金鑰紅線**：本次覆核重跑 `npm run build && grep -r "AIza" dist/`，0 結果。PASS。

### C-2（健檢決策 JSON 化＋一鍵批次健檢）

- **(a) parseHealthDecisions 五值枚舉驗證＋任何失敗回 null 不拋錯**：`services/_shared/healthDecision.ts:37-74` 逐步驗證（物件形狀→decisions 非空陣列→每筆 symbol 非空字串→decision trim 後屬五值枚舉），任何一步用 `return null`，函式本體無任何會拋出例外的路徑（`JSON.parse` 有 try/catch 包裹）。PASS。
- **(b) 取「最後一個」```json 圍欄**：`fenceRe.exec` 迴圈遍歷全部匹配、持續覆寫 `lastMatch`，迴圈結束後 `lastMatch` 必為最後一個（若有）。PASS，讀碼確認邏輯正確（若報告本體提前出現額外 json 範例區塊，此法仍正確定位到真正的機器區——除非模型自己違反指令在機器區之後又輸出新的 json 圍欄，此時會退化為抓到錯誤區塊、觸發 shape 驗證失敗回 null，非嚴重風險，優雅降級）。
- **(c) cleanedMarkdown 只移除匹配到的圍欄本身**：`fullText.slice(0, lastMatch.index) + fullText.slice(lastMatch.index + lastMatch[0].length)`——slice 邊界正確，不會誤刪報告本體其他內容。PASS。
- **(d) splitHealthReport 的 6488.TW / 6488.TWO 子字串防禦**：依長度降冪逐一認領＋每次認領只在**未被認領**的段落中搜尋（:126-134）——實際推演：先處理較長的 `6488.TWO`，其唯一候選段落被標記 claimed 後移出候選池，`6488.TW` 再處理時只會在剩餘未認領段落中找，不會誤觸已被 `6488.TWO` 佔用的段落。PASS，讀碼確認與 SUMMARY「防子字串邊角」宣稱一致（node 直測 29 情境含此案例，本次抽查邏輯吻合）。
- **(e) 📋 surrogate pair 修正**：`headerRe`（:97）用 `(?:📋)?` 非捕獲組而非 `📋?`，避開低位代理誤判為可選字元的陷阱（Deviations 記載此問題於 Task 1 直測中被抓到並修正）。PASS。
- **(f) systemInstruction 契約段轉義正確**：`services/gemini.ts:806-815` 模板字面值中 ```` ```json ```` 圍欄的反引號皆以 `` \` `` 轉義，`npx tsc --noEmit` 通過（若轉義有誤會導致模板字面值提前終止、整檔語法錯誤，tsc 必炸）。PASS。
- **(g) 併發上限 3 的 worker pool 正確性**：`cursor++` 發生在 async 函式的同步區段（`await` 之前），JS 單執行緒下不會有 race；`Math.min(3, symbols.length)` 避免少量持股時過度建立 worker。PASS（惟見 H-1：worker pool 本身無 bug，問題在於下游 `formatHealthCheckData` 對空資料的處理）。
- **(h) 決策映射與 emoji 補回**：`DECISION_EMOJI[entry.decision] + entry.decision`（Portfolio.tsx:977、:1030）與 `HEALTH_DECISIONS`/`DECISION_EMOJI` 的五值一一對應，型別 `HealthDecision` 保證只能是白名單值。PASS。
- **(i) 紅線核對**：`git diff --stat` 確認 C-2 僅觸碰三檔；`api/` 零觸碰；`geminiCache.ts` 零觸碰；`analyzeEntryWithGemini`/`analyzeTradeDecision`/`analyzeFundamentals`/`FLASH_THINKING_BUDGET` 於本次 diff 中零改動（本次覆核重新 diff 確認）；`PortfolioHealthItem` 介面零改動。PASS。

### C-3（systemInstruction 靜態化＋explicit caching 拒絕裁定）

- **(a) 四個 SI 皆 module 級 const、entry 版零 `${`**：本次覆核重新 grep 確認 `ENTRY_SYSTEM_INSTRUCTION`（0 個 `${`）、`TRADE_DECISION_SYSTEM_INSTRUCTION`／`HEALTH_CHECK_SYSTEM_INSTRUCTION`（各 0 個 `${`，本為預期——這兩個 SI 本來就不含內插）。PASS。
- **(b) entry 資訊對等成立**：`analyzeEntryWithGemini` 的 `promptData`（:109-126）逐一核對，SI 舊有的 5 個動態值（決策、進場價、固定停損、關鍵均線防守價、均線名稱）皆完整存在於 promptData 中（含相同的 `?? '—'`／`?? '中長線MA20'` fallback）。PASS，與 C-3 SUMMARY 表格宣稱一致。
- **(c) health SI 契約與 C-3 hoist 順序相容**：`HEALTH_CHECK_SYSTEM_INSTRUCTION`（gemini.ts:627-815）末尾確實包含 C-2 新增的「機器可讀決策區」契約段（:806-815），證實 C-3 的 hoist 是在 C-2 落地**之後**進行、且原樣照搬，兩包順序相容、內容無遺漏。PASS。
- **(d) Windows argv 長度餘裕（本次覆核獨立測量，非僅信賴 SUMMARY 宣稱）**：以 node 腳本抽取四個 SI 本體實測 UTF-16 code unit 數（Windows `CreateProcess` 的 32,767 字元上限以 UTF-16 計）——trade SI 7,341 units（最大）、health SI 6,448 units（含 10 個雙引號，逃逸開銷可忽略）、entry SI 1,066 units、fundamentals SI 993 units。四者皆遠低於 32,767 上限（最大者仍有 ~4.4 倍餘裕），**裁定：非 finding**，但建議在 SI 未來持續成長（例如新增更大量的結構化契約段）時，替換為 `--system-prompt-file` 暫存檔或加一道長度守衛，避免無聲超限。
- **(e) A3 快取無跨股誤共享**：`buildCacheKey` 對 hash 輸入為 `systemInstruction + ' ' + prompt`（geminiCache.ts，本包零觸碰），entry SI 靜態化後同日不同股仍因 `prompt`（含個股 symbol/日期/價位）而產生不同 hash。PASS，讀碼確認推理成立。
- **(f) 機制層偏差裁定（拒絕 Gemini explicit caching，改依 implicit caching）——獨立覆核結論：ACCEPT**：SUMMARY 提出的經濟模型（單次命中省 ~$0.001-0.002 vs 每小時儲存 ~$0.005-0.008、回本需每小時 ≥4-5 次呼叫、本 app 實際流量為個人單日零星幾次）方向正確；entry SI 靜態化後僅 ~1k tokens，可能低於 Flash explicit cache 門檻（依 Google 現行文件，Flash 系列最低快取 token 數視版本而異，但此數量級接近或低於常見門檻的判斷合理）；改採零成本的 implicit caching＋前綴穩定化，是與實際使用模式（低頻、個人、間隔以小時計）匹配度更高的工程判斷，且完全不增加維護負擔（無需管理 cache 生命週期、無需跨 serverless 實例查找 cache name）。**本次覆核認同此機制層偏差裁定，理由站得住，非缺陷。**（實際折扣命中率需靠事後帳單/`usageMetadata.cachedContentTokenCount` 觀察，非本次可靜態驗證項目，SUMMARY 已誠實記載此點。）
- **(g) 規則庫文字零改動（entry 版限定 2 行）＋金鑰紅線**：本次覆核重跑 `npm run build && grep -r "AIza" dist/`，0 結果；`npx tsc --noEmit` 全綠。PASS。

---

## 已知殘餘風險 / 接受的行為 delta（核驗結果）

- **C-1 MISSING_KEY 的 log-only console.error 差異**：核驗屬實，不影響前端契約，理由站得住。
- **C-1 claude-cli 路徑 temperature/thinkingConfig 靜默丟棄**：核驗屬實（CLI 本就不支援這些參數），SUMMARY 已誠實記載為已知限制，非缺陷。
- **C-1 systemInstruction 走 argv 的 Windows 命令列長度限制**：核驗結果見 PASS (d)——目前四個 SI 皆有 ≥4 倍餘裕，非現行 finding，僅建議日後 SI 持續膨脹時加長度守衛。
- **C-2 >8 檔可能截斷（未做 chunk 分批）**：核驗方向合理——`parseHealthDecisions` 失敗時回 null、`splitHealthReport` 失敗時回 null，兩者的呼叫端 fallback 階梯（regex → 全文兜底）確實存在且經 node 直測覆蓋（29 情境含壞 JSON/缺區塊）；此已知限制的優雅降級路徑本身沒有問題，理由站得住。但**注意**：本次覆核發現的 H-1（一檔資料失敗全批死）與此已知限制是不同的故障模式（H-1 是資料抓取失敗導致的例外中斷，不是 LLM 輸出過長導致的截斷），SUMMARY 未涵蓋 H-1 這個情境，不能視為「已知並接受」。
- **C-3 explicit caching 拒絕的機制層偏差**：核驗結果見 PASS (f)——ACCEPT，理由站得住。
- **C-3 implicit caching 命中率不確定（分鐘級生命週期、Google 未承諾）**：核驗屬實，SUMMARY 已誠實記載為「零成本啟用爆發情境折扣，非保證命中」，非過度宣稱。

---

## 跨包互動風險核驗

- **C-1 adapter × C-2/C-3 systemInstruction 長度**：見 PASS (d)，四個 SI 現行大小皆有充分餘裕，非 finding。
- **C-2 新增決策區契約 × C-3 SI hoist 順序**：見 PASS (c)，`HEALTH_CHECK_SYSTEM_INSTRUCTION` 常數內確實包含 C-2 的決策區段，C-3 的 hoist 是在 C-2 之後進行且內容照搬，順序相容、內容無遺漏。
- **C-1 claude-cli 橋接 × C-2 批次健檢的大 prompt（多檔庫存合併）**：批次 prompt（`formatHealthCheckData` 多檔輸出）走 `child.stdin`（不受 argv 長度限制），僅 systemInstruction 受 argv 限制——兩者責任分離正確，批次功能不會因為多檔而放大 CR-01/argv 長度風險，只會放大 H-1（資料抓取失敗機率隨檔數與併發增加）。
- **C-1 的崩潰風險（CR-01）× 全部功能**：若 CR-01 觸發（vercel dev 主程序當機），影響範圍不限於 claude-cli 路徑本身，而是**當下所有正在服務中的請求**（包含同時間發生的 gemini-api 路徑請求、行情 API 請求等）都會被中斷——這是為什麼 CR-01 被評為 CRITICAL 而非侷限於 C-1 包內部的 HIGH：崩潰的是整個本機開發伺服器行程，不是單一功能。

---

## 需人工實跑驗證的項目（無法靜態驗證）

1. **C-1 端到端（登入後）**：使用者需先在終端跑 `claude /login`（或 `claude setup-token`）完成訂閱登入，才能驗證「本機日常分析吃 Claude 訂閱、Gemini 帳單趨近 0」這條 PLAN 驗收標準的成功路徑（is_error===false 的真實生成）；本次覆核與 C-1 SUMMARY 皆只能驗到「未登入分類錯誤」這個登入前上限。
2. **三種分析功能報告品質人工對照 3-5 檔**：PLAN 驗收標準明文要求，本次覆核僅能靜態核驗 prompt/SI 變更本身的資訊對等性與零內容改動（見 PASS b/c），無法評估 Gemini/claude-cli 兩種 provider 的實際輸出品質差異，需實際跑分析報告肉眼比對。
3. **CR-01 的實機重現**：建議在測試環境模擬「claude.exe 存在但無法執行」情境（例如暫時修改檔案權限、或指向一個假的同名可執行檔但實際不可執行），驗證是否真的觸發未捕捉例外並讓 `vercel dev` 行程崩潰；若本地驗證屬實，這是本次覆核中最建議優先修復的項目。
4. **H-1 的實機重現**：建議用瀏覽器 DevTools Network Throttling 或直接暫時 mock `getStockData` 對某一檔持股拋出錯誤，實跑「全部健檢」按鈕，確認其餘持股是否真的被一併標記為「分析失敗」。
5. **M-2 的實機重現**：對同一檔持股先觸發單檔健檢、緊接著點擊「全部健檢」，觀察該檔位最終顯示的是哪一次分析結果、是否與使用者最後一次操作的預期一致。
6. **implicit caching 實際折扣命中**：C-3 SUMMARY 已記載此項需事後從帳單／`usageMetadata.cachedContentTokenCount` 觀察，非本次可驗證項目，留待長期使用後回顧。
7. **金鑰驗證**：本次覆核已重新執行 `npm run build && grep -r "AIza" dist/`，0 結果，可視為已驗證（非僅信賴 SUMMARY 宣稱）。

---

_Reviewed: 2026-07-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep（含跨檔案呼叫鏈追蹤：api/gemini.ts↔api/_lib/llm.ts↔api/_lib/http.ts、components/Portfolio.tsx↔services/gemini.ts↔services/_shared/healthDecision.ts；並針對 C-1 spawn 生命週期、C-2 併發池與資料失敗路徑、C-3 位元組全等宣稱與 argv 長度餘裕做獨立實測，未僅信賴各包 SUMMARY 宣稱）_

---

## 驗收後處置（orchestrator，2026-07-13，比照 Phase A/B 先例當場修）

| Finding | 處置 | Commit |
|---|---|---|
| CR-01（spawn 失敗未捕捉 stream error 可打死 vercel dev＋探索快取永不失效） | **已修**：stdio 三管（stdin/stdout/stderr）掛 error 監聽防無監聽器 throw；spawn 本體加 try/catch——修復期直測揭露 Windows 對非 PE 檔的 spawn 失敗是**同步 throw**（`Error: spawn UNKNOWN`）而非 'error' 事件（覆核建議只涵蓋事件路徑），同步/非同步失敗統一收斂 UPSTREAM_ERROR「無法啟動 claude CLI」；stdin.write/end 加 try/catch；兩條失敗路徑皆清空 `cachedClaudeCliPath` 讓下一次請求重新探索。直測兩情境 PASS：(1) 假非 PE 檔 spawn → UPSTREAM_ERROR、零 uncaughtException、行程自然退出；(2) 失敗後刪檔重呼叫 → 回探索期 MISSING_KEY「找不到 claude 執行檔」（證明快取確實已清）。C-1 原三情境直測對修後 bundle 重跑無退化（含真實 spawn 未登入 e2e，1356ms settle） | b49bd30 |
| H-1（批次健檢一檔資料失敗全批死） | **已修**：批次 worker 收攏後把 `recentData` 空的檔位剔除出送 LLM 名單、逐檔標記「資料取得失敗」（可重試、附限流提示）；全部失敗時不打 LLM 直接收場；`splitHealthReport` 與 done 寫回迴圈改用 `okSymbols`（符合切段器「每個 symbol 都須認領到段」的契約，避免缺段導致整批退全文）；catch 只回收實際送 LLM 的名單（`attemptedSymbols`）。單檔健檢同樣在 recentData 空時早退標記，不再送空資料給 `formatHealthCheckData` 拋錯（gemini.ts 維持零觸碰） | b49bd30 |
| M-1（env 清洗漏 ANTHROPIC_API_KEY/AUTH_TOKEN，可能悄悄改走 API 計費） | **已修**：`buildChildEnv` 補刪 `ANTHROPIC_API_KEY`／`ANTHROPIC_AUTH_TOKEN` 兩鍵，附「計費對象悄悄改變且無徵兆」註解 | b49bd30 |
| M-2（單檔×批次健檢對同 symbol 重疊在飛缺世代守衛） | **已修**：新增 `healthSeqRef` per-symbol 單調遞增世代（比照 App.tsx `fetchSeqRef` 模式）；單檔與批次的 done/error/資料失敗寫回逐 symbol 過世代檢查，較早起跑者的落地結果不覆蓋較晚起跑者 | b49bd30 |

修復後 `npx tsc --noEmit` 通過、`npm run build` 後 `grep -r "AIza" dist/` 無結果。

## 登入後 live e2e（orchestrator，2026-07-13，使用者完成 claude /login 後）

使用者 MSIX 桌面版 Claude 登入（Max 訂閱、jason70445@gmail.com）後，orchestrator 直接以出貨橋接程式碼實跑：

| 測項 | 結果 |
|---|---|
| 裸 CLI auth status（MSIX 路徑） | `loggedIn:true`、`subscriptionType:max`、`firstParty` |
| 出貨橋接 generateText｜fast→sonnet | PASS：`claude-sonnet-5`、`is_error:false`、回應「測試成功」UTF-8 乾淨（Node stdin 天生 UTF-8，無 PowerShell 手動管道的亂碼問題） |
| 出貨橋接 generateText｜thinking→opus | PASS：`claude-opus-4-8`、布林通道說明正確 |
| C-1×C-2×C-3 整合（真實 6442 字元健檢 SI＋兩檔擬真持股 → 橋接 sonnet → 真實 parseHealthDecisions） | PASS（契約）：Claude 照 C-2 契約在末尾吐 ```json 決策區 `[{2330.TW:續抱},{2603.TW:停損}]`——symbol 齊全、五值枚舉、決策合理（2330 多頭獲利續抱／2603 套牢空排跌破月線停損）；cleanedMarkdown 正確剝除 json 區塊 |

**live 新發現並當場修（commit 8f901e6）**：整合測試中 `splitHealthReport` 回 null——Claude（sonnet）把每檔標頭吐成 `# 📋`（H1）而非健檢 SI 指示的 `### 📋`（H3），切段正則硬綁 `###` 導致 claude-cli 路徑批次健檢每檔 fallback 全文、分檔檢視實質失效（Gemini 當初照吐 ### 故 C-2 原測未暴露）。修法：`headerRe` 與總覽 regex 井號放寬 `#{1,6}`；回歸測試確認 `#`（Claude）與 `###`（Gemini）兩種階層皆正確切段無串位。核心 json 決策契約不受此影響（決策走 JSON 主路徑，與標頭階層無關）。

**PowerShell 5.1 手動測 CLI 的兩個雷（已記入 agent-dual-core/LESSONS.md）**：(1) 管道 `|` 送中文進原生程式 stdin 時 `$OutputEncoding` 預設 ASCII → 中文變亂碼（模型會回「訊息似乎有亂碼」），須先 `$OutputEncoding=[Text.Encoding]::UTF8`；(2) `Invoke-RestMethod` 打 vercel dev（undici）的 `Expect:100-continue` 與 UTF-8 body 問題。此二者僅影響手動 PowerShell 測試，出貨橋接走 Node stdin 不受影響。

**仍待使用者人工項**：三功能在真實 UI＋真實股票資料的品質對照 3-5 檔（本次整合測試用擬真資料驗證了「格式契約與解析」，UI 實跑驗證「真實行情下的報告品質與 provider 間差異」仍建議由使用者親跑）；批次健檢在真實限流（429）下的 H-1 誠實降級實機重現；M-2 單檔×批次重疊競態實機重現。
