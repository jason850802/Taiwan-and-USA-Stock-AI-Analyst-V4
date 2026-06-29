---
status: complete
phase: quick-260629-ag1
date: 2026-06-29
files_modified: [AGENTS.md]
---

# Quick Task 260629-ag1 — Summary

## 做了什麼
新增專案根目錄 `AGENTS.md`，作為 Codex 的進入指引，採「選項 A：單一事實來源」做法：
- 明確宣告本專案完整規則**以 `CLAUDE.md` 為準**，AGENTS.md 只指向、不複製，避免兩份不同步。
- 摘要關鍵紅線：`GEMINI_API_KEY` 不可進前端 bundle／git、資料領域型別相容、既有程式風格（2 空格／單引號／繁中註解）、改檔前走 GSD 流程。
- 指出 `.claude/skills/`、`.agents/skills/` 的 SKILL.md 需先閱讀。
- 註明專案層級優先於全域 `~/.codex/AGENTS.md` → `CORE_RULES.md` 基準。

## 為什麼
原本專案只有 `CLAUDE.md`、缺 `AGENTS.md`，導致 Codex 讀不到專案層級規則（架構、安全、風格、GSD）。補上後，Claude 與 Codex 在本專案層級達成同步，為「Claude＋Codex 分工執行」奠定共同基礎。

## 注意事項
- 本次任務在執行環境中無法呼叫 `node`，故 GSD 的 `gsd-tools.cjs` 工具鏈（init.quick／query commit／自動 STATE.md 更新）無法自動執行；改以手動複刻 GSD quick 結構（quick 任務目錄 + PLAN.md + SUMMARY.md + STATE.md 紀錄）並用 `git` 原子提交完成。
- 後續若要進一步「正統化」，可依 dual-core 建議把專案規則抽成專案版 `CORE_RULES.md`，再讓 CLAUDE.md 與 AGENTS.md 同時指向它（本次未做，維持單一來源指向 CLAUDE.md 最省事）。

## 驗證
- 根目錄存在 `AGENTS.md`，且為指標檔（非 CLAUDE.md 複本）。
- 內容涵蓋安全紅線與 GSD 流程要求。

## 後續優化（同任務追補）
初版 AGENTS.md 誤將 GSD 用法寫成 Claude 專屬的 `/gsd-quick`、`/gsd-execute-phase` 斜線指令，導致 Codex 跟著做會失敗（使用者回報「Codex 無法使用 GSD」）。
查證後發現 GSD 其實已為 Codex 安裝：`.codex/agents/*.toml`（32 個代理）、`.codex/hooks.json`（gsd-workflow-guard／gsd-validate-commit 等守門 hook）、`.agents/skills/source-command-gsd-ns-*`（入口技能）。Codex 的 GSD 入口是 `gsd-ns-*` 技能（透過 Skill 機制），不是斜線指令。
已重寫 AGENTS.md：
- 新增「Codex 如何使用 GSD」一節，明列 `gsd-ns-workflow / review / context / project / manage / ideate` 對照表，並標明「不要用 `/gsd-*` 斜線指令」。
- 標註 CLAUDE.md 的 GSD 用法（斜線指令）對 Codex 為唯一例外，Codex 改用本節。
- 點出 `.codex/hooks.json` 的守門 hook 等同 Claude 端的強制規則。
- 補上 7 個朱家泓分析技能名稱與 `.agents/skills/`、`.claude/skills/` 來源。
