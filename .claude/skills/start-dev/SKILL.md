---
name: start-dev
description: 起本專案完整開發環境的固定流程：先做前置檢查（殘留 node 程序、.env 變數、埠占用），再給使用者兩終端機的複製貼上指令（vercel dev 3001 後端＋Vite 3000 前端）。當使用者說「起環境」「開 dev」「給我開 localhost 的指令」「怎麼啟動 App」或人工驗證前需要環境時使用。此流程使用者已重複詢問多次，照本 skill 執行不要重新發明。
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

## 步驟 2：給使用者的指令（原樣輸出這個格式，使用者已習慣）

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
等到顯示 `➜  Local:   http://localhost:3000/`。

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
