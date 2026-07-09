# Phase 4: 防濫用強化 ＋ 部署驗收 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-09
**Phase:** 4-防濫用強化 ＋ 部署驗收
**Areas discussed:** Todo 併入、討論範圍選擇、限流策略與數值

---

## Todo 併入（cross-reference）

| Option | Description | Selected |
|--------|-------------|----------|
| 併入 Phase 4 | 白名單清理本來就碰 GUARD-04，順勢修掉，上櫃股籌碼恢復顯示 | ✓ |
| 不併入，之後用 /gsd:quick 單獨修 | 保持 Phase 4 純防濫用＋部署範圍 | |

**User's choice:** 併入 Phase 4（Fix invalid FinMind OTC dataset names）
**Notes:** 另一個匹配 todo「Add TW stock fundamentals tab」（score 0.3）未提選項——UI 新功能屬自己的 phase，列入 Reviewed Todos。

---

## 討論範圍選擇

| Option | Description | Selected |
|--------|-------------|----------|
| 共享密鑰方案 | 注入方式、header 名稱、涵蓋端點、本地開發行為 | |
| 限流策略與數值 | gemini 嚴/行情寬的具體數字、fail-open/closed、超限訊息 | ✓（Claude 建議後採納） |
| CORS／Origin 政策 | 無 Origin 放行收緊、production 網域、preflight | |
| 部署文件與 GCP 配額 | 文件位置、深度、配額建議值 | |

**User's choice:** 「哪一個最好?」→ Claude 建議「限流策略與數值」最值得討論（唯一使用者、數值直接影響自身使用、fail-open/closed 是真取捨），其餘依研究建議裁量；用戶採納。

---

## 限流策略與數值

### Q1: /api/gemini per-IP 限流

| Option | Description | Selected |
|--------|-------------|----------|
| 10次/分＋100次/天（建議） | 單人寬裕、對腳本是硬上限；雙層 sliding window | ✓ |
| 5次/分＋50次/天 | 更保守，庫存健檢可能撞到自己 | |
| 只設分鐘窗口，不設日上限 | 每日總量交 GCP 配額把關 | |

### Q2: 行情端點 per-IP 限流

| Option | Description | Selected |
|--------|-------------|----------|
| 60次/分（建議） | 庫存多檔＋切週期連發夠用，擋爆量爬蟲；不設日上限 | ✓ |
| 120次/分 | 防護稍弱 | |
| 你決定 | 交規劃時估算 | |

### Q3: Upstash 連不上時

| Option | Description | Selected |
|--------|-------------|----------|
| 全部 fail-open（建議） | 可用性優先；密鑰＋Origin＋GCP 配額仍在 | ✓ |
| gemini fail-closed、行情 fail-open | 花錢端點寧可暫停 | |
| 全部 fail-closed | 最嚴，單點故障，不建議 | |

### Q4: Production 網域

| Option | Description | Selected |
|--------|-------------|----------|
| 還沒部署過，網域未定 | 佔位符＋部署文件說明部署後回填 ALLOWED_ORIGIN | ✓ |
| 已有 Vercel 網域（Other 填入） | 直接寫進文件與 .env.example 註解 | |

**收尾：** 四題拍板後用戶選「產出 CONTEXT.md」，其餘領域交 Claude 裁量。

---

## Claude's Discretion

- 共享密鑰方案（build-time 注入、header 名稱、環境變數名、本地開發降級）
- 無 Origin 請求的收緊方式（同源 GET 可能不帶 Origin 的限制下）
- CORS／OPTIONS preflight 實作細節
- 超限訊息（沿用 `{code,message}` 錯誤模型）
- Upstash 區域選擇與免費層說明
- 部署文件位置（README vs docs/DEPLOYMENT.md）與 GCP 配額建議值

## Deferred Ideas

- Add TW stock fundamentals tab — UI 新功能，屬自己的 phase
- CACHE-01／STREAM-01／VALID-01 — v2 requirements
- HMAC 簽章 — Out of Scope（裸共享密鑰已足夠）
