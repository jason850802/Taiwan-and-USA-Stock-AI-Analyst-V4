# 03 — claude-cli 串流取消收斂（F-02＋F-03 同根修正）

Status: claimed（2026-07-30，單窗自主連跑）
Blocked by: —（依 spec 順序第三票，最重）

## Comments

### 翻轉案清單（動工前列定，僅此三案准改斷言；紅燈先行）

既有 `claude-cli — 取消收斂` describe 區塊內，鎖定 F-02/F-03 現況行為的案例：

1. 「取消後 Promise 維持未收斂（現行行為：cancel 只中止，不 resolve 也不 reject）」
   —— F-03 鎖。翻成：取消後以取消分類 reject；遲到 close 不改變結果。
2. 「取消後遲到的 result 不會造成第二次收斂」
   —— 斷言鎖在 F-03 的 pending 態（settled===null）。意圖（不二次收斂）保留，
   斷言翻成：維持取消分類的 rejected，遲到 result＋close 不得翻案成 resolved。
3. 「取消後若仍有增量資料抵達，onDelta 仍會被呼叫（現行行為，findings F-02）」
   —— F-02 鎖。翻成：取消後遲到增量不再觸發 onDelta。

### 非翻轉的附帶調整（型別完整性所迫，非行為斷言修改）

- `http.test.ts` 的 `DEFAULT_MESSAGES: Record<GeminiErrorCode, string>` fixture：
  新分類代號入 union 後，Record 完整性要求補一個新鍵（新增一個新代號的訊息鎖案例）。
  既有五鍵與其斷言逐字零修改。
- 同理 `gemini-stream.ts`／`gemini.ts` 的 `statusByCode: Record<GeminiErrorCode, number>`
  各補一鍵（產線碼，本就在票的修改範圍）。

### 檢查紀錄

- timeout 區塊全數案例的增量都發生在 settle 之前，settled 守衛不影響清單外任何案例（逐案檢視過）。
- 既有案例「cancel 會殺子程序並清掉兩個計時器」「已收斂之後再呼叫 cancel 不會殺到子程序」
  「spawn 同步失敗時 cancelRef 不會被掛上」在新行為下不需修改、預期原封綠。

### 先紅後綠紀錄（2026-07-30 實跑）

- 三案斷言先翻、產線碼未動：恰 3 紅 45 綠——
  「取消後 Promise 立即以 CANCELLED 分類 reject…」紅（expected null to be 'rejected'）、
  「取消後遲到的 result…維持 CANCELLED」紅（同上）、
  「取消後遲到的增量不再觸發 onDelta」紅（spy called 1 times）。
- 產線碼改後：48＋1（error 後到不二次收斂）＝49 案全綠；http.test 47 案全綠（含 CANCELLED 訊息新鎖）。
- handler 級新鎖 4 案（gemini-stream.test.ts）全綠。
- 故障注入三次三次精準紅（各自還原後綠）：
  1. 拆 parseLine 的 settled 守衛 → 只紅「取消後遲到的增量不再觸發 onDelta」（1/49）。
  2. 拆 cancel 的 reject → 只紅三個收斂案（3/49）。
  3. 拆 handler 取消靜默分支 → 只紅兩個取消收尾案，對照組 2 案仍綠（2/4）。
- 全套 673 → 679 全綠（3.44s，假時鐘維持）；strict 0 不變。

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
