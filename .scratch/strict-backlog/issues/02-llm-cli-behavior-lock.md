# 02 — Claude CLI spawn 行為鎖

Status: resolved（2026-07-30）
Blocked by: 01

## What to build

依 `CONTEXT.md` 的「首批外」詞條與 ADR-0002，為需要 mock 子程序的 claude-cli spawn 路徑另建一組行為鎖。這張票只照現行行為寫斷言，不評判或改正行為；若測試翻出可疑結果，另行登記並交由使用者裁決，不得順手修改產線碼。

行為鎖需從既有匯出函式邊界覆蓋 Claude CLI 的非串流、串流、spawn 失敗、timeout 與取消收斂。測試使用 mock 子程序，不呼叫真實 Claude CLI、不讀取訂閱憑證，也不觸發網路；不得為了可測性新增 export、測試鉤子或 production seam。

本票承接先前明確延後的「首批外」工作，與票 01 的型別契約收斂分開；本輪不執行本票。

## 驗收條件

- [x] 非串流行為鎖涵蓋 prompt 寫入 stdin、正常結果收斂，以及既有輸出解析與錯誤分類語意。
- [x] 串流行為鎖涵蓋增量資料依序呼叫 `onDelta`、最終結果收斂，以及尾端 buffer 的既有處理語意。
- [x] spawn 失敗涵蓋同步 throw 與非同步 error；兩者維持既有錯誤分類、錯誤訊息與執行檔快取清除語意。
- [x] timeout 行為鎖確認子程序會被終止、Promise 依既有分類拒絕，且後續事件不會造成重複 settle。
- [x] 取消行為鎖確認 `cancelRef.cancel` 會終止子程序、清除計時器，且取消後不再產生增量回呼或第二次收斂。
      **註：「不再產生增量回呼」與現行行為不符，已照實鎖成相反斷言並登記 findings F-02，見下方。**
- [x] stdio stream error 仍被接住，不形成未捕捉例外，最終結果仍由既有 child `error`／`close` 路徑收斂。
- [x] 測試全部使用 mock 子程序；沒有啟動真實 Claude CLI、讀取訂閱憑證或觸發網路。
- [x] 既有測試案例全綠且零修改；只新增本票所需的行為鎖與測試支援。
- [x] 產線碼零變更，不新增 export、測試鉤子或 production seam。
- [x] `npx.cmd tsc --noEmit` 為 exit code 0，且 `npm run gate` 全綠。
- [x] `package.json` 與 `package-lock.json` 零變動。
- [x] 收尾依 implement 紀律跑 code-review（Standards＋Spec 雙軸）。

## Comments

**2026-07-30 完成。** 新增 48 案，全部從既有匯出邊界（`generateText`／`generateTextStream`）
驅動，**產線碼一行未動**——`git diff -- api/_lib/llm.ts` 對 HEAD 為空。

### 隔離手法（如何做到「不呼叫真實 CLI、不讀憑證、不觸網」而又不開 seam）

- `node:child_process` 的 `spawn` 整支 mock，永遠沒有真的子程序被啟動。
- `CLAUDE_CLI_PATH` 指向兩個「一定存在」的真實檔案（本測試檔與 `llm.ts` 自身），
  只為讓探索邏輯第一步的 `existsSync` 為真就直接回傳；它們永遠不會被執行。
  刻意用**兩個不同路徑**，否則驗不出「快取清掉後確實重新探索」。這也避免了 mock `node:fs`
  ——那會波及同模組圖裡其他套件的載入。
- 每案 `vi.resetModules()` 取乾淨模組，隔離 module 級的執行檔快取。
- 全檔假時鐘：逾時是 45／100／180 秒，真時鐘會讓測試套件等到天荒地老。
  **48 案總耗時 346ms**，全套 666 案仍是 3.45 秒。

### 覆蓋

啟動契約 6 案（argv 逐項、prompt 不進 argv、cwd／windowsHide、環境剔除、模型與 effort
含 env 覆寫與空白 trim、stdin 立即寫入）；非串流解析與分類 11 案；串流 9 案（逐段 onDelta、
跨 chunk 斷行接回、尾端無換行 buffer、壞行略過、delta 非字串、無 result、is_error）；
spawn 失敗與快取 6 案；stdio stream error 3 案；timeout 6 案；取消 7 案。

### 故障注入（證明鎖不是裝飾品）

四次注入四次精準紅燈，每次只紅該紅的那一案，注入後全數還原：

| 注入產線碼 | 紅燈案例 |
|---|---|
| 拿掉 `delete env.ANTHROPIC_API_KEY` | 環境隔離 |
| 拿掉 close 時的尾端 buffer 解析 | 尾端沒有換行的殘留 buffer |
| 拿掉非同步 error 的快取清除 | 非同步 error 同樣清掉快取 |
| 拿掉 `stderr` 的空 error 監聽 | 三條 pipe 各自 emit error（`Error: EPIPE` 被拋出） |

### 兩處如實記錄

1. **票面驗收條件第 5 條寫得不對**：「取消後不再產生增量回呼」與現行行為相反——
   解析路徑沒有檢查 settled，取消後抵達的增量照樣呼叫 `onDelta`。依行為鎖紀律，
   我鎖的是**現行行為**（斷言 onDelta 會被呼叫），不是票面的期待值，並登記 **F-02**。
2. **一條原本寫得空洞的斷言已改掉**：初稿有一案宣稱「非串流路徑不掛 cancel」，但
   `generateText` 的簽章根本不收 cancelRef，該斷言恆真、驗不到東西。已換成兩案有內容的：
   cancel 在 spawn 成功後才掛上、以及 spawn 同步失敗時 cancelRef 不會被掛上。

### findings

新增 **F-02**（取消後仍觸發 onDelta）與 **F-03**（取消後 Promise 永不收斂）。兩者都只登記
不修——加 settled 檢查或改成 reject 都會變更對外語意，屬裁決事項。

### code-review（雙軸，主窗自跑）

- **Standards**：2 空格／單引號／繁中註解無簡體／測試與受測碼 colocate（ADR-0002）／
  無新依賴 → 無發現。
- **Spec**：命中票面「只照鎖不修、不開 seam、不加 export、mock 子程序」；產線碼 diff 對 HEAD
  為空可對證 → 無發現。撰寫期兩個自身瑕疵（未捕捉拒絕的掛載時序、空洞斷言）已於交付前修掉。
