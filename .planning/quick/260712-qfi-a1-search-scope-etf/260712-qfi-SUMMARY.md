---
phase: 260712-qfi-a1-search-scope-etf
plan: 01
subsystem: search
tags: [stock-search, yahoo-finance, finmind, filtering]
requires: []
provides:
  - "mapYahooQuote：Yahoo quote → StockDirEntry 純過濾映射（EQUITY/ETF＋市場白名單）"
  - "isSearchableTaiwanEntry：台股名錄個股/ETF 過濾 predicate（type＋industry 黑名單＋代碼型態）"
  - "searchStocks 合併結果收斂 15 筆"
affects: [components/StockSearch.tsx 搜尋建議清單]
tech-stack:
  added: []
  patterns: ["過濾邏輯抽成 exported 純函式，可用 npx tsx 離線斷言"]
key-files:
  created: []
  modified:
    - services/stockDirectory.ts
    - components/StockSearch.tsx
key-decisions:
  - "OTHER 市場改為丟棄而非標示：Market 型別收斂為 'TW'|'US'，港/日/韓標的不再以「海外」badge 混入"
  - "DR 排除必須靠 industry 黑名單而非代碼型態：實抓發現 4 碼 DR 特例（9110 越南控-DR、9106 新焦點-DR）"
  - "特別股（2888A 等 4碼+字母，40 檔）依 §A1 代碼型態白名單一併丟棄——非 4 碼純數字個股也非 ETF"
  - "不 bump LS_KEY：過濾放在 searchTaiwan 搜尋時，新舊 localStorage 快取一體生效"
metrics:
  duration: "6 min"
  completed: "2026-07-12"
---

# Quick Task 260712-qfi: A1 搜尋限縮（美股＋台股、個股＋ETF）Summary

搜尋結果限縮為美股＋台股的個股與 ETF：移除 isYahooFinance 旁路、雙市場白名單、FinMind 名錄過濾（依 API 實測值域）、合併結果收斂 15 筆。

## 變更內容（§A1 改法 1-4 全數落地）

### Task 1 — searchYahoo 白名單收斂＋Market 型別收斂（commit e4068c4）

- `services/stockDirectory.ts`：
  - `Market` 型別 `'TW' | 'US' | 'OTHER'` → `'TW' | 'US'`。
  - 新增 exported 純函式 `mapYahooQuote(x): StockDirEntry | null`：
    - quoteType 嚴格限定 `EQUITY`/`ETF`，**移除 `|| x.isYahooFinance` 旁路**（期貨/選擇權/指數/匯率/加密該欄位皆 true，是混入根因）。
    - 市場白名單：`.TW`/`.TWO` 後綴 → TW；`exchange ∈ {NMS, NYQ, NGM, NCM, ASE, PCX, BTS}` → US（比原本多 NGM/NCM/BTS）；兩者皆非 → **null 丟棄**（不再歸 OTHER）。
  - `searchYahoo` 改為 `quotes.map(mapYahooQuote).filter(e => e !== null)`；URL/headers/錯誤處理不動。
- `components/StockSearch.tsx`：刪除 marketBadge 的 OTHER「海外」條目（tsc excess property check 強制同步，無其他 OTHER 殘留）。

### Task 2 — searchTaiwan 名錄過濾＋合併收斂（commit d32aa7b）

- 新增 exported 純函式 `isSearchableTaiwanEntry(e): boolean`（規則依實測值域，見下）。
- `searchTaiwan` 主迴圈開頭 `if (!isSearchableTaiwanEntry(e)) continue;`；名錄建置與快取邏輯（ensureTaiwanDirectory）完全未動，**不需 bump LS_KEY**（舊快取已含 type/industry 欄位，搜尋時過濾一體生效）。
- `searchStocks`：`searchTaiwan(dir, q, 20)` → 15；`merged.slice(0, 24)` → `slice(0, 15)`；hasCJK 中文短路（0 網路請求）與去重邏輯、searchYahoo limit 8 皆不動。

## 值域偵查結果（FinMind TaiwanStockInfo，2026-07-12 實抓，HTTP 200 一次成功）

原始 4277 筆，去重（首見 stock_id）3116 筆。

**distinct `type`（3 值）**：`twse` 2380、`tpex` 1368、`emerging` 529（興櫃→排除）。

**distinct `industry_category`（57 值）**，其中非個股非 ETF 類別（黑名單依據）：

| 值 | 筆數 | 內容（實抓樣本） | 處置 |
|---|---|---|---|
| 所有證券 | 36 | 權證（711140 旺矽凱基9B購01、73107P 等 6 碼） | 黑名單排除 |
| 存託憑證 | 36 | DR——91 開頭 6 碼（910708 恒大健-DR）**＋4 碼特例（9110 越南控-DR、9106 新焦點-DR）** | 黑名單排除（代碼型態擋不住 4 碼特例，必須列黑名單） |
| Index | 30 | 類股指數（OtherElectronic 等非數字代碼） | 黑名單排除 |
| 大盤 | 2 | TAIEX 加權指數、TPEx 櫃買指數 | 黑名單排除 |
| ETN | 28 | 020 開頭（020008 元大特股高息N、02001S） | 黑名單排除 |
| 指數投資證券(ETN) | 20 | tpex 的 ETN 標籤（020017 永豐富櫃200N） | 黑名單排除 |
| 受益證券 | 8 | 01 開頭帶 T（01004T 土銀富邦R2） | 黑名單排除 |

**ETF 類 industry 標籤（3 值，twse/tpex 標籤不同）**：`ETF`（twse 263）、`上櫃ETF`（tpex 121）、`上櫃指數股票型基金(ETF)`（tpex 125）——**509 檔全數符合 `^00\d{2,4}[A-Z]?$`**（不符 0 筆）。

**創新板股票/創新版股票（33＋21）**：真個股（6869 雲豹能源-創等，4 碼純數字）→ 由 4 碼規則保留。

## 最終過濾規則（isSearchableTaiwanEntry）

1. `type` 必須 ∈ {twse, tpex}（排除興櫃 emerging 529 筆）。
2. industry 黑名單：{所有證券, 存託憑證, Index, 大盤, ETN, 指數投資證券(ETN), 受益證券} → 排除。
3. 代碼型態白名單：
   - `^\d{4}$` 4 碼純數字 → 個股保留（含創新板；4 碼 DR 已被規則 2 擋下）。
   - `^00\d{2,4}[A-Z]?$` 且 industry 屬 ETF 類 → ETF 保留（覆蓋 0050、債券型 00679B、槓反型 00632R、上櫃 ETF）。
   - 其餘丟棄（特別股 2888A 等 40 檔、可轉債、91 開頭 DR、01 受益證券、02 ETN 代碼型態）。

**過殺防護 sanity**：去重 3116 檔 → 保留 2395 檔（twse/tpex 中僅 200 檔被濾，其中純代碼型態淘汰的 40 檔全為特別股）。

## 斷言結果（一次性腳本，npx tsx，驗完已刪）

- **Task 1（mapYahooQuote，11/11 PASS）**：AAPL/NMS→US、VOO/PCX→US、QQQ/NGM→US、2330.TW→TW、6488.TWO→TW；NK=F 期貨/^HSI 指數/BTC-USD 加密（皆 isYahooFinance:true）→null；0700.HK/7203.T →null；無 symbol→null。
- **Task 2（真實名錄，21/21 PASS）**：2330/0050/6488/00679B/00632R/上櫃ETF 00835B 保留；910708 DR、9110 四碼DR、01004T 受益證券、020017 ETN、711140 權證、指數、興櫃全排除；保留 2395>2000；searchTaiwan 搜「台」「00」各回 15 筆且全過 predicate；「2330」「0050」「台積電」皆命中。
- `npx tsc --noEmit`：Task 1 後、Task 2 後、收尾各跑一次，全過。
- 未啟動 dev server（依計畫）；驗證腳本 assert-task1.ts / assert-task2.ts 已刪除、未 commit。

## Deviations from Plan

None - plan executed exactly as written.（Step A 一次抓取成功，未走限流重試/WebFetch 退化路徑；ETF 代碼型態實測含 4 碼 0050，regex 採 `^00\d{2,4}[A-Z]?$` 涵蓋 4-6 碼，屬計畫預留的「以實測值域為準」調整。）

## Known Stubs

None.

## Threat Flags

None——無新增網路端點/auth 路徑/schema 變更；T-qfi-01（Yahoo 回應竄改）之 mitigation（雙白名單、未知 quote 丟棄）即本任務本體，已實作並斷言。

## Commits

| Task | Commit | 內容 |
|---|---|---|
| 1 | e4068c4 | searchYahoo 白名單收斂＋Market 型別收斂為 TW\|US |
| 2 | d32aa7b | searchTaiwan 名錄過濾（依 FinMind 實測值域）＋合併結果收斂 15 筆 |

## Self-Check: PASSED

- services/stockDirectory.ts 存在且含 mapYahooQuote / isSearchableTaiwanEntry
- components/StockSearch.tsx marketBadge 僅 TW/US
- commits e4068c4、d32aa7b 皆存在於 git log
- 兩個 commit 均無檔案刪除；工作樹無本任務殘留未追蹤檔
