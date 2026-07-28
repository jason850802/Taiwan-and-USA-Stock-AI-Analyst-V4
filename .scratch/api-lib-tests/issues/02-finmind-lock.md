# 02 — finmind 驗證＋快取秒數行為鎖

**What to build:** FinMind 代理模組的行為鎖：
- 參數驗證——dataset 白名單（白名單外一律 BAD_REQUEST，守「不成為任意資料代理」）、
  代號樣式（.TW／.TWO 去尾、大寫化、樣式不符拒收）、日期樣式檢查。
- 快取秒數——一般 dataset 走台北午夜到期（假時鐘固定時點，含跨日邊界與
  60 秒地板）；季更／年度公告類固定 3 天。
- 錯誤分類——402／429／「upper limit」訊息 → 限流；abort／timeout → 上游錯誤；
  已分類錯誤穿透不重包；其餘一律預設上游錯誤。

**Blocked by:** 01 — 測試跑道就位＋config 行為鎖。

**Status:** resolved

- [x] 驗證、快取秒數、錯誤分類三群現行行為全數上鎖
- [x] 時間相依案例用假時鐘固定時點，不用容忍區間
- [x] `npm run gate` 全綠；既有案例零修改；產線碼零變更
- [x] 新翻出的可疑行為 append 進本 feature 目錄的 findings（標票號 02）
- [x] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）

## Comments

**2026-07-28 完成**（sonnet subagent 撰寫＋主窗整合）。35 案例（agent 34＋批次
code-review 補 1 條「訊息含 aborted」的訊息路直測）。故障注入 7 條全紅
（白名單刪項／樣式放寬×2／長快取換值／429 誤判／去尾拿掉／60 秒地板拿掉），
主窗獨立重跑同結果。台北午夜三時點（12:00→43200、23:59:30→60 地板、午夜→86400）
用 UTC ISO＋假時鐘固定，Spec 軸手算比對通過。白名單刻意用寫死字面陣列鎖
（防「import 匯出反推」型假綠）。findings 進 3 條（第 7～9）。
已知取捨：錯誤捕捉沿用 toThrow＋try/catch 雙呼叫式（純函式無副作用故無害），
與 http/yahoo 的 captureError 式並存——首批「重複優於耦合」決策的自然結果，不回頭統一。
