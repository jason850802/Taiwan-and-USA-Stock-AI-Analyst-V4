# P1 修改前：第二輪漏案仍讀到舊成功檔

2026-09-21，Node `v26.4.0`。本目錄已實際執行原版 `verify-replays.mjs`，確認第二輪少送一案時，固定輸出目錄中的第一輪成功檔會使舊 verifier 仍成功退出。新增缺案斷言精確呈紅燈；P1 工具尚未在本子任務修改。

## 可重跑命令

在專案根目錄執行：

```powershell
node --check .scratch/reacceptance-fixes/evidence/01/diagnosis/reproduce-stale-replay.mjs
node .scratch/reacceptance-fixes/evidence/01/diagnosis/reproduce-stale-replay.mjs
```

語法檢查 exit `0`。第二條命令固定重現舊版缺口，預期 exit `1`，每次產生新的 `run-<UUID>/`，不覆寫前次診斷。

對照命令只移開本次沙箱自建的漏案殘留副本，保留在同次目錄的 `control-removed-residue.json`：

```powershell
node .scratch/reacceptance-fixes/evidence/01/diagnosis/reproduce-stale-replay.mjs --without-residue
```

對照中舊 verifier 因指定缺案 exit `1`，缺案斷言通過，外層命令 exit `0`。這是原因對照，不能視為 P1 已修正。

## 真實執行結果

| 執行與證據 | 第一輪 | 第二輪 | 新缺案斷言／外層退出碼 |
|---|---|---|---|
| [第一次紅燈](run-090afddb-1313-4e6f-98e9-33d825aa7d4c/diagnosis.json) | 投遞 12/12；舊 verifier exit 0、12 案通過 | 投遞 11/12；保留漏案舊檔；舊 verifier 仍 exit 0、12 案通過 | 紅燈／1 |
| [第二次獨立紅燈](run-e2106667-918c-4b36-b737-d6cfc3edd8e2/diagnosis.json) | 投遞 12/12；舊 verifier exit 0、12 案通過 | 投遞 11/12；保留漏案舊檔；舊 verifier 仍 exit 0、12 案通過 | 紅燈／1 |
| [移開殘留的對照](run-ffea605a-70fa-47d9-8371-76ccf2468daa/diagnosis.json) | 投遞 12/12；舊 verifier exit 0、12 案通過 | 投遞 11/12；移開漏案舊檔；舊 verifier 因 ENOENT exit 1 | 通過／0 |

漏案固定為 `desktop-green-stale-return.json`。第一輪成功及保留殘留的第二輪錯誤成功，舊 verifier 的真實 stdout 都是：

```json
{"group":"03","cases":12,"formalApp":12,"sourceFiles":94,"allPassed":true}
```

外層新增斷言實際輸出：

```text
P02：本輪只投遞 11/12 案，原 verifier 卻接受第一輪殘留檔並成功退出
```

第一次執行於 `2026-09-21T08:37:50.675Z` 開始、`08:37:55.678Z` 完成，含複製及完整來源核對共約 5 秒；兩次原版子程序分別 169.031／159.261 毫秒。終端執行紀錄為 `96637`（語法檢查與第一次紅燈）、`55092`（第二次紅燈與對照）。後者整批退出碼因前一條預期紅燈為 1，各命令的個別退出碼如上表。

## 原 bytes 與種子來源

固定提交為 `b2bf7d8075eb31266d556afb0f874d37c3217bb4`。原 verifier 從唯讀歷史工作區 `.scratch/reacceptance-20260921/workspace/.scratch/optimization-followup/evidence/12/verify-replays.mjs` 取得；執行前以 `git show <固定提交>:<原工具相對路徑>` 的二進位輸出逐位元組比對。

| 檔案 | SHA-256 |
|---|---|
| 原 verifier，5190 bytes | `eee7dc28da3467e4968038d5b8add1c03c58b7a9d523db7ddd231444e35b9b58` |
| 診斷腳本 | `538f34c281f19872d5d0cd65668d38b4b743e02b7b66671c7f73b5855639f2d5` |
| 漏案歷史 raw `desktop-green-stale-return.json` | `e9e8478b880c1af2278fdaaf417bb299af44ae5366e65e98e8bf275df8ad546a` |

原 03 組是舊 verifier 可選的最小完整組：五項場景及原生市場操作，桌面與窄版各六案。12 份 raw 都來自上述歷史工作區的 `replay-03/`；沒有刪減原 verifier 的預期集合或行為斷言。

腳本在本案 `diagnosis/run-<UUID>/snapshot/` 下重建原相對目錄，複製 94 個來源檔、必要工具、audit 與 build index。原 verifier 及所有輸入 bytes 均保持原樣；**沒有改寫 root／dir、沒有修改驗證邏輯**。原程式依自身位置讀取沙箱輸入、寫入沙箱摘要，透過真實 Node 子程序執行，不是模擬回傳 `passed:true`。

第一輪複製全部 12 份成功 raw。第二輪僅重送其中 11 份相同的歷史 bytes，明確不碰漏案的同名檔；獨立 `receipts/round-1.json`、`round-2.json` 記錄每輪投遞與缺案，沒有把診斷輪次或 runId 寫進 raw。漏案副本的 bytes 與修改時間在第二輪投遞前後相同。各執行最後重新核對 117 份歷史輸入，`changedOriginals` 均為空。

每份 `diagnosis.json` 保存全部工具／來源／build／raw 的路徑、bytes 或 hash、原版子程序的 executable／arguments／cwd／命令／stdout／stderr／退出碼及斷言。`round-1-verified-replay-03.json` 與成功時的 `round-2-verified-replay-03.json` 是原程式真正輸出的摘要，各輪分開保存。對照第二輪失敗時不複製上一輪摘要充數。

## 原因與對照

紅燈形成後向 prime 回報的優先假說為：固定檔名殘留被當作本輪結果；其次是來源／工具／build 不一致造成別種失敗，或誤用已存在的摘要。第一輪正常成功、原版真子程序輸出及逐位元組核對排除後兩種解釋。隨後只移開沙箱中的指定殘留檔，第二輪即在原 verifier 第 33 行讀取該檔時因 ENOENT 失敗。

根因是原 verifier 按 `replay-03/<固定檔名>` 取得預期案，核對 `passed` 與來源／工具／build，卻沒有本輪收件身分。兩輪相同來源和 build 的合法成功檔自然都通過那些檢查，不能證明這一輪實際產出過漏掉的案例。原版輸出的 raw hash 也只是記錄讀到的內容，沒有補上執行歸屬。

此結果完成 P02 的修改前精確重現與最小紅燈。它是歷史捕捉資料的檔案投遞模擬，**不是本次新瀏覽器驗收**；不計入新版要求的 88 案加 21 份前版結果，也未完成 P03～P12、新版接收端、封存、gate 或雙軸 review。這支診斷命令刻意固定舊工具以保存修改前證據；新版 P02 回歸仍需透過新版入口、真實清單與 runId 另外驗證。

本子任務只新增本目錄腳本及證據，沒有修改原工具、產品、測試／snapshot、package／lock或歷史 raw；沒有啟站、瀏覽器操作、gate、stage 或 commit。先前代理訊息工具曾回 `AGENTS_BUSY`，後續訊息已成功排入既有 prime；此工具歸屬錯誤沒有影響實驗。
