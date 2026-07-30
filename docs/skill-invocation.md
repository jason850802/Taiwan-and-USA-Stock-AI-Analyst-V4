# 主線 skills 的啟動方式（Claude ＋ Codex）

> 自 `CORE_RULES.md` 的工作流段外移（2026-07-30，為守 150 行上限）。
> 規則本體仍以 `CORE_RULES.md` 的路由表為準，本檔只講「怎麼把 skill 叫起來」。

## 兩類 skill

Matt Pocock 的 skills 分兩類，差別寫在各自 `SKILL.md` 的 frontmatter：

| 類別 | 判別 | 有哪些 |
|---|---|---|
| **user-invoked**（模型叫不到） | frontmatter 有 `disable-model-invocation: true` | `grill-with-docs`／`to-spec`／`to-tickets`／`implement`／`wayfinder`／`triage`／`ask-matt`／`improve-codebase-architecture`／`handoff`／`setup-matt-pocock-skills` |
| **模型可自行呼叫** | 無該旗標 | `code-review`／`tdd`／`diagnosing-bugs`／`grilling`／`prototype`／`research`／`codebase-design`／`domain-modeling`／`resolving-merge-conflicts` |

**路由表的主線（grill → spec → tickets → implement）整條都在 user-invoked 那邊**，
這是最容易撞牆的地方：模型的 Skill 工具叫不到它們。

## 兩端限制相同

`disable-model-invocation: true` **兩端 harness 都吃**。2026-07-29 交接測試實測：
Codex 只列得出 19 個鏡像 skills 中的 9 個，缺的正是主線那批（詳
`docs/codex-handoff-findings.md` F2）。所以「Codex 端沒有這個限制」是錯的說法。

## 怎麼啟動（兩條路都算數）

1. **使用者自己打斜線指令**：Claude 端 `/mattpocock-skills:<name>`。
2. **由助手讀 SKILL.md 照內容執行**——依使用者 2026-07-26 授權：
   讀 `.agents/skills/<name>/SKILL.md`（鏡像端，版本穩定、兩端同源）照著做，
   並向使用者標明「現在進入 X 階段」。

派票給 Codex 執行 `implement` 時走第 2 條：它同樣得讀 SKILL.md，不能靠斜線指令。

## 鏡像與來源

`.agents/skills/` 是 Codex 的讀取端，由 `npm run sync:skills` 從兩個來源維護
（專案自有 skills ← `.claude/skills/`；Matt skills ← Claude 的 plugin 快取）。
**不要手動改鏡像端**，白名單見 `scripts/sync_skills_mirror.py`。
`phase-loop` 刻意不進鏡像——規劃由 Claude／Fable 做，Codex 只收 PLAN 文件執行。
