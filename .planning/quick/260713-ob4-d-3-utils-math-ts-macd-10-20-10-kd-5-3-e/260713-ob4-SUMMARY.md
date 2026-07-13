---
phase: quick-260713-ob4
plan: 01
subsystem: testing
tags: [vitest, unit-tests, indicators, entry-filter, phase-d]
requires: []
provides:
  - "vitest 測試跑道（npm run test 一鍵全綠）"
  - "utils/math.ts 六個 export 的行為鎖（含 MACD 10,20,10／KD period=5 非標準參數）"
  - "utils/entryFilter.ts runEntryFilter 的 GO/WAIT/NO_GO 決策斷言＋停損雙軌欄位鎖"
affects: [package.json, package-lock.json]
tech-stack:
  added: ["vitest ~3.2.7 (devDependency)"]
  patterns: ["測試檔與受測檔同層（utils/*.test.ts）", "顯式 import vitest API（非 globals 模式，tsconfig 零改動）"]
key-files:
  created: [utils/math.test.ts, utils/entryFilter.test.ts]
  modified: [package.json, package-lock.json]
decisions:
  - "vitest 鎖 3.x（~3.2.7 鎖 minor）而非 latest 4.x——依 PLAN key fact 指定，peer/deps 相容 vite ^6"
  - "不需 vitest.config.ts：vitest 讀現有 vite.config.ts，預設 include 已涵蓋 utils/*.test.ts，environment=node 對純函式正確"
  - "測試雙層策略：解析案例（手算可驗）與黃金值回歸鎖（鎖現行行為）以 describe 區塊＋註解明確區分"
metrics:
  duration: ~25min
  completed: 2026-07-13
---

# Quick 260713-ob4: D-3 最小單元測試 Summary

**一句話**：vitest ~3.2.7 建立本專案首條測試跑道，32 個測試鎖住 math.ts 六個指標函式（含非標準參數 MACD 10,20,10／KD 5,3 的 warm-up 邊界＋預設參數等值斷言）與 runEntryFilter 的 GO/WAIT/NO_GO 三決策路徑＋停損雙軌欄位，受測本體與 tsconfig 零改動。

## 測試統計

| 檔案 | 案例數 | 解析案例 (a) | 黃金值鎖 (b) |
|---|---|---|---|
| utils/math.test.ts | 23 | 20 | 3 |
| utils/entryFilter.test.ts | 9 | 8 | 1 |
| **合計** | **32** | **28** | **4** |

### (a) 解析案例（手算可驗的已知輸入輸出）
- **SMA**（3）：長度不足全 null／常數序列／線性 [1..6]→[null,null,2,3,4,5]
- **EMA**（3）：長度不足／常數恆等／[1,2,3,4,5] period 3 手算（SMA 種子 2、k=0.5）
- **RSI**（3）：長度 < period+1 全 null／嚴格遞增自 idx14 起 100／嚴格遞減自 idx14 起 0
- **MACD**（4，鎖 10,20,10）：常數序列 ~0／**warm-up 邊界 macdLine[18]=null↔[19]≠null（slow=20）、signalLine[27]=null↔[28]≠null（validStart 19＋signal 10）**／線性遞增 warm-up 後恆正／**預設參數與 (10,20,10) 逐項相等、與 (12,26,9) 邊界與值皆不同**
- **Bollinger**（3）：長度不足／常數三線重合／[1,2,3,4] 手算 upper=2+2√(2/3)
- **KDJ**（4，鎖 period=5＋1/3,2/3 平滑）：常數全程 50／**idx0..3 維持初始 50（loop 自 period-1=4 起）**／遞增序列手算 K[4]=200/3、D[4]=500/9、J[4]=3K−2D＋K 單調遞增＋K/D∈[0,100]／**預設 period 與 5 相等、與 9 不同**
- **runEntryFilter**（8）：GO fixture（16 根合成多頭，decision/entryPattern/confidence=90/trend/preceptHits 空/stopPrice=114.95/軌二 MA20=110）＋guardLevel='MA5' 換軌（116／短線MA5）＋WAIT（去攻擊量→SOP 5/6、皆不符、confidence<90）＋NO_GO（嚴格遞減→資料不足、confidence≤30）

**GO fixture 實跑結果與 PLAN 推導鏈完全一致，零微調。**

### (b) 黃金值回歸鎖（值取自現行實作，非獨立推導——只鎖行為防改壞）
- MACD LCG(seed 42, n=60)：macdLine[59]=0.3429522172797874、signalLine[59]=−0.011506701317399247、histogram[59]=0.35445891859718665（toBeCloseTo, 8）
- KDJ 同序列（close±1 造 highs/lows）：K[59]=58.37497993493505、D[59]=58.48109504960816、J[59]=58.16274970558882
- RSI 常數序列怪行為鎖（見下方疑似 bug）
- entryFilter GO fixture 六步驟 status 快照 `['pass'×6]`＋sop 全 ok（檔內註明黃金值鎖）

## 驗證結果（D-3 完整驗收）

| 驗證 | 結果 |
|---|---|
| `npm run test` | ✅ 2 files, 32 tests, 32 passed |
| `npx tsc --noEmit` | ✅ 綠（tsconfig 零改動，顯式 import vitest API） |
| `npm run build` | ✅ built in 4.45s |
| `grep -r "AIza" dist/` | ✅ 無結果 |
| `grep -rl "vitest" dist/`／`grep -rl "describe(" dist/` | ✅ 皆無結果（測試不進 bundle） |
| `git diff HEAD~1 --stat` | ✅ 恰 4 檔（package.json/package-lock.json/兩 test 檔）；math.ts/entryFilter.ts 零改動 |

供應鏈驗證（T-ob4-SC）：`npm view vitest` 確認精確名 `vitest`、repository=github.com/vitest-dev/vitest、latest 3.x=3.2.7、其 `dependencies.vite='^5.0.0 || ^6.0.0 || ^7.0.0-0'` 相容本專案 vite@^6.2.0。

## 發現但不修（疑似 bug 清單——本包紅線：不改受測本體）

1. **`calculateRSI` 常數序列 NaN**（utils/math.ts:59）：初始窗 gains=losses=0 → `avgGain/avgLoss = 0/0 = NaN` → `rsiArray[period]=NaN`；其後走 `avgLoss===0` 分支恆為 100。數學上常數序列 RSI 慣例為 50 或未定義，現行「NaN 後跳 100」是實作副作用。已用黃金值測試鎖住此行為（math.test.ts 黃金值區塊）。
2. **`calculateRSI` 把 diff===0 計入 gain 側**（utils/math.ts:52，`if (diff >= 0)`）：初始平均窗將零變動視為 gain（雖加 0 不影響總和，但與後續迴圈 `diff > 0` 的判準不一致）；風格不一致，實際數值無影響。
3. **`calculateKDJ` 註解與參數不符**（utils/math.ts:142）：註解寫「KDJ (5, 3, 3)」，實作是 period=5＋固定 1/3,2/3 平滑（等效 K,D 平滑=3），註解本身無誤導性 bug，僅提醒改參數時勿只看註解。

## Deviations from Plan

None — plan executed exactly as written（GO fixture 零微調、無需 vitest.config.ts、tsconfig 零改動）。

## 產出

- Commit `6ed7713`：`test(phase-d): D-3 最小單元測試——vitest 跑道＋math/entryFilter 行為鎖（MACD 10,20,10／KD 5,3）`
  - utils/math.test.ts（235 行）、utils/entryFilter.test.ts（111 行）、package.json（+test script、+vitest ~3.2.7）、package-lock.json
- 本 SUMMARY 依 PLAN 指示不 commit。

## Self-Check: PASSED

- utils/math.test.ts：FOUND
- utils/entryFilter.test.ts：FOUND
- commit 6ed7713：FOUND（4 files, 800 insertions）
- npm run test／tsc／build／AIza 四驗證：全綠
