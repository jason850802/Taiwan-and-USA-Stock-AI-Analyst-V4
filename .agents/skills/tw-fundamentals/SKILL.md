---
name: tw-fundamentals
description: 台股基本面資料抓取與整備。補上美股 skill(dcf-model／comps-analysis／initiating-coverage／earnings-analysis)從 SEC/EDGAR 自動取得、台股卻沒有的財報資料層。自動從 FinMind 抓損益表、資產負債表、現金流量表、PER/PBR/殖利率、月營收(YoY)、股利，整備成乾淨結構，再交給那些美股分析 skill 使用。當使用者說「台積電基本面」「2330 財報」「幫我算台股的 DCF／估值」「這檔台股貴不貴」「台股 XXXX 的營收獲利」時使用。純美股標的(AAPL 等)不要用本 skill，那些 skill 自己抓得到 SEC。
---

# 台股基本面資料層（tw-fundamentals）

## 這個 skill 解決什麼問題

`dcf-model`、`comps-analysis`、`initiating-coverage`、`earnings-analysis` 這些美股 skill
預設從 **SEC/EDGAR 或 Daloopa/FactSet/S&P MCP** 自動抓財報 —— 台股代碼(2330 等)在那些來源
**查無資料**，會失效。本 skill 用 **FinMind 免 token 公開 API**（你專案既有依賴）把台股的
財報資料抓齊、整理好，讓那些 skill 改吃「使用者提供的資料」路徑，就能一樣運作。

分工：**本 skill 只負責「抓資料＋整備」，不自己重寫估值邏輯**。分析與建模交給美股 skill。
（技術面 K 線／均線／量價請走既有的朱家泓 7 步驟 skill，不在本 skill 範圍。）

## 步驟 1：抓資料（一定先做這步）

執行：
```
python .claude/skills/_shared/fetch_fundamentals.py <台股代碼>
```
例：`python .claude/skills/_shared/fetch_fundamentals.py 2330`
（要更多年份：加 `--years 5`，預設 3 年。若本次對話已抓過同一股票，沿用先前 JSON，勿重抓。）

輸出 JSON 欄位（**金額單位一律「新台幣億元」**；EPS／股利為元/股）：
- `name`、`industry`、`valuation`(PER/PBR/殖利率)
- `income_statement`：近 8 季損益（營收、毛利、營益、稅前、淨利、EPS、三率）
- `balance_sheet`：最新一季（現金、存貨、總資產、總負債、權益、負債比）
- `cash_flow`：最新一季（營業／投資／籌資現金流、資本支出、自由現金流）
- `monthly_revenue`：近 13 個月營收與 YoY
- `dividends`：近幾期現金／股票股利
- `warnings`：某 dataset 抓失敗會列在這（部分缺料仍會出其他資料）

**檢查**：若回傳 `{"error": ...}` 或 `warnings` 非空 → 見下方「疑難排解」。

## 步驟 2：產出基本面快照

把 JSON 讀成一段中文快照給使用者，至少涵蓋：
- 估值：PER／PBR／殖利率，並說明「相對自己歷史」是偏高或偏低（用 `income_statement` 的 EPS 趨勢佐證）
- 獲利趨勢：近幾季營收 YoY、毛利率／淨利率走勢（走升／走降）
- 財務體質：負債比、自由現金流是否為正
- 成長動能：`monthly_revenue` 的 YoY 是否連續正成長
- 股利：近年現金股利與殖利率

**不要編造數字**。只用 JSON 裡有的值；缺的欄位明講「FinMind 無此資料」。

## 步驟 3：交給美股分析 skill（若使用者要 DCF／comps／完整報告）

把步驟 1 的 JSON 當成「使用者提供的財務資料」餵給對應 skill，並**明確告訴它資料來源是台股 FinMind、
不要再去抓 SEC**：
- 要**內在價值估值** → 用 `dcf-model`：提供 `cash_flow.free_cash_flow_yi`、`income_statement`
  歷史、`balance_sheet` 現金與負債；WACC／成長率請與使用者確認假設。
- 要**同業比較估值** → 用 `comps-analysis`：本 skill 先對每一檔同業各跑一次，湊出 PER/PBR 對照表。
- 要**財報季分析** → 用 `earnings-analysis`：提供近 8 季 `income_statement` 與 `monthly_revenue`。
- 要**首次覆蓋完整報告** → 用 `initiating-coverage`：提供全部 JSON 當財務底稿。

## 步驟 4：網頁後備（只在 FinMind 缺料時用）

FinMind 沒有的東西——**公司財測／法說會指引、分析師目標價、產業趨勢、重大新聞**——
才用 `WebSearch`／`WebFetch` 補，來源優先：公開資訊觀測站(mops.twse.com.tw)、
證交所(twse.com.tw)、鉅亨／MoneyDJ／Goodinfo。**引用要註明來源與日期**，不要把網路數字
當成財報數字混用。不要用網頁爬取去取代 FinMind 已能提供的結構化財報（脆弱且易錯）。

## 疑難排解

- `warnings` 有某 dataset 失敗、或整體 `error`：多半是 **FinMind 限流(頻繁呼叫)**。等 30–60 秒重跑一次；
  仍失敗才換手動來源（MOPS）。先懷疑限流，不要急著改腳本（比照專案 Yahoo 429 慣例）。
- 上櫃股(.TWO)：代碼照樣填純數字即可，FinMind 不分上市櫃。
- 金融股／控股公司：三大表欄位代碼可能不同，部分 `*_yi` 會是 null——屬正常，據實呈現。

## 紅線

- 這是**分析輔助**，不是投資建議。結論要中立，不對使用者喊買賣。
- 只用抓回來的真實數字；任何推估要標明是推估與假設。
- 資料有時間落後（財報季報約季後 45 天、月營收次月 10 日前）——標註 `as_of` 與各資料日期。
