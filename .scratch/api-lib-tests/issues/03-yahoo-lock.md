# 03 — yahoo 驗證＋錯誤分類行為鎖

**What to build:** Yahoo 代理模組的行為鎖：
- chart 參數驗證——interval→range 封閉集合逐組上鎖（集合外拒收，守
  「不成為任意行情代理」）、三種代號樣式（台股／海外／匯率）、不符拒收。
- search 參數驗證——關鍵字必填與長度上限、limit 整數界線（1–20）、未給時的預設值。
- 錯誤分類——TimeoutError／AbortError／timeout 訊息 → 上游錯誤；
  已分類錯誤穿透不重包；其餘一律預設上游錯誤。

cookie+crumb 握手是首批外（CONTEXT.md「首批外」），本票不碰。

**Blocked by:** 01 — 測試跑道就位＋config 行為鎖。

**Status:** ready-for-agent

- [ ] chart／search 驗證與錯誤分類的現行行為全數上鎖
- [ ] `npm run gate` 全綠；既有案例零修改；產線碼零變更
- [ ] 新翻出的可疑行為 append 進本 feature 目錄的 findings（標票號 03）
- [ ] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）
