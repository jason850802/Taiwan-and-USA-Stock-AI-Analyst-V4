# 整合覆核修正：批次健檢移除後同代碼重加

Standards從01至11的完整產品覆核找到1項MEDIUM正確性問題：移除持股的effect只迭代單檔影格排程，但批次健檢沒有這份排程，因此漏失效其世代。已完成的舊結果也可能留在`healthResults`供同代碼新持股誤用。Spec第一階段獨立產品覆核原為0項；本修正由兩軸另確認，不改寫原審查紀錄。

## 重現與原因

命令`node .scratch/optimization-followup/evidence/12/health-guard-server.mjs`，瀏覽器開`http://127.0.0.1:4182/?stage=red&case=0`。只作用於該隔離origin，所有AI、行情及持股均合成；宿主直接import真正`useHealthCheck`並顯示公開回傳值。

修改前實跑：AAPL成本100送出批次→扣住HTTP→刪除AAPL→以成本200重新加入→釋放舊批次。新AAPL收到`OLD`報告，精確斷言「新加入持股收到舊成本的健檢結果」為紅燈。原始結果見`health-guard/red-batch-readd-before.json`，保留實際成本、結果及來源／宿主／工具指紋。

排查排序：移除時批次世代未失效；服務快取重用舊結果；殘留影格排程。紅燈只有一筆實際批次請求、批次沒有影格display，故先修正移除失效集合即可閉合公開症狀，不改服務快取、解析或金融計算。

## 最小修改

僅`components/portfolio/useHealthCheck.ts`新增10行／刪除2行。commit階段按所有已知單檔／批次世代判斷已移除代碼，取消其display並增加世代；保留單調遞增值防重加復活。移除的公開結果與視窗來源同步清理，queued updater按當前有效symbol集合判斷。仍存在持股的批次結果照常交付，單檔與批次既有成功／失敗策略不改。

`?stage=green&case=0&auto=1`跑6個新公開行為案例：回應前重加、回應後重加、舊批次錯誤、單檔重加、已完成結果重加、未移除持股仍正常完成。6案全綠；`verify-health.mjs`重算Git紅燈來源、全部當前來源、工具及esbuild宿主指紋。型別檢查已通過，完整gate及正式App整合於後續同一候選重跑。

修正前已跑的59個功能案例與21個排隊前樣本全部移至`precheck-health-review/`，保留原始內容及來源，不納入最終候選成功數。修正後重跑完整候選矩陣。這不是重訂成本或匯率口徑，而是拒收屬於已移除持股的結果。
