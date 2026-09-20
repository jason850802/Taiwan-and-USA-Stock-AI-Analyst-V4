# 12 最終整合驗收

狀態：**已完成 — 2026-09-21**。功能、效能、最終封存及獨立Standards／Spec覆核均完成，兩軸OPEN 0／NEW 0。正式結案見 [12正式票](../../issues/12-final-acceptance.md)。

## 來源與範圍

固定比較點為第01票 `ade5dca1e7106c90430efc35b50ba4adaaae8b42`；05～11最終提交已完成。第12票相對11唯一產品修正是批次健檢移除／重加的結果失效，沒有金融語意改動，見 [修正說明](health-review-fix.md)。

所有原始樣本綁定實際來源／工具／建置指紋；`precheck-health-review/` 是健檢修正前的59功能＋21排程前版樣本，`precheck-queue-source/` 是誤漏baseline啟動旗標的排程工具診斷，均不計最終通過。

`precheck-stream-tag/` 保留正式表單健檢回歸的測試標記診斷：假站會移除底線，已改用可保留的連字號標記，完整串流組按新工具指紋重新收集。產品未因這項測試名稱修正而改動。

`precheck-stream-manifest/`及`precheck-cache-manifest/`保存來源清單漏列config的診斷樣本。12的串流、快取正式App與鍵盤轉接改用94個可達產品加vite建置設定的精確95檔集合，逐檔核對並綁定新runId；不能以同為94檔的不同集合冒充完整來源，也沒有替舊結果補蓋hash。快取14頁實際編譯探針不受App清單變動影響。

## 重跑入口

先在根目錄執行 `node .scratch/optimization-followup/evidence/check.mjs 12 gate`，再逐一使用下列隔離假站。每次完成後停止自己的程序；不要覆寫02～11歷史結果。

| 驗證組 | 啟動命令（相對evidence根目錄） | 頁面／收斂驗證 |
|---|---|---|
| 基本面／K線／庫存 | `node 12/replay-server.mjs 02`，接續03、04 | `/viewport?size=desktop或narrow&path=編碼後路徑`；`12/verify-replays.mjs` |
| 排程前版 | `node 12/replay-server.mjs 05 --baseline` | `/harness?suite=before&n=1&sample=0&matrix=1`；前版本必須同時有CLI旗標，不能只改頁面名稱 |
| 排程後版 | `node 12/replay-server.mjs 05` | `suite=after`矩陣；`suite=green&n=30&scenario=overlap&behaviors=1`；兩尺寸正式App；`12/summarize-queue.mjs` |
| 快取profile | `node 08/profile-server.mjs 12` | 4180 `/?n=30&sample=0&auto=1`；`08/summarize.mjs 12` |
| 快取正式App | `node 12/cache-app-server.mjs 12` | 4181 `/?case=pressure&auto=1`；`12/verify-cache.mjs` |
| 串流profile與正式App | `node 12/stream-server.mjs 12` | 4182 `/profile?version=before&sample=0&auto=1&pipeline=1`；`09/summarize.mjs 12` |
| 兩尺寸串流 | 同上 | `/viewport?size=desktop或narrow&path=%2F%3Fedge%3Dempty%26auto%3D1%26pipeline%3D1`；全文後import `/__12-stream-layout.mjs`並呼叫`captureLayout()` |
| 正式持股移除／重加 | 同上，兩尺寸新的`/`App頁面 | import `/__12-health-app.js`並呼叫`run()`；`12/verify-stream-ui.mjs` |
| 原生鍵盤 | `node 12/keyboard-server.mjs 12` | 4183 `/viewport?size=desktop&page=harness`，依`10/native-plan.mjs`逐步用Desktop原生按鍵執行；`12/verify-keyboard.mjs` |
| 封存 | 各組全部結束 | `12/audit-lineage.mjs`、`12/seal-results.mjs`；產品與工具有後改時先重做受影響矩陣 |

表內命令的工作目錄是 `.scratch/optimization-followup/evidence/`；亦可在專案根目錄補完整相對路徑。各站只綁loopback，未知API及真實AI拒絕；只操作專屬origin的合成資料。

## 統計口徑

效能sample0列冷頁面、sample1排除暖機、sample2～6五次取中位數及最差值。排程before為第04票完成、05排程前的固定來源，不冒充01所有產品的相同起點。快取before保留第07票同資料集歷史原始樣本並明確標示；串流採相同development React.Profiler與100KiB／1000片段，不能推論為正式環境或真實網路收益。

純hook宿主、正式Vite App、Profiler與原生鍵盤分開計數。1440×900與390×844為桌面瀏覽器中真正的iframe內部viewport，並非手機硬體或螢幕閱讀器。正常情境捕捉例外／console.error為0才通過；故障注入的HTTP503與既有Recharts warning分開列出。

最後鍵盤組為15案、140次可信原生按鍵。`keyboard/native-narrow-scroll-precheck.json`保存工具未指定子頁控制時，Control+End只捲動外層的診斷；依當時snapshot的子頁「指標」控制DOM ref重新派送原生Home／End／Home，子頁實測0→1128.8→0，記入`green-narrow-scroll.json`，未用JavaScript修改子頁scroll值。背景點擊先取得當前viewport screenshotId再派送座標；未修改10的歷史plan或產品。

最終結論、數據、未做範圍及回復方法已記入 [最終報告](../../../../docs/optimization-final.md)；[覆核紀錄](code-review.md)保留產品初審、方法預檢與最終封存的不同階段。

## Git環境紀錄

建立供審候選`c86d7f7`時，Git自動維護回報`could not write multi-pack-index: Permission denied`及geometric-repack失敗；提交本身exit 0且完整SHA可解析，工作區乾淨、01至候選的父鏈可讀。另以`git -c core.commitGraph=false -c core.multiPackIndex=false fsck --connectivity-only --no-dangling HEAD`唯讀檢查通過。未改Git全域設定、權限或清理既有pack；自動維護問題與產品驗收分開記錄。

## 中斷後恢復核對

恢復時HEAD為`c86d7f7c703782eef3a51151c4b1e2feb49c27dc`，唯一未提交內容是上述Git環境註記。來源及建置沒有漂移，最後完整gate及原始實驗仍對應目前候選，沒有重新執行已完成的量測或覆寫原始封存。

[恢復核對](resume-verification.json)重新計算94個產品來源、24個封存摘要及193個原始檔SHA，另核21個排程前版樣本，合計214份結果。69個正式App／鍵盤／版面結果的95檔精確來源集合、runId及工具指紋再核一致；42份01原始測試／snapshot的bytes不變。51份本票原有測試／snapshot／依賴亦通過既有`check.mjs 12 verify`。

[Git連通性核對](git-connectivity-resume.json)再次通過且不改持久設定；4175～4183的測試listener數為0。這些紀錄是既有證據完整性檢查，不算新增瀏覽器案例或效能樣本。
