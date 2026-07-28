# 01 — 測試跑道就位＋config 行為鎖（tracer bullet）

**What to build:** 後端模組目錄裡的第一個行為鎖測試檔，受測物是後端設定讀取模組
（config）：金鑰讀取、模式對模型名的 env 覆寫與預設值、允許來源清單的解析
（逗號分隔、trim、尾斜線正規化、空值 fallback）、shared secret 未設時的回傳。
這張票同時是 tracer bullet——端到端證明「就地放置」（ADR-0002）成立：
新檔被 `npm run test` 收錄、被 tsc 覆蓋、`npm run gate` 全綠、build 產物不含測試碼。
檔頭註解說明放置決策並指向 ADR-0002（沿用既有錯誤分類測試的檔頭敘事慣例）。

**Blocked by:** None — can start immediately.

**Status:** resolved

> 本 feature 有 7 張票、要跨多個視窗掃 frontier，所以完成的票在票面標 `resolved`
> （沿用 issue-tracker.md 的 wayfinding 用語），不沿用 portfolio-backup 那種
> 「完成狀態只記在 commit、票面維持 ready-for-agent」的做法——那會讓新視窗把做完的票再做一次。

- [x] config 四個匯出函式的現行行為全數上鎖（env 已設／未設／空字串／畸形值的 fallback 走向）
- [x] `npm run test` 收錄新檔，既有案例零修改
- [x] `npm run gate` 全綠；產線碼零變更
- [x] 檔頭註解含放置決策與 ADR-0002 指引
- [x] 新翻出的可疑行為 append 進本 feature 目錄的 findings（標票號 01）
- [x] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）

## Comments

**2026-07-28 完成。** 20 個案例，gate 全綠（23 檔 396 測試，既有 22 檔零修改）。

跑道三項主張都是實測不是推論：故障注入 7 條（改壞 config.ts 的預設型號、去尾斜線、
空項過濾、空陣列保底、secret 空值正規化、金鑰 trim）**全數紅燈**，證明鎖真的會咬；
tsc 覆蓋以注入型別錯誤驗證（exit=2 且訊息指名該檔）；dist/ 掃測試檔獨有字串 0 命中。

留給後續票的形狀：env 用 `vi.stubEnv`＋`vi.unstubAllEnvs`（票 05／07 也要動 env，照抄這個）；
檔頭只寫「本檔守什麼」並指向 ADR，不重述決策理由。
