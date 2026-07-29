# Spec — api/_lib 首批行為鎖測試

Status: resolved（2026-07-28 七票全 resolved：merge `7b8b708`／`5ecd95e`；findings 13 條裁決結案 `3232e96`，收口票 `abe5ce5`）
來源：grill-with-docs 2026-07-28 四題拍板；邊界決策見 ADR-0002；詞彙見 CONTEXT.md「後端測試」節

## 問題陳述

後端 `api/_lib` 七個模組（設定讀取、守門、限流、FinMind／Yahoo／Gemini 參數驗證、
錯誤分類、金鑰消毒、LLM 分流）承擔本專案兩條命根子——金鑰紅線與「不成為任意代理」——
但至今零測試：既有 22 個測試檔全鎖前端側。現在改後端一行，唯一防線是 tsc 與人工檢視；
守門序被無聲重排、金鑰消毒被削弱、白名單被放寬，都不會有任何紅燈。

## 解法

給七個模組的純邏輯面各補一組行為鎖測試，與受測物同目錄（ADR-0002）。
跑道沿用既有 vitest——`npm run test`／`npm run gate` 自動涵蓋，零新依賴、零設定變更。
測試過程翻出的可疑行為集中進 findings 清單交使用者裁決；產線碼一個位元組不動。

## 使用者故事

1. 作為維護者，我要改守門邏輯時有紅燈網，讓守門序（CORS → OPTIONS 短路 → 來源檢查 → shared secret → 限流）不會被無聲重排或跳關。
2. 作為維護者，我要金鑰消毒被逐案例鎖住，讓日後改錯誤處理時 AIza 樣式金鑰、key= 參數、Google API URL 不可能重新漏進 log。
3. 作為維護者，我要 FinMind dataset 白名單被鎖住，讓「不成為任意資料代理」這條線不靠人腦記憶。
4. 作為維護者，我要 Yahoo interval→range 封閉集合與代號樣式被鎖住，讓前端請求形狀與後端白名單的耦合有紅燈可踩。
5. 作為維護者，我要三個錯誤分類器（Gemini／FinMind／Yahoo）對 404／429／5xx／timeout／已分類穿透的判定穩定，讓 UI 失敗文案的分流不漂移。
6. 作為維護者，我要限流 fail-open 行為被鎖住，讓 Upstash 掛掉時 App 照常服務，而不是整站被擋。
7. 作為維護者，我要取用戶端 IP 的序位（x-forwarded-for 首段 → x-real-ip → 預設值）被鎖住，讓限流的計數對象不因 header 處理改動而悄悄換人。
8. 作為維護者，我要 env fallback（模型名、允許來源、secret 未設）被鎖住，讓漏設環境變數時的行為可預期、可解釋。
9. 作為維護者，我要 LLM provider 分流的錯誤路徑被鎖住，讓設錯 LLM_PROVIDER 時得到明確訊息而非靜默走錯條路。
10. 作為維護者，我要 Gemini 請求驗證（必要欄位、trim、mode 白名單）被鎖住，讓壞請求在進 SDK 前就被擋下且分類正確。
11. 作為 AI agent，我要每張票能冷啟動（讀票即可動工、不依賴本對話記憶），讓換窗紀律不折損交付品質。
12. 作為使用者，我要整批測試不改任何產線行為，讓這批合併零風險、隨時可上。
13. 作為使用者，我要可疑行為集中在 findings 清單一次裁決，讓「要不要修」是我的顯式決策，不是 agent 的即興判斷。
14. 作為維護者，我要後端測試與受測物同目錄，讓找測試不用跨層猜位置（ADR-0002）。

## 實作決策

- **放置**：測試與受測物同目錄（ADR-0002）。安全性三方已查證：底線前綴目錄不成
  endpoint；測試檔未被 handler import 不進部署 bundle；vitest 無 include 白名單、
  tsc 只排除 node_modules／dist／.claude。
- **對映**：七個模組各一個測試檔，1:1；不建共用測試 helper——各檔自含假件
  （req/res 假件、假 limiter），首批規模下重複優於耦合。
- **零新 seam**：全部在既有匯出函式邊界測。env 相依用測試框架的 env stub；
  模組載入期讀 env 者（限流設定）用模組重載測「已設／未設」兩態。
- **時間相依**（台北午夜快取秒數）用假時鐘固定時點測，含跨日邊界與 60 秒地板；
  不用容忍區間寫法。
- **產線碼零變更**：不加 export、不加測試鉤子、不改任何行為。
- **檔頭敘事**：首個測試檔檔頭註解說明放置決策並指向 ADR-0002
  （沿用 fetchError.test.ts 的檔頭敘事慣例）。

## 測試決策

- **立場＝行為鎖**（見 CONTEXT.md 定義）：斷言「現在的行為」，不評對錯；
  對錯的裁決走 findings.md，要修另開票。
- **好測試＝只測可觀察行為**：回傳值、丟出的錯誤類別與 code、對 res 假件的
  呼叫序列；不測內部實作細節。
- **先例**：fetchError.test.ts（錯誤分類行為鎖＋檔頭敘事）、geminiRules.test.ts
  （逐位元組鎖）、viteConfigGuard.test.ts（設定防護鎖）。
- **驗收**：每張票收尾跑 `npm run gate` 全綠；既有 22 檔案例零修改；
  console 零紅字等 runtime 驗證不適用本批（純 node 側測試）。
- **findings 紀律**：每張票把新翻出的可疑行為 append 進
  `.scratch/api-lib-tests/findings.md`（已預埋 grill 期發現的四條）；
  全部票收工後使用者一次裁決。

## 範圍外（首批外）

- Yahoo cookie+crumb 握手（需 fetch mock＋模組級快取隔離）
- Gemini SDK 真呼叫（callGeminiWithTimeout 的 timeout／abort 行為）
- claude-cli spawn 的同步與串流兩條（需 child_process mock）
- 任何產線碼修正——含 findings 裁決後的修正，一律另開票
- lint／tsconfig strict 化（非本批目的）
- 前端既有測試的搬移或改寫（utils/ 維持原狀）

## 其他備註

- 一票一 commit，commit message 繁中。
- 票據不含檔案路徑與行號（耐久原則）；模組以名稱（config／guard／ratelimit／
  finmind／yahoo／http／llm）指認，接手方自行探索現況。
- 換窗紀律：每張票開新對話執行；票 01（跑道）完成後其餘票全數解鎖、可平行。
