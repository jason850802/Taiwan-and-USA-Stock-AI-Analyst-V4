---
phase: quick-260711-wqe
plan: 01
subsystem: dev-workflow-skills
tags: [start-dev, powershell, skill, dev-environment]
requires: []
provides:
  - "start-dev skill：助手直接 Start-Process 開兩視窗＋輪詢就緒的起環境流程"
affects:
  - .claude/skills/start-dev/SKILL.md
tech-stack:
  added: []
  patterns:
    - "PowerShell Start-Process -WorkingDirectory 帶含空格路徑開獨立視窗（避 -Command 內層引號轉義）"
    - "Test-NetConnection -InformationLevel Quiet 迴圈輪詢埠就緒（90s 上限/3s 間隔）"
key-files:
  created: []
  modified:
    - .claude/skills/start-dev/SKILL.md
decisions:
  - "start-dev 依設計不進 Codex 鏡像白名單，sync:skills 對它為 no-op（不新建 .agents/skills/start-dev）"
  - "輪詢用 Test-NetConnection 測埠而非 Invoke-WebRequest，因 vercel dev 對 / 回 404"
metrics:
  duration: ~3 分鐘
  completed: 2026-07-11T15:44:55Z
  tasks: 2
  files: 1
---

# Quick 260711-wqe: start-dev Skill PowerShell 升級 Summary

把 `start-dev` skill 從「輸出複製貼上指令」升級為「助手直接用 PowerShell Start-Process 開兩個使用者看得見的視窗（後端 vercel dev 3001＋前端 Vite 3000）並輪詢兩埠就緒後回報」，並實跑驗證兩埠皆活、環境留給使用者。

## 做了什麼

### Task 1：改寫 SKILL.md（commit 8b2c386）
- **frontmatter description** 更新：反映助手先前置檢查、再直接 Start-Process 開兩視窗＋輪詢的新行為（複製貼上降為 Fallback）；觸發語保留原組。
- **步驟 1 前置檢查**：原 (a) 殘留 node 程序、(b) .env 只看變數名兩段原樣保留；新增 (c) 埠占用檢查（Test-NetConnection 3001/3000）——兩埠皆 True 跳過步驟 2 直接進步驟 3；殘留占埠回步驟 1a 清程序。
- **步驟 2** 由「給指令」改為「助手直接開兩視窗」：兩行 `Start-Process powershell -WorkingDirectory "E:\My Project\..." -ArgumentList '-NoExit','-Command','npx.cmd vercel dev --listen 3001'`（前端同理 `npm.cmd run dev`），附說明為何用 `.cmd`（execution policy）與 `-WorkingDirectory`（避含空格路徑內層引號轉義）。
- **步驟 3（新增）就緒輪詢**：`$deadline = (Get-Date).AddSeconds(90)` 上限、`Start-Sleep -Seconds 3` 間隔，`Test-NetConnection` 測 $b/$f，`if ($b -and $f) break`，皆通印「OK…瀏覽器開 http://localhost:3000」，逾時印「TIMEOUT: b=$b f=$f」導向視窗 log／故障表；附替代法與為何用 Test-NetConnection 的說明。
- **Fallback（新增）**：原步驟 2 的複製貼上格式（視窗 A/B、Ready 提示、「視窗不要關」）整段搬入。
- **故障對照表**與**收尾提醒**（git 前 Ctrl+C＋tasklist 歸零）原樣保留。
- 驗證：node 關鍵段落檢查通過（Start-Process / -WorkingDirectory / 兩命令 / Test-NetConnection / 3000 / Fallback / 收尾 全到位）。

### Task 2：鏡像一致性 + 實跑驗證
- `npm run sync:skills` → exit 0、結尾「鏡像一致 ✓」，9 個白名單 skill 全 `[OK]`；start-dev 依設計不在白名單、無 `[SYNC] start-dev`，屬預期 no-op；sync 後 git 無新變更（鏡像本已一致）。
- 依新 SKILL 實跑：步驟 1(c) 查得 3001/3000 皆 False（未開）→ 執行步驟 2 兩行 Start-Process（-WorkingDirectory 指向真實專案路徑）→ 步驟 3 輪詢在 90s 內收斂為 `$b -and $f` True。
- 最終確認：`3001=True 3000=True`，前端 `http://localhost:3000` 回 HTTP 200（len=2669）。
- 環境**保留未關**（未 Ctrl+C／未 taskkill）留給使用者用。

## Deviations from Plan

None - plan executed exactly as written.

## 驗證結果

- Task 1 node 段落檢查：`OK: 全部關鍵段落到位`。
- `npm run sync:skills`：exit 0、「鏡像一致 ✓」（start-dev 不鏡像為預期）。
- 實跑：3001（後端 vercel dev）+ 3000（前端 Vite）Test-NetConnection 皆 True；前端 HTTP 200。
- 回歸：步驟 1 前置檢查、故障對照表、收尾提醒仍在 SKILL 中。

## 給使用者的環境現況

- 兩個 dev server 已起並保留：後端 `vercel dev` 埠 3001、前端 Vite 埠 3000。
- 瀏覽器開 **http://localhost:3000** 即可使用 App。
- 收工／git 合併前請 Ctrl+C 關兩視窗並 `tasklist` 確認 node 歸零。
- 註：本次 Start-Process 由非互動工作階段觸發，視窗是否對使用者可見取決於桌面工作階段；兩埠已實測皆活，dev server 確已起成功。

## Self-Check: PASSED
- FOUND: .claude/skills/start-dev/SKILL.md
- FOUND commit: 8b2c386
