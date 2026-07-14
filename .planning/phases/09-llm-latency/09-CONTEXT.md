# Phase 09 CONTEXT：AI 分析延遲優化（本機 claude-cli ＋ 快捷模式全域）

**日期**：2026-07-15 定案
**分工**：Fable 5 規劃＋驗收，Codex 執行（使用者指定本 phase 特例：驗收由 Fable 而非 Sonnet）
**分支**：`gsd/phase-llm-latency`

## 問題（2026-07-14 實測 10 檔基線）

| 環境 | 快捷模式「按下開始分析→完整報告」 |
|---|---|
| production（Gemini Flash） | 平均 18.4s（14.9-21.4s） |
| 本機（claude-cli / sonnet） | **平均 65.6s（56.9-76.2s）**，且等待期間只有骨架屏 |

## 瓶頸分解（2026-07-15 CLI 探針實測，鏡射橋接呼叫形狀）

| 探針 | 牆鐘 | 輸出 tokens | 結論 |
|---|---|---|---|
| sonnet 最小回覆 | 3.9s | 4 | 固定開銷僅 ~4s（spawn 2.4s＋API 1.5s） |
| sonnet 長報告 2179字 | 48.4s | 2397 | 吞吐 **51.7 tok/s**——瓶頸 100% 在輸出生成 |
| haiku 長報告 | 60.9s | 3859 | 吞吐僅 +27% 且嚴重囉嗦（同要求寫 3462字）→ 反而更慢 |
| sonnet --effort low | 60.9s | 2811 | 更慢更長，無速度價值 |

中文 ≈ 1.1 token/字 → **生成時間 ≈ 字數 × 1.1 ÷ 52 秒**。字數就是唯一的錶。

## 拍板決策（使用者 2026-07-15 確認）

- **D-01 快捷模式報告收斂 600 字上限**：SI 拆兩版——快捷＝重點版（≤600字）、思考＝現行完整版原樣不動。收斂綁「模式」不綁 provider：production Gemini 快捷也同步受益（18.4s → 估 ~10s），語意與 UI 文案對齊（快捷=快速重點／思考=深入推理）。
- **D-02 串流輸出（NDJSON over chunked HTTP）**：新端點 `api/gemini-stream.ts`，僅進場分析（`analyzeEntryWithGemini`）走它；健檢／覆盤／基本面維持既有 `/api/gemini` 零變化。claude-cli 走 CLI `stream-json` 真串流；gemini-api provider 回單塊（prod 行為等同現狀，Gemini 串流留後續選項）。
- **D-03 本機兩檔位全走 sonnet、以 effort 分檔**：快捷 → `--effort medium`；思考 → `--effort max`（CLI 合法值 low/medium/high/xhigh/max，已實測 `--effort max` 成功回應）。`.env` 由使用者自行加 `CLAUDE_CLI_MODEL_THINKING=sonnet`（Codex 不碰 .env）。
- **D-04 週線預抓**：開分析彈窗即 fire-and-forget 抓 1wk（現在是按下開始後才抓，本機冷抓吃掉 ~4.5s 前置）。
- **D-05 串流中斷語意**：已顯示的部分文字保留＋文末附加中斷警語；部分文本**不寫快取**（快取僅收完整成功文本，沿用現行語意）。

## 已否決的替代方案（附證據，勿再提案）

- **換 haiku 提速**：探針證偽（囉嗦抵銷吞吐優勢，淨效果更慢；連回「OK」都吐 67 tokens）。
- **--effort low 提速**：探針證偽（更慢更長）。
- **SSE（text/event-stream）**：NDJSON 更簡單（無 event/data 框架、逐行 JSON.parse），且不需瀏覽器 EventSource（要 POST body，本來就得用 fetch reader）。
- **改造既有 /api/gemini 支援串流**：新端點隔離風險——健檢/覆盤/基本面呼叫端零改動，穩定路徑 diff 為 0。
- **輪詢 job fallback**：不需要——spike 已實證 vercel dev 與 Vite proxy 都如實透傳分塊（見下）。

## 規劃期已完成的 spike（Codex 不必重做）

1. **vercel dev 分塊透傳**：臨時端點寫 3 塊、間隔 600ms → 直打 3001 與經 Vite proxy 3000，分塊均以 ~600ms 間隔到達（非一次性到達）。**PASS，真串流可行**。探針檔已刪。
2. **CLI stream-json 事件形狀**：樣本存 `09-cli-stream-sample.jsonl`。要點：文字增量在 `type==='stream_event'` 且 `event.type==='content_block_delta'` 的 `event.delta.text`；結尾 `type==='result'` 事件帶 `is_error`＋完整 `result` 文本；前導有多行 `system` 事件、尾端可能有 `rate_limit_event`——解析器只認 delta 與 result，其餘忽略。
3. **`-p --output-format stream-json` 需搭配 `--verbose`**（CLI 硬性要求）。

## 預期成效（驗收量測對照）

| 指標 | 現況 | 目標（硬門檻） | 預估 |
|---|---|---|---|
| 本機快捷：首字出現 | 65.6s（無串流） | **≤10s** | 4-6s |
| 本機快捷：完整報告 | 65.6s | **≤30s** | 17-22s |
| prod 快捷：完整報告 | 18.4s | **≤14s** | 9-12s |
| 本機思考（sonnet max、完整格式） | —（現況 opus 未量測） | ≤90s、無逾時錯誤 | 45-55s |
