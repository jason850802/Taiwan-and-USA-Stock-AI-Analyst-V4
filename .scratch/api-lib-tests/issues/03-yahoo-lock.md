# 03 — yahoo 驗證＋錯誤分類行為鎖

**What to build:** Yahoo 代理模組的行為鎖：
- chart 參數驗證——interval→range 封閉集合逐組上鎖（集合外拒收，守
  「不成為任意行情代理」）、三種代號樣式（台股／海外／匯率）、不符拒收。
- search 參數驗證——關鍵字必填與長度上限、limit 整數界線（1–20）、未給時的預設值。
- 錯誤分類——TimeoutError／AbortError／timeout 訊息 → 上游錯誤；
  已分類錯誤穿透不重包；其餘一律預設上游錯誤。

cookie+crumb 握手是首批外（CONTEXT.md「首批外」），本票不碰。

**Blocked by:** 01 — 測試跑道就位＋config 行為鎖。

**Status:** resolved

- [x] chart／search 驗證與錯誤分類的現行行為全數上鎖
- [x] `npm run gate` 全綠；既有案例零修改；產線碼零變更
- [x] 新翻出的可疑行為 append 進本 feature 目錄的 findings（標票號 03）
- [x] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）

## Comments

**2026-07-28 完成**（sonnet subagent 撰寫＋主窗整合）。40 案例：interval→range
八組合法組合全窮舉（Spec 軸對照 map 確認不多不少）、三種代號樣式、search 界線
（含 `Number('5')` 字串轉型照鎖）、錯誤分類。故障注入 7 條全紅，主窗獨立重跑同結果。
注入選點刻意避開 TimeoutError 分支（與 fallback 殊途同歸、產線碼 L-1 註記已載明——
注入不會紅不算鎖失敗）。findings 進 1 條（第 10：interval/range 大小寫敏感 vs
symbol 寬容的不一致）。握手函式全程未 import（零網路實證）。
