# 03 處置增量獨立雙軸覆核（2026-09-29）

依 `code-review` skill 由未參與實作的 Standards／Spec 兩位覆核者分開只讀審查，非執行者自評。起點 `db4e620`，第一固定點 `90fcbc2`，修正後固定點 `1221b52`。六支工具的圖譜覆蓋皆為 excluded／not_tracked（`.scratch` 刻意排除），改直接讀差異及原始碼；沒有以圖譜無結果推論無問題。

## Standards

`db4e620...90fcbc2` 與 `90fcbc2..1221b52`：硬性規範違反 0，重要 smell 0。程序守衛保留啟動器與驗收端兩份實作有獨立驗證用途；S1 清單集中已有不收理由，未重複提案。規範依據為 CORE_RULES.md 的窄範圍／繁中／風格規則及 gate／runtime 分別驗證。

覆核者核對 gate03-review-20260929-r1／r2 的 829/829、五道 gate、exit 0，及 28 檔 source manifest；未把 gate 當 runtime 通過。

## Spec

第一固定點 1 條應修：背景分類使用 `finishedAtMs <= startedAtMs`，相同時刻不能證明「在本筆開始前」。覆核者純假資料重播確認誤收。`1221b52` 已改嚴格 `<`，補同時刻拒絕案例；覆核者再查確認 `ok:false`，此條關閉。

其餘 P3、P2、S2、P1／P4／P5 文件與 S1 不收未見確定缺漏。停止回覆修正也已覆核：原本立即同步清理可能阻塞控制連線 FIN，改為控制連線 close 後才清理；保留停止後空埠及狀態檢查。

## 本輪紅綠燈與證據邊界

- 守衛先紅：`guard03-stream-red-20260929-r1/raw.json`，新限定條件的 12 個負向案例在舊判定下紅燈；舊期望未改。
- 守衛綠：`guard03-stream-20260929-r1` 32/32；加嚴格背景先後後 r2 為 33/33。
- 原埠生命週期 r1：`life03-localhost3000-20260929-r1/raw.json`，2/8；六項停止客戶端約 3 秒誤報失聯，最終空埠／清理檢查無殘留。保留原始失敗。
- 修正後 r2：`life03-localhost3000-20260929-r2/raw.json`，8/8，外部用戶端 0、清理殘留 0、結尾空埠與狀態不存在。工具固定 `1221b52`，28 檔 run 前後雜湊無漂移。

## 平台工具預審（未提交階段）

兩位覆核者另讀 platform-03.mjs／platform-fixture-03.cjs。Standards 未見硬性違規或重要 smell；Spec 找到假 CLI 的 `trace:null` 蓋掉請求 trace，已修為明傳 trace、固定欄位最後組裝；純假資料 `platform-fixture-check-20260929-r1.json` 驗證 spawn／kill 同 trace，未起真程序。

Spec 以記憶體 esbuild 包核對五路由皆先初始化 fixture 再初始化 handler，未見既有路徑漏到真 AI／真行情。Preview 注入停用真 Upstash／shared secret，maxDuration 30 與原串流 200 不同；因此只能列「原 handler＋受控注入的平台觀察」，不能冒稱正式設定／全部契約等價。非串流 POST 依預審提醒補進後續探針。

整票仍 **OPEN**；此文件不替尚未完成的 App／平台實測預先給 PASS，04 不解鎖。後續結果另增補，不改寫上述固定點結論。

## 最終 Standards 與平台增量

Standards 最終範圍 db4e620..6b14769：硬性違規 0、重要 smell 0；獨立核對 gate r3/r4/r5 均 829/829、exit 0，177 檔隔離來源一致，平台五支工具 byte match。15 個平台來源僅 ratelimit.ts 為已明列換行差異。Spec 對 CRLF 容許與公開模型名稱排除無新增發現。平台 r3 已部署；其取消未通過，詳見最新處置增補，不能以此 Standards 結論代替平台 PASS。

Spec 最終平台補審：獨立重組 r3 的 12 組 logs／74 事件／12 trace，核對五工具 SHA、15 來源及五包 SHA。末筆只收到第一段即取消，伺服器仍五段＋done，無 request-aborted／fakeCli.kill，close.finished=true；與 cancellation-analysis 完全一致。此筆不適用「完整交付後取消」例外，平台取消 FAIL，03 OPEN／04 鎖定。reviewer 未重跑請求或部署。
