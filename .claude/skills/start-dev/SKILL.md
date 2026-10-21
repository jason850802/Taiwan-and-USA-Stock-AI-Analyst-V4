---
name: start-dev
description: 在使用者的 Windows 主機啟動本專案開發環境。PowerShell 輸入 start-dev，會檢查 .env 變數名稱與 3000／3001 埠、開可見的 Vercel 與 Vite 視窗，並確認 HTTP 就緒。使用者說「起環境」「開 dev」「怎麼啟動 App」時使用。
---

# 起開發環境

在**使用者電腦的 PowerShell** 執行 `start-dev`。指令入口為使用者 PATH 中的 `%APPDATA%\npm\start-dev.cmd`，實作在專案的 `scripts/start-dev.ps1`。代理若只有受限沙盒，須使用可存取實際主機的執行方式；不要把沙盒內 `Start-Process` 回傳 PID 當成服務已啟動。

腳本會只讀 `.env` 的**變數名稱**，檢查 npm／npx、主機程序與埠占用。已啟動的 Vercel／Vite 會沿用；缺少的服務才各開一個使用者可見的 PowerShell 視窗。它不會停止其他程序。等 3000／3001 監聽後，再確認 `localhost` 的 HTTP 回應；成功才回報 `http://localhost:3000`。

如 `start-dev` 尚未安裝到 PATH，可在主機 PowerShell 直接執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4\scripts\start-dev.ps1"
```

這台機器的 Windows PowerShell 5.1 預設不執行 `.ps1`；入口 `.cmd` 僅對啟動腳本的程序指定 `RemoteSigned`，不修改持久執行原則。若腳本回報「無法取得主機程序」或存取被拒，先確認自己使用的是主機 PowerShell；不要改用受限 shell 重試開視窗。若逾時，讀兩個視窗的錯誤訊息，不以視窗 PID 或單一埠代替服務就緒。測完在兩個服務視窗各按 `Ctrl+C`。

已知陷阱見 [pitfalls](references/pitfalls.md)。
