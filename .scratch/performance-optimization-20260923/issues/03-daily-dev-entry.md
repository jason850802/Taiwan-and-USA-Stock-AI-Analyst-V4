# 03 — 把通過的候選接入日常開發入口

Status: open
Blocked by: 02
Type: task

## 要交付的行為

使用者以一個清楚命令啟動正式 App 與本機 API，看到的就是本次候選；改碼、停機、重開及錯誤恢復都可靠。

## 工作

- 只有前票低成本與 API parity 皆通過才產品化候選。若前票以證據選擇保留原入口，明列分支並提供原入口的相同身分／啟停保障。
- 提供不需改 package 的單一啟動／停止命令、埠衝突提示、ready 條件與所有 owned PID。前端同源代理到選定 backend。
- 來源由目前候選讀入，runtime 與 log 在 watcher 外；handler、依賴或設定修改／刪除後重載並核對版本。失敗即停止服務該候選，不繼續回舊碼。
- 正式元件／CSS HMR 仍有效；寫證據不引發產品 reload。後端 env 僅後端使用，停止／失敗時清本案複本。
- 用正式 App 的一個台股、一個美股、庫存及假 AI 串流跑通新入口，驗證例外與停止。

## 驗收

- [ ] 日常入口與量測入口同源、同 handler、同設定，來源 manifest 可證明。
- [ ] 連續兩次啟停／restart、埠衝突、語法錯誤、依賴刪除／恢復、環境變更都有明確結果。
- [ ] 無 orphan child、無舊碼服務、無秘密洩漏，其他服務未被關閉。
- [ ] 採用候選分支：正式 App 端到端打到候選，固定 GET 與 OPTIONS 的低成本仍成立。有效否證而保留原入口分支：證明正式 App 仍可用、來源與啟停可靠，列出實際成本與未過目標；不能將原入口約秒級成本標成 PASS。
- [ ] 原 Vercel 部署配置及 API 行為保留；有一個可驗證的回復命令。
- [ ] 隔離完整 gate、獨立 Standards／Spec 覆核、精確提交與日常命令文件完成。

有效否證而保留原入口時，本票可在上述分支驗收完成後 resolved，讓報價與 K 線的獨立成本工作繼續；同列「本機成本目標未過」，全案保持 OPEN。原型若缺 parity／證據則仍 blocked，不得用這個分支繞過安全檢查。

## 首輪紀錄（2026-09-24，覆核後撤回結案）

採用 02 候選為日常入口，修正 dev-server 到 handler 的取消訊號；Yahoo chart／search、FinMind、Gemini 串流／非串流在斷線後均停止本次上游工作，單人 cookie 握手也會取消，共享握手時另一請求仍成功。限流等待中斷線的五路由案例亦全部通過，沒有再啟動行情或 AI 上游。真 AI 不執行；以假 CLI 與假 SDK 驗證。固定資料從身分綁定的 Vite 同源入口量得暖 OPTIONS 中位 15.364 ms、固定 GET 中位 61.766 ms，各 20/20 成功。正式 App 固定台股、美股、K 線、隔離庫存及假 AI 串流可見；十檔冷庫存與 K 線的 App 可見 B1↔C 配對留在 04～07，**全案 OPEN**。資料、來源、例外、獨立 Standards／Spec 覆核與日常命令見 [03 REPORT](../evidence/03/REPORT.md)。沒有 push、部署或發版。

日常啟動：`node .scratch/performance-optimization-20260923/tools/daily-dev.mjs start`；停止以同路徑 `stop`。本票精確提交應由 Git 記錄及來源 manifest 核對，不依賴只有標題的舊 commit 訊息。

## 覆核後進度（2026-09-24）

獨立 Standards／Spec 覆核判定首輪均 FAIL，本票改回 OPEN。已修正日常網址為 `http://localhost:3000` 的同一來源主機名、隔離 Vite 的 envDir、抽出五路由共用的斷線監聽與解除、補共享握手取消測試、加入失聯狀態的身分核對復原命令。新證據見 [覆核後增補](../evidence/03/ADDENDUM-20260924.md)。

隔離 gate 已掃到本票新檔且通過，但 59 案對等工具連續兩次在 B1 啟動時遇到 Vercel `Retrieving project…` 後的 `fetch failed`，實際執行 0 案；不得把先前 02 的 59 案當作本票 PASS。原 `localhost:3000` 的隔離 App 實測、正式部署取消／API 行為、依賴刪除重載及生命週期 raw 仍待完成。21 檔來源清單已建立；獨立 Standards／Spec 覆核均判 FAIL，見 [覆核增補](../evidence/03/REVIEW-ADDENDUM-20260924.md)。此票維持 OPEN，04 不因本輪機械 gate 通過而自動解鎖。

## 2026-09-25 重驗

使用者啟動的 3000／3001 原入口可用；本輪在獨立埠重新啟動 B1 與候選，[正式重驗](../evidence/03/RETEST-20260925.md)取得來源穩定的 **59/59 案依判定規則通過、0 非預期差異**，其中 1 項同窗限流差異已明列。候選日常入口在固定上游下取得 OPTIONS、GET 各 20/20 及隔離 App 的台股、美股、K 線、合成庫存、假 AI 冒煙結果。隔離 gate 通過；獨立覆核判本輪 Standards PASS、整票 Spec FAIL。原 `localhost:3000` 的候選 App、逐操作五鍵 raw、依賴刪除重載、完整生命週期 raw 與正式部署行為仍未驗；本票維持 **OPEN**。

## 2026-09-25 第二輪補證（起點 `c789bda`，未改產品碼）

使用者讓出 3000／3001 後，在原 `http://localhost:3000` 以隔離瀏覽器資料目錄驗候選 App，並補依賴刪除／恢復重載、兩次啟停、埠衝突與失敗恢復的原始紀錄，另做正式部署路徑的靜態核對。真帳本保護：每種視窗全新 `user-data-dir`（結束即刪）、起服務前以哨兵接走仍開著的舊分頁（事件 0）、服務期間監看外部用戶端（0）；後端固定上游與假 AI，非本機連線與真 CLI 均被擋（0 次觸發）。總覽見 [第二輪補證](../evidence/03/ACCEPTANCE-20260925.md)。

| 驗收項 | 判定 | 證據路徑 |
|---|---|---|
| 同源、同 handler、同設定，來源 manifest 可證明 | **PASS** | `evidence/03/SOURCE-MANIFEST-20260925-r4.json`（26 檔 SHA-256＋blob）；App／重載 raw 內的候選來源雜湊 |
| 兩次啟停、埠衝突、語法錯誤、依賴刪除／恢復、環境變更有明確結果 | **PASS** | `evidence/03/life03-localhost3000-20260925-r1/`（7/7：兩次啟停、雙埠衝突、vercel／Vite／監督程序崩潰與恢復）；`evidence/03/reload03-deps-20260925-r1/`（12 步，刪共用依賴兩邊 500、恢復 200，`diffs=[]`） |
| 無 orphan、無舊碼服務、無秘密洩漏、其他服務未被關閉 | **PASS** | App r2 與生命週期停止後零殘留（含 5 個函式子程序）；重載 `orphans=[]`、不回舊碼；各工具 `.env` 值掃描 0；隔離 gate（見總覽第 6 節） |
| 正式 App 端到端打到候選；固定 GET／OPTIONS 低成本仍成立 | **PASS** | `evidence/03/app03-localhost3000-20260925-r2/`：原 3000、桌面＋窄版 28/28，逐步五鍵 before／after 原始字串與 28 張截圖；低成本沿用 `daily03-cost-20260925-r1`（同啟動器與來源，量於 4633） |
| 原 Vercel 部署配置及 API 行為保留；可驗證的回復命令 | **部分 PASS，正式平台 OPEN** | `evidence/03/deploy03-static-20260925-r1/`：部署設定零差異、路由不變、本機預載被 `.vercelignore` 排除、03 前後正式前端建置 15 檔逐位元組相同；本機標準 runtime API 以 parity r5 59/59；**正式平台 API／取消未實測**。回復入口為原 `scripts/start-dev.ps1`（09-25 使用者實跑、重驗核對 200／204）；產品碼 `git revert` 未演練 |
| 隔離 gate、獨立 Standards／Spec 覆核、精確提交、日常命令文件 | **部分完成，覆核 OPEN** | 隔離 gate 全綠：tsc 0 錯、829/829、build、金鑰掃描含本輪新檔（追蹤原始碼 4451 檔）、package／lock 無差異（`evidence/03/gate03-accept-20260925-r1-lf.txt`）；精確提交為本輪 commit；**本輪增量尚未做獨立雙軸覆核** |

失敗歷史照留：`app03-localhost3000-20260925-r1` 窄版 1 步 FAIL（畫面與五鍵正確，判定器當時未實作協定 §4 的 2y 例外、缺完成時刻），修正後以 r2 重跑，不追認 r1。App 判定新增逐筆請求分類：除 §4 的 2y 外，另把「發起者非頁面腳本的瀏覽器背景重新驗證」與「`/api/gemini-stream` 畫面已證明完整收到 `done` 後被 Chrome 標為取消」列為非失敗；這兩類是**本輪判定器新增規則、非協定凍結條文，後者成因未定位**，請使用者裁定是否接受。

剩餘缺口：正式部署的 API 與取消行為未實測（依指示不部署）；本輪增量待獨立 Standards／Spec 覆核；上述請求分類待裁定；04～07 的全案效能目標不受本輪影響。**本票維持 OPEN，04 不自動解鎖。**
