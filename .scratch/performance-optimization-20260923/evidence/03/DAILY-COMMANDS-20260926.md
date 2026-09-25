# 03 日常命令與本輪回復方式（2026-09-26）

適用工具提交 `7eb5ee5ca71d478aa88661058ada69ab20c73b25`。03 仍 OPEN；下列為命令文件，這一輪尚未執行原 3000／3001 的新生命週期或 App 驗收。

在專案根目錄執行：

```powershell
node .scratch/performance-optimization-20260923/tools/daily-dev.mjs start
node .scratch/performance-optimization-20260923/tools/daily-dev.mjs status
node .scratch/performance-optimization-20260923/tools/daily-dev.mjs stop
```

App 網址為 `http://localhost:3000`，後端綁 `127.0.0.1:3001`。狀態可聯絡時使用 `stop`；若提示控制管道失聯而原程序仍在，使用：

```powershell
node .scratch/performance-optimization-20260923/tools/daily-dev.mjs recover
```

`recover` 核對 PID、建立時間及記錄的身分後清理；若埠是其他程序占用則拒絕接管。清理後再 `start`。狀態檔位於 `%LOCALAPPDATA%\Temp\perf-opt-20260923\daily\state.json`，不要自行刪檔後強行另起服務。

正式補證前，必須由使用者關閉 Chrome 內**全部** `localhost:3000` 分頁（含背景分頁），再核對 3000／3001 無 listener。哨兵無法取代這個確認。以下命令需使用未用過的新 run-id，且工具 SHA-256 必須等於當時提交版：

```powershell
node .scratch/performance-optimization-20260923/tools/lifecycle-03.mjs <新的生命週期代號>
node .scratch/performance-optimization-20260923/tools/app-03.mjs <新的App代號>
```

生命週期與 App 分別執行，不與 gate 或其他重負載同跑。App 只用固定上游、假 CLI 與隔離 Chrome 資料目錄。純假程序表檢查可獨立執行：

```powershell
node .scratch/performance-optimization-20260923/tools/guard-review-03.mjs <新的守衛代號>
```

要切回既有 B1 日常入口，先正常停止候選、確認雙埠空出，再執行原 `scripts/start-dev.ps1`。這次只核對命令來源，未重演啟動；先前使用者在 2026-09-25 啟動並核對 200／204 的紀錄仍是歷史證據。

若要撤回**這次覆核處置的工具實作**至起點 `db4e620` 的內容，在保存並排除無關未提交變更後，明確反向提交這兩個修正（由新至舊）：

```powershell
git revert --no-edit 7eb5ee5ca71d478aa88661058ada69ab20c73b25 85c553680849b495a85a938503fcc91b9bb1ca8c
```

此命令未實際演練；它撤回本輪工具修正，不是撤回整張 03 的歷史產品提交。原 03 產品提交為 `5a44fd58f32b978d27228efc635d50f618092cbd`，後續啟動器修正另有 `5997b92968135fb0c06a64e5f63e246a4528beb4`；整票回復需按實際分支逐項檢查相依與衝突，不能再使用泛指 `HEAD` 的回復命令。這次沒有執行任何回復、push、部署或發版。
