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

**Status:** resolved

- [x] 取 IP、檢查邏輯、載入期兩態的現行行為全數上鎖
- [x] 全程零真網路呼叫（假 limiter＋模組重載，不連 Upstash）
- [x] `npm run gate` 全綠；既有案例零修改；產線碼零變更
- [x] 新翻出的可疑行為 append 進本 feature 目錄的 findings（標票號 05）
- [x] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）

## Comments

**2026-07-28 完成**（sonnet subagent 撰寫＋主窗整合）。16 案例（agent 15＋批次
code-review 補 1 條「x-real-ip 陣列取首」）：取 IP 序位（含空字串 cascade 怪行為
照鎖）、checkRateLimit 全假件矩陣（fail-open 含 console.warn 斷言）、載入期兩態
（resetModules＋顯式雙態 stub；已設態只驗非 null，經 node_modules 原始碼確認
`Redis.fromEnv()`／`new Ratelimit()` 建構子純同步無 I/O）。
故障注入 7 條全紅（fail-open→closed／取首→取末×2／預設 IP／filter(Boolean)／
every→some／x-real-ip fallback 拿掉），主窗獨立重跑同結果。CRLF 雷同票 04，同法修復。
findings 進 2 條（第 11：XFF 可偽造的限流身分、第 12：fail-open 遮蔽超限判定）。
