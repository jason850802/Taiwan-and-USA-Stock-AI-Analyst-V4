# 03 覆核處置續驗（2026-10-01）

本輪接續 `9ba9569` 的剩餘缺口，並核對已提交的取消診斷／設定 `69e1cc797`、`571be82`；未重做已完成的歷史證據。**新 Preview 18/18、終端 3/3、最終 App r2 接受口徑 28/28／步驟快照 22/28／凍結終態 21/28、完整 gate 838/838。03 依使用者指示保持 OPEN，04 不自動解鎖。** 本輪最終固定點與交接列於末節；首組 App r1 的快照與終態更正亦保留。

## 授權、固定點與範圍

- 使用者已接受嚴格背景分類與限定完整串流後的 ERR_ABORTED 分類；沒有再新增搜尋取消例外。
- 使用者已同意既有 Vercel 專案 `taiwan-and-usa-stock-ai-analyst-v4` 的 Preview 上傳：五支私有 handler 原始碼包、固定行情／假 CLI，不含 .env 或真金鑰。此次延續相同目的地與內容，不提升正式網域。project ID `prj_aOslmSMp3ZTQMN9zVg299zkir8ws`、team ID `team_ZBl1hFhSVRgzKzSmfx7WioYv`。
- 本輪使用者再次確認 Chrome 全部 localhost:3000 分頁（含背景）已關閉並讓出雙埠；工具起跑前核對空埠，哨兵／外部用戶端監看也無事件。
- 原始覆核起點仍為 `db4e620`；本輪入口 HEAD 為 `571be823bc4555d5c963f1507d77e4ca6b165c86`。工具提交 `241fba1b4e6be8f74719afd7d8b7b2fa87a5d6f6`，取消收尾判定提交 `e6b6770883379cd3a22779588f08e9dbc0249fee`。
- 本輪程式覆核範圍 `571be82..4d2b2ba`：`platform-03.mjs`、`platform-fixture-03.cjs`、`guard-platform-03.mjs`、`terminal-03.mjs`、`console-control-03.py`、`app-03.mjs`、`guard-review-03.mjs`；另核對先前 `69e1cc797` 的 `vercel.json`／設定守衛。其餘產品變更只是目前來源的受影響驗證，不納入本輪實作。
- 終端正式 run 固定 `241fba1`；新平台及首組 App 固定 `e6b6770`，最終 App r2 固定 `4d2b2ba`。每次正式 run 的實際工具均與當時提交逐位元組一致。
- [首組前置來源清單](acceptance03-20261001-r1-manifest-before.json)／[首組後置來源清單](acceptance03-20261001-r1-manifest-after.json)：187 檔，前後無漂移；其中 183 檔已與隔離 gate 比對，另四支既有共用工具 `sameAsGate=null`、與提交逐位元組一致。165 檔 exact，22 檔僅 CRLF/LF 差異並保留雙 SHA；工具一律 exact。最終 r2 清單列於末節。

## 逐條處置與剩餘邊界

| 發現 | 處置 | 證據與邊界 |
|---|---|---|
| P3 | 已修；本輪補終端實測 | 七處 `/T` 移除、結束當下重列子孫與建立時間守衛沿用已提交版本；歷史假守衛 33/33、lifecycle 8/8 為證據核對。本輪 Ctrl+C／關窗／B1 回復 3/3，程序殘留 0。CIM 查詢與終止仍非原子，不能宣稱所有 PID 重用競態消失。 |
| P2 背景 | 已修、使用者接受 | 同視窗、完全相同網址且腳本 200 完成時間嚴格早於本筆開始。新 App 原始取消照留。 |
| P2 串流 | 已修、使用者接受 | 沿用四臂 B1／候選對照；新 App 每筆同 requestId 精確五段＋done、done 早於 canceled ERR_ABORTED，UI 完整。平台首段取消另用上游 kill 證據，不套用完整串流例外。 |
| P1 | 已修 | 最終 App r2 接受28/28、凍結快照22/28／終態21/28同列；首組r1的終態20/28見下方更正。歷史紅燈與原始錯誤不追認。 |
| P4 | 已修；本輪演練切回 B1 | 三項終端 run 的 rollback-b1 直接執行既有 `scripts/start-dev.ps1` 的 backend／frontend，首頁 200、OPTIONS 204，正常停止後無殘留。這是入口回復，沒有演練產品碼 `git revert`。 |
| P5 | 已修補實測並揭露限制 | 本輪實際送 Windows Ctrl+C、關閉自己的 console 視窗；只核對自己新建 console 的精確 FILETIME。不宣稱涵蓋任意作業系統訊號。看門輪詢空窗、祖先與看門同失效的新孤兒、非原子 CIM 身分查詢限制仍在。 |
| S1 | 不收 | 集中歷史 13 檔清單會擴大 parity／reload 工具修改，改其雜湊及重跑範圍；本輪必要處置不需要此重構。既有具名 raw 保留，不改寫舊證據。 |
| S2 | 已修 | 身分組裝沿用 port-guard 共用欄位；終端另以原始 FILETIME 核對 console 出生身分，非按埠猜 PID。 |

## 首組執行（App r1 終態更正見後續覆核節）

| 項目 | 結果 | 原始證據 |
|---|---|---|
| 平台假資料守衛 | 30/30；無網路、無真程序終止 | [guard raw](guard03-platform-20261001-r1/raw.json) |
| Ctrl+C／關窗／切回 B1 | 3/3；每案首頁 200、OPTIONS 204；無 foreign/errors，停止後雙埠空、state 刪除、alive 空 | [terminal raw](terminal03-localhost3000-20260930-r1/raw.json) |
| 原 localhost:3000 正式 App | 桌面及窄版各 14/14；接受 28/28、凍結 22/28；四軸逐步、五鍵 before/after 與 28 截圖 SHA | [App raw](app03-localhost3000-20261001-r1/raw.json) |
| 新 Preview API／取消 | 18/18；兩種取消停止，取消後下一筆正常；無 blocked-fetch | [prepare](platform03-accept-20261001-r1/prepare.json)、[deployment](platform03-accept-20261001-r1/deployment.json)、[raw](platform03-accept-20261001-r1/raw.json)、[平台 logs](platform03-accept-20261001-r1/platform-logs.json)、[summary](platform03-accept-20261001-r1/summary.json) |
| 最新隔離完整 gate | 52 檔、838/838、tsc／build／金鑰掃描／package diff 五道全綠、exit 0；183 檔來源對應 | [gate log](gate03-review-20261001-r2.txt)、[來源](gate03-review-20261001-r2-source.json)、[exit](gate03-review-20261001-r2.txt.exit.txt) |

新 App 固定 provider fetch 共 46（FinMind 18、cookie 2、crumb 2、chart 22、search 2），假 CLI spawn 4、delta 20、done 4；blocked net/fetch/AI、foreign、sentinel 均 0。記錄 12 個程序停止後皆退出，兩個隔離 profile 刪除，原雙埠空；未碰真帳本。對兩張代表截圖另做可見內容核對：完整假分析與窄版合成台／美庫存可見。外部字型來源單列，不是市場或 AI 上游。

[聚合分析](acceptance03-20261001-r1-analysis.json) 綁 App raw 與平台 summary SHA，不替換原始檔。59 案 parity、12 步 reload、lifecycle 8/8、OPTIONS／GET 各 20/20 是歷史證據核對，**未在本輪重跑**；不能寫成最終 HEAD 的全量重驗。llm CLI 隔離／effort、Markdown／cache tag 等另票已提交變更，由本輪新 App 與 838 測試覆蓋其受影響路徑；沒有新增行情效能宣稱。

## 平台取消與配置範圍

[本輪 Preview](https://taiwan-and-usa-stock-ai-analyst-v4-kr2atkmnw-chuan0802.vercel.app)，部署 `dpl_8wVnjr7jLS3iM794zCL2rQwXrsfP`。提交版工具核對 prepare SHA、精確 URL／dplID／Preview target，再做請求；部署與五組 bundle／config SHA 綁定。五 API 開 cancellation，從提交來源讀取原時限（行情 30、非串流 AI 120、串流 200 秒）；沒有再用舊包把串流降為 30 秒。

18 筆包括五 OPTIONS、三行情 GET、無效 POST 400、method 405、origin／secret 403、非串流與完整串流、兩種取消、取消後完整串流、限流 429。每筆驗 payload／error code；拒絕案不得開行情或 CLI。共 117 個同部署注入事件、fake CLI spawn 5、kill 2、done 3。

- 首段取消：只送第 1 段；res close(false) 至 kill 約 0.61 ms，首段伺服器寫出至 kill 約 252.42 ms；同 trace 無其後 delta／done。
- 出字前取消：kill emitted 0；close(false) 至 kill 約 0.65 ms；無 delta／done。其後 response-finish 是原 handler 的 `res.end()` 靜默收尾，須已有明確時間的斷線與 kill，才能接受。
- 取消後新請求完整五段＋done，沒有污染下一請求。

以上時間只用同筆伺服器時鐘；不將 client 與 server 時鐘相減，不宣稱端到端取消 SLA。平台通知可能延至下一次寫出，長時間無輸出時仍有延遲下限。

此次是原 handler＋部署旗標／原時限的**固定資料 Preview**：Node22、esbuild 注入、origin／secret／Redis 固定測試值；原 guard／限流程式碼仍執行。**未驗真服務配置、真 Redis 可用性、真 Gemini／Claude／市場或正式網域，也不是完整產品 production 部署等價證明。** 真上游／真 AI 被禁止，這些保留為範圍限制，不用 mock PASS 推定。原本「配置完全不變」由使用者核准 supportsCancellation 例外取代。

## 本輪紅燈時間軸與保留

| UTC／證據 | 事件 | 處置 |
|---|---|---|
| 2026-09-30T15:54:01 起，platform03-accept-20260930-r1 | 17/18；early 已 kill emitted 0，因原 verifier 一律拒 response-finish 判紅 | 原 prepare/deployment/raw/logs/summary 完整保留。修正判定後新 run，不追認此輪 PASS。 |
| gate03-review-20261001-r1 | PowerShell 5.1 原先 BOM 解析中止；加 BOM 後又將 Node stderr 警告當終止錯誤，未完成 gate | 保留該輪來源／部分 log，沒有 exit 0／PASS 宣稱；確認 env 複本已清、無 gate 程序殘留。沿用原 PowerShell 7 起跑，新 r2 全綠。 |
| e6b6770、guard03-platform-20261001-r1 | 新守衛拒正常完成後 kill、缺時間 finish、kill 後出字及任意 done；30/30 | 只修驗證器，未改產品 handler；Standards／Spec 增量均獨立確認。 |
| platform03-accept-20261001-r1 | 新提交版 18/18 | raw／logs／summary 各為新檔，不覆寫 r1 紅燈或 09-29 原平台取消 FAIL。 |

更早的紅燈／診斷仍見 [09-29 增補](REVIEW-ADDENDUM-20260929-r1.md) 與 [09-30 非正式診斷](diag-platform-cancel-20260930/README.md)。非正式診斷不追認為正式驗收。本輪 git 精確提交曾因一小時前的空 index.lock 中止；核對無 git 程序且鎖未變後只移除該過期鎖，沒有重置 index 或其他內容。

## 日常命令、重跑與回復

在 repo 根目錄：

```powershell
node .scratch/performance-optimization-20260923/tools/daily-dev.mjs start
node .scratch/performance-optimization-20260923/tools/daily-dev.mjs status
node .scratch/performance-optimization-20260923/tools/daily-dev.mjs stop
# 控制管道失聯才用；按記錄的身分恢復，不直接刪 state
node .scratch/performance-optimization-20260923/tools/daily-dev.mjs recover
```

本輪已演練候選停止、確認空埠，再以兩個自己的 PowerShell console 執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/start-dev.ps1 -Service backend
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/start-dev.ps1 -Service frontend
```

這是已驗證的 B1 入口回復。若需撤回本輪**工具**，先保全無關工作並檢查衝突，再逆序 `git revert --no-edit e6b6770883379cd3a22779588f08e9dbc0249fee 241fba1b4e6be8f74719afd7d8b7b2fa87a5d6f6`；撤回取消設定另需 `69e1cc797`。反向提交命令未演練，不能用它作整票產品回復已驗證的宣稱。

重跑使用全新代號：`terminal-03.mjs <新代號>`、`app-03.mjs <新代號>`；原埠需重新取得分頁關閉確認並核對空埠，工具等於提交版。平台依 `platform-03.mjs prepare|probe|logs <platform03-新代號> [精確Preview網址]`；每一步檔案都拒覆寫。完整 gate 與本機正式 runtime 不同時跑。

所有本輪服務停止；本輪 gate env 複本清除，junction 保留，未移除 worktree／junction 目標；無 package／lock 改動、push、發版或 production 提升。平台假資料 Preview 保留供覆核。

## 後續獨立覆核：晚到取消與終態更正

上述第一組 App 的「凍結 22/28」是**步驟快照**，不是完整 run 終態。Spec 獨立核對原始事件找到桌面 `24724.175`／窄版 `10064.175`，皆為 add-tw-2330 的 FinMind 背景請求：步驟當下 failed=null，但稍後已保存 loadingFailed ERR_ABORTED canceled=true。兩筆都有同視窗、同網址先前腳本 200，接受口徑仍 28/28；依凍結規則終態為 **20/28**。原 raw／summary／聚合分析不改寫；[終態更正](app03-localhost3000-20261001-r1/terminal-amendment.json) 綁原 raw SHA，明列兩筆及前筆證據，之後引用此 run 必須同列快照 22/28／終態 20/28。

工具缺陷亦處置：`4d2b2ba51fa2a6ba12a5f86915c6ca8be8d85a50` 對每步 events／capture 深複製，保留 requestsAtStep；視窗關閉前依同 requestId 最新事件重算 requests、四軸及接受／凍結結果。串流仍需當步 UI 完整，不能用事後 bytes 取代；只有 200 標頭而無終態不得通過。沒有修改產品消費器或新增分類例外。

Standards／Spec 預審另發現不完整步驟缺 verdict 可能使 reconciliation 拋錯並跳過 Chrome 清理，已修為缺 verdict 判失敗、重算錯誤記為無效 run，巢狀 finally 仍嘗試關 CDP／Chrome／刪隔離 profile。純資料守衛由 33 增至 37，正式 [37/37 raw](guard03-final-20261001-r1/raw.json) 綁 `4d2b2ba`；[最終 gate r4](gate03-review-20261001-r4.txt) 同來源 838/838、五道全綠、exit 0。修正前 r3 為中繼候選 gate，保留且不替代 r4。

本輪後段一次純資料驗證因自動核准審查額度不足未執行；它是審查失敗，不是安全否決。使用者續跑後重新走同核准流程，已成功；未繞過核准。開發守衛 raw 中帶 red 的代號為命名，結果實為 PASS，不列為先紅證據；確定工具缺陷的否證來自已保存 App r1 的欄位／事件不一致及 reviewer 的缺 verdict 重播。

新的正式 App run 使用 `4d2b2ba` 與全新 `app03-localhost3000-20261001-r2`，其結果及最終固定交接接續於下方；首組 App 僅保留作歷史與修正依據。

## 最終提交版 App 與處置增量

[App r2 raw](app03-localhost3000-20261001-r2/raw.json)／[聚合](acceptance03-20261001-r2-analysis.json)：`4d2b2ba`，正式原 localhost:3000，兩視窗各 14 項四軸通過。**接受 28/28；操作快照凍結 22/28；視窗關閉前觀察終態凍結 21/28**（桌面 11/14、窄版 10/14）。本輪三筆串流完整後取消，另一筆正常完成，所以不能沿用舊 r1 的終態 20/28；不為湊相同數字重跑。

四筆串流仍皆有精確五段＋done，三筆取消符合限定 bytes／UI／嚴格先後規則；四筆背景取消各有同視窗同網址先前腳本 200。窄版 add-tw-2330 的晚到取消確實從快照 failed=null 更新成最終 failed，沒有再以共享陣列掩蓋終態。requestsAtStep 保留深複製快照，requests 與最終 verdict／摘要一致。

28 張新截圖 SHA、每步五鍵 raw 保存；browser API 50 筆、固定 provider fetch 46、假 CLI 4（20 delta、4 done）；真市場／AI 0、blocked／foreign／sentinel 0。17 個程序樹節點停止後全退出，state／兩個 profile 已清、3000／3001 空埠。終態時間範圍是視窗關閉前的觀察，不將測試器關閉 Chrome 自己引發的取消當成產品失敗。

[最終 before](acceptance03-20261001-r2-manifest-before.json)／[最終 after](acceptance03-20261001-r2-manifest-after.json) 187 檔無漂移；183 檔與 gate r4 相符，另四支共用工具與提交 exact。r4 的 sourceHead 記提交前 `e6b6770`，但新版 App／守衛實際 SHA 均與後續 `4d2b2ba` 相同；不拿 sourceHead 標籤代替逐檔來源查證。

本輪新增覆核範圍固定 **`571be82..4d2b2ba`**：七支工具（前述五支，加 App 與程序／分類守衛）；另核對 `69e1cc797` 的部署設定及設定守衛。全案 03 覆核處置可從 `db4e620` 接至 `4d2b2ba`，09-29 已覆核的增量不重做。文件與證據固定點是包含本增補、票面及新 raw 的精確提交；[獨立雙軸紀錄](REVIEW-INCREMENT-20261001-r1.md) 分開列程式預審、修正與正式證據結論。

目前授權的固定資料／假 CLI Preview、日常入口、App 與回復範圍已完成必要實作及新證據；保留的外部邊界包括真配置、真上游、production 網域、產品碼反向提交未演練，以及輪詢／CIM 競態。它們不被 mock PASS 覆蓋。合入 main 前仍需選定精確 03 提交範圍並核對整合差異；本輪未 merge、push 或發版。

## 最終固定交接

本票／狀態／來源與最終 commit：03／OPEN（依使用者凍結，不自動 resolved）；初始覆核來源 db4e620，本輪接續571be82；平台／終端工具241fba1、平台判定e6b6770、最終App工具4d2b2ba；文件證據固定點為包含本檔的提交。04不解鎖。

這次真正改變的等待來源、採用與未採用分支：採用使用者核准 supportsCancellation 配置，平台斷線能通知既有 handler 並停止假上游；修正取消後靜默 finish 判定及 App 晚到取消的終態紀錄。S1 不收；行情等待、三槽、快取金融語意未改。

使用者可感知的 before→after（來源、樣本、成功／失敗、時間口徑）：09-29舊Preview首段取消後仍送五段done、無kill；新Preview首段只送一段、出字前零段、兩筆都有kill且無done，取消後請求正常。新App 28/28接受、22/28快照、21/28凍結終態；不是效能提速宣稱。終端Ctrl+C／關窗／回復由未驗變3/3通過。

各段時間與 browser／provider 請求數、重試、peak、快取：新App browser API50、固定fetch46、假CLI4；平台18筆、同部署117事件、CLI5次spawn／2次kill。平台首段寫出至kill約252.42ms，close至kill約0.61／0.65ms，皆同筆server時鐘；不宣稱client端SLA。未重測行情成本中位數、重試或peak。

正確性、FX、沿用窗、取消／世代、P1／S1、本體五鍵：新App四軸、五鍵與圖28/28；真帳本未碰，FX／費率／損益／世代語意未改。兩條使用者接受規則嚴格限縮，凍結快照／終態分列；S1不收並列理由。平台取消不套用完整done例外。

固定測試、真行情、正式 App、完整 gate、雙軸覆核各自結果：本輪平台純資料30/30、程序／請求守衛37/37、原埠終端3/3、App接受28/28／凍結終態21/28、Preview18/18、gate r4 838/838五道全綠；真行情／真AI不執行。獨立雙軸程式預審發現均已修，正式證據結論見REVIEW-INCREMENT末節；歷史life8/8、parity59/59、reload12與低成本20/20僅證據核對。

證據入口、日常啟停／重跑命令、回復方式：本增補及REVIEW-INCREMENT，最終manifest r2、App r2、平台20261001-r1、terminal20260930-r1。daily-dev start/status/stop/recover 不變；新run-id、提交版工具及原埠分頁確認才重驗。切回B1的backend/frontend命令已實際驗證；git revert工具命令及產品碼撤回未演練。

仍 OPEN 的具體原因、不可控下限與已嘗試措施：依使用者要求維持OPEN與04凍結；真服務／正式網域不在mock驗收內，產品碼revert未演練、平台取消通知可延至寫出、CIM查詢與終止非原子。已有旗標紅綠診斷、新受控Preview、三項終端與最終App證據，不以gate代替外部邊界。

下一票名稱、前置是否滿足、下一個可直接執行動作：04「降低單次報價成本」仍不解鎖。先由使用者裁定03結案與精確main整合範圍；若另要真配置／production網域驗收，需另定不耗真AI／行情的範圍。不要重跑本輪已完成raw或直接合整條含其他工作之分支。

## 分項交付狀態

| 項目 | 已實作 | 固定驗證 | 真上游 | 使用者畫面 | 是否達標 |
|---|---|---|---|---|---|
| 日常入口與來源／清理 | 已採候選及身分守衛 | 歷史life8/8；本輪終端3/3、來源無漂移 | 未使用 | 目前App兩視窗28操作 | 03授權範圍通過；競態限制保留 |
| API／平台取消 | 使用者核准取消旗標 | 新Preview18/18，原時限、guard、kill及下一請求核對 | 未使用 | 固定App串流可見；Preview為API包 | 受控Preview通過；真配置／production等價未驗 |
| App／本體五鍵 | 元件沿用目前提交；判定器修晚到取消 | 37守衛；App四軸28/28 | 未使用 | 28截圖與逐操作raw | 接受28/28；凍結終態21/28另列 |
| 回復 | 保留B1命令 | 實際backend/frontend 200／204及停止清理 | 未使用 | 僅首頁HTML，B1庫存未另跑 | 入口回復通過；產品git revert未演練 |
| 全案效能 | 本輪未改行情等待 | 歷史低成本證據沿用 | 本輪禁止 | 十檔／K線配對留後票 | 全案仍OPEN，沒有新提速結論 |

最終獨立結論：Standards 無未處置硬違規／重要 smell；Spec 授權 mock 範圍 PASS，無剩餘技術阻擋。來源、真上游邊界與03／04狀態照上列保留。

現行七工具撤回清單**取代前段首組清單**；先保全無關工作並核對衝突，以下命令未演練，不是整張03產品回復：

```powershell
git revert --no-edit 4d2b2ba51fa2a6ba12a5f86915c6ca8be8d85a50 e6b6770883379cd3a22779588f08e9dbc0249fee 241fba1b4e6be8f74719afd7d8b7b2fa87a5d6f6
```

最後觀察見 [清理r1](CLEANUP-20261001-r1.json) 與 [精確身分清理r2](CLEANUP-20261001-r2.json)：r1的DateTime直接對字串不作無殘留依據，r2使用正式port-guard序列化出生身分，17個記錄節點無存活、雙埠空。gate env／state／profile已清，junction仍指向C:\pfv\node_modules。原清理檔不覆寫，正式App stopCheck仍保留。
