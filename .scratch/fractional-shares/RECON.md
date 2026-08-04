# 美股碎股支援——偵查紀錄（RECON，2026-08-04）

> 狀態：**已拍板（2026-08-04 四題四答）**，spec 與四張票已落地（同目錄 spec.md ＋ issues/01~04）；
> 邊界決策固化為 ADR-0004、詞彙進 CONTEXT.md「美股碎股」節。
> 本檔降級為偵查快照（精確原則，含行號，僅供加速定位）；**規格以 spec.md 為準**。

## 使用者回報的三個症狀

1. LITE 三批碎股（1.2048／1.08896／0.50824，合計 2.802 股）在庫存**群組列顯示成 3 股**；明細列正確。
2. 匯入對帳單時，**對帳單上賣出 LITE 2.8 股多的那筆出「系統錯誤」**，賣出沒被處理。
3. 希望把「部分美股標的可交易碎股」機制建進系統。

## 根因（皆已定位，含證據）

### A. 顯示層：股數格式化一律取整（症狀 1）

`fmt` 預設 0 位小數（`toLocaleString` 四捨五入）：

- `components/portfolio/HoldingsTable.tsx:23` — `fmt = (n, d = 0) => n.toLocaleString('zh-TW', …)`
- `components/portfolio/HoldingsTable.tsx:352` — 群組列 `fmt(totalShares)` → 2.802 顯示「3」（**截圖的 bug**）
- `components/portfolio/RealizedLedger.tsx:108` — 已實現帳本 `fmt(t.sharesSold)` → 碎股賣出顯示成整數
- `components/portfolio/ImportStatementModal.tsx:32,192` — 缺口列 `fmt(g.sharesMissing)` → 幻影缺口顯示「0」股
- `components/portfolio/SellModal.tsx:118` — `lot.totalShares.toLocaleString('zh-TW')` 無位數參數，預設最多 3 位 → 1.08896 顯示「1.089」

金額計算不受影響（群組列市值 $2,000.46 = 713.94 × 2.802 正確；聚合都用原始小數）。
明細列用 `EditableCell`（`HoldingsTable.tsx:34` `String(value)`＋`parseFloat`）→ 精確，與使用者觀察一致。

### B. 匯入重播引擎：浮點比較無容差（症狀 2 的真兇）

`utils/importReplay.ts:134-135`：

```ts
const poolShares = pool.reduce((s, l) => s + l.totalShares, 0);
if (poolShares < txn.shares) {   // ← 無 epsilon
```

實證（node）：`1.2048 + 1.08896 + 0.50824 === 2.8019999999999996`，比對帳單賣出的 `2.802` 少 `4.44e-16`
→ 誤判「池子不足」→ 產生 `sharesMissing ≈ 4.4e-16` 的**幻影缺口**（UI 顯示「賣出 0 股找不到買進紀錄」）
→ 使用者沒填成本 → **整筆賣出被略過**：庫存沒扣、已實現帳本沒記。

引擎其餘部分本來就是碎股安全的：切片迴圈 `remaining <= 1e-9`（:174）、清倉過濾 `> 1e-9`（:234）、
末筆吃餘數保證費稅總額守恆（:182-188）、`money()` 美股 round2。

### C. 機制面：資料模型早已支援碎股，缺的只是上面兩點＋兩個邊角

- `types.ts:163` — `ParsedTxn.shares: number; // 可為小數（美股碎股）`（Phase 11 就預留）
- `utils/statementParsers/cathay.ts:13-16` — `parseFloat`；`utils/statementParsers/parsers.test.ts:108,141` — Case G 碎股行為鎖已存在
- 新增表單 `usePortfolioForm.ts:41` `parseFloat`；明細編輯 `EditableCell` `parseFloat` → 手動輸入碎股本來就可以
- **不需要「哪些美股標的可碎股」白名單**——本 App 是記帳不是下單，對帳單即事實來源；美股一律允許小數即可
- 邊角 1：手動賣出 `utils/portfolioLedger.ts:99,107` — 超賣擋板與滿賣判定用**嚴格比較**
  （`sharesSold > lot.totalShares`／`===`）。「全部」鈕走 `String()`→`parseFloat` 精確往返所以能全賣，
  但手打接近值可能誤擋或留下 1e-16 塵埃批次
- 邊角 2：台股股數輸入無整數防呆（`parseFloat` 會收 0.5 股台股）——現狀如此，是否加防呆待拍板

### D. 復原路徑（使用者現有資料）

匯入確認時（`ImportStatementModal.tsx:93` → `App.tsx:184`）**全部** txn 的 dedupeKey 都寫入
`portfolio_import_log_v1`——**含被略過的賣出**。兩種可能狀態：

- 當時按了「確認匯入」→ LITE 賣出的 key 已被記成已匯入，修好引擎後**重匯同檔會被去重擋掉**
  → 需先從 import log 移除該 key（Edge Console snippet，使用者用 Edge 是既定做法）。
  流水 `portfolio_transactions_v1` 依 key 去重（`txnStore.ts:89-98 appendTxns`）→ 重匯不會重複記流水。
  註：該賣出 txn 已在流水中 → 歷史回推已把 LITE 視為清倉，與庫存（還留著三批）目前不一致，修復後歸一致。
- 當時取消了 → 什麼都沒寫，修好後直接重匯即可。

診斷 snippet（貼 Edge Console）判斷屬於哪種：
```js
const log = JSON.parse(localStorage.getItem('portfolio_import_log_v1') ?? '{}');
console.log('LITE 賣出鍵：', (log.keys ?? []).filter(k => k.includes('|LITE|sell|')));
const tx = JSON.parse(localStorage.getItem('portfolio_transactions_v1') ?? '{}');
console.log('LITE 流水：', (tx.txns ?? []).filter(t => t.symbol === 'LITE'));
```

## 修正計畫（票的雛形，拍板後 to-spec/to-tickets 正式化）

- **T1 引擎容差**：`SHARE_EPS = 1e-6` 進 importReplay 的缺口閘門（`txn.shares - poolShares > SHARE_EPS` 才算缺口）。
  依據：券商碎股最小單位 1e-5，浮點累積誤差 ~1e-13，1e-6 居中安全。
  TDD：新增 LITE 手算對數案例（三批＋賣 2.802 → 0 缺口、3 筆 trade、費稅總額守恆、lots 清空）；
  真缺口案例（池 1.0 賣 2.802 → gap ≈ 1.802）仍要報。**既有測試案例零修改（紅線）**。
- **T2 顯示統一**：新增 `fmtShares`（先 round 到 6 位吸浮點噪音、去尾零、千分位——2.8019999999999996→「2.802」、
  1.08896→「1.08896」、3→「3」、12,000→「12,000」），換掉 A 節四個顯示點＋單元測試。
- **T3 資料修復（使用者實機）**：診斷 snippet → 視結果（已記鍵→清鍵）→ 重匯對帳單 →
  驗證：LITE 三批消失、已實現帳本出現 2.802 賣出、歷史曲線與庫存一致。
- **T4（視拍板）**：手動賣出容差（滿賣判定與超賣擋板加 EPS，公式不動）；台股整數防呆。

## 拍板結果（2026-08-04，四題四答，全採建議案）

1. 股數顯示格式：**原值去尾零（最多 6 位）**。
2. 被略過交易的去重鍵：**維持現狀（確認即記鍵）＋一次性修復**（票 04 runbook）。
3. 手動賣出容差：**一併加**（滿賣＋超賣擋板＋clamp，公式不動）→ 票 03。
4. 台股整數防呆：**此輪不做**（範圍外）。
