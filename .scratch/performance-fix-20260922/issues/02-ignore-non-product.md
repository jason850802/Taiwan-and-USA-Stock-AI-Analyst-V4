# 02 — 隔離非產品目錄並驗證開發服務行為

Status: ready-for-human — E1／E2 對同期 clean 通過，但缺 E0 正式暖基準，50% 門檻仍 OPEN。
Blocked by: 01
Type: task

本檔為正式票據。依本案共同驗收手冊執行。

## 要交付的結果

用單變因量測判斷非產品工作區是否造成額外本機 Vercel／Vite 成本，只保留能被實測證明有效且不破壞開發更新的最小設定。

## 實作範圍

- 先以新啟動原工作區建立 E0，控制舊父程序因素。
- E1 只調整後端開發服務的非產品排除範圍，優先處理大量驗收證據；其他目錄先確認不是產品或執行依賴。
- E2 在 E1 上獨立調整前端 watcher 排除，確認寫入驗收證據不造成 App reload，而產品元件、樣式與設定仍正常更新。
- 比較 E0、E1、E2 與同期精簡對照；兩種設定的收益分開量，不把設定存在當成已生效。
- 需要 fixture 主動重載時，改成明確測試入口；排除 watcher 不等於停止提供測試資源。

## 驗收條件

- [ ] E0／E1／E2 各有兩次 actual independent service starts 與 formal OPTIONS raw；每 start 每 route 1 cold + >=5 matched interleaved warm pair、全 204，identity 符合共同手冊。
- [x] 能取得的 file-map／watch 證據與 reload 行為保存，因果敘述只到證據可支持的層級。
- [ ] 候選使用同期 formal clean reference 通過門檻；若 E0 相對 clean 重現慢速，E1／E2 相對 E0 的對應 route reduction 至少 50%。
- [x] 不以修改 TypeScript 或測試收錄範圍製造效能或測試數改善。
- [x] 完整 gate、雙軸覆核與本票回復方式完成。

## 邊界

不刪歷史證據，不重寫 runtime。若本票已達本機門檻，03 仍需以「不需實作」的證據狀態結案；若未達標，03 進入實作分支。

## Comments

2026-09-22：fresh E0 在未排除 `.scratch` 時，正確 Yahoo OPTIONS 後兩筆為 3.09／4.19 秒、前四筆於 20 秒探針逾時；FinMind 3.93～4.19 秒。量測寫入 evidence 時 Vite watcher 直接拋出 `EBUSY` 並結束 dev process。

2026-09-22：舊 E1 只加入 Vercel `.scratch` 排除，Vite watcher 維持原設定；Yahoo 1.25～1.66 秒、FinMind 1.24～1.36 秒，全 204。舊 E2 再加入 Vite watcher `.scratch` 排除；Yahoo 1.08～1.26 秒、FinMind 1.07～1.12 秒，全 204，且在 `.scratch` 持續寫入 evidence 時服務保持存活。這些舊樣本保留為方向證據，但 E1 沒有 frozen formal 兩-start/pair identity，不能單獨支撐 formal closure。

2026-09-23：formal v2 已準備同源單變因 runtime：E0/E1/E2 共用 frozen full root；E1 只變 `.vercelignore`，E2 再變 Vite watcher；同期 clean 使用同一 base manifest 的 lean root。因 E0 start-1 第一支 cold Yahoo OPTIONS 已 60 秒 timeout，依 fail-fast 規則停止整輪 protocol，沒有啟動 E1/E2 或產生 formal comparison。因此舊 `options-comparison-v1.json` 的 historical threshold-only clean 不再視為正式 reference，02 維持 OPEN。

2026-09-23：formal v6 的 E1、E2 與同期 clean 各有兩次獨立成功 start、來源／設定／工具身分與全 204 raw；Yahoo／FinMind warm 中位數 E1 為 `1945.51／1971.96 ms`、E2 為 `1804.07／1813.48 ms`，都低於 clean 門檻 `2469.91／2499.64 ms`。然而 E0 在 90 秒內未就緒，沒有兩次成功 start 或 warm 中位數，無法計算相對 E0 的 50% 下降率。候選對 clean 的門檻 PASS，本票整體仍 OPEN；詳 `evidence/02/formal-options-closure-review.md`。
