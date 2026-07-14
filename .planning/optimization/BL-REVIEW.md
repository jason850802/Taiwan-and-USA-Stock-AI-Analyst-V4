# BL 冷載入收尾——Sonnet 覆核報告與處置（2026-07-14）

**覆核者**：Sonnet subagent（依 BL-PLAN.md 各章驗收標準逐章比對，程式碼層＋e2e 證據雙軌）
**範圍**：BL-2（260714-nfn）／BL-1（260714-ns3）／BL-3（260714-o6l），commits `2619d87..03dac9e`
**總結論**：**ACCEPT WITH FINDINGS** → findings 已當場處置（見下），處置後狀態等效 ACCEPT。

## 逐章驗收結果摘要

- **BL-2**：7/7 PASS（含 1 項 N/A-見-drift）。亮點：chipDataUnavailable 語意由覆核者讀碼獨立證實「僅法人 null 才 true、量能失敗不影響」；既有呼叫端（getTwFundamentals 2-arg）零 breaking change。
- **BL-1**：11/11 PASS。覆核者逐行重建 promise 鏈驗證 abort 三態、與改前原始碼（`git show 9e714ca^`）逐行比對證實抽函式為真·行為零變、StockChart 全部 data 相依 effect 逐一排查無漏網 reset 路徑、無 unhandled rejection。
- **BL-3**：5/5 PASS（指標一致性為結構性推論——同一組 warm-up 數學，BL-1 已實測 relDiff=0）。
- **共同驗收**：build ✓／dist 無 AIza ✓／vitest 32/32 ✓／preview 實跑 ✓／tsc 覆核者獨立重跑 ✓。

e2e 實測證據（統測階段，vercel dev＋fetch hook 注入）：五路同刻起跑 spread 0-1ms；partial→full 完整時間線（骨架屏 223ms→partial 6.1s 含籌碼副圖→縮放 100→64→full 21.6s 落地後**維持 64 不重置**、容器 1060px 恆定）；2y vs 10y 最近端 3 根 MA20/MA60/MACD/KD 相對差全為 0；快取只寫 full（2421-2431 根）；10y 晚失敗→停留 2y＋console.warn＋不寫快取＋不進 fallback＋重試成功；連點 5 檔前四檔全 abort＋sessionStorage 零殘留；1mo range=15y 恰 180 根；快取切回 0 請求 0 骨架屏。

## Findings 處置

| # | Severity | 內容 | 處置 |
|---|---|---|---|
| HIGH-1 | HIGH | `Portfolio.tsx:908` 的 `getStockData(sym,'1d')` 無 onRevalidated → 兩段式 partial resolve 後 full 靜默丟棄 → 該呼叫只拿 2y 截斷資料；下游 `gemini.ts:462` 的 `?? latest` 對買入日超出視窗（改前 >10y、改後 >2y）的舊部位，把「買入當天技術面摘要」靜默換成今日棒 | **已修（4005108）**：(1) `getStockData` 兩段式加 `opts?.onRevalidated` 閘門——無回呼呼叫端走單段 10y，語意回到 BL-1 前；(2) `gemini.ts` 買入日查無時本節從缺＋明示「請勿以其他日期推斷」，不再靜默頂替（此半支為既有弱點的根治，非僅回復原狀）。修後 tsc ✓、vitest 32/32 ✓、dev 實測 App 主路徑兩段式健在（1101 五路同刻＋2y/10y 雙發） |
| LOW-1 | LOW | 投機 chipSpec 在「Yahoo 雙路＋FinMind fallback 全失敗」稀有場景多打 3 支 FinMind（永不 reject、無崩潰風險） | 記錄不修；FinMind 限流預算調整時納入考量 |
| LOW-2 | LOW | 殭屍棒過濾對 2y 陣列獨立套用，2y 最左緣一根在補全前的極窄時窗有理論不一致（畫面外、full 落地即自癒） | 記錄不修 |

## Drift 裁定（覆核者）

1. BL-PLAN 檔案清單漏列 `api/_lib/yahoo.ts` 白名單 → **合理接受**（兩包 PLAN 均事先標注並補上，SUMMARY 記錄完整）。
2. BL-1 PLAN race 骨架空指標邊角、executor 修正 → **合理接受**，覆核者獨立重建四種 race 結局證實修正完全覆蓋。
3. BL-2「dev 降 ≥2s」與 BL-1「dev 首繪 ≤5s」因 BL-4a 改 prod 量測而字面不可執行 → **合理接受**，以結構性證據（串行鏈→五路並行）替代；**條件**：BL-4b 對照表必須明列這兩條的 prod 數字，不得因已 evidence-substituted 而跳過。

## 覆核後補充 commit

- `4005108` fix(bl-review): HIGH-1 兩處修正（services/yahoo.ts 閘門＋services/gemini.ts 買入日誠實化）
