# 04 — 帳本「沖」徽章＋批次覆核收尾

Status: resolved（2026-07-30；徽章 commit e424e3a、覆核修正 commit 53e2871）
Blocked by: 03

- [x] 帳本列徽章：只有 `true` 顯示「沖」；`false` 與 `undefined` 零視覺變化（DOM 驗證：三筆帳全表僅 1 個徽章）
- [x] `main..HEAD` 全 diff 批次 code-review（Standards＋Spec 雙軸）
- [x] findings 全數處置：R-01 已修（commit 53e2871）；F-03／F-04 記入 findings.md
- [x] 最終 `npm run gate` 全綠（611 tests、既有案例零修改）
- [x] `REPORT.md` 完成（票對照表／gate 摘要／覆核發現／DOM 證據／人工驗收清單／合併指令）
- [x] 四張票與本票皆已標 resolved＋commit hash
- [x] **未合併 main**（合併留給使用者驗收後執行；merge message 已備在 MERGE_MSG.txt）

## 目標

已實現帳本列在 `isDayTrade === true` 時顯示「沖」徽章；然後執行整個 feature 的
批次覆核收尾，產出隔日驗收所需的 REPORT。

## 規格依據

spec.md「帳本 UI」節；收尾協定見同目錄 RUNBOOK.md「全票完成後」節。

## 範圍

做：
- 帳本列徽章：只有 `true` 顯示「沖」；`false` 與 `undefined` 一律無任何視覺變化
  （顯示層不放大三態）。
- 收尾：
  1. 對 main..HEAD 全 diff 跑批次 code-review（Standards＋Spec 兩軸）。
  2. findings 全數處置：修正另立 commit，或在 findings.md 記明不修理由。
  3. 最終 `npm run gate` 全綠。
  4. 寫 `.scratch/tw-day-trade/REPORT.md`：各票 commit hash、gate 摘要、
     code-review findings 與處置、DOM 驗證證據、**使用者人工驗收清單**
     （票 03 五情境＋帳本徽章＋舊資料無變化）、合併指令（含 `Code-Review:` trailer 範例）。

不做：
- **合併 main**（使用者驗收後親自執行）。
- 帳本 CSV／統計的任何其他變動。
- findings.md 既有 F-01／F-02 的處置（另日裁決）。

## 驗收

- 徽章僅在 `true` 列出現；帶 `undefined` 的舊資料與匯入資料零視覺變化（DOM 驗證）。
- code-review findings 全數處置完畢。
- 最終 gate 全綠；REPORT.md 完整；四張票與本票皆已標 resolved＋commit hash。
