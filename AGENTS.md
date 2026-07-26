# Codex 入口

> **本檔只是指標。專案的完整規則在根目錄的 [`CORE_RULES.md`](CORE_RULES.md)——動工前先讀它。**
> `CLAUDE.md`（Claude Code 讀）指向同一份，兩端看到同一套規則。
> 改規則請改 `CORE_RULES.md`，不要改本檔。

## 不開檔也要遵守的四條

1. **金鑰紅線**：`GEMINI_API_KEY` 只能存在後端／環境變數，**絕不可進前端 bundle 或 git**。
   驗證法：`npm run build` 後 `grep -r "AIza" dist/` 必須無結果。
2. **改 `.ts/.tsx` 後最低驗證 `npx tsc --noEmit`**；只讀過程式碼不算驗證。完整 gate 見 `CORE_RULES.md`。
3. **環境**：Windows ＋ PowerShell 5.1 沒有 `&&`；路徑含空格必加引號；寫檔一律 UTF-8。
4. **程式風格**：2 空格縮排、單引號、繁體中文註解、camelCase／PascalCase；
   **不要重排或重寫無關檔案**。所有產出繁體中文，禁用簡體字。

## Codex 專屬

- **Skills 位置**：讀 `.agents/skills/`（`.claude/skills/` 的鏡像）。
  **鏡像是唯讀的**——要改 skill 請改 `.claude/skills/` 再跑 `npm run sync:skills`。
- **Matt Pocock skills**：透過各 skill 的 `agents/openai.yaml` 呼叫
  （與 Claude 共用同一套 skill，只是入口方式不同）。
- **接工作**：票據在 `.scratch/<feature>/issues/<NN>-<slug>.md`（一票一檔，含 `Blocked by`
  與驗收條件），**讀該票即可冷啟動**，不需要讀 `.planning/`。規格書在 `.scratch/<feature>/spec.md`。
  票據刻意不寫檔案路徑與行號（耐久原則）——依行為描述自行探索現況程式碼。
- **`.planning/` 是 Phase 1~12 的歷史檔案庫（唯讀）**：查既往決策可讀，新工作一律不寫入。
- **實作紀律**：一票一個 commit；每步 `npx tsc --noEmit` 0 錯；
  收尾跑完整測試與 `npm run build`，並確認 `package.json`／`package-lock.json` 零變動。
- 全域基準見 `~/.codex/AGENTS.md` 指向的 `agent-dual-core\CORE_RULES.md`；
  **專案層（`CORE_RULES.md`）優先於全域基準。**

<!-- 2026-07-24 重構為指標檔，內容合併進 CORE_RULES.md（原有的程式風格、鏡像規則、耐久原則條款均已併入） -->
