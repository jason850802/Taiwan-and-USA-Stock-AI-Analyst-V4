# P1 驗收新鮮度與 S1 健檢失效修正計畫

Status: in_progress

建立日期：2026-09-21。使用者已採用本計畫並授權依序執行兩票。**01 P1 的109份正式結果、36項負向矩陣、完整gate、保護及最終seal已通過，正建立第一個最終提交；02 S1在該提交後開始。** 各票最新狀態以票面與本案新證據為準；[執行提示詞](SESSION-PROMPT.md)保留為原交接入口。

## 入口與固定點

- 專案：`E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4`；CoS 路徑：`/taiwan-and-usa-stock-ai-analyst-`。
- 已核實的規劃基準：`b2bf7d8075eb31266d556afb0f874d37c3217bb4`。規劃開始時 tracked／staged diff 為空，另有未追蹤的 `.scratch/reacceptance-20260921/`，必須保留。
- 完整行為要求見 [spec](spec.md)，測試矩陣與完成規則見 [acceptance](acceptance.md)。正式票的 `Status:` 是本修正案的進度來源。
- 本案重新編號 01、02；**不是重跑或重開原最佳化計畫的 01、02**。P1、S1 是原審查發現識別，兩者原嚴重度均為 MEDIUM。

## 已確認的問題與來源

| 發現 | 現況及證據 | 本案交付 |
|---|---|---|
| P1 | replay 固定輸出目錄缺同次執行識別，漏跑時可能沿用舊成功檔。上一輪已透過隔離與移出舊結果排除污染，但原工具沒有修正。 | 工具自動拒絕缺案、混輪、舊頁面回傳及過期摘要，不依靠操作者手動清理。 |
| S1 | 同股票、同 lot 修改健檢相關持股輸入，舊完成報告仍顯示，在途舊報告仍可發布。01 基準已有此問題，非 05～12 新回歸。 | 相關持股資料保存後舊報告失效；明示需重新健檢，由使用者手動重新執行。 |

來源：[重新驗收結果](../reacceptance-20260921/RESULTS.md)、[Standards](../reacceptance-20260921/review-standards.md)、[Spec](../reacceptance-20260921/review-spec.md)。S1 的兩個正式 App 重現：[完成後修改](../reacceptance-20260921/workspace/.scratch/optimization-followup/evidence/12/app-same-symbol-completed-0.json)、[在途修改](../reacceptance-20260921/workspace/.scratch/optimization-followup/evidence/12/app-same-symbol-inflight-0.json)。上述紀錄是修改前證據，不是新修正的通過結果。

## 兩票順序

| 正式票 | 前置 | 修改責任 | 關票必要結果 |
|---|---|---|---|
| [01 — P1 驗收執行識別](issues/01-p1-replay-freshness.md) | 無 | 驗收啟動、頁面觀測、結果接收、讀取／彙總與封存。產品零改動。 | 反例能拒絕；完整新 replay 組可通過；獨立雙軸覆核完成；一個最終提交。 |
| [02 — S1 健檢持股輸入失效](issues/02-s1-health-input-invalidation.md) | 01 | 持股健檢生命週期、狀態呈現與必要回歸測試。 | 兩個既有重現轉綠、單檔／批次及不誤失效案例通過；雙軸覆核完成；一個最終提交及全案交接。 |

先 P1 是為了讓 S1 的新結果有可靠來源。本案不把「有 runId」當成完整修復，也不把「只刪除舊報告」當成完整 S1 修復；具體邊界由 spec 的條款決定。

## 實作探索位置

下表是規劃當下的責任入口，不要求照行號打補丁；動工前仍須讀現況與使用端。

| 責任 | 現有入口 |
|---|---|
| P1 啟站及結果附加 metadata | `.scratch/optimization-followup/evidence/12/replay-server.mjs` |
| 頁面啟動／回傳觀察 | `.scratch/optimization-followup/evidence/12/integration-bootstrap.js` |
| 案例驗證、05 前後彙總、封存 | 同目錄 `verify-replays.mjs`、`summarize-queue.mjs`、`seal-results.mjs`；沿實際讀寫鏈檢查相關消費端。 |
| 既有執行識別參考 | 同目錄 `stream-server.mjs`、`cache-app-server.mjs`、`keyboard-server.mjs`；只參考必要模式，不建立通用驗收框架。 |
| S1 每股票世代及健檢輸入 | `components/portfolio/useHealthCheck.ts`；單檔與批次共用守衛。 |
| S1 表格、報告視窗與重新健檢入口 | `components/portfolio/HoldingsTable.tsx`、`components/Portfolio.tsx`；只調整健檢狀態／型別及必要呈現。 |
| 保持原樣的服務／金融契約 | `services/gemini.ts`、`services/_shared/geminiCache.ts`、金融工具、`useDailySnapshot` 及本體資料層。 |

P1 可修改上述仍在使用的 12 驗收入口及必要消費端，並新增小型共用讀取／驗證責任。原 02～11 場景邏輯、既有行為斷言及歷史 JSON 不為新工具放寬。工具升版後，舊樣本只能搭配固定提交的舊工具重算；新工具不能替舊結果補蓋新 runId。

## 工作區與歷史保護

1. 新 session 先讀 [AGENTS](../../AGENTS.md)、[CORE_RULES](../../CORE_RULES.md)、[CONTEXT](../../CONTEXT.md)、[tracker 規則](../../docs/agents/issue-tracker.md)，再讀本案文件。診斷依專案 diagnosing-bugs skill；收尾依 code-review skill。
2. 重新確認 HEAD、merge-base、status、完整未提交差異、未追蹤檔及既有工作樹。若 HEAD 已向前，判定既有修正是否已落地；不可 reset 回規劃基準或重做已完成項目。
3. 為既有產品、測試／snapshot、package／lock、舊審查與 raw 建立清單／SHA-256。原 `.scratch/reacceptance-20260921/` 含 worktree 與大量證據，禁止 `git add .`、整包移動、刪除或提交它。
4. 可建立 `codex/` 工作分支或新的隔離 worktree；先盤點未提交內容，並確保新規劃檔及所有屬本案的候選修改都在實際實作位置，不能從舊 HEAD 開空 worktree 遺漏它們。
5. 新證據只寫本案 `evidence/01/`、`evidence/02/` 下的獨立執行目錄；不覆寫原 01～12 raw、重新驗收報告或 P2 已關閉的歷史證據。這些新目錄在實作時才建立。
6. 原根 `PLAN.md` 與原票面不重寫成「當時零缺口」。本案以新文件交代修正關閉；必要現況文件只在修正完成後追加新入口。

## 執行、覆核與提交

新 session 採用此計畫後，依序完成兩票，不在票間重問開始指令。先將當票改 claimed，再建立能命中原問題的紅燈；修正、受影響測試、完整 gate、獨立 Standards／Spec、修正覆核、證據與最終提交全部完成才 resolved。

Reviewer 沿用使用者既有明確授權的工具模型 ID `5.6`、推理 `high`，兩軸獨立上下文，作者不能代替 reviewer。工具不支援時記錄實際錯誤，不冒稱已覆核。提供完整固定點至候選的 diff／提交鏈，以及未提交新檔；覆核要包含 P1→S1 的交互作用。

每票一個最終提交：01 包含本案規劃與 P1 修正；02 包含 S1 修正與結案文件。不要 amend 原 `b2bf7d8` 或先前 01～12 提交。02 結案時回填新 01 的最終 SHA；02 自身 SHA 由交接回覆提供，避免循環改寫自己。若實際產生 merge，依根規則附 Code-Review trailer，不為此強造 merge。

完整 gate 的 805 項是已驗收基準，不是允許寫死的新測試總數。新增案例另外計數，原測試期望／snapshot 不改；舊封存器的固定計數應由新版本讀實際 gate 摘要及預期案例集合核對，不能為容納新數字移除檢查。

## 範圍與停止條件

僅修 P1、S1。P2 已關閉，不擴張至 OS 休眠、長時間 freeze 或 tab discard。不得新增套件、變更 AI 提示詞／型號／快取契約、修改費率／金額公式／rounding／匯率政策，或讀寫真實持股。只用隔離本機假資料與合成串流，未知 API 明確拒絕；不推送、部署或正式發版。

805 項既有測試若出現新的失敗，先定位並按根規則回報；本案新增預期失敗回歸不屬既有測試紅燈。若必須改金額語意，攤開現值、依據及影響再問；不得將它當一般修正自行決定。缺少必要瀏覽器／獨立覆核能力時保留未完成條款，不以純函式或歷史綠燈替代。

完成後交付本案 `RESULTS.md`：兩項修正前後差異、實際測試與 UI 結果、freshness 反例、雙軸 findings 處置、兩個 SHA、證據位置、剩餘限制及清理結果。回復以新 02→新 01 反向處理，先核工作區與依賴，保留原 01～12。完成兩票即停止。
