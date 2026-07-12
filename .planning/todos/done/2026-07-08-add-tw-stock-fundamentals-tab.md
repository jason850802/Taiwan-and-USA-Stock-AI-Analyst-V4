---
created: 2026-07-08T05:07:32.489Z
resolved: 2026-07-12
title: Add TW stock fundamentals tab
area: ui
files:
  - .claude/skills/tw-fundamentals/SKILL.md
  - .agents/skills/tw-fundamentals/SKILL.md
  - .claude/skills/_shared/fetch_fundamentals.py
  - .planning/design/fundamentals-tab-PLAN-v2.md
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

依 [fundamentals-tab-PLAN-v2.md](../../design/fundamentals-tab-PLAN-v2.md) 執行完畢（取代
本文件原引用的舊版 `fundamentals-tab-PLAN.md`）：新增 `fundamentals` 分頁，資料改走後端
`/api/finmind` 代理白名單（非前端直連），欄位邏輯照抄 `fetch_fundamentals.py`。內容：估值卡
（PER/PBR/殖利率）、近 13 月營收+YoY 趨勢圖、近 8 季損益三率+EPS 趨勢圖、財務體質+現金流卡、
近 5 期股利表、AI 基本面解讀（六段固定輸出）。7 個 Step 皆已 tsc 過＋實跑驗證（2330/2882/
6488/0050/2317），逐一 atomic commit。
