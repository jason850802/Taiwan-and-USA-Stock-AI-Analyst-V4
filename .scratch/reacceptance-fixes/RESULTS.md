# P1／S1 修正執行結果

狀態：P1 已完成並提交；S1 實作、正式驗收、獨立雙軸覆核與最終封存均已通過，第二個提交 SHA 由交接回覆提供。

## 目前已驗證

- P1 原缺陷已有兩次真紅燈：12份完整成功後，第二輪只交11份，舊 verifier 仍接受殘留第12份；移出殘留的控制組拒絕。原證據不改。
- 2026-09-21 Codex 已核實原四項程式／方法 finding 在兩軸追加報告均 CLOSED、NEW 0；整票仍需正式執行證據。
- 新真 provenance baseline gate：`evidence/01/checks/provenance-baseline-gate.json`，exit 0、兩工具 SHA、完整 log、金鑰掃描未降級。對帳 `provenance-baseline-summary.json`：原47檔／805項；歷史副本138檔／2383項；新增 Vitest 0。不能把歷史副本稱為新增測試。
- 保護 `evidence/01/checks/codex-resume-protection.json`：49份原測試／snapshot、2233份歷史檔、package／lock均不變，產品零改動，非預期 tracked 修改0。

## P1 最終結果

- 正式批次：`evidence/01/batches/p1-final-body-fix-bca2fd9c-4ce9-4fc3-9137-e499bfe19599/`，五組明確選定後revision 5。02=22、03=12、04=25、05-before=21、05-after=29，共109；其中正式App 38、hook行為29、排程樣本42。verifier、queue與seal均重算通過。
- 03桌面與窄版均由CUA原生操作：每尺寸17個trusted key、七項搜尋／週期讀值、K棒64→51、無溢出。成功raw沒有由控制頁偽造。
- P05／P08真舊頁跨重啟觀測9/9；後續身分與時間線補驗9/9。舊bootstrap 410、舊頁上傳409、重送409，新run在觀測時空收件；其後同run只由明標`protocolOnly`測試加入一份`passed:false` raw，成功raw仍為0。
- 04／05三組真HTTP的response body、`X-Replay-Run`、`X-Replay-Artifact-Sha256`與run保存的`holdings.js`一致。P11同活站缺案select失敗、補齊後成功；重啟另用新run完整重跑。
- P01～P12負向矩陣實跑36項全通過，含新增來源、native esbuild、gate工具與真bundle反例；原137份輸入零變動。structural 21/21、artifact 22/22、fingerprint 50/50。
- 最終gate：`checks/linkage-final-gate.json`，185檔／3188項全綠；對帳為原47檔／805項、歷史副本138檔／2383項、新增Vitest 0，金鑰掃描未降級。保護核對原49份測試／snapshot、2233份歷史檔、package／lock均不變，產品程式零改動。
- 首屏維持291.26 KiB raw／95.79 KiB gzip。排程量測如實保留取捨：30檔請求峰值6→3，全部完成中位數約538→1034 ms；這是原05前後版差異，本票不改產品。
- 最終seal：scope `P1-replay-109`、revision 5、88後版＋21前版、正式App 38、原根測試805，全部通過。

P1 最終提交：`db2c8cb9dbf64f04b92af22264b80d209d72dead`。P1 的109份不改標成S1最終產品證據。

## S1 正式驗收與封存

- 修正前，完成後及在途的同碼同 lot 成本修改均未使舊報告失效；兩份精確公開 hook 紅燈在 `evidence/02/tools/runs/red-completed-change.json` 與 `red-inflight-change.json`。修正後，已保存相關成本／股數／lot 身分變更使該股票變為「需重檢」，舊全文、片段、錯誤與過期 finally 都不能覆蓋新結果；未改股票仍可完成，編輯本身不呼叫 AI。
- S01～S13 的27個公開 hook 案例全綠，包含成本來源分支、無關欄位不失效、A→B→A、批次／單檔交錯、移除重加、StrictMode、卸載與失敗子集。指定 manifest：`evidence/02/runs/hook/ff4adbb5-1d8c-468e-8b68-041ad6e54421/manifest.json`。
- production dist 假資料 App 的桌面1440×900及窄版390×844，各18/18；原生保存、Tab／Shift+Tab／Escape與焦點、手動重跑、真請求內容、延遲舊結果及批次隔離皆核實。指定 manifest：`evidence/02/runs/formal/e9ed50d9-46c5-4d7e-b4a7-8b66391aba61/manifest.json`。這是隔離瀏覽器驗收，不宣稱 Electron 安裝版或真 AI 輸出。
- 新 S1 證據由本票工具、產品及 build 指紋綁定；重複、錯頁、過期URL、缺檔及竄改等9個反例全通過，記錄在 `evidence/02/negative/308131bd-6b35-46a3-8997-ea7a4f884400/result/negative.json`。
- 完整 gate 185檔／3188項，內含原47檔／805項及歷史副本138檔／2383項，沒有改原 test／snapshot；金鑰掃描未降級。`package.json`／`package-lock.json` 不變；首屏291.26 KiB raw／95.79 KiB gzip。正式紀錄在 `evidence/02/checks/final-gate-v1.json` 與 `final-bundle-v1.json`。
- 獨立 [Standards](evidence/02/review-standards-final.md) 與 [Spec](evidence/02/review-spec-final.md) 均為 `FINAL: PASS`、`OPEN: 0`、`NEW: 0`。Standards 預覆核的工具指紋、不可覆寫 raw 及 tracker metadata 缺口均已關閉；Spec 預覆核的共享 `fetchKind` 錯誤文案競態已改為每次準備結果的局部值。
- [最終 S1 seal](evidence/02/seals/79d7866b-3313-41ab-b69c-784166a8dd61/seal.json) 為 `allPassed: true`，重新核對兩組指定 manifest、gate、原805項／測試快照不變、package／lock、首屏、9項反例與兩份覆核。沒有將預檢或 P1 raw 混入 S1 正式結果。

本次僅使用隔離本地假資料、合成串流與 production dist 瀏覽器；沒有真 AI／真持股操作，也沒有宣稱 Electron 安裝版驗收。4184／4185 本地假站已停止且無 listener；一個較早的自建4185分頁因瀏覽器控制連接已脫離，未能由工具關閉，瀏覽器工作階段結束後應自動清理。

## 提交與回復

起點 `b2bf7d8075eb31266d556afb0f874d37c3217bb4`；P1 提交 `db2c8cb9dbf64f04b92af22264b80d209d72dead`；S1 提交 SHA 在最終交接回覆提供，避免自我引用。未執行reset／clean／推送／部署。回復時先核依賴與工作樹，再依 S1→P1 反向 revert 個別提交，保留原01～12及重新驗收歷史。
