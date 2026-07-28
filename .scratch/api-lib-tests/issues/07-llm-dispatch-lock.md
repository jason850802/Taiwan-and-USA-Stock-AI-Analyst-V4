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

**Status:** ready-for-agent

- [ ] 兩入口的分流錯誤路徑現行行為全數上鎖
- [ ] 測試全程不設真金鑰、零真網路呼叫、零子程序
- [ ] `npm run gate` 全綠；既有案例零修改；產線碼零變更
- [ ] 新翻出的可疑行為 append 進本 feature 目錄的 findings（標票號 07）
- [ ] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）
