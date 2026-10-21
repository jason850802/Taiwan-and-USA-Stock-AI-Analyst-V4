# 03 精確本機 main 整合完成

本機 `main` 已從 `bf7599c53b0dcee2a5a814f3e62133c67844309a` 更新為 **`1a9269fe781f4ae5e0d432d1c22b4c77d6cc3bcd`**。合併樹與已驗收候選 `49654f3a1ad49b068c921fdba9545bc3f188e8b2` 完全相同，30 檔工具／操作說明的工作檔與 main blob exact。**production 暫不新增；沒有 push、部署或發版。03 維持 resolved，04 未領取或執行。**

原工作區仍在 `codex/reacceptance-fixes-p1-s1`，以保留大量無關修改；本輪不是把整條來源分支合入 main。[工作區前後核對](main03-integration-20261001-r1/preservation-after.json) 的 763 個原有變更路徑位元組無漂移。乾淨整合副本位於 `.scratch/integration03-isolated-20261001-r1`，分支 `codex/integration03-main`、HEAD 同 main。03 票與完整歷史證據仍由來源分支保存，未擴充成其他票的 main 移轉。

## 固定點與精確範圍

原準備 `cfbd118` 以 `2b2811b` 為 main；執行時 main 已新增前端文案修正 `bf7599c`，本輪先更新基底，保留該 5 檔。新版精確範圍是 **47 檔**：原 45 檔、清理假守衛與操作界線兩檔。13 檔產品取消／Vite、2 檔核准平台設定／守衛、1 個部署排除 hunk、B1 入口，以及 30 檔共用工具／操作說明。`package.json`／lock、AI 模型／effort、提示詞／快取／金融語意及其他票沒有帶入。

[候選清單與逐檔 SHA](main03-integration-20261001-r1/candidate-fixed-point.json)、[最終 patch](main03-integration-20261001-r1/candidate-final.patch)、[真實本機整合結果](main03-integration-20261001-r1/integration-result.json)、[雙軸覆核](main03-integration-20261001-r1/REVIEW.md) 可直接交給獨立覆核者。可覆核固定 diff 為 `git diff bf7599c53b0dcee2a5a814f3e62133c67844309a..1a9269fe781f4ae5e0d432d1c22b4c77d6cc3bcd`，實作候選為 `bf7599c..49654f3`。合併 commit 有具體 `Code-Review:` trailer，並以舊 main 身分 compare-and-swap 更新 ref，沒有覆蓋新前進或切換髒工作區。

## 每條新增發現的處置

| 發現 | 處置 | 新證據／界線 |
|---|---|---|
| daily shutdown 清理失敗仍刪 state／exit 0 | 已修：保存同 token 身分與 cleanupError、exit 1；異 token 不碰 | `cleanup-red.json` 舊版 1/6；`cleanup-green-r3.json` 13/13，真 kill 0 |
| service-kit 按裸 PID taskkill /T，埠空就假成功 | 已修：核對 spawn 建立時間及腳本、逐一重列子孫；已記錄程序消失且埠空才 stopped | 同上：重用 PID、非 listener 孤兒、晚生子孫、外部 listener、缺身分與 CIM 失敗 |
| 第一輪 stopOwned 的新增 known 丟失 | 已修：回傳並合併到最終清理；孤兒失敗仍保存 | Spec／Standards 都獨立重播，最終實際 stopOwned＋shutdown 守衛 PASS |
| terminateVerifiedTree 中途查詢失敗丟失新身分 | 已修：錯誤攜回 known／killed，stopService 保存供重試 | Standards 獨立補查失敗後重試 PASS；13 項守衛涵蓋此模式 |
| 看門失敗僅記 exited／直接 caller 登記太晚 | 已修：非 0 或異常退出保留失敗；兩 caller 在 spawn 就登記 | Standards 實際 stopWatchdog 三狀態 PASS；原埠 terminal／life 全綠 |
| 歷史 identity 缺基線／五文件；準備文件過度宣稱依賴齊備 | 已處置：fail-fast＋README-main-03 明列完整證據 checkout 限制，含 stream-compare | 不搬 01／02 整票，不將 main 冒充原基線；新主入口不依賴歷史 identity |

原始 09-25 P3、P2 背景／串流、P1、P4、P5、S2 及 S1 不收理由仍以結案增補為準：均不重做已完成證據，兩項分類按使用者已接受的收緊規則。S1 仍不收，避免無行為必要地抽象化歷史 parity／reload、擴大雜湊及重跑範圍。這次共用服務安全缺口與歷史上下文說明是精確 main 新覆核的必要處置，不是翻案 S1。

## 本輪驗證與失敗保留

| 驗證 | 結果 | 證據 |
|---|---|---|
| 完整 gate | 53 檔、838/838；tsc／build／金鑰／package diff 全綠 | `main03-integration-20261001-r1/gate3-{log.txt,result.json,before.json}` |
| 原 3000／3001 life | 8/8，包括雙重崩潰 recover | `main03-life-20261001-r2/` |
| 正式 App desktop／narrow | 接受 28/28；凍結步驟 22/28、視窗終態 20/28；五鍵及四軸通過 | `main03-app-20261001-r1/`；28 張畫面 |
| 原埠終端與 B1 回復 | Ctrl+C／關窗／B1 3/3 | `main03-terminal-20261001-r1/` |
| 五 API 取消 | 串流、非串流 AI、搜尋、FinMind、chart 都 PASS | `main03-{cancel,gemini,search,finmind,chart}-20261001-r1/` |
| guard 等待階段取消 | 5/5，取消後不啟上游或假 CLI | `main03-guard-cancel-20261001-r1/` |
| 假身分／請求守衛 | 37/37；新增清理守衛 13/13；真 kill 0 | `main03-guard-20261001-r1/`、`cleanup-green-r3.json` |
| 來源與保護 | 每輪來源無漂移、工具與提交 blob exact；外部用戶端 0；原埠／備用埠空、state 無、臨時 env 移除 | `*-before.json`／`*-result.json`；`integration-result.json` |

所有新 raw 都從實際候選執行後按位元組複製回來源證據，共 11 個具名 run，清單與 SHA 見 [完整驗證索引](main03-integration-20261001-r1/validation-summary.json)。`gate`／`gate2` 型別解析失敗及 `main03-life-20261001-r1` 啟動失敗都保留：只因隔離依賴的 Vite／React／Vitest 解析與缺 Vite 命令包裝器，分別補既有套件副本與包裝器後用新證據名稱重驗；沒有安裝套件、修改 package 或刪原 raw。沒有建立或移除 junction，`C:\pfv7\node_modules` 及其目標未碰。

本輪 App：50 筆瀏覽器請求（42 成功、4 已收緊背景取消、4 完整串流後取消），固定 fetch 46、假 CLI 4 次／20 段／4 done。兩視窗各一筆預期取消 console、其他紅字 0。原始 ERR_ABORTED 保留；每筆背景取消都要求同網址在發起前已有腳本完成 200，每筆串流例外都要求完整五段與 done，不普遍忽略取消。12 個已記錄程序停止後殘留 0。既有 Preview 18/18 與原 03 撤回演練只算證據核對，本輪不新增平台部署。

## 固定九欄交接

1. **本票／狀態／來源與最終 commit：** 03 resolved；本輪 main 整合完成。來源結案 `5c93216`；候選 `49654f3`；main 合併 `1a9269f`；文件由包含本檔的來源分支精確提交固定。
2. **這次真正改變的等待來源、採用與未採用分支：** 採核准日常長駐／取消配置與清理修復；不再以未授權 production 阻擋本機 main。沒合整條來源分支；歷史身分只保留完整證據 checkout 用途；S1 不收理由照留。
3. **使用者可感知的 before→after：** 舊清理假成功改為失敗可復原；精確新 main 的原埠 life 8/8、App 28/28。歷史 2/8→8/8 屬原 03 證據核對，不當成本輪同母體 before。時間為本機固定資料診斷斷面，未宣稱真行情新的速度提升。
4. **各段時間與 browser／provider 請求數、重試、peak、快取：** App 50 browser／46 固定 fetch／4 假 CLI；逐步時間、trace／重試、快取記在 raw。這輪驗整合正確性，不重建舊效能比較或捏造 provider 真實時延。
5. **正確性、FX、沿用窗、取消／世代、P1／S1、本體五鍵：** 固定台／美／FX、庫存五鍵及 UI 四軸 PASS；沒有改錢的語意、真帳本或真 AI／行情。已接受分類與凍結失敗同列，世代／舊證據來源不混用。
6. **固定測試、真行情、正式 App、完整 gate、雙軸覆核各自結果：** 本輪假守衛37＋13、API取消5＋guard5、life8、terminal3、App28、gate838及兩軸均通過；真行情／AI未測；正式 production 未新增。
7. **證據入口、日常啟停／重跑命令、回復方式：** 本檔及 validation-summary／integration-result。在乾淨整合副本依 README-main-03 起停；所有重跑換新 run-id。撤回本次 main 範圍可在獨立乾淨 main checkout 執行 `git revert -m 1 1a9269fe781f4ae5e0d432d1c22b4c77d6cc3bcd`，本新合併命令未另演練；既有03精確撤回／恢復 PASS 照留。不要在髒來源工作區切換或回復。
8. **仍 OPEN 的具體原因、不可控下限與已嘗試措施：** 03／本輪 main 整合無剩餘技術阻擋。真上游、production 等價及 Windows 非原子空窗是已明列的驗證界線，非用來反覆重開03。全案其他票仍未完成。
9. **下一票名稱、前置是否滿足、下一個可直接執行動作：** 04 技術前置已滿足，但本輪沒有授權領取／執行；production 暫不新增。此階段停止，沒有待使用者重複確認的 main 整合動作。

## 提交後原始位元組核對

來源證據提交 `e8bc11765c309587b6eed728bbdee188177a144c` 的129檔均與工作檔逐位元組相同，結果見 `main03-integration-20261001-r1/postcommit-byte-check.json`。四份PowerShell守衛JSON保留原UTF-8 BOM／CRLF；本證據資料夾的局部 `.gitattributes` 只對這四檔禁止換行過濾，避免Windows Git誤顯修改或取回時改寫raw，沒有調整其他路徑或全域Git設定。main47檔及所有驗收固定點不變。