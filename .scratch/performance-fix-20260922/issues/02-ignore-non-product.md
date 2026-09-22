# 02 — 隔離非產品目錄並驗證開發服務行為

Status: resolved
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

- [x] E0／E1／E2 各有獨立服務身分與 OPTIONS raw，協定與樣本數符合共同手冊。
- [x] 能取得的 file-map／watch 證據與 reload 行為保存，因果敘述只到證據可支持的層級。
- [x] 候選達 OPTIONS 門檻，且必要 API 路由與前端開發更新正常；若只改善 reload 而 OPTIONS 仍慢，照實記錄。
- [x] 不以修改 TypeScript 或測試收錄範圍製造效能或測試數改善。
- [x] 完整 gate、雙軸覆核與本票回復方式完成。

## 邊界

不刪歷史證據，不重寫 runtime。若本票已達本機門檻，03 仍需以「不需實作」的證據狀態結案；若未達標，03 進入實作分支。

## Comments

2026-09-22：fresh E0 在未排除 `.scratch` 時，正確 Yahoo OPTIONS 後兩筆為 3.09／4.19 秒、前四筆於 20 秒探針逾時；FinMind 3.93～4.19 秒。量測寫入 evidence 時 Vite watcher 直接拋出 `EBUSY` 並結束 dev process。

2026-09-22：E1 只加入 Vercel `.scratch` 排除，Vite watcher 維持原設定；Yahoo 1.25～1.66 秒、FinMind 1.24～1.36 秒，全 204。E2 再加入 Vite watcher `.scratch` 排除；Yahoo 1.08～1.26 秒、FinMind 1.07～1.12 秒，全 204，且在 `.scratch` 持續寫入 evidence 時服務保持存活。產品 `.ts/.tsx` 變更仍可由同一 dev server 即時反映到 browser fixture。未修改 TypeScript／Vitest 收錄範圍；`.scratch` 歷史測試重複仍保留。
