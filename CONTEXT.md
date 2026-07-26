# CONTEXT.md — 領域詞彙表

> 本檔由 grill-with-docs／domain-modeling **懶建與懶維護**：只收「已拍板」的詞。
> 所有產出（票、測試名、提案、UI 文案）用這裡的詞，不要漂移到被避免的同義詞。
> 決策記錄在 `docs/adr/`；用法規範見 `docs/agents/domain.md`。

## 庫存資料層（2026-07-27，ADR-0001）

| 詞 | 定義 | 避免的同義詞 |
|---|---|---|
| **本體資料** | 重建不回來的五把 localStorage key：`portfolio_items`（持股，唯一裸陣列）、`portfolio_transactions_v1`（交易流水）、`portfolio_import_log_v1`（匯入紀錄）、`portfolio_realized_trades_v1`（已實現帳本）、`portfolio_snapshots_v1`（每日快照） | 使用者資料、核心資料 |
| **可重建資料** | 丟了能自動補回的 key：`portfolio_close_cache_v1`（收盤價快取，可重抓）、`gemini_cache_v1\|*`（AI 分析快取，當日即棄）。**不進備份** | — |
| **備份** | 把五把本體 key 收進單一 JSON 檔（自帶 schema 版本＋匯出時間）下載到使用者電腦。保命用，**不是雲端同步** | 匯出（保留給 P2 CSV 報表）、同步 |
| **回灌** | 用備份檔**整包覆蓋**五把本體 key。無合併、無部分回灌（ADR-0001 第 3 條） | 匯入（已被「匯入對帳單」佔用）、還原、restore |
| **預備份** | 按下回灌確認的當下，自動先下載的一份現況備份；手滑回錯檔的最後救援。現況全空則跳過 | — |
| **CSV 報表** | P2：持股／已實現帳本給 Excel 看的單向輸出，**匯不回來**。細節待 P2 grill | 備份（嚴禁混用——報表救不了命） |
