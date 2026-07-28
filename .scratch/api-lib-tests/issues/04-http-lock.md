# 04 — http 分類＋金鑰消毒＋請求驗證行為鎖

**What to build:** Gemini HTTP 模組的行為鎖：
- 錯誤分類——status 數字與訊息文字兩條判定路都要鎖：404 → 模型不存在、
  429 → 限流、5xx → 上游錯誤、abort／timeout → 上游錯誤、已分類錯誤穿透、
  其餘一律預設上游錯誤。
- 金鑰消毒——三種 REDACTED 置換逐一上鎖（Google API URL、key= 參數、
  AIza 樣式金鑰），含一句訊息多雷混合的案例。這是金鑰紅線的 log 側防線。
- 請求驗證——prompt／systemInstruction 必填與 trim、mode 白名單、缺任一
  丟 BAD_REQUEST；temperature 與 thinkingConfig 的不驗型別透傳**照現狀鎖**
  （對應 findings 第 1 條，勿修）。

SDK 真呼叫（含 timeout／abort 機制）是首批外，本票不碰。

**Blocked by:** 01 — 測試跑道就位＋config 行為鎖。

**Status:** ready-for-agent

- [ ] 分類、消毒、驗證三群現行行為全數上鎖
- [ ] 金鑰消毒案例不得含真金鑰樣本（測試資料用假樣式字串）
- [ ] `npm run gate` 全綠；既有案例零修改；產線碼零變更
- [ ] 新翻出的可疑行為 append 進本 feature 目錄的 findings（標票號 04）
- [ ] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）
