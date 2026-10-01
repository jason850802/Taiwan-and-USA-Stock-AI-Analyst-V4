# 精確 main 候選的獨立雙軸覆核

基底 `bf7599c53b0dcee2a5a814f3e62133c67844309a`；首次覆核 `54193c41ab7cd955af6e384c672711c99a742b50`，最終增量核對至 `49654f3a1ad49b068c921fdba9545bc3f188e8b2`。規格來源為 03 票、acceptance、結案增補與精確候選清單，以及使用者「完成精確 main 整合，production 暫不新增」。兩名覆核者未參與實作，各自唯讀；`.scratch` 在圖譜排除範圍，均明確降級為直接來源查證。

## Standards

覆核者 `/root/main_standards_review`。首次發現兩項清理身分遺失：第一輪 `stopOwned` 忽略 `known`；`terminateVerifiedTree` 中途查詢失敗不攜回 `known`，父退出後孤兒不可重找。兩項都有假表重播，沒有真程序終止。

最終增量可放行：`stopOwned` 回傳新增身分後由 shutdown 重核；清理中途失敗攜回 known／killed，由 stopService 保存新身分供重試。看門非 0／異常退出保留失敗；hmr／b1-breakdown 兩個直接 caller 在 spawn 時透過 onStarted 登記。提交版假守衛 13/13；覆核者另查實際 stopWatchdog 三種退出狀態與中途失敗後重試均 PASS，真程序終止 0。剩餘硬性 finding 0、阻擋性 smell 0。未跑重型 gate 或服務。

## Spec

覆核者 `/root/main_spec_review`。首次發現第一輪清理忽略晚生孤兒身分及 README 漏列 stream-compare 的歷史 identity 依賴。前者以實際區塊注入重現：父 41 消失、孤兒 99 殘留，舊版仍刪 state、exit 0，真程序終止 0。

最終增量可放行，無剩餘 finding：實際 stopOwned＋shutdown 在孤兒仍在時改 exit 1，保留 state 與孤兒身分；README 明列 stream-compare 的基線／五文件限制。看門失敗、查詢中途保存身分與提早登記符合啟停保障；47 檔沒有帶入其他票、模型／effort／金融語意。提交版假守衛 13/13。仍須主執行者完成候選 gate、runtime 與真實 main 整合。

## 執行者處置與邊界

初版候選 `cfbd118` 的三項發現亦已處置：shutdown 保留同 token 復原身分、非 0 回報；共用服務不用 taskkill /T，逐一 birth 守衛；歷史 identity 明列缺基線／五文件並 fail-fast，不假冒 main 可直接重跑舊票。採取文件界線而不搬其他票的規格與證據，符合精確範圍。既有準備 README 的「依賴齊備」只涵蓋靜態匯入，新增 README-main-03 明列訂正，舊文不覆寫。

Windows 程序查詢與終止仍非原子；保留這個系統限制，不將其當成待決產品方向或 production 授權。
