# 02 — finmind 驗證＋快取秒數行為鎖

**What to build:** FinMind 代理模組的行為鎖：
- 參數驗證——dataset 白名單（白名單外一律 BAD_REQUEST，守「不成為任意資料代理」）、
  代號樣式（.TW／.TWO 去尾、大寫化、樣式不符拒收）、日期樣式檢查。
- 快取秒數——一般 dataset 走台北午夜到期（假時鐘固定時點，含跨日邊界與
  60 秒地板）；季更／年度公告類固定 3 天。
- 錯誤分類——402／429／「upper limit」訊息 → 限流；abort／timeout → 上游錯誤；
  已分類錯誤穿透不重包；其餘一律預設上游錯誤。

**Blocked by:** 01 — 測試跑道就位＋config 行為鎖。

**Status:** ready-for-agent

- [ ] 驗證、快取秒數、錯誤分類三群現行行為全數上鎖
- [ ] 時間相依案例用假時鐘固定時點，不用容忍區間
- [ ] `npm run gate` 全綠；既有案例零修改；產線碼零變更
- [ ] 新翻出的可疑行為 append 進本 feature 目錄的 findings（標票號 02）
- [ ] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）
