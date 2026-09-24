---
name: start-dev
description: 起本專案完整開發環境的固定流程：助手先做前置檢查（殘留 node 程序、.env 變數名、埠占用），再直接用 PowerShell Start-Process 開兩個使用者看得見的獨立視窗（後端 vercel dev 3001＋前端 Vite 3000），輪詢兩埠就緒後回報「瀏覽器開 http://localhost:3000」；不再只輸出複製貼上指令（保留為 Fallback）。當使用者說「起環境」「開 dev」「給我開 localhost 的指令」「怎麼啟動 App」或人工驗證前需要環境時使用。此流程使用者已重複詢問多次，照本 skill 執行不要重新發明。
---

# 起開發環境（start-dev）

## 步驟 1：前置檢查（助手先跑，能自動查的不要叫使用者查）

```bash
# a. 殘留 node 程序（上次 Ctrl+C 常殺不乾淨，會佔埠或鎖檔）
tasklist //FI "IMAGENAME eq node.exe" //V
# 有使用者自己的殘留（CHUAN\jason 且非 Codex runtime 路徑）→ 請使用者確認後 taskkill //F //PID <pid>

# b. .env 必要變數是否齊（只看變數名，絕不顯示值）
grep -oE "^[A-Z_]+=" "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.env"
# 需要：GEMINI_API_KEY、GEMINI_MODEL_FAST、GEMINI_MODEL_THINKING、ALLOWED_ORIGIN、FINMIND_TOKEN(選填)
```

```powershell
# c. 埠占用檢查（3001 後端 / 3000 前端）
Test-NetConnection localhost -Port 3001 -InformationLevel Quiet -WarningAction SilentlyContinue
Test-NetConnection localhost -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue
```
- 兩埠皆回 **True** → 環境可能已經開著：**跳過步驟 2**，直接進步驟 3 輪詢確認後回報使用者。
- 埠在聽但其實是舊視窗殘留（步驟 1a 查到殘留 node）→ 先回步驟 1a 清程序，再重新起。
- 兩埠皆 False → 正常，往步驟 2 開視窗。

## 步驟 2：助手直接開兩個視窗（Start-Process，使用者看得見）

助手直接執行下列兩行（不是給使用者貼，是助手自己跑），會開出兩個獨立、使用者看得見的 PowerShell 視窗：

```powershell
# 視窗 A（後端 vercel dev 3001）
Start-Process powershell -WorkingDirectory "E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4" -ArgumentList '-NoExit','-Command','npx.cmd vercel dev --listen 3001'

# 視窗 B（前端 Vite 3000）
Start-Process powershell -WorkingDirectory "E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4" -ArgumentList '-NoExit','-Command','npm.cmd run dev'
```

- 這會開出兩個獨立 PowerShell 視窗（A 後端、B 前端），使用者可在視窗內即時看 log、要收工時各自 **Ctrl+C**。
- `-NoExit` 讓視窗在指令跑起來後留著顯示 log，不會一閃即關。
- 為何用 `npx.cmd` / `npm.cmd`：PowerShell execution policy 會擋 `npx.ps1` / `npm.ps1`，用 `.cmd` 版繞過。
- 為何用 `-WorkingDirectory` 而非 `-Command` 內 `cd "..."`：專案根目錄含空格（`E:\My Project\...`），把 `cd "..."` 塞進 `-Command` 字串會踩內層引號轉義雷；用 `-WorkingDirectory` 帶路徑最乾淨。

## 步驟 3：輪詢就緒後回報

開完視窗後，助手輪詢兩埠，兩埠皆通才回報使用者開瀏覽器：

```powershell
$deadline = (Get-Date).AddSeconds(90)
do {
    $b = Test-NetConnection localhost -Port 3001 -InformationLevel Quiet -WarningAction SilentlyContinue
    $f = Test-NetConnection localhost -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue
    if ($b -and $f) { break }
    Start-Sleep -Seconds 3
} while ((Get-Date) -lt $deadline)

if ($b -and $f) {
    Write-Host "OK：後端 3001 + 前端 3000 就緒，瀏覽器開 http://localhost:3000"
} else {
    Write-Host "TIMEOUT: b=$b f=$f — 看視窗 A/B 的 log 對照下方故障表"
}
```

- `vercel dev` 首次冷啟可能 30–60 秒，故上限設 **90 秒**、每 **3 秒**輪一輪。
- 兩埠（$b 後端 3001、$f 前端 3000）**皆通**才回報使用者開 http://localhost:3000（`/api` 由 Vite proxy 轉給 3001）。
- 逾時就把 `b=`/`f=` 值連同「看視窗 A/B 的 log」一起回報，對照下方故障表判斷。
- 替代法：亦可用 `Invoke-WebRequest -UseBasicParsing -Uri http://localhost:3000 -TimeoutSec 3`，但 `vercel dev` 對 `/` 會回 404，`Test-NetConnection` 只測埠、不受 HTTP 狀態影響，較穩。

## Fallback：Start-Process 失敗時退回複製貼上

若 `Start-Process` 因權限／環境問題失敗（開不出視窗），就把下面這兩段貼給使用者，請他自己在兩個終端機各跑一個：

**終端機視窗 A（後端）**：
```
cd "E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4"
npx.cmd vercel dev --listen 3001
```
等到顯示 `Ready! Available at http://localhost:3001`。**這個視窗不要關。**

**終端機視窗 B（前端）**：
```
cd "E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4"
npm.cmd run dev
```
等到顯示 `➜  Local:   http://localhost:3000/`。**這個視窗不要關。**

兩個都 Ready 後，瀏覽器開 **http://localhost:3000**（`/api` 由 Vite proxy 轉給 3001）。

## 常見故障對照（出現症狀直接比對，不要重新診斷）

| 症狀 | 原因 | 解法 |
|---|---|---|
| 前端 console 一串 `ECONNREFUSED /api/...` | 3001 後端沒在跑（只開了 B 沒開 A） | 開終端機 A |
| `npx : 因為這個系統上已停用指令碼執行` | PowerShell execution policy 擋 npx.ps1 | 改用 `npx.cmd`（npm 同理 `npm.cmd`） |
| `Port 3000/3001 is in use` | 舊視窗沒關乾淨 | 步驟 1a 清殘留程序 |
| `EPERM: operation not permitted, scandir` | 在錯的資料夾跑、或殘留程序鎖資料夾 | 確認 cd 到專案資料夾；清殘留程序 |
| vercel dev 問 team/project/directory | 首次 link | team 選自己、Create new project、Code directory 按 Enter（./）、Customize 一律 No；專案名稱要全小寫 |
| AI 分析「分析失敗」但 K 線正常 | 多半 Gemini 金鑰/環境問題或殘留程序鎖 api/ | 看 A 視窗的 `[gemini:CODE]` log 再判斷 |

## 收尾提醒
測完若要進行 **git 合併/切分支**：先請使用者 Ctrl+C 關掉兩個視窗，再 `tasklist` 確認
node 程序歸零（Ctrl+C 常留子程序），否則檔案鎖會讓 git 操作失敗——這是本專案踩過 3 次的雷。
