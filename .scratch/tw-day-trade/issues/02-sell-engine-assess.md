# 02 — 判定純函式與賣出引擎三態留痕

Status: resolved（2026-07-29；commit 97e0aed）
Blocked by: 01

- [x] `assessDayTrade` 七種 reason 代碼、固定優先序、不吃價格
- [x] `SellInput.isDayTrade` 三態；有效旗標＝夾制後的（覆寫 ?? 自動判定），夾制不拋錯
- [x] `RealizedTrade.isDayTrade` optional；台股一律留痕、美股不寫該欄位
- [x] 稅額改走費稅計算＋有效旗標；`SellResult` 形狀零變更
- [x] 備份 schema 版本常數零變更（`git diff` 對 portfolioBackup.ts 為空）
- [x] 對帳單匯入路徑零變更（重播引擎自建 trade 物件、從不呼叫賣出引擎與費稅公式 → 天然 `undefined`）
- [x] 新增 22 個案例、既有 12 案零修改（61/61 綠含票 01）
- [x] `npm run gate` 全綠
- [x] code-review：已併入票 04 的 main..HEAD 批次雙軸覆核（Spec 軸無發現；Standards 軸 1 筆 R-01 已修，commit 53e2871）

## 目標

賣出引擎模組新增 `assessDayTrade` 判定純函式（七種 reason 代碼、固定優先序、
**不吃價格**）；賣出輸入與已實現帳本各加 optional `isDayTrade`（三態）；
引擎按硬閘夾制後算稅並留痕。

## 規格依據

spec.md「判定純函式」「硬閘／軟閘」「賣出引擎整合」「資料模型」節；ADR-0003 決策 1／2。

## 範圍

做：
- `assessDayTrade(批次, 賣出股數, 賣出日期) → { eligible, reason }`
  - reason ∈ `eligible / not-tw-stock / etf-not-eligible / odd-lot-sell / odd-lot-holding / date-mismatch / no-buy-date`（代碼不含文案）。
  - 判準（全部成立才 eligible）：台股個股 ∧ 賣出股數 1000 整數倍 ∧
    持有股數 1000 整數倍 ∧ 該批買進日＝賣出日。
  - 優先序固定（硬閘先於軟閘）：`not-tw-stock` → `etf-not-eligible` →
    `odd-lot-sell` → `no-buy-date` → `date-mismatch` → `odd-lot-holding`。
- 賣出輸入 optional `isDayTrade`：`undefined`＝引擎自動判定；`true`／`false`＝覆寫。
  有效旗標＝**夾制後**的 `(input ?? 自動判定)`：硬閘（台股個股 ∧ 賣出整張）不過
  一律強制 `false`；**夾制不拋錯**。
- 已實現帳本型別加 optional `isDayTrade`；台股賣出一律記錄有效旗標（true/false），
  美股**不寫該欄位**（undefined）。
- 稅額改走「賣出費稅計算＋有效旗標」；已實現損益公式不變。

不做：
- `SellResult` 形狀變更（既有解構零影響）。
- UI（票 03）。
- 備份 schema 版本（**紅線：版本常數零變更**——optional 欄位是唯一合規擴充法）。
- 對帳單匯入路徑（產出一律 `undefined`，**不從稅額反推**）。

## 驗收

- 新增案例（既有零修改）：
  - `assessDayTrade` 七種 reason 各至少一案；優先序案例：零股賣出＋日期不符 → 回 `odd-lot-sell`。
  - 引擎整合：
    - `undefined`＋判定成立 → 稅減半＋`trade.isDayTrade === true`（手算對數）。
    - 軟閘覆寫：date-mismatch＋`true` → 減半＋記 `true`。
    - 硬閘夾制：odd-lot-sell＋`true` → 稅照一般＋記 `false`。
    - 覆寫 `false` → 一般稅＋記 `false`。
    - 美股賣出 → trade 上無 `isDayTrade` 欄位。
    - 同批同日分次整張賣兩筆 → 各自 `true`（首筆賣後剩餘股數仍為整張）。
- 備份模組 schema 版本常數零變更（diff 檢查）。
- `npm run gate` 全綠。
