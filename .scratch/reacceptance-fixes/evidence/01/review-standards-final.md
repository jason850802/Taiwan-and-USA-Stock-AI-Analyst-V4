# P1 Standards 最終覆核

- 覆核日期：2026-09-22（Asia/Taipei）
- 固定點／目前 `HEAD`：`b2bf7d8075eb31266d556afb0f874d37c3217bb4`
- 最終批次：`p1-final-body-fix-bca2fd9c-4ce9-4fc3-9137-e499bfe19599`
- manifest：revision 5，definition SHA-256 `f3b56510dda315acc4486db0cc0c236619910ea077a8466f302680991e6cec83`
- 覆核結論：**PASS；NEW findings 0**

## 範圍與基準

本次以 `git diff b2bf7d8075eb31266d556afb0f874d37c3217bb4`、staged／unstaged 狀態及本案未追蹤來源為完整候選，覆核 30 份 staged 程式檔與 1 份 tracked unstaged README；未把 `.scratch/reacceptance-20260921/` 歷史副本納入候選，也未修改該目錄。`HEAD` 仍在固定點，固定點外沒有產品程式差異；本案變更限於 `.scratch/` 的驗收工具、保護工具、證據與文件。

判斷依序採用專案 `CORE_RULES.md`、全域 shared baseline、`.planning/codebase/CONVENTIONS.md`／`ARCHITECTURE.md`，並逐項套用 `.agents/skills/code-review/SKILL.md` 的完整 Fowler smell baseline。smell 僅作啟發式判斷；可由既有 gate、fingerprint、protection 與格式工具機械核對的事項，不另製造人工 finding。

## Findings

**NEW findings：0。**

先前 `S-P1-01`、`S-P1-02`，以及交叉覆核的 `P1-SPEC-02`、`P1-SPEC-04` 仍符合原 closure 條件，不重開：

- source freeze 已涵蓋 `index.css`、PostCSS／Tailwind 等實際 App／build 輸入。
- tool freeze 已涵蓋實際 esbuild native binary 與 package metadata。
- gate runner／entrypoint provenance、04／05 動態 harness artifact 身分仍由 manifest、verifier 與 seal 連結。
- 新增的 browser linkage verifier 逐欄驗證 duplicate identity；P05 的舊 raw、重啟、late metadata、舊 bootstrap／upload 拒絕及後續 `protocolOnly passed:false` receipt 有同一條可核時間線。

真實 manual 路徑曾揭露 `viewport-controls.mjs` 在成功回應也先呼叫 `response.text()`、使後續 `response.json()` 出現 `Body is unusable`。目前程式只在非成功回應讀取錯誤 body；精準 red／green regression 已由失敗 SHA `474d…` 轉為目前 SHA `599e…` 的 2/2 通過。較早、工具指紋不同的批次只保留為 precheck，未被升格進 revision 5。

## 凍結與最終證據

- 我以目前檔案重新計算 manifest 的 102 份 source、38 份 tool、15 份 build SHA-256：missing 0、mismatch 0。manifest 本身 SHA-256 `093801d62a253e1fa885e6b93d56beb36b2905f742cd6846cd969d3800a1095a` 與 seal 相同。
- `verified-replays.json`：109/109 通過；分組為 02 `22/22`、03 `12/12`、04 `25/25`、05-before `21/21`、05-after `29/29`，其中 formal App 38。`queue-summary.json` 與 final seal 均為 `allPassed`；seal 計數為 replays 88、queueBefore 21、formalApp 38。
- 最終 full gate `linkage-final-gate.json`：exit 0、185 files／3188 tests、`fullGate: true`、secret scan 未降級。summary 分開列出原測試 47 files／805 tests、歷史副本 138 files／2383 tests、新增測試 0。
- 最終 fingerprint regression：50/50 通過、failed 0、legacy gate unchanged；raw-negative：36/36 通過且 `changedOriginals: []`。
- browser linkage final timeline：9/9 通過；確認原空收件發生在明標失敗 fixture 之前，當前該獨立 run 只有 1 份 raw、成功 raw 為 0。failed-receipt 證據亦通過：首次保存 `passed:false`，同 case 重送 409，既有 bytes／failed state 未被覆寫。
- 04、05-before、05-after 三份 HTTP artifact 核對皆通過；各自核對實際 `/harness` 回應、header、HTML、response body 與保存檔 SHA，而非只比較記憶體物件。
- final protection 通過：test、package、歷史副本 mismatch 均為 0，unexpected changes 為 0；`baselineHead` 與 `currentHead` 都是固定點。
- `final-seal.json` 為 `allPassed: true`、manifest revision 5，並綁定最終 gate、verified replays 與 queue summary 的 SHA-256。封存說明正確限縮為本案 P1 的 109 份新結果，未宣稱原 213 案重跑或 S1 已修正。

## Standards 判斷

候選將 replay contract、HTTP server、batch capture、負向 regression、browser linkage 與 protection 分成可獨立執行的工具；每個入口的責任雖有較多證據欄位，但這些欄位共同維護同一個可重放、可拒絕漂移的證據契約。依完整 Fowler baseline 檢查後，未看到足以構成可採取 finding 的長函式、重複邏輯、過長參數列、資料泥團、分散式修改或全域狀態問題。此次 CUA 適配也維持人工操作者負責 App 輸入／點擊，controls 僅暴露 `/viewport` 觀測按鈕；沒有用工具自動操作 App 來替代原驗收語意。

本報告只判定 P1 最終候選符合目前文件化 Standards。它不擴張到 S1、正式發版或產品功能的新結論；除新增本報告外，覆核過程未改來源、未啟站、未操作 browser、未重跑 gate。
