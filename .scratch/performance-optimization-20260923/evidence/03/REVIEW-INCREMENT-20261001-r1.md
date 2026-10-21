# 03 續驗增量：獨立 Standards／Spec 覆核

覆核範圍：`571be82..4d2b2ba` 七支工具，另核對 `69e1cc797` 的 Vercel 取消配置／設定守衛。`db4e620..6b14769` 已覆核增量沿用 [09-29 紀錄](REVIEW-INCREMENT-20260929-r1.md)，不從頭重做。兩位 reviewer 未參與實作，分別只讀查 Standards 與 Spec；本檔記錄其回報及修正固定點。

## 程式預審與處置

| 軸 | 發現 | 處置／固定點 |
|---|---|---|
| Standards／Spec | B1 第二個啟動失敗會漏清第一個；最初根 PID 觀察可能誤認重用 PID；外部用戶端後仍可能繼續起下一案 | 取得 FILETIME 就保存 console，再即時核對 CIM 出生時間與原 FILETIME；每次起跑／等待加停止守衛；以出生錨點擴展樹後才關 console。`241fba1`，終端 3/3。 |
| Spec | probe 在請求前未綁定部署；只驗狀態會誤收錯 payload；FinMind 期望受 shell env 影響 | 提交／prepare／URL／dplID／Preview target／五組 bundle+config SHA 在網路前核對，完整 fixture 與 error code 判定，固定 FinMind 三股期望。`241fba1`。 |
| Standards／Spec | early 取消已 kill，`res.end()` 收尾發 finish 卻被驗證器判紅 | finish 必須晚於同 trace 的斷線與 kill，任意 done／kill 後 delta 仍拒。`e6b6770`，假守衛 30/30，新平台 18/18。原 r1 FAIL 保存。 |
| Spec | App 快照的 failed 與共享 terminalEvents 不一致，漏算跨步驟晚到取消 | raw 不改寫，r1 新增終態增補為快照 22／終態 20。`4d2b2ba` 深複製快照、視窗關閉前重算，凍結快照／終態分欄；新 App r2 快照 22／終態 21。 |
| Standards／Spec | 未完成步驟沒有 verdict，重算拋錯會跳過 Chrome／profile 清理 | 不完整步驟失敗、重算錯誤使 run 無效；巢狀 finally 保證仍嘗試 CDP／Chrome／profile 清理。`4d2b2ba`，正式假守衛 37/37。 |
| Standards | 新增補草稿兩處簡體字違規 | 提交前已改為繁體字；既有歷史文件未改。 |

## 正式證據核對

| 軸 | 獨立查證結果 |
|---|---|
| Standards | 工具與提交／現有 bytes 一致；prepare→deployment、raw/logs→summary 雜湊綁定；gate183檔與隔離副本相同；manifest187檔前後及現況無漂移（四支既有共用工具另以提交 exact 核對）。三組平台／終端／App 新 run 秘密值掃描無命中；舊平台 FAIL 與舊 App raw SHA 未變。 |
| Spec 平台 | 18/18 獨立重算：五 OPTIONS 短路，完整行情／AI fixture，method／origin／secret／body／rate-limit 拒絕無行情或 CLI 上游。117同部署事件，首段取消 emitted1、出字前 emitted0，皆 close(false)→kill、無其後 delta/done；下一筆完整五段+done。取消旗標與30／120／200秒原時限、工具／來源／bundle身分核對通過。 |
| Spec 終端 | Ctrl+C、關窗、切回 B1 三案首頁200／OPTIONS204，原埠空／state刪除／alive空；B1 script與工具SHA對上241fba1且後續未變。 |
| Standards／Spec App r2 | 接受28/28；凍結快照22/28、終態21/28（桌面11、窄版10）。50筆請求欄位與terminalEvents一致；窄版晚到取消從原快照null／events0更新為終態ERR_ABORTED／events1。四軸、五鍵精確允許內容、28圖SHA全部成立。 |
| Spec 請求例外 | 四筆串流bytes均五delta+done；其中三筆done嚴格早於取消0.413／0.711／0.303ms，第四筆200且loadingFinished正常。四筆背景取消各有同視窗同網址腳本200在先；沒有新分類例外。 |
| Standards／Spec 清理／gate | 無重算錯誤、errors／foreign／blocked，17程序樹節點殘留0，兩個profile／state／3000&3001全清；37/37與838/838、五gate、exit0成立。 |

## 最終結論

**Standards：無未處置的硬性違規或重要 smell。Spec：授權固定資料／假 CLI Preview 與本機入口範圍 PASS，無剩餘技術阻擋。** 晚到取消與清理預審發現均已有提交版新 run，不以修改舊 raw 代替驗證。

歷史 parity59／reload12／lifecycle8 只沿用具名證據，不冒稱本輪於最終 HEAD 重跑。真配置、真 Redis／Gemini／Claude／行情、production 網域未驗，不能宣稱完整 production 等價；程序非原子查詢與通知延遲等限制照列。詳見 [完整處置及固定交接](REVIEW-ADDENDUM-20261001-r1.md)。

**03 依使用者指示維持 OPEN，04 不自動解鎖。** 本次沒有 merge main、push、發版或提升 production。最終文件／票面與證據以包含本檔的精確提交固定。
