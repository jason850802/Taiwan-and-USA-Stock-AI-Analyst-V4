# 03 獨立 Standards＋Spec 覆核

固定點：`6a7b029`。兩位未參與實作的覆核者分別檢查 Standards 與 Spec；03 票的首輪提交為 `bbf8610`，後續修訂仍歸在同一票的提交內。

## 首輪發現與處置

| 軸 | 發現 | 處置與重驗 |
|---|---|---|
| Spec | 只有 chart fetch 接到取消；唯一請求在共享 cookie／crumb 握手期間斷線仍留上游工作 | 握手以等待者計數，最後一位取消才中止；單人 cookie 取消 `chart03-cookie-20260924-r2` PASS，共享取消 `chart03-shared-cookie-20260924-r2` PASS，chart `chart03-final-20260924-r3` PASS |
| Spec | 前端程序由全部 `process.env` 黑名單刪除部分金鑰，未知後端密鑰仍可能進入 Vite 程序 | 改為必要系統變數與公開 `VITE_` 白名單，加上 `PERF03_API_ORIGIN`；修訂後啟動、五路由預熱與代理固定成本 `daily03-cost-20260924-r3` PASS |
| Spec | 控制管道失聯的舊狀態可能被改名，若在新埠重啟會失去仍在跑的舊服務記錄 | 檢查舊 listener、監督程序及已記錄子程序身分；任一仍在即拒絕另起。`stale03-20260924-r1` PASS，舊 listener 與 state 保留 |
| Spec | 規格的取消契約涉及每個正式路由；原修正只驗 chart 與串流 | Yahoo search、FinMind 假上游斷線後均 `AbortError`，非串流假 CLI 被 kill，Gemini API 用假 SDK 驗中止訊號；串流 SDK 分支斷線後靜默收尾。見 `route03-*` 與 827 項隔離測試 |
| Standards | 票面 `resolved`，REPORT 卻寫覆核與提交後才可結案；HANDOFF 指向未存在的覆核結果 | REPORT 改為同一狀態，新增本覆核紀錄並由 README／HANDOFF 連結 |
| Standards | 固定成本 raw 只有入口埠與來源雜湊，無法單靠該檔綁定實際受測程序 | `daily03-cost-20260924-r4` 在測量前後讀取同一輪狀態，記錄監督程序、子程序 PID／建立時間及同一狀態判定；不記錄 token |
| Spec | chart／search／FinMind／Gemini 非串流在 `applyGuards` 返回後才註冊取消；限流等待時斷線仍可能開始上游工作 | 五路由在 guard 前註冊／檢查中止，guard 後再檢查；LF 最終來源 `guard03-20260924-r2` 以延遲假限流重現斷線，5/5 無後續上游。最終來源的 chart／握手／search／FinMind／Gemini 取消皆重新執行 |
| Standards／Spec | FinMind 與 Yahoo search 的實體 CRLF 換行被 Git 的 `eol=lf` 正規化，raw 的來源 SHA 與 index 原始位元組不符 | 兩檔轉成 LF，以 `git hash-object --no-filters` 對照全部十一檔 index 皆一致；以新 run-id 重跑 guard、兩路由取消、完整 gate 與全路由重載。先前 run 保留歷史，不作最終來源 PASS |

## 修訂後驗證

- 隔離 `C:/pfv7` 十一個候選產品／測試檔與主工作樹實體 SHA-256 逐檔一致；所有 skip-worktree 修訂將用精確 blob 寫入 index，逐檔核對。
- `reload03-allroutes-20260924-r8` 的 B1／C 十步重載矩陣 `diffs=[]`、`problems=[]`，`productClean=true`、`testFilesRemoved=true`，隔離測試檔還原；`r4` 因來源在執行中變更而判紅，不採用，`r7` 屬換行正規化前來源。
- 隔離完整 `npm.cmd run gate -- --require-env`：tsc 0 錯、Vitest 827/827、build 成功、金鑰掃描乾淨、package／lock 無差異。
- 最終來源的日常同源固定成本 `daily03-cost-20260924-r5`：OPTIONS／GET 各 20/20 成功，中位 15.364／61.766 ms；owned PID 前後相同，停止後兩埠沒有 listener。

## 定稿覆核

獨立 Standards／Spec 覆核先後指出取消涵蓋、限流時序與換行來源身分缺口；各缺口已按上表修正。Standards 覆核者核對 `guard03-20260924-r2` 的五條來源雜湊與 5/5 結果、十一檔實體／index 原始位元組一致；Spec 覆核者檢查最終程式路徑時指出舊 guard run 的來源身分缺口。最後的 `reload03-allroutes-20260924-r8`、兩路由 `r3` 取消、完整 gate 與文件一致性由執行者補驗，因覆核代理額度中斷，沒有取得獨立覆核者對這些最後增量的額外簽核。沒有把此限制寫成獨立最終簽核；原始證據與來源可重跑。
