# Codex Agent Instructions

> 本檔給 OpenAI Codex 讀。Claude Code 讀 `CLAUDE.md`，Codex 讀本檔；兩者要看到同一套規則。

## 單一事實來源（Single Source of Truth）

本專案的**完整規則、架構、慣例、技能（skills）與工作流程，一律以根目錄的 `CLAUDE.md` 為準**。
請在動工前先完整閱讀 `CLAUDE.md`，並把它視為本專案的權威指引。

本檔**不複製** `CLAUDE.md` 的內容，只指向它，以避免兩份文件不同步。
若本檔與 `CLAUDE.md` 有任何衝突，**以 `CLAUDE.md` 為準**。

## 動工前務必遵守的紅線（摘自 CLAUDE.md，細節仍以該檔為準）

- **安全（最高優先）**：`GEMINI_API_KEY` 只能存在於後端／環境變數，**絕不可出現在前端 bundle 或 git**。這是本專案存在的根本目的，任何改動都不得破壞此原則。
- **相容性**：資料服務層回傳的領域型別（`StockDataPoint[]`、`StockInfo` 等）必須保持相容，避免動到圖表、過濾器、提示詞與既有分析行為。
- **程式風格**：沿用既有慣例——2 空格縮排、單引號、繁體中文註解、camelCase／PascalCase 命名，不要重排或重寫無關檔案。
- **工作流程**：使用 Edit／Write 等改檔工具前，先透過 GSD 工作流程（`/gsd-quick`、`/gsd-execute-phase` 等）進行，讓規劃文件與執行紀錄保持同步；除非使用者明確要求略過。

## 專案技能（Skills）

`.claude/skills/` 與 `.agents/skills/`（若存在）內含本專案的可重用技能（例如朱家泓進場分析步驟 1–7）。動工前請先列出並閱讀相關的 `SKILL.md`，並在實作時遵守其規則。

## 全域基準

本機全域基準規則見 `~/.codex/AGENTS.md` 指向的 `CORE_RULES.md`；**專案層級（本檔與 `CLAUDE.md`）優先於全域基準。**
