# 07 — llm 分流錯誤路徑行為鎖

**What to build:** LLM provider 分流模組的錯誤路徑行為鎖：
- 未設或設 gemini-api 時走 Gemini 路徑，缺金鑰**立即**丟 MISSING_KEY——
  金鑰檢查在觸網之前，因此測試環境不設金鑰即可安全驗證，全程零真呼叫。
- 設無效 provider 值時丟明確設定錯誤訊息（錯誤 code 掛 MISSING_KEY 的
  **現狀照鎖**，對應 findings 第 4 條，勿修）。
- 同步與串流兩個入口的分流行為一致（同一組案例兩入口都要過）。

claude-cli 分支（執行檔探索、spawn、串流解析）是首批外（CONTEXT.md
「首批外」），本票不碰。

**Blocked by:** 01 — 測試跑道就位＋config 行為鎖。

**Status:** resolved

- [x] 兩入口的分流錯誤路徑現行行為全數上鎖
- [x] 測試全程不設真金鑰、零真網路呼叫、零子程序
- [x] `npm run gate` 全綠；既有案例零修改；產線碼零變更
- [x] 新翻出的可疑行為 append 進本 feature 目錄的 findings（標票號 07——確認零新增，既知點即第 4 條）
- [x] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）

## Comments

**2026-07-28 完成**（sonnet subagent 撰寫＋主窗整合）。14 案例，兩入口對稱
（7×2）：四種導向 gemini 路徑的 provider 值（未設／gemini-api／帶空白 trim／空字串）
→ 缺金鑰逐字 MISSING_KEY；三種無效值 → 逐字「設定值無效」訊息（code 照 findings
第 4 條鎖 MISSING_KEY）；stream 專屬斷言（onDelta 未呼叫＋cancelRef 未掛）。
故障注入 7 條全紅（default 靜默 fallback×2／訊息改字／code 換／trim 拿掉／
case 改名／空字串 case 拿掉），全數維持「觸網前就丟」性質（危險注入點——反轉
金鑰檢查——依交辦單明令排除），主窗獨立重跑同結果。整檔毫秒級執行佐證零觸網。
批次 code-review 收斂：檔頭標籤統一為「行為鎖」。
