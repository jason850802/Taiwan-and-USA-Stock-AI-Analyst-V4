# Claude Code 入口

> **本檔只是指標。專案的完整規則在根目錄的 [`CORE_RULES.md`](CORE_RULES.md)——動工前先讀它。**
> `AGENTS.md`（Codex 讀）指向同一份，兩端看到同一套規則。
> 改規則請改 `CORE_RULES.md`，不要改本檔。

## 不開檔也要遵守的四條

1. **金鑰紅線**：`GEMINI_API_KEY` 只能存在後端／環境變數，**絕不可進前端 bundle 或 git**。
   驗證法：`npm run build` 後 `grep -r "AIza" dist/` 必須無結果（用 Bash 工具跑，PowerShell 5.1 沒有 grep）。
2. **改 `.ts/.tsx` 後最低驗證 `npx tsc --noEmit`**；只讀過程式碼不算驗證。完整 gate 見 `CORE_RULES.md`。
3. **環境**：PowerShell 5.1 沒有 `&&`；路徑含空格必加引號；寫檔用 Write 工具或 `-Encoding utf8`。
4. **工作流**：使用者描述需求後，依 `CORE_RULES.md` 的「工作流」路由表決定走法，**不要即興決定流程**。
   碰錢的語意決策一律停下來問使用者。

## 交辦 subagent

憑判斷不憑反射：Claude 5 世代 spawn 冷啟動成本高，預設自己處理（讀檔、定位、修改、驗證都算）；
只有大範圍偵查（Explore agent）或已解模式的批次改檔（約 ≥10 檔）才交辦，主對話只收
「結論＋檔案:行號」（判準見 `agent-dual-core\MODEL-DISPATCH.md` 第 1 節）。

## Claude 專屬

- **Skills 位置**：`.claude/skills/`（**唯一事實來源**）。改完執行 `npm run sync:skills`
  同步到 Codex 讀的 `.agents/skills/` 鏡像，不要手動改鏡像端。
- **Matt Pocock skills**：用 Skill 工具或 `/mattpocock-skills:<name>` 斜線指令呼叫。
- 全域基準見 `~/.claude/CLAUDE.md` 指向的 `agent-dual-core\CORE_RULES.md`；
  **專案層（`CORE_RULES.md`）優先於全域基準。**

<!-- 舊版全文備份：.claude/backups/CLAUDE.md.20260703.bak（2026-07-26 重構為指標檔，內容移入 CORE_RULES.md） -->
