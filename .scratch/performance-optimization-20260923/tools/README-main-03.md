# main 的 03 工具入口與歷史量測邊界

日常入口為 `node .scratch/performance-optimization-20260923/tools/daily-dev.mjs start|stop|status|recover`；回復 B1 為 `scripts/start-dev.ps1`。03 的 `app-03.mjs`、`lifecycle-03.mjs`、`terminal-03.mjs` 與取消工具可在本 checkout 執行，沿用各工具的固定資料、假 CLI、身分及原埠保護協定。`guard-main-cleanup-03.mjs` 不啟動或終止真程序。

共用工具同時保留 01／02 歷史量測入口。`b1-breakdown.mjs`、`c-parity.mjs`、`c-reload.mjs` 的身分函式需要 Git 基線 `30dfdb2` 及完整證據 checkout 內的 `PLAN.md`、`spec.md`、`acceptance.md`、`issues/01-baseline-and-critical-path.md`、`issues/02-persistent-api-prototype.md`。精確 main 範圍沒有搬入這五份歷史規格或其他票的 raw，因此不能宣稱 main 可直接重跑 01／02；身分函式會明列缺少的依賴並停止，不會自動改用 main 或借用其他 checkout 的規格。需要重跑歷史量測時，應在保留上述原始上下文的獨立完整證據 checkout 執行，另給新 run-id。

準備紀錄曾稱所有 source manifest 依賴齊備，那句只證明靜態匯入，未涵蓋此五份執行期規格與基線；本說明訂正其範圍，舊紀錄與證據不覆寫。03 主入口不依賴上述歷史身分函式。

清理失敗不代表可重新啟動：日常入口保留同 token 的完整程序身分與錯誤，退出碼為 1，先執行 `recover`。共用服務清理逐一核對 PID 與建立時間，重列當下子孫，只有所有已記錄程序消失且埠空才宣告成功。Windows 查詢與終止之間仍有非原子的短暫空窗，不宣稱作業系統層的原子程序控制。
