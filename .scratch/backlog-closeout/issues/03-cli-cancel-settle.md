# 03 — claude-cli 串流取消收斂（F-02＋F-03 同根修正）

Status: ready-for-agent
Blocked by: —（依 spec 順序第三票，最重）

## What to build

讓 claude-cli 串流路徑的取消真正收斂。現況（兩筆 findings 鎖定在案）：cancel 只
中止子程序，Promise 不 resolve 也不 reject（F-03），後到的增量照樣觸發 onDelta，
而唯一呼叫端（串流端點）的 onDelta 是往已斷線的 response 寫入（F-02）。

授權書第 3 條的目標契約，三件一組：

1. cancel 後 Promise 以既有錯誤分類慣例的「取消」類 **reject**（分類代號照同檔
   既有慣例命名），且不與 timeout／error 路徑重複 settle。
2. cancel 後抵達的增量**不再觸發 onDelta**。
3. 呼叫端 catch 到取消分類後**靜默收尾**：不對已斷線 response 寫任何東西、
   `res.end` 必被呼叫。為此補一個最小 handler 級行為鎖（mock LLM 模組即可，
   不碰真 CLI）。

**紅燈先行紀律**：動工前把「鎖定 F-02/F-03 現況行為」的既有案例清單列進本票
Comments——只有這些准改，逐案先改斷言看紅、再改產線碼轉綠。清單外的既有案例
維持零修改。串流與非串流的其他語意（timeout、kill、close、快取清除、單次 settle）
全部不得漂移——既有 48 案行為鎖就是防漂移網。

## 驗收條件

- [ ] Comments 含翻轉案清單，且每案有「先紅後綠」的紀錄
- [ ] 新鎖至少涵蓋：取消後 onDelta 靜默、Promise 收斂且分類正確、取消後不重複
      settle（timeout／error 後到不再二次收斂）、handler 端 `res.end` 被呼叫且
      未對 response 寫入內容
- [ ] 故障注入：拆 onDelta 守衛 → 對應案紅；拆收斂 → 對應案紅；各自還原後綠
- [ ] 除翻轉清單外，全部既有案例零修改；假時鐘維持，全套秒級不膨脹
- [ ] `npm run gate` 全綠；strict 總數不變（本票與 strict 無關）
- [ ] `.scratch/strict-backlog/findings.md` 的 F-02／F-03 標「已修」＋證據 commit
