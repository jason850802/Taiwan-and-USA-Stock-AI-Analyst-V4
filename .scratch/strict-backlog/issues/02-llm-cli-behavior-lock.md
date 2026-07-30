# 02 — Claude CLI spawn 行為鎖

Status: ready-for-agent
Blocked by: 01

## What to build

依 `CONTEXT.md` 的「首批外」詞條與 ADR-0002，為需要 mock 子程序的 claude-cli spawn 路徑另建一組行為鎖。這張票只照現行行為寫斷言，不評判或改正行為；若測試翻出可疑結果，另行登記並交由使用者裁決，不得順手修改產線碼。

行為鎖需從既有匯出函式邊界覆蓋 Claude CLI 的非串流、串流、spawn 失敗、timeout 與取消收斂。測試使用 mock 子程序，不呼叫真實 Claude CLI、不讀取訂閱憑證，也不觸發網路；不得為了可測性新增 export、測試鉤子或 production seam。

本票承接先前明確延後的「首批外」工作，與票 01 的型別契約收斂分開；本輪不執行本票。

## 驗收條件

- [ ] 非串流行為鎖涵蓋 prompt 寫入 stdin、正常結果收斂，以及既有輸出解析與錯誤分類語意。
- [ ] 串流行為鎖涵蓋增量資料依序呼叫 `onDelta`、最終結果收斂，以及尾端 buffer 的既有處理語意。
- [ ] spawn 失敗涵蓋同步 throw 與非同步 error；兩者維持既有錯誤分類、錯誤訊息與執行檔快取清除語意。
- [ ] timeout 行為鎖確認子程序會被終止、Promise 依既有分類拒絕，且後續事件不會造成重複 settle。
- [ ] 取消行為鎖確認 `cancelRef.cancel` 會終止子程序、清除計時器，且取消後不再產生增量回呼或第二次收斂。
- [ ] stdio stream error 仍被接住，不形成未捕捉例外，最終結果仍由既有 child `error`／`close` 路徑收斂。
- [ ] 測試全部使用 mock 子程序；沒有啟動真實 Claude CLI、讀取訂閱憑證或觸發網路。
- [ ] 既有測試案例全綠且零修改；只新增本票所需的行為鎖與測試支援。
- [ ] 產線碼零變更，不新增 export、測試鉤子或 production seam。
- [ ] `npx.cmd tsc --noEmit` 為 exit code 0，且 `npm run gate` 全綠。
- [ ] `package.json` 與 `package-lock.json` 零變動。
