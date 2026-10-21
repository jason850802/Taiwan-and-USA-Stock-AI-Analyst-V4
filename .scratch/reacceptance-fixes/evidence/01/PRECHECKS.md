# P1 預檢與修正紀錄

這裡列的是正式封存前的真實執行，不是最終候選109份驗收。原始manifest、startup、state、raw均留在原目錄，沒有補蓋新身分。

2026-09-22：`p1-codex-final-0e924a7d-cdae-43ae-9af5-e5fdc85435b9` 改列precheck。02 run `5a47358b-a7bc-4633-8668-cab2b63567c7` 已真22/22及select/verifier通過，P11真活站11→22拒絕／通過已保存。03 run `d9a65391-64bf-4003-9f88-ec99c58d0f23`有5份桌面成功；`7a1f4a10-57f3-484a-bca5-7a9ffdf9fef2`有真17可信鍵、七讀值、64→51的desktop-manual-market成功raw，但新父頁控制在取得實收raw時拋出body already read，P05未完成。`viewport-controls-regression.mjs`以真控制函式與標準Response重現成功路徑紅燈（`checks/viewport-response-e621be44-144d-4bb4-8797-7a2e4a92441a.json`），只將錯誤回應讀body改為條件執行後2/2綠（`viewport-response-bd87a5bd-1932-4ece-97f4-826cbcf3edfb.json`）。核心控制工具指紋已改，須重新凍結，不能替本批raw補標。中斷期間未完成假站程序消失，所有新啟站均採新run，未拼接。

2026-09-21 Codex續接的 `p1-final-v2-610d313c-1f5d-4ab9-a49f-1288d018f297` 已使用真 provenance gate 建立，02 run `c0dc9345-00fe-4421-bcdb-3fe7c6fd8dba` 取得部分桌面raw。因需適配本session唯讀瀏覽器JavaScript能力，新增可點擊觀測控制會改核心工具集合，此批仍保留預檢。原raw不改，不能在新指紋下補蓋身分；正式批次必須另建。

`core-precheck-2a3a5c2c-7dc9-4189-8770-dc5a43e3037a`驗證了舊頁跨重啟：03舊run `f8385ae1-5871-44f8-807e-fee46679d8d8`在桌面正式App完成switch-return；同頁重複回傳409。重啟至`bc15f46e-f8ad-4e4b-abf2-5e5720eaa758`後，舊頁刻意晚取metadata仍保持初載ID，舊bootstrap410、上傳409，新run沒有raw。觀測與7項重核在`browser-negative/precheck-observation.json`及`precheck-verified.json`。

`p1-final-6ce4245f-e290-46e3-90d0-e2a0cddb7e33`原本準備作正式批次，因獨立雙軸覆核發現完整來源／工具指紋缺口，改列預檢。其02 run `f7273fb6-26a1-4849-a0a3-6b29eef55a60`兩尺寸22案已通過，並保存同活站未完整時select exit1、補齊後select與verifier exit0。03保存另一真stale-return種子run `ff6e263e-80df-463d-ad34-50343c8c323f`；run `9cc12e01-5ef8-4d49-a471-5a41c311cc71`已跑10個自動案及桌面原生案（17個可信按鍵、七讀值、64→51根K棒）。04 run `35ce5cc6-ab04-4eec-a462-17bce102cb72`已跑hook與桌面App預檢。其完整性以各state為準；這些部分結果不能合計成109案PASS。

Standards的S-P1-01／02與Spec的P1-SPEC-01～04合併成四項修正：納入`index.css`／PostCSS／Tailwind來源、納入實際esbuild native binary與package、讓gate runner／entrypoint SHA沿manifest與seal重算，以及綁定04／05真正served的動態harness bundle。核心contract因此變更，後續必須建立新manifest，重新取得完整109份與P05／P11證據；不得只修改上述manifest指紋來讓舊raw通過。

上述假站均以本次已確認的terminal或PID停止。原始紅燈及歷史保護盤點另在`diagnosis/`與`setup-b66e4aa6-3c48-461e-8975-ac8bcf48ca08/`；歷史805項測試的基準gate保留原紀錄，缺少新gate工具SHA的舊record也不補寫欄位。
