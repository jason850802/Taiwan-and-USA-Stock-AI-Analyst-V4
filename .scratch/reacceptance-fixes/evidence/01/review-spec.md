# 01 P1 Spec 獨立覆核

狀態：**進行中／有實作缺口，尚不可關票**  
覆核軸：Spec only（Standards 由另一獨立 reviewer 負責）  
固定點：`b2bf7d8075eb31266d556afb0f874d37c3217bb4`  
候選：同一 HEAD 加完整 working tree 與本案新檔；`git log b2bf7d8..HEAD --oneline` 為空。

本次對照 `.scratch/reacceptance-fixes/spec.md` 的 P1-01～P1-08、`acceptance.md` 的 P01～P12，以及 `issues/01-p1-replay-freshness.md`。已讀六個 `evidence/12` 修改入口、`reacceptance-fixes/tools/*.mjs`、`manual-market.mjs`、`run-check.mjs`、保護／gate 摘要與 browser-negative 驗證器。此報告先記程式本身可判定的 finding；109 份正式 fresh、final gate、真 raw 負向矩陣與 seal 尚未全部就緒，因此目前不宣稱驗收完成。

## OPEN findings

### P1-SPEC-01 — manifest 的完整來源集合漏掉實際 build 輸入

**對應規格：** P1-04 要求核對「完整來源與工具集合及雜湊」；P07 要求缺少任一必要 source/tool/build hash 都失敗。

`.scratch/reacceptance-fixes/tools/replay-contract.mjs` 的 `rootSources` 只列 `App.tsx`、`index.tsx`、`types.ts`、`index.html`、`vite.config.ts`、`tsconfig.json`、`package.json`、`package-lock.json`，再加 `api/`、`components/`、`config/`、`services/`、`utils/`。它漏掉三個已追蹤且會影響正式 Vite/CSS build 的根檔：

- `index.css`：`index.tsx` 第 1 行直接 `import './index.css'`。
- `postcss.config.js`：PostCSS build 設定，載入 Tailwind plugin。
- `tailwind.config.js`：Tailwind build 設定。

因此 `fingerprints().sourceHashes` 的「目前來源」不是完整 build source set，`beforeSourceHashes` 也沿同一 `productFile` 定義；`createBatch()` 的「來源 mtime 不得晚於 dist」檢查同樣完全看不到這三檔。P07 結構回歸雖有刪除 source hash 的案例，但只在這個已縮小的集合內故障注入，所以不能證明「必要來源 hash 不可缺」。

目前 formal manifest `batches/p1-final-6ce4245f-e290-46e3-90d0-e2a0cddb7e33/manifest.json` 的保存內容也找不到上述三個檔名，故這不是未來才可能發生的邊界，而是本批次已採用的來源定義。

**影響：** manifest/raw 可以在沒有綁定這些 build input 的情況下宣稱完整 source/build provenance；這是 P1-04／P07 的實作缺口。若修正 `sourceFiles()`／fingerprint 定義，既有正式批次的 definition/tool fingerprint 會改變，依本案 README 自身規則應保留既有批次作 precheck，另建正式批次重跑。

### P1-SPEC-02 — final gate 的 runner／entrypoint SHA 有記錄但 seal 沒有核對

**對應規格：** `spec.md` P1-06 明定 verifier／摘要／seal 遇工具或 build 漂移須非零退出；`acceptance.md` 第 9 行要求保存候選完整來源與工具集合及實際執行命令，票據第 25 行要求 run／source／tool／build 指紋可沿彙總／封存鏈重算。

`.scratch/reacceptance-fixes/run-check.mjs` 產生 gate record 時已有：

- `runnerSha256`：`run-check.mjs` 自身 SHA-256。
- `entrypointSha256`：實際 `scripts/run-gate.mjs` SHA-256。

但 `.scratch/reacceptance-fixes/tools/replay-contract.mjs` 的 `gateDetails()` 只核 `command`、exit/signal、log SHA、`GATE 全綠`、secret scan 與 test rows，沒有把 record 內兩個 SHA 與目前檔案重算比較。同時 `toolFiles()` 不含 `run-check.mjs`，`sourceFiles()` 不含 `scripts/`，所以 manifest fingerprint 也不會抓到這兩個 gate 執行工具漂移。

`scripts/run-gate.mjs` 是 tracked，最終另跑 protection 可以從整體工作樹角度發現它被改；但 untracked 的本案 `run-check.mjs` 不在起始 tracked protection 內，而且 P1-06 要求的是 seal 鏈本身拒絕工具漂移。以目前程式，gate record 產生後 runner 或 gate entrypoint 漂移，seal 仍可接受該舊 record。

目前 formal manifest 同樣沒有 `run-check.mjs` 或 `scripts/run-gate.mjs` 的 source/tool fingerprint；其固定的 `checks/baseline-gate.json` 是在 `run-check.mjs` 加入 `runnerSha256`／`entrypointSha256` 之前產生，該 record 本身也沒有這兩欄，更凸顯 gate tool provenance 尚未納入批次契約。

**影響：** final gate provenance 尚未沿 seal 閉環。應將兩個工具納入可重算 fingerprint，或由 `gateDetails()` 明確重算並核對 `runnerSha256`／`entrypointSha256`；修正會影響正式驗收工具身分時，同樣需依 fingerprint 規則處理既有批次。

### P1-SPEC-03 — 04／05 動態 bundle 的實際 esbuild native binary 未納入 tool fingerprint

**對應規格：** P1-04 的「完整來源與工具集合及雜湊」以及 P07 的必要 tool hash 缺漏拒絕。

04／05 的原 fixture server 會在驗收執行期間呼叫 `esbuild.build()` 動態產生 hook harness bundle。`toolFiles()` 目前只把 `node_modules/esbuild/lib/main.js` 與 `node_modules/esbuild/package.json` 納入 `toolHashes`。但此 Windows x64 環境沒有設定 `ESBUILD_BINARY_PATH`；`esbuild/lib/main.js` 的 `pkgAndSubpathForCurrentPlatform()` 對 Windows x64 明確選 `@esbuild/win32-x64` 與 `esbuild.exe`，`generateBinPath()` 再用 `require.resolve()` 取得該 native executable。實際檔案 `node_modules/@esbuild/win32-x64/esbuild.exe` 存在，約 10.1 MB。

目前 manifest/toolHashes 沒有 `@esbuild/win32-x64/package.json` 或 `esbuild.exe`。因此 native bundler bytes 可漂移而 manifest、接收端、verifier、queue、seal 仍看見相同的 JS wrapper/tool hash；對 05-before 這尤其直接，該組的 hook-only bundle 正是在執行時由這個 native binary 產生。

**影響：** P1 的「完整工具集合」仍缺一個實際執行元件，且現有 P07 missing-tool regression 只會刪除已列入的 wrapper hash，抓不到 native binary 漏列。修正 `toolFiles()` 後正式 batch fingerprint 會改變，需依本案規則重建正式批次。

### P1-SPEC-04 — 04／05 harness 真正執行的動態 bundle 沒有 build fingerprint

**對應規格：** P1-03 要求來源、工具、候選、建置及案例 metadata 由伺服器核實；P1-04 要求案例／檔案完整性；票據第 25 行要求 raw／source／tool／build 指紋沿彙總／封存鏈可重算。

04 與 05 的 `/harness` 不執行 repo `dist` App，而是收到假站啟動後用 esbuild 即時產生的 `holdings.js`。04 的 `fixture-server.mjs` 在 `/__fixture/holdings.js` 以 `build({ entryPoints: holdings.jsx, bundle: true, write: false, ... })` 生成 bytes；05 同樣即時 bundle，且 `05-before` 還透過 plugin 從固定提交載入產品來源。這些 bundle 是該批 harness raw 實際執行的建置產物。

目前 binding 的 `buildHashes` 只來自 `hashes(walk('dist'))`，raw／receipt／manifest 都沒有保存或核對本次動態 `holdings.js` 的 SHA。尤其 `05-before` 21 份全部跑 `/harness`，當輪實際 bundle 與目前 `dist` 沒有同一 build 身分；即使 raw 內保存了 fixed hook source/hash，仍沒有證明瀏覽器收到的是由該輪工具與來源產出的哪一份 bundle bytes。

**影響：** harness raw 的 `build` 綁定目前指向未實際執行的 `dist`，而真正執行產物未被封存鏈重算，與「每一份通過結果都屬於指定實際執行」及 P1-03／票據 build fingerprint 要求不完整。可在假站產生 bundle 後固定其 SHA 並加入 run/startup binding（或等價地把實際 served bundle SHA 納入可重算 receipt）；若此欄位進 binding，正式 browser raw 必須用新 batch 重跑。

## 已核到的實作形狀（不等於最終驗收 PASS）

- P1-01／02：manifest 明列五組 `02`、`03`、`04`、`05-before`、`05-after`；預期案例數為 22／12／25／21／29，共 109。案例集合由既有場景定義與 12 的 holdings case 定義產生，沒有從實際 raw 倒推完整性。每次啟站使用新 UUID runId，輸出落在 `runs/<group>/<runId>/`，manifest 只選完整單一 run。
- 必驗集合沒有縮小：新定義仍是 02～05 後版 88 份加 05-before 21 份；03 保留兩尺寸原生市場操作，驗證 17 個 trusted key、64→51 K 棒與既有 7 項搜尋／週期讀值；05-before 固定來源仍為 `0366f5fb1d58d963323cc9d519f49ec87217a048`。
- P1-03：HTML 初載內嵌 binding，bootstrap URL 同時帶 runId 與 bootstrap SHA；bootstrap 不向 `/__integration/meta` 認領新 ID。接收端要求 `X-Replay-Run` 與本文 binding 都等於本 run；舊 bootstrap 路徑回 410。現有真 browser precheck 另保存舊頁跨 restart 的 409／410／新 run 空收件結果。
- P1-04／05：raw 使用同 run 獨立目錄、同案例 exclusive write、temp→rename；duplicate 409，第一次失敗保留且該 run 不會轉成完整成功。`verifyRun()` 從 expected 重讀 startup/state/raw 並核完整檔名集合、case/size/sample/before-after、raw SHA；同 live run 可補缺案，重啟產生新 runId。
- P1-06：replay verifier 與 queue summary 都攜 manifest revision/hash、selected run 與逐 raw SHA；seal 會重新計算 verifier/queue 並與已保存摘要做完整相等比較，raw 被換、舊 revision、缺案或混 run 都會破壞驗證。此項仍受 P1-SPEC-02 的 gate-tool provenance 缺口影響。
- P1-07／12：四個舊 `evidence/12` 呼叫方式沒有 manifest 時明確非零退出；README 把舊固定目錄命令標成歷史重算入口。原 02～11 場景腳本與歷史 raw 未被本票修改。
- P1-08：tracked diff 目前只有六個 `evidence/12` 工具／README；產品 `.ts/.tsx` 沒有 tracked 修改。runId/hash 的文件也只宣稱防意外混樣與來源漂移，沒有擴張成對惡意操作者的安全宣稱。

## 已有但屬 precheck／結構證據

- 舊 verifier 的「第一輪成功、第二輪漏案仍因殘留 12→11 而 PASS」修改前重現與移除殘留後控制已保存，屬原問題紅燈。
- `evidence/01/protocol-check-db83523b-9bac-4df2-86e8-9f1abaa9df32/results.json` 保存 21 項 CLI／VM 結構回歸；它不是 109 份 browser fresh。
- `evidence/01/browser-negative/precheck-verified.json` 重核真 browser：同頁跨 restart 維持舊初載 runId、duplicate 409、舊 bootstrap 410、舊頁 upload 409，且新 run raw 為空。此證據目前屬 precheck manifest；最終引用時仍需確認其核心 tool/source fingerprint 與正式候選一致。

## 尚待證據，不列為程式 finding

以下項目在本次程式覆核當下仍未齊，因此不能據此把 P1 標 CLOSED：

1. 正式 manifest `evidence/01/batches/p1-final-6ce4245f-e290-46e3-90d0-e2a0cddb7e33/manifest.json` 的 109 份 fresh browser 最終完成、五組明確 select 與完整 verifier／queue 結果。
2. batch 建立後的 final gate、gate summary，以及 test/snapshot/package/lock／歷史保護最終核對。
3. 以真 fresh raw 為種子的 `replay-raw-regression.mjs` P01～P11 負向矩陣實跑，尤其 P02、P03、P10 的可觀察拒絕與 P11 同 live server 補案證據。
4. final seal 成功與其對 109 raw、selected run、manifest revision、source/tool/build/raw SHA 的最終重算；目前 P1-SPEC-01／02 未修前，不應把 seal 成功視為完整符合規格。
5. 獨立 Standards 軸與本 Spec 軸修正後覆核，以及最終單一提交／票面 resolved。

目前 Spec 結論：**4 個 OPEN 實作 finding；最終驗收證據另有待完成項目。**

本輪程式範圍掃描至此完成；prime 已接收上述四項並交由 author 一次修正。既有 `p1-final-6ce4245f-e290-46e3-90d0-e2a0cddb7e33` 批次保留作 precheck，不再作正式候選。後續 fix-review 會在新工具凍結、新 baseline gate 與新 manifest 產生後追加關閉證據，不刪除此處發現歷程。

## 2026-09-21 修正覆核追加

固定比較點仍為 `b2bf7d8075eb31266d556afb0f874d37c3217bb4`，目前 HEAD 同點，`git log b2bf7d8..HEAD --oneline` 仍為空。本次只讀核目前 staged／working tree 與保存證據；沒有啟站、browser 或 gate，也沒有修改產品／工具／測試。四項原 Spec finding 的程式 closure 均成立，**NEW finding = 0**；整張 P1 仍 OPEN，原因是正式新批次與最終證據尚未完成。

### P1-SPEC-01 — CLOSED：完整來源集合已補齊 build 根輸入

`replay-contract.mjs` 的 `rootSources` 現在同時包含 `index.css`、`postcss.config.js`、`tailwind.config.js`；`sourceFiles()` 因此把三檔納入目前候選 `sourceHashes`，而 `beforeSourceHashes` 亦透過同一 `productFile` 規則從固定前版提交取得三檔。修正凍結 `review-fix-freeze-8f3c3c94-c7ff-4d9b-9a72-6fe359e6c424/result.json` 保存目前來源 102 份，三檔均有 SHA，且 `sourceFilesMatchOriginalProtection=102`。

對應 regression `fingerprint-green-d09219b0-ee2a-4d62-93b2-ffdb509a4209/results.json` 為 45/45：三檔各自都有完整集合、缺欄、hash 漂移、同數異集合拒絕；before 固定來源亦逐檔確認包含並有缺欄拒絕。原 protection SHA 與目前三檔 bytes 相同，沒有藉修正改產品來源。

### P1-SPEC-02 — CLOSED：final gate runner／entrypoint provenance 已沿 seal 契約閉環

`gateToolFiles` 現明確綁 `.scratch/reacceptance-fixes/run-check.mjs` 與 `scripts/run-gate.mjs`；兩檔同時進 `toolHashes`。`gateDetails()` 在任何 gate 被接受前先呼叫 `gateProvenance(record)`，逐值重算當前 `runnerSha256`／`entrypointSha256`，缺欄或 drift 均拒絕。這不是只保存欄位；seal 使用的 `gateDetails()` 本身就是強制核對邊界。

fingerprint regression 已覆蓋兩欄的 missing／drift，並直接用既有真 `checks/baseline-gate.json` 驗證「歷史 gate 因缺兩 SHA 而拒絕」，舊檔 SHA 保持不變。新的 provenance baseline gate 目前尚未產生：`checks/provenance-baseline-gate-blocked.json` 明列兩次 `exec_command` 都被安全檢查封鎖，`processStarted=false`、`exitCode=null`、`gatePassed=false`，因此沒有把舊 gate 補欄或誤當新 PASS。

### P1-SPEC-03 — CLOSED：esbuild 實際 native runtime 已納入工具指紋

`esbuildRuntime()` 現從本機已安裝 `node_modules/esbuild/lib/main.js` 的平台解析段解析實際 runtime，對目前 Windows x64 得到 `node_modules/@esbuild/win32-x64/esbuild.exe`，並同時綁 API、API package.json、native binary、native package.json。它核 package／optional dependency 版本一致、拒絕 symlink 路徑，且要求 `ESBUILD_BINARY_PATH` 未設定；任何 override 直接拒絕建立 fingerprint。

修正凍結保存 native binary SHA `cae1bbc86f4df800b01d99e28aea0a154b02243de6797e98f48a9b88a64a7be0`。fingerprint regression 確認 runtime 解析結果就是實際 build API 將啟動的 native binary，並對 binary／native package 的完整集合、缺欄、hash drift、同數異集合及兩種 `ESBUILD_BINARY_PATH` override 做拒絕驗證。這關閉原先「只 hash JS wrapper」的缺口。

### P1-SPEC-04 — CLOSED：04／05 真 harness bundle 已成為 per-run 可重算 build artifact

新增 `replay-harness-adapter.mjs` 只在記憶體轉接原 04／05 fixture server：保留原 build 選項／05 固定來源 plugin，把唯一 `build()` 分支移到 listen 前執行，並把實際產出的 `holdings.js` bytes 交給 `replay.captureArtifact()`。每個 04、05-before、05-after run 的預期 artifact 集合固定為 `['holdings.js']`；02／03 為空集合。

`prepareRun()` 在 listen 前以 exclusive 原子保存 `runs/<group>/<runId>/artifacts/holdings.js`，第一次保存後更新 binding 的 `artifactHashes`，重複保存拒絕。`markListening()` 先 `verifyRunArtifacts()`；HTML 的 script URL 使用 `/__integration/artifacts/<runId>/<sha256>/holdings.js`。server 只對該精確版本 URL 回傳 `serveArtifact()` 重新核對過的保存 bytes，並回傳 `X-Replay-Run` 與 `X-Replay-Artifact-Sha256`；舊 `/__fixture/holdings.js` 明確 410。

同一 `artifactHashes` 進 startup binding、state、每份 raw 的 integration binding；接收 raw 前與 verifier 讀取時都重新核 artifact 目錄、精確檔案集合及 bytes SHA。artifact regression 22/22 覆蓋五組集合、04／05-before／05-after 的 missing hash／missing file／drift／extra file、binding hash、重複保存不可覆寫及原 04／05 build 分支仍各只有一次。adapter preflight 另實際跑過 04、05-before、05-after 三份真 esbuild 編譯但截斷 HTTP listen，三組各有唯一 `holdings.js` SHA、版本 URL 與 HTML binding 相符，沒有產生 startup／raw 或 listener。這些屬程式／編譯 preflight；正式 HTTP 真正 served body／header／artifact SHA 相等仍要在新批次取證，沒有被本 closure 偷換成 PASS。

### 保護、範圍與尚待正式證據

目前 freeze bytes 與保存結果相符：`replay-contract.mjs` SHA `59d53cc8ee7c8a807dd07c2f326bd9b16cd6e969a99bca438d89bc325586774a`，`replay-server.mjs` SHA `9598dc074090f49980fb2e7b72227d630b90cadf943146c3d8d9f400c9948084`，adapter SHA `feaac2b1c6116f7a4c96583d530b769f64de51aaee53a2c5dddb0050cb543394`。`git diff --cached --check` 無錯；HEAD 未前進。

`checks/after-review-freeze-protection.json` 為真實重算並通過：原 49 個測試／snapshot、2233 份歷史檔、package 全部零 mismatch；`unexpectedChanges=[]`，tracked 變更只有六個授權的原 `evidence/12` 檔。這支持本修正仍屬驗收工具範圍，沒有產品 scope creep。

但正式 P1 **仍 OPEN**。目前缺少：

1. 工具允許後真跑新的 provenance baseline gate，取得包含兩個工具 SHA 的 gate record；目前只有被封鎖的觀測，沒有真 gate。
2. 用修後凍結 fingerprint 建立全新正式 manifest；舊兩個 batch 僅能留作 precheck。
3. 新正式 109 份（02=22、03=12、04=25、05-before=21、05-after=29）與五組 select／verifier／queue；04／05另需真 HTTP served body／header／artifact SHA 相等證據。
4. 新批次 P05 舊頁跨 restart、P11 同 live run 補案／重啟新 run，以及以新 109 真 raw 執行完整 raw-negative 矩陣。
5. 新 final gate、完整 protection、用新 gate 的 gate provenance 負向副本、final seal、最終提交／票面 resolved。

修正覆核結論：**P1-SPEC-01～04 程式 finding 全部 CLOSED；NEW 0。P1 整票仍 OPEN，原因只剩上述正式執行／證據門檻。**
