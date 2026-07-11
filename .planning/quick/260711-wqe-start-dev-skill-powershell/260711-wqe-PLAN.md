---
phase: quick-260711-wqe
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .claude/skills/start-dev/SKILL.md
autonomous: true
requirements:
  - SKILL-direct-start
  - SKILL-ready-poll
  - SKILL-fallback
  - MIRROR-consistency
user_setup: []

must_haves:
  truths:
    - "依 SKILL 執行「起環境」時，助手用 PowerShell Start-Process 開出兩個使用者看得見的獨立視窗（後端 vercel dev 3001、前端 Vite 3000），使用者能看 log、能自己 Ctrl+C"
    - "助手輪詢 3001 與 3000（有上限與間隔），兩埠皆就緒後才回報『瀏覽器開 http://localhost:3000』；逾時則導向視窗 log 與故障表"
    - "步驟1前置檢查（殘留 node 程序、.env 變數名、埠占用）、故障對照表、收尾提醒全部保留"
    - "Start-Process 失敗時 SKILL 提供退回原複製貼上指令的 fallback"
    - "frontmatter description 反映新行為（助手直接開視窗＋輪詢，非只給指令）"
    - "實跑一次啟動流程後，3000/3001 皆可連線且環境留著給使用者用（未被關閉）"
  artifacts:
    - path: ".claude/skills/start-dev/SKILL.md"
      provides: "助手直接開兩視窗 + 輪詢就緒 + fallback 的起環境流程"
      contains: "Start-Process"
  key_links:
    - from: "SKILL.md 步驟2"
      to: "Start-Process powershell -WorkingDirectory ... -ArgumentList npx.cmd/npm.cmd"
      via: "助手直接執行開兩個視窗"
      pattern: "Start-Process"
    - from: "SKILL.md 步驟3"
      to: "3001/3000 就緒輪詢"
      via: "Test-NetConnection / Invoke-WebRequest 迴圈"
      pattern: "Test-NetConnection|Invoke-WebRequest"
---

<objective>
升級 `.claude/skills/start-dev/SKILL.md`：使用者說「起環境」時，助手不再只輸出複製貼上指令，而是直接用 PowerShell `Start-Process` 開兩個使用者看得見的獨立視窗（A：後端 `vercel dev --listen 3001`；B：前端 `npm run dev` → Vite 3000），輪詢兩埠就緒後回報使用者「瀏覽器開 http://localhost:3000」。

Purpose: 使用者已重複多次要「幫我把環境起好」；把 skill 從「教學／給指令」改為「助手直接執行」，讓使用者看得到 log、能自己 Ctrl+C，省掉每次手動貼指令的往返。
Output: 改寫後的 `SKILL.md`（步驟1前置檢查保留、步驟2 改為助手直接開視窗、新增步驟3輪詢、保留 fallback 與故障表與收尾提醒、更新 frontmatter description）；並實跑一次啟動流程驗證兩埠皆活、環境留著。
</objective>

<execution_context>
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

# 要升級的目標檔（現況：步驟2 是「給使用者複製貼上指令」）
@.claude/skills/start-dev/SKILL.md

# 已查證的關鍵事實（勿再重查）：
# 1. `.agents/skills/start-dev` 不存在——start-dev 不在 sync 白名單（scripts/sync_skills_mirror.py
#    WHITELIST 只含 7 個朱家泓分析 skill + tw-fundamentals + _shared）。故 `npm run sync:skills`
#    對 start-dev 是 no-op，只會重驗分析 skill 鏡像一致；不要期待也不要新建 .agents/skills/start-dev。
# 2. `.vercel/project.json` 已存在（專案已 link）→ vercel dev 不會問 team/project → 輪詢會真的收斂。
# 3. 專案根目錄含空格：E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4
#    → 用 Start-Process 的 -WorkingDirectory 帶路徑，避開 -Command 內 cd "..." 的內層引號轉義雷。
# 4. PS 5.1：沒有 &&；execution policy 擋 .ps1 → 一律 npx.cmd / npm.cmd；
#    輪詢用 Test-NetConnection -InformationLevel Quiet 或 Invoke-WebRequest -UseBasicParsing（無新版參數）。
</context>

<tasks>

<task type="auto">
  <name>Task 1: 改寫 SKILL.md — 步驟2 改助手直接開視窗、新增步驟3輪詢、保留 fallback</name>
  <files>.claude/skills/start-dev/SKILL.md</files>
  <action>
    改寫 `.claude/skills/start-dev/SKILL.md`，維持既有台式繁中口吻與「照本執行不要重新發明」精神。整體節構：frontmatter → 步驟1 → 步驟2 → 步驟3 → Fallback → 故障對照表 → 收尾提醒。

    (A) 更新 frontmatter `description`：反映新行為——助手先做前置檢查，再「直接用 PowerShell Start-Process 開兩個使用者看得見的視窗（後端 vercel dev 3001＋前端 Vite 3000），輪詢兩埠就緒後回報『瀏覽器開 http://localhost:3000』；不再只輸出複製貼上指令（保留為 fallback）」。觸發語保留現有那組（「起環境」「開 dev」「給我開 localhost 的指令」「怎麼啟動 App」或人工驗證前需要環境時）。

    (B) 步驟1 前置檢查——保留現有 (a) 殘留 node 程序（`tasklist //FI "IMAGENAME eq node.exe" //V`，使用者殘留請確認後 `taskkill //F //PID`）與 (b) .env 變數名檢查（只看變數名絕不顯示值）兩段原樣不動；新增 (c) 埠占用檢查：`Test-NetConnection localhost -Port 3001 -InformationLevel Quiet` 與 3000——若已在聽表示環境可能已開（跳過步驟2、直接進步驟3驗證並回報），若是舊視窗殘留占埠則回到 (a) 清程序。

    (C) 步驟2 由「給使用者指令」改為「助手直接開兩個視窗」。標題改為類似「## 步驟 2：助手直接開兩個視窗（Start-Process，使用者看得見）」。放一個 powershell fenced block，內含兩行命令（用 -WorkingDirectory 帶含空格路徑、避開內層引號轉義；-NoExit 讓視窗留著顯示 log）：
    後端 → `Start-Process powershell -WorkingDirectory "E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4" -ArgumentList '-NoExit','-Command','npx.cmd vercel dev --listen 3001'`
    前端 → `Start-Process powershell -WorkingDirectory "E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4" -ArgumentList '-NoExit','-Command','npm.cmd run dev'`
    命令下方用一兩句說明：這會開出兩個獨立 PowerShell 視窗（A 後端、B 前端），使用者可在視窗內看 log、要收工時各自 Ctrl+C；為何用 `npx.cmd`/`npm.cmd`（execution policy 擋 .ps1）與為何用 `-WorkingDirectory` 而非 `cd "..."`（路徑含空格＋-Command 內層引號轉義是常見雷）。

    (D) 新增步驟3 就緒輪詢。標題類似「## 步驟 3：輪詢就緒後回報」。放一個 powershell fenced block：以 `$deadline = (Get-Date).AddSeconds(90)` 為上限，`do { ... Start-Sleep -Seconds 3 } while ((Get-Date) -lt $deadline)` 迴圈，每輪用 `Test-NetConnection localhost -Port 3001 -InformationLevel Quiet -WarningAction SilentlyContinue`（$b）與 Port 3000（$f）檢查，`if ($b -and $f) { break }`；迴圈後 `if ($b -and $f)` 印「OK：後端 3001 + 前端 3000 就緒，瀏覽器開 http://localhost:3000」，else 印「TIMEOUT: b=$b f=$f — 看視窗 A/B 的 log 對照下方故障表」。文字說明：vercel dev 首次冷啟可能 30–60 秒故上限設 90 秒、每 3 秒一輪；兩埠皆通才回報使用者開瀏覽器；並補一句替代法「亦可用 `Invoke-WebRequest -UseBasicParsing -Uri http://localhost:3000 -TimeoutSec 3`，但 vercel dev 對 / 會回 404，Test-NetConnection 測埠不受 HTTP 狀態影響較穩」。

    (E) 新增「## Fallback：Start-Process 失敗時退回複製貼上」——把「現況步驟2」那份手動格式（終端機視窗 A：`cd "..."` + `npx.cmd vercel dev --listen 3001`；視窗 B：`cd "..."` + `npm.cmd run dev`；各自的 Ready 提示與「這個視窗不要關」）原樣搬到這一節，前言：若 Start-Process 因權限/環境失敗（開不出視窗），就把這兩段貼給使用者自己在兩個終端機跑。

    (F) 「## 常見故障對照」表與「## 收尾提醒」原樣保留不動（收尾提醒關於 git 合併前 Ctrl+C＋tasklist 歸零那段是踩過 3 次的雷，務必保留）。

    禁止用複製貼上/heredoc 寫檔——用 Write 工具整檔改寫。
  </action>
  <verify>
    <automated>node -e "const fs=require('fs');const s=fs.readFileSync('.claude/skills/start-dev/SKILL.md','utf8');const need=['Start-Process','-WorkingDirectory','npx.cmd vercel dev --listen 3001','npm.cmd run dev','Test-NetConnection','3000','Fallback','收尾'];const miss=need.filter(t=>!s.includes(t));if(miss.length){console.error('MISSING:',miss);process.exit(1)}console.log('OK: 全部關鍵段落到位')"</automated>
  </verify>
  <done>SKILL.md 步驟2 已改為助手直接 Start-Process 開兩視窗（含 -WorkingDirectory 正確寫法）、有步驟3輪詢（90s 上限/3s 間隔/兩埠皆通才回報）、保留 Fallback 複製貼上、故障表與收尾提醒不變、frontmatter description 已更新；上述 node 檢查通過。</done>
</task>

<task type="auto">
  <name>Task 2: 同步 Codex 鏡像（no-op 驗證）＋ 實跑一次啟動流程驗證兩埠皆活</name>
  <files>.claude/skills/start-dev/SKILL.md</files>
  <action>
    兩件事：鏡像一致性驗證 + 依新 SKILL 實跑一次。

    (1) 執行 `npm run sync:skills`。預期輸出所有白名單 skill 皆 `[OK]` 且結尾「鏡像一致 ✓」（exit 0）。重要：start-dev 不在白名單（見 context 已查證），故本次改動不會出現在 .agents/skills，也不需新建——sync 對 start-dev 是 no-op，只是重驗分析 skill 鏡像未被連帶破壞。若 sync 報 DIFF/失敗，那是其他 skill 的既有不一致，非本任務引入，回報使用者即可（勿為此改 start-dev）。

    (2) 依改好的 SKILL 步驟實跑，驗證助手真能把環境起好且兩埠皆活：
      - 先跑步驟1(c) 埠占用檢查：`Test-NetConnection localhost -Port 3001 -InformationLevel Quiet -WarningAction SilentlyContinue` 與 3000。
      - 若兩埠已在聽 → 環境已開，勿重複 spawn（避免雙 dev server 占埠），直接進輪詢確認並回報。
      - 若未開 → 用 PowerShell 工具實際執行步驟2 的兩行 `Start-Process`（後端 3001、前端 3000）。
      - 執行步驟3 輪詢（90s 上限、3s 間隔），確認 `$b -and $f` 為真。
      成功後環境留著給使用者用——**不要** Ctrl+C、**不要** taskkill、**不要**關視窗（這是驗證，環境要留下）。
    注意：Start-Process 是否開出使用者看得見的視窗取決於執行工作階段是否互動；若視窗未顯示但兩埠仍活，仍算 dev server 起成功（記錄此觀察並提醒 fallback 情境）；若 Start-Process 直接失敗，退回 SKILL 的 Fallback 節（把複製貼上指令給使用者）。
  </action>
  <verify>
    <automated>npm run sync:skills</automated>
    <human-check>執行步驟2/3 後，`Test-NetConnection localhost -Port 3001 -InformationLevel Quiet` 與 Port 3000 皆回 True；瀏覽器開 http://localhost:3000 App 正常載入、無整排 /api ECONNREFUSED；兩個 dev 視窗留著（未被關）。</human-check>
  </verify>
  <done>`npm run sync:skills` 結尾「鏡像一致 ✓」且 exit 0（start-dev 不在白名單為預期）；實跑後 3001/3000 兩埠 Test-NetConnection 皆 True、http://localhost:3000 可載入、環境保留未關閉。</done>
</task>

</tasks>

<threat_model>
純 skill 文件（.md）修改 + 本機開發環境啟動，無新增依賴、無新增外部信任邊界、不觸及 GEMINI_API_KEY／資料抓取／prompt。步驟1(b) 明訂 .env 只看變數名絕不顯示值（維持金鑰不外洩紅線）。無新 STRIDE 威脅。唯一操作面：Start-Process 在本機開視窗與啟 dev server，屬使用者主動要求的既定流程，非新攻擊面。
</threat_model>

<verification>
- Task 1 node 檢查：SKILL.md 含 Start-Process/-WorkingDirectory/兩條命令/Test-NetConnection/3000/Fallback/收尾 等關鍵段落。
- `npm run sync:skills` exit 0、結尾「鏡像一致 ✓」（start-dev 不在白名單為預期，非錯誤）。
- 實跑：3001（後端 vercel dev）與 3000（前端 Vite）Test-NetConnection 皆 True；http://localhost:3000 App 正常、無 /api ECONNREFUSED；環境保留未關。
- 回歸：步驟1前置檢查、故障對照表、收尾提醒（git 前 Ctrl+C＋tasklist 歸零）仍在 SKILL 中。
</verification>

<success_criteria>
- 使用者說「起環境」時，助手依 SKILL 用 Start-Process 直接開兩個看得見的視窗（後端 3001、前端 3000），輪詢就緒後回報「瀏覽器開 http://localhost:3000」，不再只輸出複製貼上指令。
- SKILL 保留步驟1前置檢查（含新增埠占用）、故障對照表、收尾提醒，並提供 Start-Process 失敗時的複製貼上 fallback。
- Start-Process 用 -WorkingDirectory 帶含空格路徑、npx.cmd/npm.cmd、輪詢用 PS 5.1 相容 cmdlet（可直接複製）。
- 實跑驗證兩埠皆活、環境留給使用者；Codex 鏡像分析 skill 保持一致（start-dev 依設計不鏡像）。
</success_criteria>

<output>
完成後建立 `.planning/quick/260711-wqe-start-dev-skill-powershell/260711-wqe-SUMMARY.md`
</output>
