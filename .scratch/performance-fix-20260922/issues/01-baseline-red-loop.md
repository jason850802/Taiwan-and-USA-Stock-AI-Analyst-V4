# 01 — 固定基準並建立可判紅迴圈

Status: ready-for-human — E0 90 秒內未就緒，正式兩次 start 與暖樣本不足；凍結門檻仍 OPEN。
Blocked by: none
Type: task

本檔為正式票據。依本案共同驗收手冊執行。

## 要交付的結果

建立可重跑且綁定來源身分的 fresh before，並讓本機 OPTIONS 慢速與「價格被名稱阻塞」都有會因症狀存在而失敗的自動判定。後續任何產品修改都以這組方法比較，不用歷史樣本冒充本輪 before。

## 實作範圍

- 保存 HEAD、未提交來源身分、既有測試／snapshot、package／lock、涉及產品來源與執行工具身分；保留所有無關修改。
- 將主 PLAN 落成規格、驗收手冊與七張正式票，明確標示條件分支與前置。
- 建立同期原工作區與精簡對照，逐檔核對產品／設定相同；副本與大量輸出不能反過來干擾被量測服務。
- 建立 OPTIONS 效能比較器，狀態錯誤、漏列、逾時、樣本不足與超標皆非零退出。
- 建立正式庫存 hook 的名稱 pending 紅燈：Yahoo 已完成時價格仍 loading 或後續價格工作未起跑即失敗。
- 以既有慢樣本及故意錯誤輸入驗證紅燈能力；歷史證據只作工具反例，不取代 fresh before。

## 驗收條件

- [x] fresh before 有唯一 run-id、來源身分、原始資料、命令與退出碼，既有輸出不可覆寫。
- [x] 原工作區與精簡對照的產品／設定來源可逐檔核對，差異與隔離條件有紀錄。
- [x] OPTIONS 比較器對已知合理候選可通過，對已知慢候選、非 204、漏列與不完整協定可判紅。
- [x] 名稱阻塞 harness 走正式 hook，使用可控制 pending 的固定回應；當前症狀存在時可穩定判紅，且不靠真上游或脆弱 sleep。
- [x] 本體資料五鍵在隔離驗收前後逐值一致；沒有真 AI 或真帳本寫入。
- [x] 明確記錄本輪是否重現空 OPTIONS 異常；若未重現，不做猜測式 runtime 修正。
- [x] 原母體測試與歷史副本分列，不把重複案例計成新增覆蓋。
- [ ] formal closure 有 fresh E0 與同期 clean 各至少兩個 actual independent starts，且每 start 每 route 1 cold + >=5 matched interleaved warm pair、全 204，並保存 actual PID/port/command/source/config/tool/runtime identity。

## 邊界

本票不修改產品行為或設定，不開始非產品目錄隔離。完成本票的正式 gate、雙軸覆核與提交後停止；下一票為 02。

## Comments

2026-09-22：依已採用 PLAN 開始 01；測試接縫固定為來源身分、OPTIONS 比較器與正式庫存 hook 名稱阻塞。

2026-09-22：01 原結案紀錄：`tools/self-test.mjs` 7/7 通過；identity 工具拒絕同 run-id 覆寫並只保存 `.env` 變數名稱。fresh E0 於正確 `/api/yahoo/chart` 與 `/api/finmind` 重現慢速；Yahoo 前四筆在 20 秒探針內逾時、後兩筆 3.09/4.19 秒，FinMind 3.93～4.19 秒。先前誤打 `/api/yahoo-chart` 的樣本保留但標為 invalid，不納入結論。原始 `npm run gate` 為 232 files/3993 tests 全綠，其中大量 `.scratch` 歷史副本屬重複母體，不宣稱為新增覆蓋。

2026-09-23：formal v2 覆核 finding 後重新開票。已建立 `evidence/01/formal-options-v2/`：171 檔產品來源 manifest、8,960 檔 frozen `.scratch` layout、E0/E1/E2/clean config identity，以及 actual PID/port/command/tool/version capture。`self-test.mjs` 擴為 15/15，包含重複 PID／缺 identity 判紅。正式 E0 start-1 的 owned Vercel PID 40880 / port 3020、Vite PID 25780 / port 4210 身分驗證通過，但第一支 cold `/api/yahoo/chart` 在 60,018.5263 ms timeout（AbortError）；capture fail-fast 只保存這一列，未發 FinMind／warm。依 frozen protocol 已停止本輪 formal run，未執行 E0 start-2 或同期 clean，因此本票仍 OPEN。

2026-09-23：formal v6 的 E1／E2／clean 已具兩次獨立 start 與完整身分、全 204，補足候選及同期 clean 證據；但 E0 start-1 在 90 秒內未就緒、start-2 依 fail-fast 未跑，沒有 E0 warm 樣本。將此記為本機啟動失敗／慢速症狀，不冒充本票要求的「兩次成功 E0 start」。依原驗收條件本票保持 OPEN；詳 `evidence/02/formal-options-closure-review.md` v6 段落。
