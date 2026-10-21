# 新 session 執行提示詞

以下區塊整段貼到已連接同一專案的 Chat On Steroids 新 session。貼上即採用此計畫並授權執行兩票；本檔建立時尚未啟動修正。

```text
請執行 P1／S1 修正計畫，依序完成兩票的實作、驗收、獨立雙軸覆核與提交。

專案：E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4
CoS 對應：/taiwan-and-usa-stock-ai-analyst-
本案入口：.scratch/reacceptance-fixes/PLAN.md
規劃時 HEAD：b2bf7d8075eb31266d556afb0f874d37c3217bb4

我採用這份計畫、spec.md 與 acceptance.md，授權本 session 修正 P1／S1；先前「只驗收、不改代碼」是上一輪限制，不是本輪修正限制。請先讀 AGENTS.md、CORE_RULES.md、CONTEXT.md，以及本案 PLAN.md、spec.md、acceptance.md、issues/01-p1-replay-freshness.md、issues/02-s1-health-input-invalidation.md。診斷與覆核依專案 diagnosing-bugs／code-review skills。

先查目前 HEAD、Git 狀態與既有成果。原 .scratch/reacceptance-20260921/ 是須保留的重新驗收證據，本案規劃文件也可能尚未提交；不要 reset、clean、整包git add或從舊HEAD開worktree而漏掉現有修改。已完成的工作先核實再續做，不因聊天歷史缺失重做。

先完成本案01（P1），再自動完成本案02（S1），票間不必再次詢問。這是新修正案的01／02，不是原12步計畫的01／02。

P1：每次啟站有唯一runId與獨立輸出；頁面載入時固定執行身分，伺服器拒絕舊頁面回傳；verifier、05前後統計與最終seal都核對指定清單、完整案例、來源／工具／build及raw hash。必須以漏案、混輪、舊頁面、舊摘要反例證明會失敗，不能只加一個欄位就關閉。

S1：只針對已保存的健檢相關持股輸入／lot組成變更撤銷舊報告，單檔與批次共享身分守衛。顯示「持股資料已變更，請重新健檢」，已開視窗保留提示及可用按鈕，未開不彈出；由我手動重跑，不自動呼叫AI。不因排序、相同內容新物件、無關欄位或單獨報價／匯率更新誤失效。

每票先建立命中原症狀的紅燈，完成最小修正及受影響回歸、完整gate、兩個獨立Standards／Spec覆核與修正覆核，再一票一個最終提交。Reviewer沿用我已授權的工具模型5.6、high。原805項測試是保護基準，新增另外計數；既有測試期望／snapshot不可改。缺必要驗收或覆核能力時明列未完成，不冒稱通過。

只用隔離本機假資料與合成串流，不新增套件、不呼叫真實應用AI、不寫真實持股、不改金融公式／費率／精度／匯率政策／AI提示詞或快取契約、不推送或部署。遇到必須改金額語意或既有測試紅燈，按根規則先定位並詢問。

新證據與最終報告放本案目錄，原01～12及重新驗收歷史保留。不要amend原b2bf7d8或舊票提交。完成兩票後回報修正前後差異、實測數據、新增測試、P1負向驗證、兩軸結果、兩個提交SHA、證據位置、剩餘限制與清理結果，然後停止。
```
