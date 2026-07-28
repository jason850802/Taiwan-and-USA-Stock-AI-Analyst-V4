# 05 — ratelimit 取 IP＋fail-open 行為鎖

**What to build:** 限流模組的行為鎖：
- 取用戶端 IP 的序位——x-forwarded-for 逗號首段＋trim → x-real-ip →
  預設回環位址；陣列型 header 取首個值。限流計數對象不能悄悄換人。
- 檢查邏輯——無啟用 limiter 時放行；多個 limiter 全過才過、任一擋則擋
  （limiter 用假件驅動，不真打 Upstash）；limiter 丟錯時 **fail-open 放行**
  （外部限流服務掛掉不能變成整站被擋）。
- 載入期兩態——限流設定在模組載入時讀 env：未設時產出停用態、已設時產出
  啟用態（用模組重載測兩態；已設態只驗有啟用，不發真請求）。

**Blocked by:** 01 — 測試跑道就位＋config 行為鎖。

**Status:** ready-for-agent

- [ ] 取 IP、檢查邏輯、載入期兩態的現行行為全數上鎖
- [ ] 全程零真網路呼叫（假 limiter＋模組重載，不連 Upstash）
- [ ] `npm run gate` 全綠；既有案例零修改；產線碼零變更
- [ ] 新翻出的可疑行為 append 進本 feature 目錄的 findings（標票號 05）
- [ ] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）
