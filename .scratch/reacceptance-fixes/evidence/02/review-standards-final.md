# S1 Standards 最終獨立覆核

FINAL: PASS
OPEN: 0
NEW: 0

覆核日：2026-09-22。固定點及目前 `HEAD`：`db2c8cb9dbf64f04b92af22264b80d209d72dead`。固定點後尚無提交；以 `git diff db2c8cb9dbf64f04b92af22264b80d209d72dead --` 的 staged／unstaged 候選，以及本案未追蹤的 gate、bundle 和正式證據作比較。本報告只負責 Standards 軸；Spec 軸及最終 seal 由各自流程處理。

## 範圍與標準

覆核兩個產品檔 `components/portfolio/useHealthCheck.ts`、`components/portfolio/HoldingsTable.tsx`，S1 的 `evidence/02/tools/`、票據、規格、README、P1→S1 的來源及證據連結。依據根 `AGENTS.md`、專案 `CORE_RULES.md`、全域 `agent-dual-core/CORE_RULES.md`、`CONTEXT.md`、`docs/agents/issue-tracker.md`、`.planning/codebase/CONVENTIONS.md` 及 `.agents/skills/code-review/SKILL.md`。專案規則優先；Fowler 十二種 smell 是判斷性啟發式，非硬性違規，機械 gate 能強制的項目不另開人工 finding。

## Findings 與前次處置

**目前 OPEN 0、NEW 0，沒有未解的檔案／行號 finding。**

預覆核的兩項正式證據 blocker 已關閉：先前 `evidence/02/tools/formal-server.mjs` 只連結少數來源、工具及 `dist/index.html`，且固定輸出檔名可覆寫。現行 `evidence/02/tools/s1-run.mjs:18-24,40-74,77-98` 將 P1 的完整來源／建置／native 工具指紋與 S1 工具、fixture 合併，為每次執行建立 UUID 目錄、明確案例集合、不可覆寫 raw、版本 URL、binding 比對與完整集合驗證；`health-input-server.mjs` 及 `formal-server.mjs` 都使用此入口。真 HTTP 反例的 duplicate 皆回 409，錯誤頁面身分回 400，過期 URL 回 410。這不是把舊 precheck 改名為正式結果：新 manifest 各有獨立 runId，既有 `tools/runs/`、`tools/formal-runs/` 仍明列為 precheck。

另曾指出票據與規格 `Status:` 值夾帶說明、`Blocked by:` 夾帶 SHA，與 `docs/agents/issue-tracker.md`／`docs/agents/triage-labels.md` 的精確 tracker 欄位不合。現行 `.scratch/reacceptance-fixes/issues/02-s1-health-input-invalidation.md:3-4` 已為 `Status: claimed`、`Blocked by: 01`；`.scratch/reacceptance-fixes/spec.md:3` 為 `Status: claimed`，說明移到正文，已關閉。Spec 預覆核提出的舊非同步錯誤種類共用 ref，現行 `useHealthCheck.ts:21,162-181,196-206,258-286` 改為隨每次準備結果返回的 `PreparedHealthItem.fetchKind`，不再讓舊工作改寫新工作錯誤文案；此處只就 Standards 和資料所有權判斷，Spec 結論由另一軸獨立提出。

## 程式與證據核對

- 產品差異僅在上述兩個 portfolio 檔。`healthInputSignatures` 以每股票的 lot 身分、股數及既有健檢實際採用的成本分支／值建立穩定識別；未複製成本或損益公式，未將報價、即時匯率、排序及無關欄位納入編輯失效判斷。單檔與批次共用 per-symbol 世代；在途片段、AI 前過濾、結果、錯誤與 batch `finally` 各有身分守衛。`HoldingsTable` 使用匯出的 `HealthResult` 型別顯示「需重檢」入口，沒有以 `any` 掩蓋新狀態。
- hook manifest `ff4adbb5-1d8c-468e-8b68-041ad6e54421` 為 27/27；formal manifest `e9ed50d9-46c5-4d7e-b4a7-8b66391aba61` 的桌面、窄版各 18/18，兩尺寸各有 6 次假 AI 請求、5 次保存、trusted 鍵盤／輸入事件及零瀏覽器錯誤。兩組 `inputs` 相同，含 source 102、tool 47、build 15；我重新計算現檔 SHA-256，缺少／漂移均為 0，所有預期 raw 通過且沒有多餘檔。
- negative `308131bd-6b35-46a3-8997-ea7a4f884400` 為 9/9；除了 HTTP 拒絕，也在唯讀副本驗證 raw binding、缺案、來源 hash 與多餘檔案會被 verifier 拒絕。正式 App 由本機同源假服務供應；未知 API 回 403，沒有向真 AI／真持股或外網取資料。
- `checks/final-gate-v1.json` 為 exit 0、185 檔／3188 項、完整且金鑰掃描未降級；其中原母體 47 檔／805 項維持不變。`checks/final-bundle-v1.json` 量測 exit 0，其 `dist/index.html` SHA 與兩組 manifest 一致。`package.json`、`package-lock.json`、既有測試／snapshot 及歷史 `.scratch/reacceptance-20260921/` 相對固定點均無差異。

完整十二項 Fowler baseline 已逐項考量。新增 hook 的世代、簽章與狀態同屬一個持股健檢責任；案例 dispatcher 雖長，按公開情境順序排列並局限於驗收工具。未見足以提出可操作建議的 Mysterious Name、Duplicated Code、Feature Envy、Data Clumps、Primitive Obsession、Repeated Switches、Shotgun Surgery、Divergent Change、Speculative Generality、Message Chains、Middle Man 或 Refused Bequest。這是判斷性審查，並非把 smell 當成硬性規則。

本報告僅代表目前凍結的 S1 候選符合 Standards；最終 seal 須在雙軸報告齊備後另行產生，S1 票據也須依既定流程提交及結案。本次除撰寫本報告，未修改產品、工具、測試或 raw，未啟站、操作瀏覽器或重跑 gate。
