---
phase: 09-llm-latency
branch: gsd/phase-llm-latency
files_modified:
  - api/gemini-stream.ts        # 新增：進場分析串流端點（NDJSON）
  - api/_lib/llm.ts             # 新增 generateTextStream＋既有路徑加 --effort
  - services/gemini.ts          # SI 拆快捷/完整兩版＋callGeminiApiStream＋analyzeEntryWithGemini 接 onChunk
  - App.tsx                     # handleRunAnalysis 接串流 onChunk＋handleOpenAnalysisModal 週線預抓
  - components/AnalysisResult.tsx  # loading 中有內容即渲染（邊生成邊顯示）
  - .env.example                # CLAUDE_CLI_MODEL_THINKING 建議值＋effort 覆寫說明
must_haves:
  - GEMINI_API_KEY 不進前端 bundle：npm run build 後 grep -r "AIza" dist/ 必須無結果
  - api/gemini.ts 與 services/gemini.ts 的 analyzeTradeDecision/analyzePortfolioHealth/analyzeFundamentals、services/_shared/geminiCache.ts、api/_lib/http.ts：git diff 必須為 0
  - 快取語意不變：僅「完整成功文本」寫 localStorage；部分串流文本絕不落快取
  - production（LLM_PROVIDER 未設＝gemini-api）走串流端點時回單塊 NDJSON，報告內容行為等同現行
  - 串流端點必掛與 /api/gemini 相同的 applyGuards＋geminiPerMin/geminiPerDay 限流
---

# Phase 09 PLAN：AI 分析延遲優化

決策背景與探針數據見同目錄 `09-CONTEXT.md`。CLI 串流事件樣本見 `09-cli-stream-sample.jsonl`。

## 給冷啟動執行者的前提（Codex 必讀，逐條遵守）

### 拍板決策（不得重新發明）
- **D-01**：快捷模式 SI 收斂 600 字重點版（本檔 T1 附全文，照貼）；思考模式 SI＝現行文本逐字節不動（只改常數名）。收斂綁 mode 不綁 provider。
- **D-02**：串流走**新端點** `api/gemini-stream.ts`、NDJSON 協議（非 SSE）；只有進場分析走它，健檢/覆盤/基本面維持 `/api/gemini` 零改動。
- **D-03**：claude-cli 兩檔位都用模型別名預設（fast→sonnet；thinking 由使用者 .env 設 sonnet，程式碼不硬編 thinking=sonnet）；effort 分檔 fast→`medium`、thinking→`max`，env 可覆寫。
- **D-05**：串流中斷＝保留已顯示文字＋文末警語、不寫快取、不彈錯誤 UI。
- 已否決方案（haiku、effort low、SSE、輪詢 fallback）見 CONTEXT，勿實作。

### 環境鐵則
1. 路徑含空格（`E:\My Project\...`）——一切指令加引號；PowerShell 用 `npx.cmd`。
2. **禁裝任何 npm 套件**——串流用內建 `child_process`/`fetch`/`ReadableStream`/`TextDecoder` 即可。
3. `.env` 不碰（含金鑰）；只准改 `.env.example` 的註解與空值鍵。
4. 每任務收尾 `npx.cmd tsc --noEmit` 0 錯誤才 commit；一任務一 commit。
5. git 大動作前先確認無殘留 node 子程序鎖檔（`tasklist //FI "IMAGENAME eq node.exe"`）。
6. 下列行號為 2026-07-15 快照（main @ b2e89a2 之後）——**動手前開檔確認**，對不上就先停下回報，不要猜。

### 既有程式碼事實（行號快照）
- `services/gemini.ts:19-49` `callGeminiApi`：讀快取（:25-27）→ fetch `/api/gemini`（:29-33，帶 `proxyHeaders`）→ 非 ok 拋 `data.message`（:39-41）→ 非空成功文本 `writeCache`（:44-46）。
- `services/gemini.ts:65-91` `ENTRY_SYSTEM_INSTRUCTION`（template literal）；`:93-135` `analyzeEntryWithGemini`（:128-134 呼叫處：mode、temperature 0.2、fast 帶 thinkingConfig）。
- `services/gemini.ts:417/:827/:924` 三支既有分析函式——**diff 必須為 0**。
- `services/_shared/geminiCache.ts` `buildCacheKey/readCache/writeCache`——共用不動；key 含 SI 雜湊，SI 改版自動不撞舊快取。
- `api/_lib/llm.ts:21-39` `generateText` provider switch；`:145-150` `getClaudeCliModel`（env 覆寫模式照抄給 effort 用）；`:156-170` `buildChildEnv`；`:179-303` `callClaudeCli`——**spawn 防僵死三件套必須照抄**：stdio 三管 error 空監聽（:219-221，漏了會讓 vercel dev 整程序崩潰）、`settled` 旗標＋`settle()` 收斂（:223-235）、同步 spawn throw 的 try/catch（:198-214）。
- `api/gemini.ts:35-64` handler（guards→405→validate→generateText→json；`maxDuration=120`）——**整檔 diff 為 0**。
- `api/_lib/guard.ts` `applyGuards`、`api/_lib/ratelimit.ts` `geminiPerMin/geminiPerDay`——串流端點原樣引用（import 形狀照 `api/gemini.ts:8-10`）。
- `App.tsx:163-169` `handleOpenAnalysisModal`；`:171-201` `handleRunAnalysis`（:184-186 週線抓取、:194 `analyzeEntryWithGemini` 呼叫、:196-197 catch 設 err.message）；`:473-475` `AnalysisResult` 渲染條件。
- `components/AnalysisResult.tsx:13-19` `if (loading)` 回骨架、`:21` `if (!content) return null`。
- `services/yahoo.ts` `getStockData` miss 路徑已有 in-flight 去重（BL-1）——T5 預抓依賴此事實，動手前確認仍成立。
- `vite.config.ts:20-25` `/api` proxy→3001。分塊透傳兩埠皆已 spike 實證 PASS（CONTEXT），不必重驗。
- CLI 事實（已實測）：`-p --output-format stream-json` **必須帶 `--verbose`**；文字增量在 `stream_event`/`content_block_delta` 的 `event.delta.text`；收尾 `result` 事件帶 `is_error`＋全文；`--effort` 合法值 low/medium/high/xhigh/max。

## 任務序列（T1→T6 依序，一任務一 commit）

### T1：SI 拆版（services/gemini.ts）

1. 現行 `ENTRY_SYSTEM_INSTRUCTION`（:65-91）**原文逐字節不動**改名為 `ENTRY_SYSTEM_INSTRUCTION_FULL`。
2. 新增 `ENTRY_SYSTEM_INSTRUCTION_FAST`，全文照貼（不得增刪改寫）：

```
### 角色
你是精通「朱家泓 × 林穎」技術分析體系的交易教練。下方「程式濾網客觀結論」已由系統量化判定完成，你的任務是精煉解讀，**不得推翻 GO/WAIT/NO-GO 結論與各步驟燈號**。

### 輸出格式（Markdown，全文不超過 600 字）
#### 1. 結論摘要
2 句：最終決策＋最關鍵的通過項與卡關項。
#### 2. 六步驟速覽
趨勢/位置/K線/均線/量價/指標各**一句**白話解釋燈號原因（共 6 行條列）。
#### 3. 操作計畫
- GO：進場價、停損雙軌兩價位（擇一主防守、收盤跌破出場）、停利紀律，共 2-3 句。
- WAIT / NO_GO：對照「未卜先知 5 觀察」標明目前所處情境編號，給出具體觸發條件與等待價位（盤整上頸線/月線/前高等，從濾網資料推算），共 2-3 句；五情境皆不符則一句說明需等趨勢翻多。
- 使用者持有中：依成本價一句加減碼/停損建議；空手則不談持股操作。

### 限制
- 嚴守紀律與客觀，不臆測未提供的資訊；直接輸出報告本文，不要開場白。
- 結尾一行小字免責：本分析為技術面教學推演，非投資建議。
```

3. `analyzeEntryWithGemini` 呼叫處（:130）改為 `systemInstruction: mode === 'fast' ? ENTRY_SYSTEM_INSTRUCTION_FAST : ENTRY_SYSTEM_INSTRUCTION_FULL`。

**雷區 diff 形狀**：本任務在 services/gemini.ts 只准出現（a）SI 常數區的文本與常數名（b）:130 一行的常數選擇。`promptData` 構成、temperature、thinkingConfig、其他函式——邏輯行出現任何 diff 即回退。

### T2：llm.ts 串流函式＋effort 分檔

1. 新增 effort 解析（模仿 `getClaudeCliModel` 的 env 覆寫模式）：
   `getClaudeCliEffort(mode)`：thinking → `CLAUDE_CLI_EFFORT_THINKING` 或 `'max'`；fast → `CLAUDE_CLI_EFFORT_FAST` 或 `'medium'`。值不做白名單驗證（CLI 自己報錯→歸 UPSTREAM_ERROR）。
2. 既有 `callClaudeCli` 的 args（:183-191）插入 `'--effort', effort` 兩元素——本函式其餘邏輯零變化。
3. 新增 `callClaudeCliStream(req, onDelta, cancelRef)`，形狀完全比照 `callClaudeCli`（同 exe 探索、同 buildChildEnv、同 cwd=tmpdir、同 stdio error 空監聽、同 settle 模式、同步 throw try/catch、同 stdin 寫入），差異僅：
   - args 改：`['-p','--output-format','stream-json','--include-partial-messages','--verbose','--tools','','--no-session-persistence','--disable-slash-commands','--model',model,'--effort',effort,'--system-prompt',req.systemInstruction]`。
   - stdout 逐行解析：緩衝 split `'\n'`、保留最後不完整行；每行 `JSON.parse`（失敗忽略該行）；`type==='stream_event' && event?.type==='content_block_delta' && typeof event.delta?.text==='string'` → `onDelta(text)` 並累積；`type==='result'` → 存起來。其餘事件（system/assistant/rate_limit_event…）一律忽略。
   - close 收斂：有 result 事件 → `is_error` 分支照抄 `callClaudeCli`（含 Not logged in→MISSING_KEY）；成功 → `resolve({ text: String(result.result ?? '') })`。無 result 事件 → reject `UPSTREAM_ERROR`（訊息含 stderr 摘要）。
   - 逾時雙軌：總逾時 `CLAUDE_CLI_STREAM_TIMEOUT_MS = 180_000`；**首塊逾時 45s**（spawn 後 45s 內無任何 delta 且無 result → kill＋reject）。收到首個 delta 後解除首塊計時。
   - `cancelRef.cancel = () => { 若未 settle：settled=true、clearTimeout、child.kill() }`——供端點在 client 斷線時止血（不 resolve 不 reject，端點已斷無人收）。
4. 新增匯出 `generateTextStream(req, onDelta, cancelRef): Promise<{text}>`：provider switch 與 `generateText` 同構——`claude-cli` → `callClaudeCliStream`；`''`/`gemini-api` → 直接 `return callGeminiApiProvider(req)`（零次 onDelta，單塊語意）；其他值 → 同樣的 MISSING_KEY 錯誤。

**對數案例（照 `09-cli-stream-sample.jsonl` 手驗解析器）**：餵入樣本檔全部 27 行，onDelta 必須恰好被呼叫 9 次，前三次依序收到 `台`、`積電（台灣積體電路製`、`造股份有限公司）是全球最大的專業積`；resolve 的全文以 `台積電（台灣積體電路製造股份有限公司）` 開頭且與 9 段 delta 串接結果一致。

### T3：api/gemini-stream.ts 新端點

骨架比照 `api/gemini.ts`：`applyGuards(req,res,[geminiPerMin,geminiPerDay])` → 非 POST 405 JSON → `validateGeminiRequest`。之後：
1. `export const maxDuration = 200;`
2. Headers：`Content-Type: application/x-ndjson; charset=utf-8`、`Cache-Control: no-store`。
3. NDJSON 協議（一行一 JSON）：`{"t":"delta","text":...}` × N → `{"t":"done","text":<完整全文>}`；錯誤 → `{"t":"error","code":...,"message":...}` 後 `end()`。
4. 流程：`generateTextStream(request, d => res.write(deltaLine(d)), cancelRef)` → 成功 `res.write(doneLine(full))`＋`end()`。
5. 錯誤分兩態：**尚未 write 任何行** → 照 `api/gemini.ts` 的 catch 寫法回 `res.status(statusByCode[code]).json({code,message})`；**已 write 過** → 只能以 error 事件行收尾＋`end()`（HTTP 狀態碼已定案不可改）。
6. Client 斷線：`req.on('close', () => cancelRef.cancel?.())`（handler 介面型別上補 `on`）——防使用者關頁後子程序白燒訂閱 tokens。
7. 錯誤 log 沿用 `console.error('[gemini-stream:CODE] ...')`＋`sanitizeErrorForLog`。

### T4：前端串流消費

1. `services/gemini.ts` 新增 `callGeminiApiStream(payload, onChunk): Promise<string>`：
   - 快取命中 → 直接回 cached（不打網路、不呼叫 onChunk）——沿用 `buildCacheKey/readCache`。
   - fetch `'/api/gemini-stream'`（POST、`proxyHeaders`，比照 :29-33）。`!response.ok` → 讀 json 拋 `data.message`（與現行一致）。
   - `response.body.getReader()`＋`TextDecoder` 逐行解析（緩衝 split `'\n'`）：`delta` → 累積並 `onChunk(累積字串)`；`done` → `writeCache(key, done.text)` 後 resolve `done.text`；`error` 事件或流異常結束（無 done）→ 已有累積文本則 resolve `累積文本 + '\n\n> ⚠️ 報告生成中斷——以上為部分內容，可按「AI 分析」重試。'` 且**不寫快取**；無累積文本 → throw Error(message 或通用訊息)。
2. `analyzeEntryWithGemini` 加第 4 選配參數 `onChunk?: (partial: string) => void`：有 onChunk → `callGeminiApiStream`；無 → 現行 `callGeminiApi`（其他呼叫端零改動）。
3. `App.tsx` `handleRunAnalysis`（:194）：`analyzeEntryWithGemini(filter, userPosition, analysisMode, (partial) => setAnalysis(partial))`——不節流（React 18 自動批次；chunk 頻率實測每秒個位數次）。完成後照現行 `setAnalysis(report)`。catch 分支不動。
4. `components/AnalysisResult.tsx`：`:13` 的 `if (loading)` 改 `if (loading && !content)`——loading 中已有部分內容即走正常渲染分支（邊生成邊顯示）。其他呼叫端（健檢等）loading 時 content 恆空，行為不變。

### T5：週線預抓（App.tsx）

`handleOpenAnalysisModal`（:163-169）內加：`if (interval === '1d') { getStockData(info?.symbol || symbol, '1wk').catch(() => {}); }`——fire-and-forget，靠 getStockData 既有快取＋in-flight 去重讓 :185 的正式抓取直接命中。**不加任何 state、不加 await**。若確認 in-flight 去重不存在（前提節事實對不上），停下回報。

### T6：.env.example 註解更新

- `CLAUDE_CLI_MODEL_THINKING=` 註解補「建議 sonnet（配 effort max）；未設預設 opus」。
- 新增段落：`CLAUDE_CLI_EFFORT_FAST=`（預設 medium）、`CLAUDE_CLI_EFFORT_THINKING=`（預設 max），註明合法值 low/medium/high/xhigh/max、僅 claude-cli provider 生效。

### T7：checkpoint:human-verify（Codex 做到此停下回報）

回報格式：各 commit hash＋`npx.cmd tsc --noEmit` 結果＋`npm run build`＋`grep -r "AIza" dist/`（Bash）結果＋`npm run test` 結果＋T2 對數案例的實際驗證輸出。

## 機械驗收清單（每項可直接執行）

1. `npx tsc --noEmit` → 0 錯誤。
2. `npm run build` → 成功；`grep -r "AIza" dist/` → 無結果。
3. `npm run test` → 32 案例全綠。
4. `git diff main --stat` → 僅 frontmatter files_modified 所列檔案（＋本 phase .planning 檔）。
5. `git diff main -- api/gemini.ts api/_lib/http.ts services/_shared/geminiCache.ts` → 空。
6. `ENTRY_SYSTEM_INSTRUCTION_FULL` 與 `git show main:services/gemini.ts` 的原常數文本逐字節相同（僅名稱不同）。
7. T2 對數案例通過（樣本檔 9 delta＋全文一致）。
8. curl 冒煙：`curl -X POST http://localhost:3001/api/gemini-stream`（無 body、帶 Origin localhost:3000）→ 400 JSON；GET → 405。

<review_checklist>
覆核者（本 phase＝Fable 驗收）逐條執行，PASS/FAIL＋證據；必修退 Codex 附行號，同題最多退 2 輪，第 3 輪升級使用者：

- [ ] R1 範圍：`git diff main --stat` 與 frontmatter 完全一致；must_haves 的 diff=0 清單逐檔驗（機械清單 4/5/6）。
- [ ] R2 T1 雷區：services/gemini.ts diff 僅 SI 常數區＋:130 一行；三支既有分析函式、promptData、temperature/thinkingConfig 零變化。
- [ ] R3 T2 防僵死：callClaudeCliStream 具備 stdio 三管 error 空監聽、settled/settle 收斂、同步 spawn try/catch、雙軌逾時、cancelRef.kill——逐項讀碼比對 callClaudeCli。
- [ ] R4 T2 對數案例親手重跑（node 直測或臨時腳本餵 09-cli-stream-sample.jsonl）。
- [ ] R5 T3 安全面：applyGuards＋兩限流掛載、非 POST 405、write 前/後錯誤兩態、req close→cancel。effort 旗標同時進了非串流 callClaudeCli。
- [ ] R6 T4 快取語意：done 才 writeCache；error/中斷路徑無任何 writeCache 呼叫（讀碼）＋e2e 驗 localStorage。
- [ ] R7 e2e（本機 vercel dev＋LLM_PROVIDER=claude-cli）：冷標的快捷分析——首字 ≤10s、完整 ≤30s、報告 ≤~600字三節結構；同日重按 0 請求；思考模式走完整長格式無逾時；DevTools 斷線模擬中斷→部分文字＋警語＋無快取污染；健檢/覆盤/基本面回歸各跑一次（走 /api/gemini 不受影響）。
- [ ] R8 prod 模擬：.env 暫時移除 LLM_PROVIDER 重啟 vercel dev → 快捷分析走 gemini-api：串流端點回單塊、報告正常、內容為 600 字重點版。驗完還原 .env。
- [ ] R9 機械清單 1/2/3/8 親手跑。
</review_checklist>

## Human-verify（使用者驗收步驟）

1. `.env` 加一行 `CLAUDE_CLI_MODEL_THINKING=sonnet`，重啟 vercel dev（env 變更必須重啟）。
2. localhost:3000 搜一檔今天沒看過的股票 → AI 分析 → 快捷＋空手 → 開始：預期 **~5 秒內報告文字開始逐段浮現**、~20-25 秒完成；報告為三節重點版。
3. 同一檔再按一次分析 → 應即時出現（當日快取）。
4. 換思考模式跑一檔：完整六步驟長格式、約 45-60 秒（串流顯示）、無逾時錯誤。
5. 手感對照：市場分析頁的健檢/覆盤/基本面照常運作（此三功能不串流、行為不變）。
6. 部署 production 後：快捷分析完整報告 ≤14 秒、內容為重點版；串流端點在 prod（Gemini）為一次性出現全文屬預期行為。

## 未達標處置

驗收硬門檻（CONTEXT 成效表）任何一項未達 → 開 backlog 條目記錄差距與下一步假設，不在本 phase 內加碼（比照 BL-PLAN 檢查點紀律）。
