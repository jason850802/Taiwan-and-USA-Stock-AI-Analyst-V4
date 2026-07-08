---
created: 2026-07-08T05:07:32.489Z
title: Add TW stock fundamentals tab
area: ui
files:
  - .claude/skills/tw-fundamentals/SKILL.md
  - .agents/skills/tw-fundamentals/SKILL.md
  - .claude/skills/_shared/fetch_fundamentals.py
  - .planning/design/fundamentals-tab-PLAN.md
---

## Problem

使用者很久之前就提過：想把台股個股的基本面資料（最新一個月營收、EPS、財報等）整合進 App
介面裡直接看到，不用切去對話問 skill。這是使用者主動要求記下的待辦，尚未排入任何 GSD phase 執行。

這個構想其實已經規劃過、不是從零開始：
- **資料層已存在並實測過**：`tw-fundamentals` skill（`.claude/skills/tw-fundamentals/SKILL.md`，
  Codex 側鏡像於 `.agents/skills/tw-fundamentals/`）用 FinMind 免費 API 抓月營收、財報（損益/
  資產負債/現金流）、估值（PER/PBR/殖利率）、股利，抓取腳本在
  `.claude/skills/_shared/fetch_fundamentals.py`，曾對台積電(2330)、國泰金(2882，金融股結構
  不同)實測驗證過欄位對映正確。這一層目前只在 Claude/Codex 對話中被呼叫，還沒有接進前端 UI。
- **UI 設計已產出**：`.planning/design/fundamentals-tab-PLAN.md` 有完整的分頁設計（線稿、
  資料流、與現有 Yahoo/FinMind 資料源整合方式），是在 UI 大翻新規劃前先出的獨立設計文件，
  尚未套用 UI 翻新後的新設計 token（`components/ui/` 共用元件、色彩系統）——執行前需要先
  對照現有設計文件是否要依新 token 系統重新順一次版面，而不是照舊圖直接做。

**決策脈絡**：使用者當時決定先完成 GSD 後端安全里程碑（Phase 1 金鑰封存）與 UI 大翻新
（Phase A/B/C）才回頭做這個，兩者都已完成（分別合併於 main `e3243ba` 與 `d016a7d`）。
本待辦與目前 `ROADMAP.md` 的後端 Phase 2-4（Yahoo/FinMind API 代理化、防濫用）是不同軌道——
那是把既有資料抓取搬到後端保護 token；這個待辦是新增一個「顯示台股基本面」的前端分頁功能。

## Solution

TBD——執行前建議：
1. 先確認 `.planning/design/fundamentals-tab-PLAN.md` 的版面是否要依 UI 翻新後的
   `components/ui/` 共用元件與色彩 token 重新順一版（多半要，因為該文件早於 UI 翻新）。
2. 資料抓取邏輯可直接複用 `fetch_fundamentals.py` 的欄位對映與 FinMind dataset 清單，
   不需重新研究。
3. 需決定：資料是前端直連 FinMind（比照現有 `services/` 模式），或等後端 Phase 3
   （FinMind 代理化）完成後走後端——若先做這個待辦，可能與 Phase 3 有工作重疊，執行前一併評估。
