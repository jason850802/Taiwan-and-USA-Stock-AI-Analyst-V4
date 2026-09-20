# 02 獨立 Standards／Spec 覆核

日期：2026-09-20。

固定比較點：`ade5dca1e7106c90430efc35b50ba4adaaae8b42`（第 01 票）。
初始候選：`fb70974840882d8b02fce461d0e565881edbbd74`。

沿用使用者已確認的 worker 模型 ID `5.6`／`high`，兩個獨立上下文分別覆核 Standards 與 Spec。初次覆核命令為 `git diff ade5dca...fb70974`，並讀取 `git log ade5dca..fb70974 --oneline`；merge-base 為 ade5dca，範圍包含全部 30 個候選檔案。修正覆核再涵蓋 fb70974 之後的全部暫存變更，固定比較點不變。

## Standards

初次有 1 項 MEDIUM correctness finding，沒有其他實質標準違反或判斷型 smell：面板雖阻止舊回應寫 React state，服務仍先將舊結果寫入 memory／sessionStorage；A2 先成功、A1 晚回，再次查閱 A 可能退回 A1。

處置：新增 `red-cache-return.json` 實際重現再次查閱 A 讀回 11.11；新增 4 項公開服務測試，其中 2 項在修正前失敗。服務入口改用每個既有 cache key 的請求身分限制快取發布，成功／失敗均清理身分；舊呼叫仍回覆自己的結果。財報組裝及 429 退避移到私有函式但內容未變，快取鍵、有效期、force 刪除規則維持原樣。

修正後 4 項服務測試全部通過，11 個瀏覽器案例全部通過；再次查閱 A 仍為 A2 的 21.11。原 Standards reviewer 完成獨立修正覆核：原 finding **CLOSED**，**OPEN 0／NEW 0**。核對服務快取發布、失敗清理、公開服務測試、瀏覽器再訪讀值及完整 gate，沒有新增標準、安全、金融或依賴問題。

## Spec

初次 0 findings：missing／partial、scope creep、implemented-wrong 均為 0。原 Spec reviewer 另核對 cache 修正，確認屬於同代碼不同請求與再次查閱的可見行為，沒有範圍擴張；最終 **OPEN 0／NEW 0**。

兩軸均確認最新 staged 候選的程式、11 組 browser JSON、4 項新增服務測試、731 gate 與 README／diagnostics／cleanup 一致。其後只有結案文字與此覆核紀錄更新，沒有再修改產品或測試。

## 驗證與限制

- 最終 gate：41 個測試檔／731 項通過（原有 727＋新增 4），型別、build、秘密掃描、package gate 全綠。
- 原有 44 個測試／snapshot／package／lock 檔案 SHA-256 沒有變更。
- 11 個建置後真 App DOM／假 HTTP 行為案例全綠，與 Vitest 計數分開；UI 修正後另有 Desktop 實際 fill／Enter／click 驗收。
- 首屏 283.30 KiB raw／92.85 KiB gzip，比 01 增加 0.13／0.03 KiB，低於 5% 調查門檻。
- 正常流程沒有非預期 console error；故障注入 503 獨立記錄，既有 Recharts warning 未擴張到本票修正。
- Desktop 歷史 network 緩衝區曾丟棄事件，未宣稱完整封包擷取；逐案 fake server request JSON 獨立保存，隔離由 loopback 路由與 CSP 約束。
- 未驗真實 AI 品質、真實市場延遲與第 12 票跨尺寸整合；未呼叫真實應用 AI、未寫真實持股、未推送或部署。
