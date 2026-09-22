# P1／S1 修正執行結果

狀態：P1正式驗收完成，等待第一個最終提交；S1尚未開始。最後進度以票面及 [HANDOFF](HANDOFF.md) 為準。

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

P1提交後才開始S1實作與其專項驗收；P1的109份不改標成S1最終產品證據。

## 提交與回復

起點 `b2bf7d8075eb31266d556afb0f874d37c3217bb4`。P1提交SHA於S1結案文件回填；未執行reset／clean／推送／部署。回復P1可在保留本地證據後revert該單一提交。
