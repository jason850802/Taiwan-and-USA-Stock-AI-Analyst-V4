# start-dev 已知陷阱

- 受限沙盒查不到主機程序（`Get-CimInstance Win32_Process` 回「拒絕存取」）時，空結果不代表沒有殘留；腳本在無法確認程序時會立即停止，不要改用沙盒內結果。
- 沙盒內 `Start-Process` 回傳的視窗 PID 不代表服務已啟動；判準是 3000／3001 有監聽且 `localhost` 回 HTTP 200。
- 不要把多層引號塞進 `-Command`：新視窗一律用 `powershell.exe -File scripts/start-dev.ps1` 的服務模式，並以 `Get-Command` 解析 `npx.cmd`／`npm.cmd` 完整路徑。
- Windows PowerShell 5.1 預設不執行 `.ps1`：只在啟動腳本的新程序指定 `-ExecutionPolicy RemoteSigned`，不修改持久設定。
- 只在缺少服務時開視窗；已占用埠先核對程序身分，不自動殺程序。
