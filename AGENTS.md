# Codex Agent Instructions

> 本檔給 OpenAI Codex 讀。Claude Code 讀 `CLAUDE.md`，Codex 讀本檔；兩者要看到同一套規則。

## 單一事實來源（Single Source of Truth）

本專案的**完整規則、架構、慣例與技能，一律以根目錄的 `CLAUDE.md` 為準**。動工前請先讀 `CLAUDE.md`。
本檔只指向、**不複製** `CLAUDE.md`，以免兩份不同步；若有衝突，以 `CLAUDE.md` 為準。

**唯一例外**：`CLAUDE.md` 的工作流路由表寫的是 **Claude 的斜線指令用法**；**Codex 請改用下方「Codex 如何接工作」一節**（同一套 skills，入口方式不同）。

## 動工前的紅線（摘自 CLAUDE.md，細節以該檔為準）

- **安全（最高優先）**：`GEMINI_API_KEY` 只能存在於後端／環境變數，**絕不可出現在前端 bundle 或 git**。這是本專案存在的根本目的。
- **相容性**：資料服務層回傳的領域型別（`StockDataPoint[]`、`StockInfo` 等）必須保持相容，避免動到圖表、過濾器、提示詞與既有分析行為。
- **程式風格**：2 空格縮排、單引號、繁體中文註解、camelCase／PascalCase 命名；不要重排或重寫無關檔案。

## Codex 如何接工作（2026-07-24 起，GSD 已完全停用）

**GSD 已停用**：`.codex/hooks.json` 的守門 hook 全數解除註冊，`gsd-ns-*` 技能不再使用，
`/gsd-*` 斜線指令亦不使用。本專案改用 Matt Pocock 的 engineering skills
（Claude 與 Codex 共用同一套；Codex 端透過各 skill 的 `agents/openai.yaml` 呼叫）。

- **工作票據**在 `.scratch/<feature>/issues/<NN>-<slug>.md`（一票一檔，含 `Blocked by` 與驗收條件）。
  接手時**讀該票即可冷啟動**，不需要讀 `.planning/`。規格書在 `.scratch/<feature>/spec.md`。
- **tracker 慣例**見 `docs/agents/issue-tracker.md`；triage 狀態字串見 `docs/agents/triage-labels.md`。
- **`.planning/` 是 Phase 1~12 的歷史檔案庫（唯讀）**——查既往決策可讀，新工作一律不寫入它。
- **實作紀律**：一票一個 commit；每步 `npx tsc --noEmit` 0 錯；收尾跑完整測試與 `npm run build`，
  並確認 `grep -r "AIza" dist/` 無結果、`package.json`／`package-lock.json` 零變動。
- 票據刻意**不寫檔案路徑與行號**（耐久原則）——依行為描述自行探索現況程式碼。

## 專案技能（Skills）

`.agents/skills/`（Codex 讀）與 `.claude/skills/`（Claude 讀）內含本專案的可重用技能，包括朱家泓進場分析步驟 1–7（`trend-analysis`、`position-analysis`、`kline-signal`、`ma-structure`、`volume-analysis`、`indicator-analysis`、`entry-decision`）。動工前先列出並閱讀相關 `SKILL.md`，實作時遵守其規則。
**鏡像規則**：`.claude/skills/` 是唯一事實來源；改 `.claude/skills/` 後執行 `npm run sync:skills` 同步到 `.agents/skills/`（白名單見 `scripts/sync_skills_mirror.py`），不要手動改鏡像端。

## 全域基準

全域基準規則見 `~/.codex/AGENTS.md` 指向的 `CORE_RULES.md`；**專案層級（本檔與 `CLAUDE.md`）優先於全域基準。**
