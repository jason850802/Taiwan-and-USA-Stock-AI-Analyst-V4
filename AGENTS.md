# Codex Agent Instructions

> 本檔給 OpenAI Codex 讀。Claude Code 讀 `CLAUDE.md`，Codex 讀本檔；兩者要看到同一套規則。

## 單一事實來源（Single Source of Truth）

本專案的**完整規則、架構、慣例與技能，一律以根目錄的 `CLAUDE.md` 為準**。動工前請先讀 `CLAUDE.md`。
本檔只指向、**不複製** `CLAUDE.md`，以免兩份不同步；若有衝突，以 `CLAUDE.md` 為準。

**唯一例外**：`CLAUDE.md` 裡「如何使用 GSD」寫的是 **Claude 的斜線指令用法**；**Codex 請改用下方「Codex 如何使用 GSD」一節**（兩個工具的 GSD 入口不同）。

## 動工前的紅線（摘自 CLAUDE.md，細節以該檔為準）

- **安全（最高優先）**：`GEMINI_API_KEY` 只能存在於後端／環境變數，**絕不可出現在前端 bundle 或 git**。這是本專案存在的根本目的。
- **相容性**：資料服務層回傳的領域型別（`StockDataPoint[]`、`StockInfo` 等）必須保持相容，避免動到圖表、過濾器、提示詞與既有分析行為。
- **程式風格**：2 空格縮排、單引號、繁體中文註解、camelCase／PascalCase 命名；不要重排或重寫無關檔案。

## Codex 如何使用 GSD（重要：與 Claude 不同）

GSD 已為 Codex 安裝完成（代理在 `.codex/agents/`、守門 hook 在 `.codex/hooks.json`），但**入口方式和 Claude 不一樣**：

- ❌ **不要**使用 `/gsd-quick`、`/gsd-plan-phase`、`/gsd-execute-phase` 等斜線指令——那些是 **Claude Code 專屬**，Codex 沒有。
- ✅ **改用 GSD 的 `gsd-ns-*` 整合入口技能**（透過 Skill 機制呼叫），它們會再路由到對應的子流程：
  | 想做的事 | 用這個技能 |
  |---|---|
  | 討論／規劃／執行／驗證／推進階段 | `gsd-ns-workflow`（discuss・plan・execute・verify・phase・progress） |
  | 程式審查／除錯／安全／UI／eval | `gsd-ns-review` |
  | 建立 codebase 知識（map／graphify／docs／learnings） | `gsd-ns-context` |
  | 專案生命週期（里程碑／稽核／摘要） | `gsd-ns-project` |
  | 設定／工作區／workstreams／ship | `gsd-ns-manage` |
  | 構想探索（explore／sketch／spike／spec） | `gsd-ns-ideate` |

- **改檔前務必先走 GSD**：`.codex/hooks.json` 的 `gsd-workflow-guard` 會在 Edit／Write／Bash 前檢查流程、`gsd-validate-commit` 會檢查提交——這等同 `CLAUDE.md` 對 Claude 的強制規則。除非使用者明確要求略過。
- 規劃／執行時，閱讀 `.planning/` 下相關的 `PLAN.md`、`STATE.md`，並維持**每步原子提交**。

## 專案技能（Skills）

`.agents/skills/`（Codex 讀）與 `.claude/skills/`（Claude 讀）內含本專案的可重用技能，包括朱家泓進場分析步驟 1–7（`trend-analysis`、`position-analysis`、`kline-signal`、`ma-structure`、`volume-analysis`、`indicator-analysis`、`entry-decision`）。動工前先列出並閱讀相關 `SKILL.md`，實作時遵守其規則。
**鏡像規則**：`.claude/skills/` 是唯一事實來源；改 `.claude/skills/` 後執行 `npm run sync:skills` 同步到 `.agents/skills/`（白名單見 `scripts/sync_skills_mirror.py`），不要手動改鏡像端。

## 全域基準

全域基準規則見 `~/.codex/AGENTS.md` 指向的 `CORE_RULES.md`；**專案層級（本檔與 `CLAUDE.md`）優先於全域基準。**
