# OPTIONS formal v2 — 02 / E1 + E2

狀態：**BLOCKED / OPEN。**

本輪已建立 `setup-reference.json`，指向 01 v2 的同一份 source manifest、scratch layout 與 E0/E1/E2/clean config identity。E1 僅變更 Vercel `.scratch` ignore；E2 在 E1 上再加入 Vite watcher `.scratch` ignore，三者預定共用同一個 full runtime，避免非產品 payload 漂移。

但 E0 start-1 的第一支 cold `/api/yahoo/chart` 已在 60,018.5263 ms timeout，formal protocol 依 fail-fast 規則停止。因此本輪沒有啟動 E1／E2，也沒有產生兩-start merged raw 或 formal comparison；不得沿用舊 E1 單批資料或歷史 clean 來填補。

02 與條件式 03 仍為 OPEN：需要下一個**新的** formal protocol/run-id，在服務可正常完成 cold OPTIONS 的前提下，重新取得 E0、同期 clean、E1、E2 各至少兩次 independent starts，才可重新判定 slow-reproduced、clean threshold、>=50% reduction 與 03 no-op 分支。

本輪沒有產生 `comparison-e1.json` 或 `comparison-e2.json`，這是刻意的：E0 formal 已 fail-fast，後續 candidate/reference comparison 不具 frozen protocol 所需輸入，不能用舊 raw 補齊。
