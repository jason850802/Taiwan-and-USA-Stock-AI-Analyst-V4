# 03 — 條件式建立精簡 API 執行目錄

Status: ready-for-human — E0 正式基準不足，未實作分支尚無形式結案證據；本票仍 OPEN。
Blocked by: 02
Type: task

本檔為正式票據。依本案共同驗收手冊執行。本票是條件票。

## 要交付的結果

若 02 仍未達本機 OPTIONS 門檻，提供可維護、來源不漂移的精簡 API 執行入口；若 02 已達標，保存不需實作的判定證據並結案。

## 實作範圍

- 先量只隔離後端 API root、前端仍使用原工作區是否足夠。
- 由目前工作區內容產生所需 handler、import graph、設定與執行依賴，透過 manifest 校驗完整性，不能把診斷時的檔案數當永久清單。
- 提供單一啟動／停止流程；來源變更後同步並重新驗證，失敗即停止，不能默默服務舊碼。
- 副本位於原開發服務 watcher 之外，沿用既有依賴，不安裝套件；後端環境只送入後端程序，秘密不進證據。
- 對照守門序、錯誤狀態、timeout、Yahoo fallback、FinMind 與串流契約；AI 只用假 provider。
- 驗證啟動、來源修改、刪除、啟動失敗、停止、再次啟動及前端代理整合。

## 驗收條件

- [ ] 02 以 fresh formal E0／E1／E2 + 同期 formal clean 證明已達標時，才可用「不需實作」分支 resolved；不得以歷史 threshold-only clean 代替。
- [ ] 進入實作分支時，來源 manifest 無漂移，API 契約與正式前端代理正常，OPTIONS 達本機門檻。
- [ ] 同步失敗與來源缺漏可判紅，不會服務過期副本。
- [x] 啟停只作用於本案已核實的程序／目錄，不干擾使用者原有服務。
- [x] 完整 gate、雙軸覆核與啟動／停止／回復文件完成。

## 邊界

精簡目錄仍未達標時，以未通過狀態結束並另提窄範圍長駐 runtime 原型，不在本票擴張成自製 API server。

## Comments

2026-09-22：舊判定曾依 E1/E2 約 1.1～1.7 秒與歷史 clean 門檻將本票直接 resolved，沒有建立第二套精簡 API root。formal review 後確認 historical clean 只能是 threshold-only sanity，且 E1 缺 formal 兩-start evidence，因此該 no-op closure 需要 fresh formal protocol 重新證明。

2026-09-23：formal v2 已建立可供 fresh E0/E1/E2/clean 比較的 isolated runtime/identity 工具，但 E0 start-1 cold Yahoo OPTIONS 在 60 秒 timeout，整輪依 fail-fast 規則停止。02 尚無 formal clean-threshold/slow-reproduced 結論，故 03 的 conditional no-op 目前不能正式關票；本輪也沒有進入精簡 API root 實作分支。

2026-09-23：formal v6 的 E1／E2 都通過同期 clean 門檻，顯示非產品目錄排除後的候選環境已接近精簡對照；但 E0 無合格 warm 資料、02 尚未滿足凍結的 E0 相對降幅驗收，因此「不需實作」分支不可標 resolved。維持 ready-for-agent／OPEN，不在本輪擴張 API root 實作；詳 `evidence/02/formal-options-closure-review.md`。
