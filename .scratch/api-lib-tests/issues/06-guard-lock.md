# 06 — guard 守門序行為鎖

**What to build:** 守門模組的行為鎖（守門序定義見 CONTEXT.md）：
- 同源判定——x-forwarded-host 優先於 host、origin 優先於 referer、
  URL 解析失敗視同無來源。
- 來源檢查矩陣——origin 與 referer 雙缺放行（**現狀照鎖**，對應 findings
  第 2 條，勿修）、同源放行、白名單命中／未中、origin 尾斜線正規化、
  referer 前綴比對。
- CORS header——白名單命中才送 Allow-Origin＋Vary；Methods／Headers／
  Max-Age 恆定送出。
- shared secret——未設時放行、等長錯值拒、長度不等拒、正確值通過
  （常數時間比較的行為面）。
- applyGuards 守門序——用假 req/res 鎖完整順序與短路行為：OPTIONS 204
  短路不往下走、來源不符 403、secret 不符 403、限流不過 429、全過回 true；
  各拒絕路徑的狀態碼與回應體 code 欄位一併上鎖。

**Blocked by:** 01 — 測試跑道就位＋config 行為鎖。

**Status:** resolved

- [x] 上述五群的現行行為全數上鎖，含守門序的順序本身
- [x] 假 req/res 只驗可觀察行為（狀態碼、header、回應體、回傳值），不碰內部實作
- [x] `npm run gate` 全綠；既有案例零修改；產線碼零變更
- [x] 新翻出的可疑行為 append 進本 feature 目錄的 findings（標票號 06）
- [x] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）

## Comments

**2026-07-28 完成**（sonnet subagent 撰寫＋主窗整合）。27 案例（agent 26＋批次
code-review 補 1 條「referer 不可解析（且無 origin）→ 拒絕」）：同源判定
（x-forwarded-host 優先、origin 短路 referer 救不回）、來源矩陣（雙缺放行照
findings 第 2 條鎖）、CORS 恆定表頭逐字、shared secret（等長錯值／長度不等）、
applyGuards 守門序——「後面關卡未被觸及」用會炸的 vi.fn 假件當硬證據，
「CORS 恆先設」用呼叫序記錄驗證，非憑回應內容推論（Spec 軸抽查認證此點）。
故障注入 8 條全紅（含 OPTIONS 短路搬位、secret 長度檢查拿掉→timingSafeEqual throw），
主窗獨立重跑同結果。注入採「find 字串不跨行」策略迴避 CRLF 雷。
findings 進 1 條（第 13：兩種 403 共用 BAD_REQUEST code）。
