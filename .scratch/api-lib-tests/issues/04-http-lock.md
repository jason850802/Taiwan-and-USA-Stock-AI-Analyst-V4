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

**Status:** resolved

- [x] 分類、消毒、驗證三群現行行為全數上鎖
- [x] 金鑰消毒案例不得含真金鑰樣本（測試資料用假樣式字串）
- [x] `npm run gate` 全綠；既有案例零修改；產線碼零變更
- [x] 新翻出的可疑行為 append 進本 feature 目錄的 findings（標票號 04——確認零新增，既知點已被第 1／4 條涵蓋）
- [x] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）

## Comments

**2026-07-28 完成**（sonnet subagent 撰寫＋主窗整合）。46 案例：錯誤分類雙路
（status 數字＋字串轉型／訊息 word boundary，含 `4045` 不命中 `404` 的邊界反例）、
三種金鑰消毒（假樣本尾巴 10～16 字，低於 gate 掃描的 30 字門檻；混合案例整段
`toBe` 鎖 regex chain 交互順序）、請求驗證（temperature 透傳照 findings 第 1 條鎖現狀）。
故障注入 8 條全紅，主窗獨立重跑同結果。
執行紀錄：注入腳本首輪踩 CRLF 雷（http.ts 是 CRLF，手打 `\n` 比對落空）——改為
從讀入內容偵測換行字元後修復；此教訓已寫進波次交辦單傳給後續 agent。
批次 code-review 收斂：檔頭標籤統一為「行為鎖」、describe 詞彙「遮蔽」→「金鑰消毒」
（CONTEXT.md 詞彙紀律）。
