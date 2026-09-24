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
