# P1 replay 執行與驗證

此入口只涵蓋本案 P1 的 109 份新結果：原02～05後版88份，加05前版21份。38份正式App、29份hook行為與42份排程樣本分開計數。歷史raw保持原樣；原213案及S1不在此scope。

命令的工作目錄為專案根目錄，使用既有Node，不安裝套件。原02～11場景和行為斷言保持原樣。先完成本案保護盤點及基準gate，待工具凍結再建立正式批次。以下每條命令都須檢查退出碼；不能因上一條失敗仍繼續宣稱通過。

## 建立批次

```powershell
node .scratch/reacceptance-fixes/run-check.mjs 01 provenance-baseline-gate gate
node .scratch/reacceptance-fixes/tools/replay-batch.mjs init --label p1-final-v2 --baseline-gate .scratch/reacceptance-fixes/evidence/01/checks/provenance-baseline-gate.json --protection .scratch/reacceptance-fixes/evidence/01/setup-b66e4aa6-3c48-461e-8975-ac8bcf48ca08/protection.json
```

第一條須真正成功完成後才能執行第二條。原`baseline-gate.json`是修改前基準，缺少後來新增的gate runner／entrypoint SHA，不能補寫欄位或用作新契約的基準。若紀錄名稱已存在，先核既有結果，不重跑或覆寫；需要新一輪時使用新名稱。

stdout回傳`manifest`的完整專案相對路徑。下文`<M>`必須替換成該路徑，不能選「最新檔案」。每次init建立新的UUID目錄；名稱不覆寫舊批次。

`manifest.json`的schema為`p1-replay-v1`。`definition`固定batchId、scope、建立時間、五組expected案例、expectedArtifacts產物清單、來源／工具／dist完整指紋、原工作樹保護清單SHA及基準gate根測試母體。`definitionSha256`固定這份定義。`revision`及`selected`只記操作者明確選定的完整run；每次select增加revision。原始結果綁固定definition，摘要另綁當下manifest全文SHA及revision。

來源包含產品各目錄、入口、index.html、index.css、PostCSS／Tailwind／Vite／TypeScript設定及package／lock；dist逐檔雜湊。05-before的`sourceHashes`取固定`0366f5fb1d58d963323cc9d519f49ec87217a048`的產品及設定，`hostSourceHashes`另記目前工作樹。前版只服務hook宿主，不把目前dist稱為舊版App。其餘組的來源為當前工作樹。Node、候選、所有原場景工具、新入口、共用契約／harness轉接、原生市場觀測、gate runner／entrypoint及esbuild實際執行工具都納入指紋。

esbuild使用已安裝API的解析邏輯，在唯讀VM取得真正native optional package與執行檔，核JS／native套件版本、package.json及執行檔bytes，記錄平台、架構與解析路徑。VM沒有下載、解包或寫入node_modules的能力。只接受已安裝native套件及未設定`ESBUILD_BINARY_PATH`的環境；覆寫、WASM fallback、連結或解析入口改變均明確失敗。本機已驗版本為0.25.12、Windows x64。這是驗收工具環境限制，不是產品執行環境政策。

## 啟站與頁面

```powershell
node .scratch/optimization-followup/evidence/12/replay-server.mjs --manifest <M> --group 02
```

`--group`僅接受`02`、`03`、`04`、`05-before`、`05-after`，各自有22、12、25、21、29個預期案例。02～05使用原4176～4179埠，05前後依序啟動，必須先停止上一個自己建立的程序。前版由group決定，不再接受舊`--baseline`旗標。

成功listen的stdout回傳runId、output、origin及pid。每次啟站建立`runs/<group>/<runId>/`，其中startup記實際啟動、raw逐案獨立寫入、state保存已收件的精確案例及SHA。啟站失敗或收件未完整的run不能select。程序重啟必須新run，整組重跑；不同組可選各自完整run。

04／05先以原fixture的build選項和來源plugin編譯，將真正的`holdings.js`原子保存到該run的`artifacts/`，才開始listen。初載HTML、startup、state與raw帶同一份`artifactHashes`，模組URL為`/__integration/artifacts/<runId>/<sha256>/holdings.js`。送檔、接收、verifier、queue及seal都重讀產物bytes；缺檔、缺hash、多檔或內容漂移均拒絕。舊`/__fixture/holdings.js`回410。02／03的產物集合明確為空。原05量測起點仍是首筆fetch至MutationObserver公開輸出，編譯發生在啟站前，不納入該時間。

正式HTTP驗收要核對版本URL回應body的SHA、`X-Replay-Run`／`X-Replay-Artifact-Sha256`、初載binding與保存檔一致。`replay-adapter-preflight.mjs`只有不開埠的handler預檢，不能代替這項真HTTP觀測。

所有頁面使用`/viewport?size=desktop&path=<URL編碼後子頁>`，narrow亦同。desktop固定1440×900，narrow固定390×844；**05的所有hook樣本與行為亦使用desktop包框**，不得以外層視窗不定尺寸回傳。

| 組別 | 子頁及操作 |
|---|---|
| 02 | 兩尺寸`/?suite=green&case=0`，沿原場景自動完成11案。 |
| 03 | 兩尺寸`/?suite=green&case=0`，各完成5案；兩尺寸另用`/?manual=market`頁執行原生市場操作。`/viewport`父頁以版本化控制模組呼叫子頁的版本化觀測模組，17個按鍵由Codex CUA原生派送，保留7讀值、64→51縮放。 |
| 04 | desktop的`/harness?suite=green&case=0`沿23個原場景逐案重新載入；兩尺寸正式`/?lots=us&appcase=app-overlap`各自執行正式App交錯更新與移除。`lots=us`只種本案例的美股，才能核對移除最後持股的原斷言。 |
| 05-before | desktop的`/harness?suite=before&n=1&sample=0&matrix=1`，自動跑1、10、30檔各7份。 |
| 05-after | desktop的`/harness?suite=after&n=1&sample=0&matrix=1`；另`/harness?suite=green&n=30&scenario=overlap&behaviors=1`；兩尺寸`/?suite=green&n=30&scenario=overlap`。 |

HTML回應內嵌本頁身分，bootstrap路徑同時含runId與bootstrap檔案SHA。bootstrap初載固定身分，不呼叫metadata取得新ID。舊版本路徑回410；舊頁上傳的header或本文身分不符回非成功。新bootstrap也拒絕對已有integration／replayCase／integrationBrowser的raw重貼身分。

同case只接受一次。第一次失敗亦保留，第二次回409；請新啟站重跑完整組，不能覆寫失敗。以專屬wx鎖及同目錄temp→rename提交完整JSON；半份JSON、未完成receipt或剩餘temp／lock都不會被當作完整成功。

### 03 原生市場操作

每個尺寸使用新父頁`/viewport?size=<desktop|narrow>&path=%2F%3Fmanual%3Dmarket`，先確認子頁`/__fixture/state`的pending為空，再POST `/__fixture/reset`清除前案假HTTP計畫。父頁控制列位於固定尺寸iframe之後，不進入正式App的1440×900或390×844尺寸。控制模組、手動觀測模組及bootstrap均使用含runId與各自工具SHA的版本化URL，回應另帶`X-Replay-Run`與`X-Replay-Tool-Sha256`；錯版路徑回410。

先用原生滑鼠按父頁「開始 manual」。按鈕只在子頁載入版本化`manual-market.mjs`、取得其公開的原函式並呼叫`begin()`；模組仍只觀測DOM／HTTP，不代替原生輸入。以下每一段輸入或正式App按鈕操作使用Codex CUA原生click／key；每段完成後再原生點父頁相應的「記錄」按鈕。控制結果及錯誤都顯示在父頁`pre`，不需要以evaluate匯入模組或直接呼叫函式。

1. 原生滑鼠三連點搜尋欄全選，再按`Backspace`，然後點「記錄 原生清空」；輸入`2`、`3`、`3`、`0`，等選項出現後點「記錄 搜尋選項」。Codex CUA的`Control_L+a`會產生`Control`及`a`兩個trusted keydown，因此第一次清空必須使用三連點加`Backspace`，此段只產生1個鍵盤事件。
2. `ArrowDown`、`ArrowUp`、`ArrowDown`、`Enter`確認選項來回操作，點「記錄 原生方向鍵選股」；仍在搜尋欄時`Control_L+a`、`Backspace`、`A`、`A`、`P`、`L`、`Enter`，等報價222.00後點「記錄 原生輸入美股」。
3. 依序點正式App的「週」、「1時」、「日」，每次完成後分別點父頁「記錄 週期 1wk」、「記錄 週期 60m」、「記錄 週期 1d」。再點「記錄 縮放前」確認64根，原生點正式App一次「放大 (+)」，最後點「完成並保存 raw」核51根並保存raw。

Codex CUA下的17個trusted `keydown`計數為：第一次三連點後`Backspace` 1、`2330` 4、方向鍵與`Enter` 4、第二次`Control_L+a`加`Backspace` 3、`AAPL`加`Enter` 5。不要用合成事件、自動點正式App、修改audit或改原17鍵斷言。父頁若因iframe捲動而遮住目標，先取新畫面，原生捲動父頁，再以目前DOM ref或目前畫面座標點擊；失敗的輸入呼叫不代表已點成功。兩尺寸都需實際完成，不能拿桌面結果換尺寸。

點父頁「完成並保存 raw」後，控制模組才可透過`/__integration/raw/<runId>/<嚴格case檔名>`的GET唯讀路由取得該run已接受的精確raw與`X-Replay-Raw-Sha256`。路由不補身分、不改`passed`，未知、未收件或跨run case均拒絕。控制模組只把raw保留在舊頁記憶體；重送前移除`integration`、`integrationBrowser`、`replayCase`，再交給子頁原bootstrap fetch包裝依該頁初載binding重新附加。

### 保存命令與負向瀏覽器觀測

`node .scratch/reacceptance-fixes/record-cli.mjs 01 <新名稱> <zero|nonzero> <Node入口.mjs> <參數...>`保存真子程序命令、起訖、退出碼、stdout／stderr及工具hash至`checks/<新名稱>.json`。`passed`表示實際退出碼符合所指定的預期；預期拒絕的子程序仍須記錄非零退出碼。不能只看外層runner的exit 0就稱正常案例通過。

`node .scratch/reacceptance-fixes/verify-browser-negative.mjs --observation <觀測.json> --output <新結果.json>`核對CoS真舊頁跨啟站觀測、兩站startup、原raw與receipt hash、409／410、相同pageTimeOrigin與新run空收件。觀測必須來自實際保留的同一瀏覽器頁；這個讀取器不操作頁面，也不把觀測當成109份矩陣案例。

P08先在原server仍活著時原生點父頁「P08 同case重送」；它必須用上述記憶體真raw經子頁原fetch包裝重送，父頁`P08 觀測`的`pre`應顯示409及「同case重複送出」。停止原server並以同一manifest重啟03後，不重載父頁或子頁，再原生點「P05 跨重啟觀測」。此按鈕會晚取新`/__integration/meta`、核對group／batchId／definition SHA、讀原bootstrap版本URL，並以舊頁原fetch包裝上傳同一份記憶體payload；父頁`P05 觀測`的`pre`須顯示新runId、舊bootstrap 410、upload 409，且父頁與正式App子頁的timeOrigin都和P08相同。主代理只讀該`pre`文字並另存觀測JSON；假站不提供新的觀測寫檔API。

## 選擇、驗證與封存

```powershell
node .scratch/reacceptance-fixes/tools/replay-batch.mjs select --manifest <M> --group 03 --run <該站stdout的runId>
node .scratch/optimization-followup/evidence/12/verify-replays.mjs --manifest <M> --group 03
```

只有完整成功的組可select。驗證必須從expected案例重讀startup、state、raw，核ID、尺寸、case、before／after、完整來源／工具／build及raw SHA。10/12案時select應失敗；同活站補完缺案後可成功。不同run不能拼成同組。

五組都已明確選定後，執行：

```powershell
node .scratch/optimization-followup/evidence/12/verify-replays.mjs --manifest <M>
node .scratch/optimization-followup/evidence/12/summarize-queue.mjs --manifest <M>
node .scratch/optimization-followup/evidence/12/seal-results.mjs --manifest <M> --gate <本批次最終gate.json>
```

三份輸出都在M同目錄，分別為verified-replays.json、queue-summary.json、final-seal.json。完整verifier是109份；seal另列88＋21及正式App數。queue保留原冷頁、暖機、五次樣本、中位數、最差值、請求數與峰值口徑。

最終gate接受本案run-check的schema1紀錄，必須提供真命令、開始／結束、exitCode、signal、log及logSha256、fullGate、secretScanDegraded、runnerSha256及entrypointSha256。seal重算目前run-check與scripts/run-gate的SHA，並重新讀取log，核完整gate、原根測試逐檔數量及test／snapshot bytes；缺任何gate工具SHA或工具漂移都失敗。歷史worktree副本數另外列，不當作新增。P1新增Node回歸另外計數。最終gate必須在batch建立後執行，不能拿基準gate代替。gate與產品、瀏覽器矩陣的協調由prime負責。

最後seal重算全部raw與兩份摘要；舊revision、混run、缺hash、來源／工具／dist漂移、缺案及舊gate都非零退出。工具改動後保留舊批次作precheck，建立新批次完整重跑；不可重蓋原始標記。僅文件變動不改實驗指紋。

## 相容邊界

原`replay-server.mjs 03`、`verify-replays.mjs 03`以及不帶manifest的queue／seal皆明確失敗並指引新入口。歷史結果只可配固定提交的舊工具，在唯讀來源及獨立輸出副本重算。這些ID及SHA防意外混樣與漂移，不宣稱能抵抗操作者同時偽造全部證據。

## CLI 回歸與證據分工

```powershell
node .scratch/reacceptance-fixes/tools/replay-structural-regression.mjs --manifest <M>
```

此命令不啟站、不操作browser。它實際執行原bootstrap於受控VM，檢查初載固定ID、延後bootstrap錯版、拒絕raw重貼標記；另驗預期案例集合、缺來源／工具／build、路徑、原子重複寫入與四個舊命令的非零退出。四項覆核修正後已實跑21項通過，證據位於`evidence/01/protocol-check-56fbde7a-b2ec-4b5a-993c-a45301afa1bc/results.json`。這21項不是21份新browser成功raw。

另有`replay-fingerprint-regression.mjs`的45項完整集合／漂移回歸及`replay-artifact-regression.mjs`的22項產物回歸，修改前紅燈與修改後綠燈均保存於`review-fix-freeze-8f3c3c94-c7ff-4d9b-9a72-6fe359e6c424/result.json`列出的來源。三組共88項Node／VM檢查，與原805項及browser案例分開。真新gate就緒後，可執行以下命令擴至50項fingerprint檢查，增加真gate正常控制及4種缺／錯工具SHA副本；未執行前不得把預期50項當成實測通過數。

```powershell
node .scratch/reacceptance-fixes/tools/replay-fingerprint-regression.mjs --phase green --legacy-gate .scratch/reacceptance-fixes/evidence/01/checks/baseline-gate.json --protection .scratch/reacceptance-fixes/evidence/01/setup-b66e4aa6-3c48-461e-8975-ac8bcf48ca08/protection.json --gate <真新gate.json>
```

完整109份真結果、五組select、verifier／queue摘要以及本批次最終gate就緒後，再執行：

```powershell
node .scratch/reacceptance-fixes/tools/replay-raw-regression.mjs --manifest <M> --gate <最終gate.json> --stale-raw <另一真03-run的desktop-green-stale-return.json>
```

`--stale-raw`必須是另一個真實P1 run的同案例、同桌面尺寸成功raw，保留原integration及runId；不能拿switch-return或舊版無runId結果代用。runner只在新的`raw-negative-UUID/`複製、注入故障並執行真CLI，最後核原始證據SHA未變。P01正常副本須讓verifier／queue／seal全通過；P02缺案且另一目錄保留成功殘留、P03另一真run混入、P04混前後版／尺寸、P06未知身分、P07指紋缺漏、P09半份JSON／非法run路徑及P10舊摘要／raw事後被換都必須拒絕。P11的CLI案例只回放同run的未完成→補齊狀態；真活站補跑與重啟仍由browser證據另行覆蓋。

可加`--origin http://127.0.0.1:4177`，只對明確選定且仍活著的真03站送應拒絕的HTTP：重複case409、半份JSON400、舊run409及舊bootstrap410；它不啟新站、不寫新的正常成功案例。這些HTTP回應與CLI退出碼分開保存。真正舊browser頁面跨restart及晚取metadata仍不能換ID，需另外保存browser讀值，不能以VM或Node重送代替。

此raw runner已增加三個CSS／設定來源、native executable／package、gate兩工具及真bundle缺檔／漂移／缺hash共14個必要反例，目前已完成語法檢查；必須等上述真輸入具備後實跑，才能填寫通過數。回歸runner與README不在實驗工具指紋集合內；它們驗證凍結工具，並在各自獨立目錄保存工具hash與證據。任何正式入口或共用contract修改仍會使舊batch驗證失敗，必須告知prime並新建batch。
