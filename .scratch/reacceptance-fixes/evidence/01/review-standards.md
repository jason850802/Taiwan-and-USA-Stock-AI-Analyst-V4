# P1 Standards 候選程式覆核

日期：2026-09-21  
固定點：`b2bf7d8075eb31266d556afb0f874d37c3217bb4`  
候選：同一 HEAD 上的完整 working tree 與本案新工具；`git log b2bf7d8..HEAD --oneline` 為空。  
狀態：**OPEN — 程式／方法 finding 2 項；109 fresh 與最終 full gate 尚未完成，因此本報告不是 P1 CLOSED 證明。**

## Standards 基準與範圍

已重讀 `AGENTS.md`、`CORE_RULES.md`、`.agents/skills/code-review/SKILL.md`，依 repo 規則及 Fowler smell baseline 覆核；smell 僅作 heuristic，沒有把 heuristic 當成強制缺陷。本輪檢查完整 tracked diff、P1 新工具、P1-01～08、P01～12 的驗收方法、修改前紅燈、21 項協定回歸、P05 真 browser 重啟負向證據、P11 同活站補案證據及保護／gate 工具。產品程式、原測試與歷史 raw 本輪未由 reviewer 修改。

## OPEN findings

### S-P1-01 — manifest 的來源集合漏掉實際 App／build 輸入

`tools/replay-contract.mjs` 的 `rootSources` 目前只列 `App.tsx`、`index.tsx`、`types.ts`、`index.html`、`vite.config.ts`、`tsconfig.json`、`package.json`、`package-lock.json`；其餘只遞迴 `api/`、`components/`、`config/`、`services/`、`utils/`。因此以下實際輸入沒有進 `sourceHashes`，也不會被 `loadManifest()` 在收件、verifier、queue 或 seal 時重算：

- `index.css`：`index.tsx:1` 直接 `import './index.css'`，是正式 App source。
- `postcss.config.js`、`tailwind.config.js`：是該 CSS／Vite build 的直接建置輸入。

這使 P1-04／P07 要求的「完整來源集合及雜湊」仍不成立。尤其來源在 dist 未重建前漂移時，manifest/raw 身分本身看不到變更；最終 protection 能檢查最後工作樹，不能倒推出每份 raw 當下使用的完整來源 snapshot。

修正要求：至少把上述三檔納入批次來源／build input 指紋，並新增 exact-set 負向回歸（例如刪掉 `index.css` hash 必須拒絕）。`replay-contract.mjs` 是 raw 的核心工具，因此修正後既有 `p1-final-6ce4245f-...` 及其 raw fingerprint 必須保留為 precheck，重新建立 manifest 並重跑受影響正式證據。

### S-P1-02 — esbuild 工具指紋沒有涵蓋實際執行的 native binary

同檔 `toolFiles()` 有意把 esbuild 納入 `toolHashes`，但只列 `node_modules/esbuild/lib/main.js` 與 `node_modules/esbuild/package.json`。04／05 fixture 在 runtime 呼叫 `esbuild.build()`；目前安裝的 `main.js` 會由 `generateBinPath()` 啟動 `node_modules/@esbuild/win32-x64/esbuild.exe`，而該 executable 沒有被 hash。當前 `ESBUILD_BINARY_PATH` 未設定，所以實際就是這個預設 binary。

因此 native executable 漂移時，manifest、raw、verifier 與 seal 都仍會視為同一工具集合，未達 P1-04／P07 的完整 tool fingerprint。修正要求：固定並記錄實際 resolved esbuild executable（本環境至少 `node_modules/@esbuild/win32-x64/esbuild.exe`，以及對應 package metadata）；若允許 `ESBUILD_BINARY_PATH`，則必須把實際 resolved 路徑／hash 納入身分。這項修正同樣會改核心 contract fingerprint，須重建正式批次。

## 已重核關閉的先前方法缺口

- 頁面身分：HTML 初載直接內嵌 binding；bootstrap URL 同時含 `runId` 與 bootstrap SHA，bootstrap 不再靠 `/__integration/meta` 認領新輪。真 browser precheck 保存同頁跨 server restart：舊 run 上傳 `409`、舊 bootstrap `410`、新 run raw 為空。
- 05-before：binding 已將固定 `0366f5f...` 的 `beforeSourceHashes` 與目前 `hostSourceHashes` 分開，並標示 `buildUse=hook-only-current-dist-not-served`；不再以 after/current source 冒充 before。
- exact raw／run：每次啟站新 UUID 目錄；startup/state/raw 皆綁 batch/group/run。verifier 從 manifest expected 集合重讀 startup、receipt、raw，不掃固定歷史目錄補案。
- 寫入：raw 使用同目錄 temp→rename，首次 case 採 exclusive `wx` 鎖；成功或失敗第一次收件都保留，重複 case 明確 `409`，不能覆蓋失敗。
- queue／seal：queue 先重算 05-before/after 所選 run；seal 再重算五組 raw、queue，並與已保存摘要逐值比對，摘要 revision/run/raw 漂移會失敗。
- legacy CLI：replay／verify／queue／seal 缺 manifest 的舊命令已由 21 項協定回歸實跑為非零退出並提示新版 manifest 入口。
- gate 母體：新 `gateDetails()` 不再把 nested historical worktree 的 2383 tests 當新增母體；原 47 檔／805 案與 49 個 tests/snapshots 依固定點逐 byte 鎖定，歷史副本另計。

## 證據方法判斷

修改前 P02 紅燈有效：診斷腳本逐 byte 核對原 `verify-replays.mjs` 與固定點後，以真 Node 子程序執行；第二輪實際只投遞 11/12，但指定舊成功 raw 未被碰觸，原 verifier 仍 stdout `allPassed:true`／exit 0；只移開該殘留後同一原 verifier 因該檔 ENOENT exit 1。這不是手造 `passed:true`。

21 項 structural regression 對初載 binding、missing source/tool/build、duplicate/atomic、非法路徑／半份 manifest 及四個 legacy CLI 有直接負向斷言；P05 browser-negative 又以真正既有頁面跨 restart 補足 VM 無法證明的舊頁情境。方法本身未見自證 PASS 的新缺口。

## Pending 完成條件

1. 修正 S-P1-01／S-P1-02 後建立新的 final manifest；目前 `p1-final-6ce4245f-...` 不可作最終候選證據。
2. 以最終工具 fingerprint 完成 fresh 109（02～05-after 88 + 05-before 21）、五組 select、verifier、queue 與 seal，並重跑因核心 contract 改動而受影響的 P05／P11 證據。
3. 用最終 fresh raw 實跑 `replay-raw-regression.mjs`，完成 P01～P12 中依賴真 raw 的 P02／P03／P04／P06～P10，以及 final manifest 下的正常副本 P01。
4. 最終 full gate 必須重新執行且 secret scan 不降級。現階段 `.scratch/reacceptance-fixes/` 是 untracked；`scripts/run-gate.mjs` 的原始碼掃描只走 `git ls-files`，所以目前 full gate 不會掃到新增 `.mjs`。依 `acceptance.md`「新原始碼須納入受掃描範圍再執行最後 gate」，最終 gate 前須先讓這些新 source 進受掃描集合，或提供等價且可稽核的補充 secret scan。
5. 最終 protection 重新核對產品、原 tests/snapshots、package/lock、歷史證據零非預期變更；本輪看到的 `after-baseline-protection.json` 是工具修改前的早期紀錄，不能替代收尾結果。

在以上 pending 完成且兩個 finding 關閉前，Standards 結論維持 **OPEN**；目前沒有其他需要修的 Fowler heuristic finding。

## 2026-09-21 fix-review 追加覆核

本節覆核作者針對前述兩項 Standards finding，以及 Spec reviewer 另報的 gate provenance 與 04／05 harness 實際 bundle fingerprint 兩項缺口所做修正。固定點仍為 `b2bf7d8075eb31266d556afb0f874d37c3217bb4`，HEAD 仍同固定點、區間 commit log 為空；候選為目前完整 working tree。此次只做唯讀程式／方法覆核，未啟站、未操作 browser、未跑 gate、未 stage／commit；除本報告外沒有修改其他檔案。

工具 freeze 為 `evidence/01/review-fix-freeze-8f3c3c94-c7ff-4d9b-9a72-6fe359e6c424/result.json`，其中核心 `replay-contract.mjs` SHA-256 為 `59d53cc8ee7c8a807dd07c2f326bd9b16cd6e969a99bca438d89bc325586774a`、`evidence/12/replay-server.mjs` 為 `9598dc074090f49980fb2e7b72227d630b90cadf943146c3d8d9f400c9948084`；review 時重新計算目前 bytes 與這兩個 freeze 值一致。freeze 保存的完整 fingerprint 為 current source 102 檔、05-before source 99 檔、core tool 37 檔、dist 15 檔。

### S-P1-01 / P1-SPEC-01 — CLOSED at program/method level

`rootSources` 已加入 `index.css`、`postcss.config.js`、`tailwind.config.js`，所以 current `sourceHashes`、固定 `0366f5f...` 的 `beforeSourceHashes`、`createBatch()` 的 source-vs-dist mtime 檢查及後續 `loadManifest()->fingerprints()` 漂移檢查都使用同一完整來源定義。三檔同時與原 protection 的 tracked bytes 相符，沒有替 protection 補寫新值。

`replay-fingerprint-regression.mjs` 不只檢查三個 key 存在：對 current source 與 before source 各做必要欄位，current 另做 hash drift 與「刪一個 key、補同 hash 的 unrelated key」反例，因此不是只靠檔案數量判完整。舊 contract `cd6273c...` 的 red run 45 項中 29 項失敗；freeze contract `59d53cc...` 的同類 green run 45/45 通過。此 finding 的原缺口已由 exact-set 契約與負向回歸關閉。

### S-P1-02 / P1-SPEC-03 — CLOSED at program/method level

`esbuildRuntime()` 不再 hardcode 單一主機路徑後就自行宣稱完整，而是從目前安裝的 `node_modules/esbuild/lib/main.js` 擷取其平台解析段，以唯讀 VM 執行 `pkgAndSubpathForCurrentPlatform()`／`generateBinPath()`，要求 native optional package、禁止 WASM fallback，並確認 `generateBinPath()` 的 resolved binary 與 `require.resolve(<platform package>/esbuild.exe)` 一致。實際 binding／manifest 會保存 API、API package、native executable、native package metadata、版本、platform／arch／endianness與 resolution；四個 runtime 檔都進 `toolHashes`。本案明確拒絕 `ESBUILD_BINARY_PATH`，故不留下 override 未綁定的旁路。

更重要的是，回歸另以完整未改的 esbuild API 實際呼叫 `build()`，只在 `child_process.spawn` 邊界截停，不執行 executable；觀察到 API 真正準備啟動的 command 正是 `node_modules/@esbuild/win32-x64/esbuild.exe`，其 binary/package SHA 再與 contract 的 runtime 解析結果逐值比較。這把「解析器自我解釋」與「實際 build API 執行路徑」分開驗證。missing/drift/same-count-wrong-set 及兩種 `ESBUILD_BINARY_PATH` override 亦有負向案例。此 finding 關閉。

### P1-SPEC-02 — CLOSED at program/method level

`run-check.mjs` 原本就會在 gate record 寫入 `runnerSha256` 與 `entrypointSha256`；現在 contract 新增 `gateToolFiles`／`gateProvenance()`，將 `.scratch/reacceptance-fixes/run-check.mjs` 與 `scripts/run-gate.mjs` 同時納入 `toolHashes`，且 `gateDetails()` 每次讀 gate record 時重算目前兩檔 SHA 並要求 record 值完全一致。舊 `baseline-gate.json` 沒有這兩欄，現 contract 實際明確拒絕，沒有補寫舊 gate。

fingerprint regression 對兩欄各有 missing／drift 拒絕，並保存 legacy gate bytes 未改；因此原本「有記錄、seal 不核」的旁路已消失。正式證據仍需 prime 新跑帶 provenance 的 baseline gate，並以該 gate 建新 manifest；之後用真新 gate 再跑 `gateDetails()` pass 與負向副本，是正式關票證據而不是剩餘程式缺口。

### P1-SPEC-04 — CLOSED at program/method level

04／05 原 `fixture-server.mjs` 的 `build()` 分支沒有重寫 build 選項或 05-before fixed-source plugin；`replay-harness-adapter.mjs` 精確抽取原 `/__fixture/holdings.js` 分支，把同一段 build body 搬到 `createServer(...).listen(...)` 前，只把最後的 `content = bundle` 改成 `replay.captureArtifact('holdings.js', bundle)`。原 branch 之後只會拒絕舊固定 artifact 路徑；HTML 改用 `/__integration/artifacts/<runId>/<sha256>/holdings.js`。

contract 對 04、05-before、05-after 明確要求唯一 `holdings.js`；`captureArtifact()` 只能在 listen 前執行、同 run 同名只能保存一次，使用 atomic exclusive write，保存後由實際檔案 bytes 算 SHA 並更新 run binding。`markListening()` 先重算 artifact 集合與 bytes；startup/state 保存該 hash；`serveArtifact()` 每次送出前再重算 bytes；`accept()` 在收 raw 前再重核 input fingerprint 與 artifact；`verifyRun()`／queue／seal 最後亦從 run 的 artifact 檔案重算並要求 startup/state/raw binding 完全相同。05-before 因而不再只以 current `dist` 身分代表實際 hook bundle。

回歸方法分三層：22 項 artifact contract red 22 fail → green 22 pass，涵蓋 missing hash/file、bytes drift、extra file、初載 binding 與 duplicate capture；adapter preflight 對五組生成後來源做語法檢查，並對 04／05-before／05-after 真正執行原 esbuild `write:false` build，三個 run 均保持 `starting`、無 startup、raw 0、listener 0，同時直接呼叫 handler 取得 `/harness` HTML，確認頁面 binding 等於該 run binding 且 script URL 帶該 run 的 artifact hash。這不是 browser／HTTP PASS；真 listener 所服務 bytes 與 browser 實際執行仍由 prime 的新 109 補最終證據。程式與回歸方法本身足以關閉原實作 finding。

### NEW findings

**0 個新的程式／方法 finding。** 完整重讀 `replay-contract.mjs`、`replay-harness-adapter.mjs`、`evidence/12/replay-server.mjs` 與新增 fingerprint／artifact／adapter/raw regressions 後，未發現會繞過 run/source/tool/build/raw 綁定的新 PASS 路徑，也未見為關閉 finding 而縮小原 02～05 場景或改產品金融／提示詞行為。

先前 09:53 的 `checks/review-fix-protection.json` 的確早於最後 adapter freeze；prime 隨後已在 freeze 後真跑 `checks/after-review-freeze-protection.json`（10:05，exit 0 等價結果），重新確認 49 個原 test/snapshot、package/lock 與 2233 個歷史檔均無 mismatch，且 tracked changed 集合只有本票授權的六個 `evidence/12` 檔。該紀錄中的 `replay-server.mjs` actual SHA 已是 freeze/current 的 `9598dc074090f49980fb2e7b72227d630b90cadf943146c3d8d9f400c9948084`，所以 protection 時序缺口已補上，沒有形成新 finding。

目前正式證據真正的能力缺口是 provenance baseline gate：prime 已嘗試命令 `node .scratch/reacceptance-fixes/run-check.mjs 01 provenance-baseline-gate gate`，但執行工具在程序啟動前以安全狀態不確定為由封鎖；`checks/provenance-baseline-gate-blocked.json` 明記 `processStarted:false`、`exitCode:null`、`gatePassed:false`，且沒有 `checks/provenance-baseline-gate.json`。因此不能把這次封鎖當 gate 失敗，也不能把舊 baseline gate 補欄重用；它只表示正式新 manifest／109／seal 目前仍被真 provenance gate 前置條件阻塞。

### Current Standards status after fix-review

前述 `S-P1-01`、`S-P1-02` 及 Spec 交叉提出的 `P1-SPEC-02`、`P1-SPEC-04` 四項，**程式與回歸方法均可判 CLOSED**。Standards 目前 **fix-review NEW 0**，但整張 P1 仍不在本節宣稱 CLOSED：必須等待 prime 以 frozen tool fingerprint 建立新的 provenance baseline gate／manifest，完成 fresh 109、P05/P11 新 run 證據、真 fresh raw 負向矩陣（含 artifact drift）、最終 full gate、final protection、verifier／queue／seal，再由雙軸依 final manifest 正式收尾。
