# Formal OPTIONS closure review

2026-09-23 覆核 01／02／03 的 formal OPTIONS 證據。此檔只整理本輪量測與仍缺的 provenance，不取代 raw。

## 正式輸入

- E0：`evidence/01/formal-e0-v1/merged.json`，2 個 `serviceStartId`、24 rows；每個 start 每條 route 都有 cold 1 筆與 warm 5 筆，warm pairId 在 Yahoo／FinMind 完整配對，全 204。
- E2：`evidence/02/formal-e2-v1/merged.json`，2 個 `serviceStartId`、24 rows；格式同上，全 204。
- clean：`evidence/02/formal-clean-v1/merged.json`，由 `clean-start-1` 與 `clean-start-2b` 合併，2 個 starts、24 rows；格式同上，全 204。
- `clean-start-2b` 的有效 raw 為 `evidence/02/formal-clean-v1/start-2b.json`；runtime 身分為 `start-2b.runtime.json`。
- 先前 3011 的 `start-2` 啟動因直接以 Node 啟 Vercel 時子程序找不到 `vite` 而退出，未進正式 HTTP capture；stdout/stderr 與 launcher PID 原樣保留，不納入 merged reference。

## 正式比較

使用最新版 `tools/compare-options.mjs` 的預設 `formal` 模式，輸出為 `evidence/02/formal-options-comparison-v2.json`。比較器結果 `pass=true`、`failures=[]`。

| Route | E0 warm median | E2 warm median | clean warm median | E2 相對 E0 | clean 門檻 | 結果 |
|---|---:|---:|---:|---:|---:|---|
| `/api/yahoo/chart` | 3260.59 ms | 1166.27 ms | 1460.28 ms | -64.23% | 2075.35 ms | PASS |
| `/api/finmind` | 3331.42 ms | 1140.98 ms | 1454.44 ms | -65.75% | 2068.05 ms | PASS |

`overall` 只保留摘要，不形成額外 gate。

## Formal review finding

效能與樣本契約已通過，但目前仍不能宣稱 01／02／03 formal finding 為 OPEN 0。PLAN 共用量測協定要求正式 run 保存實際 serve 身分、PID、port、來源身分、工具雜湊、Node／Vercel 等資訊；現有 `formal-e0-v1` 與 `formal-e2-v1` 目錄只有 start raw 與 merged JSON，未找到可綁定 `e0-start-1/2`、`e2-start-1/2` 的 per-start runtime manifest；`clean-start-1` 亦只有 raw。全域搜尋目前只找到本輪 `clean-start-2b` 的 runtime manifest。

因此本輪結論是：**formal comparator 與效能門檻 PASS；per-start provenance 仍 OPEN。** 若無法以當時保存的原始資料補足這些執行身分，需重新做具完整 runtime identity 的 formal starts，不能事後用目前程序身分回填舊 run。

## 2026-09-23 v6 更新與結案判定

`formal-options-v6-20260923` 凍結同一來源與設定，E1／E2／clean 各有兩次獨立 start、每 start 每路由 cold 1 筆及交錯 warm 5 對，validator 均 PASS；owned PID 與 listener PID、port、來源／設定／工具雜湊可核對。這取代 v1／v2 的 provenance 缺口，但只適用於 E1／E2／clean。E0 start-1 的 Vercel 90 秒內沒有 `Ready!`，留下 status 與 log 後依 fail-fast 停止，start-2 未執行，沒有合格 OPTIONS raw。

| 路由 | clean warm 中位數 | clean 門檻 | E1 warm 中位數 | E2 warm 中位數 | 候選對 clean |
|---|---:|---:|---:|---:|---|
| Yahoo chart | 1775.93 ms | 2469.91 ms | 1945.51 ms | 1804.07 ms | E1／E2 均 PASS |
| FinMind | 1799.71 ms | 2499.64 ms | 1971.96 ms | 1813.48 ms | E1／E2 均 PASS |

`comparison-e1-vs-clean.json` 與 `comparison-e2-vs-clean.json` 的 `--before` 使用候選自身，只取 `referencePass`。其 `slowReproduced=false`、`reductionPass=true` **不代表** E0 已重現可計算的 50% 改善。E0 的啟動逾時可記為嚴重本機失敗，但不是兩次成功 start、每路由全 204 暖樣本，也不能算出 E0 warm 中位數或 E1／E2 相對 E0 的下降率。依原凍結驗收條件，01／02／03 保持 OPEN；03 的「不需實作」分支尚未形式上成立。這個判斷保留 E1／E2 已接近 clean 的正面觀察，也不把 90 秒逾時改寫成 50% PASS。
