# P1／S1 執行續接

## 2026-09-22 目前固定點（優先於下列歷程）

分支 `codex/reacceptance-fixes-p1-s1`；P1 已獨立提交 `db2c8cb9dbf64f04b92af22264b80d209d72dead`，其109份正式結果、36/36負向矩陣、最終gate、雙軸覆核與seal均完成。S1 以該提交為起點，產品修正、正式驗收、獨立雙軸覆核與最終 seal 已完成；第二個提交 SHA 在最終交接回覆提供。下列舊段落是當時快照，不代表目前仍在等待P1。

- S1 產品只修改 `components/portfolio/useHealthCheck.ts` 及 `components/portfolio/HoldingsTable.tsx`。已保存持股輸入的 lot 身分、股數及原成本分支原值形成每股票識別；相關變更使舊全文／片段／錯誤失效，顯示「需重檢」，由使用者手動重跑；單檔及批次共享世代，批次只隔離變更股票。
- 修改前兩個公開 hook 紅燈：`evidence/02/tools/runs/red-completed-change.json`、`red-inflight-change.json`。最終 27/27：`evidence/02/runs/hook/ff4adbb5-1d8c-468e-8b68-041ad6e54421/manifest.json`。production dist 兩尺寸各 18/18：`evidence/02/runs/formal/e9ed50d9-46c5-4d7e-b4a7-8b66391aba61/manifest.json`。兩組原始檔由 `tools/s1-run.mjs` 核對產品、工具、bundle、頁面身分及雜湊。
- S1 協定反例9/9：`evidence/02/negative/308131bd-6b35-46a3-8997-ea7a4f884400/result/negative.json`。最終 gate：`evidence/02/checks/final-gate-v1.json`，exit0、185檔／3188項、非降級金鑰掃描；首屏：`final-bundle-v1.json`，291.26 KiB raw／95.79 KiB gzip。原47檔／805項及 package／lock 不變，由最終 seal 再核。
- Standards／Spec 最終報告分別在 `evidence/02/review-standards-final.md`、`review-spec-final.md`，兩軸均 PASS、OPEN 0、NEW 0。`evidence/02/seals/79d7866b-3313-41ab-b69c-784166a8dd61/seal.json` 為 allPassed。
- 4184 hook 與4185 formal 的本地假站已停止，PID16044／6892不再存在且兩埠無 listener。390×844 viewport override 已還原；本輪正式窄版頁已關閉。較早一個自建4185頁因瀏覽器偵錯控制已脫離而無法用工具關閉，工作階段結束後應自動清理。

## 2026-09-22 先前續接快照

P1 已取得同一最終工具的109份真瀏覽器成功，尚待負向矩陣、封存與兩軸最終覆核完成才提交。S1未開始。HEAD仍為b2bf7d8，沒有本案提交。

- 正式manifest：`evidence/01/batches/p1-final-body-fix-bca2fd9c-4ce9-4fc3-9137-e499bfe19599/manifest.json`，revision 5，definition SHA `f3b56510dda315acc4486db0cc0c236619910ea077a8466f302680991e6cec83`。
- 選定run：02 `6858a1b5-236f-45a9-81ce-3648ddcfe2f6` 22；03 `65fbbede-6874-43b4-943e-7e70e6f232bf` 12；04 `c93f55fa-bd0f-4c62-9751-50af4f401b79` 25；05-before `9ba190b4-1516-48d5-ac9c-b12748a8ff3f` 21；05-after `cb61b603-19f5-458f-b8c0-0ef6745af011` 29。verifier及queue已通過；38正式App、29hook行為、42排程樣本。
- 兩尺寸原生manual皆17個trusted key、7讀值、64→51與無溢出。CUA首次清空採三連點加Backspace，第二次Ctrl+A；不改原斷言。
- 真同頁P05/P08：`browser-negative/body-fix-observation.json`與`body-fix-verified.json`，9/9、新run空收件、同父子timeOrigin、bootstrap410/upload409。舊run `53905abc-e488-478f-809c-f7dd76c71020` 的desktop-green-stale-return是真混輪種子。失敗首次收件不覆蓋：`checks/body-fix-failed-receipt.json`。P11同活站10/12 select exit1，再12/12 select exit0在`checks/body-fix-p11-live-incomplete.json`及`body-fix-select-03.json`。
- 3份HTTP artifact核對：`checks/body-fix-http-artifact-{04,05-before,05-after}.json`。
- 真final gate：`checks/linkage-final-gate.json`，3188/185全綠、非降級；對帳`linkage-final-gate-summary.json`：原805、歷史2383、新增Vitest0。`linkage-final-protection.json`原49測試/snapshot及2233歷史均不變。首屏`body-fix-final-bundle.json`：291.26 KiB raw、95.79 KiB gzip。
- 最新structural21/21：`protocol-check-0c1d776a-f8ba-47e1-aba9-509cf4bdbb31/results.json`；artifact22/22：`artifacts-green-3bd5091a-80cd-40e0-8e8c-259d79dcba84/results.json`；fingerprint50/50：`fingerprint-green-c49447c8-686e-4d6a-a785-bf87627fecb0/results.json`；raw-negative36/36：`raw-negative-89cd95d9-92b3-47a4-91fa-9b69f9619591/results.json`，原137份輸入零變動。final seal已通過。
- 假站02 PID5232、04 PID2932、05-before PID20684、05-after PID28540已由本session停止；03在負向HTTP完成後亦已退出。4176～4179目前無listener。自建本輪瀏覽器頁全部已關閉。

先前所有不同核心指紋batch保留precheck，不升格。後面的舊freeze與待辦是當時快照，不代表目前仍須重跑109。

目前兩票未完成。2026-09-21 Codex 續接已核實兩軸追加覆核：四項程式／方法缺口均 CLOSED、NEW 0；不代表整票完成。新的 provenance baseline gate 已實際通過，先前 CoS 呼叫封鎖已不構成本 session 阻擋。02 S1 尚未開始，維持01提交後才進行的順序。

## 2026-09-21 Codex 續接狀態

- HEAD／分支與下文一致；保留24份既有 staged 來源、全部歷史及三個 worktree，未提交。
- `checks/provenance-baseline-gate.json`：2026-09-21 11:10:46–11:11:13 UTC，exit 0、完整 gate、金鑰掃描未降級，兩個 gate 工具 SHA 齊全。`checks/provenance-baseline-summary.json` 逐檔核對原47檔／805項、歷史138檔／2383項、新增Vitest 0；49份既有測試／snapshot不變。
- 初次新 manifest：`batches/p1-final-v2-610d313c-1f5d-4ab9-a49f-1288d018f297/manifest.json`。02曾啟動run `c0dc9345-00fe-4421-bcdb-3fe7c6fd8dba`（PID 11352），已有部分真桌面結果。因本session瀏覽器的JavaScript介面限唯讀，須為原生03觀測／P05提供可點擊假站控制；工具適配會改指紋，此批保留預檢，不升格。已停止本次建立的PID 11352並關閉該驗收分頁。
- 本session無舊CoS worker family，已建立獨立 Standards／Spec reviewer，實際型號 `gpt-5.6-sol`、`high`，先核來源，正式證據齊備後再覆核。
- 一次 `Get-CimInstance Win32_Process` 回「拒絕存取」，不影響已成功的gate／啟站；PID歸屬由本次啟站stdout及terminal session確認。

HEAD仍是`b2bf7d8075eb31266d556afb0f874d37c3217bb4`，分支為`codex/reacceptance-fixes-p1-s1`。沒有新提交。已精確stage 24個授權驗收來源／本案新工具，其他新文件及證據仍需最後逐項核對再stage；不要reset、clean、整包git add、重做已成功的stage或將歷史重新驗收目錄納入提交。

## 上輪阻擋歷程（本 session 已取得真 gate）

呼叫`Chat_On_Steroids_Core.exec_command`執行`node .scratch/reacceptance-fixes/run-check.mjs 01 provenance-baseline-gate gate`時，工具回應：「由於 OpenAI 無法確定要求的安全狀態，因此已將此工具調用封鎖。」沒有啟動gate子程序或產生新gate紀錄；後續唯讀確認`checks/provenance-baseline-gate.json`不存在。原始回應轉存於`evidence/01/checks/provenance-baseline-gate-blocked.json`。這是該次工具呼叫封鎖，不是測試紅燈，也不表示整個工作區唯讀。

確認第一次沒有執行後，曾以完全相同的命令重試一次，仍收到相同封鎖回應。兩次都沒有成功執行紀錄。

原`checks/baseline-gate.json`真完整gate已成功，47個原測試檔／805項全綠；另外138個歷史副本檔／2383項不算新增。但它產生時尚無gate runner／entrypoint SHA，因此新契約故意拒絕該舊紀錄。不可補寫欄位或製造新gate成功摘要來建立正式manifest。

## 已完成成果

紅燈診斷在`evidence/01/diagnosis/`：兩次真舊工具重現12份完整成功後，第二輪只交11份，殘留第12份仍讓舊verifier成功；控制組移去殘留後失敗。原始檔與歷史保持不變。

修改涵蓋原12的六個授權入口／README及本案新工具。每站UUID／獨立目錄、初載固定身分與版本bootstrap、完整案例／來源／工具／build核對、原子保存與重複拒絕、manifest指定組／完整raw SHA、queue及seal重算均已落實。最初獨立覆核指出的四項缺口已修：三個CSS／設定來源、esbuild實際native工具、gate工具SHA核對、04／05實際served harness bundle。完整凍結資料在`evidence/01/review-fix-freeze-8f3c3c94-c7ff-4d9b-9a72-6fe359e6c424/`。

凍結contract SHA為`59d53cc8ee7c8a807dd07c2f326bd9b16cd6e969a99bca438d89bc325586774a`；server SHA為`9598dc074090f49980fb2e7b72227d630b90cadf943146c3d8d9f400c9948084`。來源102份、before來源99份、核心工具37份、dist15份。專用回歸是fingerprint45/45、artifact22/22、structural21/21，共88項Node／VM檢查，另有完整adapter五組語法與三份真esbuild編譯的無HTTP預檢。不能把這些算成109份瀏覽器成功案例。

Standards的正式fix-review已追加於`evidence/01/review-standards.md`第57行起，獨立重算freeze bytes並檢查四項修正，判程式／回歸方法CLOSED、NEW 0；整張P1仍OPEN。Spec初次四finding報告在`evidence/01/review-spec.md`，已有一次喚醒逾時，續接請核該檔是否已追加真正fix-review，不可把最初4 OPEN的完成回報誤當修正覆核結果。

兩個舊batch均是precheck，詳`evidence/01/PRECHECKS.md`。已真實確認舊頁跨重啟POST409、舊bootstrap410、新run空收件；P11活站缺案select非零，補齊後成功；桌面原生市場17個trusted按鍵、七讀值、K棒64→51。02曾22案完整通過，03／04只有部分預檢，05正式前後統計尚未取得。四項修正改了核心指紋，後續須新manifest完整重跑，不可改標這些原raw。

原工作樹保護基準：`evidence/01/setup-b66e4aa6-3c48-461e-8975-ac8bcf48ca08/protection.json`。修正凍結後的`checks/after-review-freeze-protection.json`已實際完成並通過：原49個測試／snapshot及2233份歷史檔全部不變，非預期修改為零，只列六個授權的原12檔案變更。

## 精確續接順序

1. 先核HEAD／status、已stage檔與review報告最新追加段落。兩個reviewer沿用同一獨立5.6 high上下文：worker-2 Standards、worker-3 Spec；worker-1是作者，不能兼任獨立reviewer。
2. 在工具可執行所需gate後，先真跑新的provenance baseline；檢查退出碼、工具兩SHA、完整log及805母體。再依`tools/README.md`建立全新manifest。舊gate缺欄不補、舊batch不升格。
3. 用凍結工具取得02=22、03=12、04=25、05-before=21、05-after=29，共109。04／05還需真HTTP body／header／artifact檔案SHA相等；P05舊頁跨重啟與P11同活站補齊須在新批次另取證。03舊輪同案例真raw供P03混輪反例。操作URL、原生17鍵與各CLI已完整記在`tools/README.md`。
4. 指定五組完整run，verifier／queue重算；新增來源全stage後真final gate、保護、bundle對照。用真新gate跑fingerprint擴充50項，用109真raw跑含14新反例的raw-negative矩陣，然後雙軸最終證據覆核及seal。只有全部必要項目完成，01才可resolved並建立第一個最終提交。
5. 從P1提交接續02 S1：先讀真health呼叫鏈與欄位選取表，建立同碼同lot成本變更紅燈；最小修正共享守衛／明確提示，S01～S13及兩尺寸正式UI／原805保護／完整gate／兩軸與修正覆核後，第二個最終提交。原產品目前完全未改，不應假設S1已部分實作。

本輪清理觀測在`evidence/01/checks/cleanup-after-review-freeze.json`：4176～4183無listener，本案假站Node程序無殘留，兩個自建驗收頁已關閉。保留所有原始證據與暫存成果；未推送或部署。
