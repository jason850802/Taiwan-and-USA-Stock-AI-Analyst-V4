# ADR-0002: api/_lib 首批測試採「就地放置＋行為鎖」

- 日期：2026-07-28
- 狀態：已拍板（grill-with-docs 四題四答，使用者逐題確認）
- 階段：邊界決策；實作規格見 `.scratch/api-lib-tests/spec.md`

## 背景

後端 `api/_lib` 七個模組（守門、限流、參數驗證、錯誤分類、金鑰消毒、LLM 分流）
承擔金鑰紅線與「不成為任意代理」的守門責任，但至今零測試——既有 22 個測試檔
全在 `utils/`，鎖的都是前端側。`utils/fetchError.test.ts` 檔頭註解明寫
「測試檔放 utils/ 是沿用現行 vitest 收錄範圍」，是描述當時現況，不是原則性規定。

## 決策

1. **測試與受測物同目錄**：後端測試放 `api/_lib/*.test.ts`，不再塞進 `utils/`。
   安全性已逐項查證：底線前綴目錄不會被 Vercel 當 endpoint；測試檔未被 handler
   import 就不會進部署 bundle；vitest 收錄範圍沒有 include 白名單（放哪都收）；
   tsconfig 只排除 node_modules／dist／.claude（tsc 照蓋）。
2. **首批範圍＝純邏輯全包**：七檔的純邏輯面全進（env fallback、守門序、取 IP／
   fail-open、參數驗證、快取秒數、錯誤分類、金鑰消毒、provider 分流錯誤路徑）。
   **首批外**＝需 mock 網路或子程序的路徑：Yahoo cookie+crumb 握手、Gemini SDK
   真呼叫、claude-cli spawn。
3. **立場＝行為鎖（characterization）**：照現行行為寫斷言，一律不改產線碼。
   翻出的可疑行為集中寫進 findings 清單交使用者裁決，要修另開票。
4. **交付節奏**：grill→spec→tickets 同窗完成，每張票開新對話執行（換窗紀律）。

## 後果與約束

- 前端測試繼續留在 `utils/`；本 ADR 只界定後端測試的新慣例，不搬舊檔。
- 首個後端測試檔檔頭要註明放置決策並指向本 ADR（沿用 fetchError.test.ts
  的檔頭敘事慣例），後人才不會誤以為放錯位置。
- 產線碼零變更（含不加 export、不加測試鉤子）；零新 seam——全部在既有
  匯出函式邊界測，env 相依用測試框架的 env stub 處理。
- 每張票收尾跑 `npm run gate`，既有案例零修改。
