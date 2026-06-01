# Phase 1: 後端骨架 ＋ Gemini 端點（金鑰封存） - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-01
**Phase:** 1-後端骨架 ＋ Gemini 端點（金鑰封存）
**Areas discussed:** 端點厚薄（prompt 放哪）, 錯誤訊息前端顯示程度

---

## 端點厚薄（prompt 放哪）

### 厚薄

| Option | Description | Selected |
|--------|-------------|----------|
| 薄轉發 | 前端組 prompt+systemInstruction 傳後端，後端只持金鑰/選模型/轉發 | ✓ |
| 厚端點 | prompt 模板也搬進後端，風險較高 | |

### 端點粒度

| Option | Description | Selected |
|--------|-------------|----------|
| 單一通用端點 | 一個 /api/gemini 接 {prompt, systemInstruction, mode} 服務全部 4 呼叫 | ✓ |
| 每功能一個端點 | /api/gemini/entry、/trade、/health 各一個 | |

### 模型傳遞

| Option | Description | Selected |
|--------|-------------|----------|
| 前端傳 mode | mode='fast'\|'thinking'，後端映射模型 ID（ID 不離後端） | ✓ |
| 前端傳模型名 | 前端直接指定模型名，不符集中設定 | |

**User's choice:** 薄轉發 ／ 單一通用端點 ／ 前端傳 mode
**Notes:** 三者一致：本里程碑不動 gemini.ts 的 prompt 邏輯，改動最小。

---

## 錯誤訊息前端顯示程度

### 錯誤呈現

| Option | Description | Selected |
|--------|-------------|----------|
| 直接顯示後端 message | 後端回中文友善訊息，前端只渲染，自動涵蓋所有分類碼 | ✓ |
| 前端依 code 客製 UI | 較細但屬本里程碑排除的前端錯誤分類範圍 | |

### 分類碼

| Option | Description | Selected |
|--------|-------------|----------|
| MODEL_NOT_FOUND | 模型不存在/下架（404）| ✓（PROXY-02 必收） |
| RATE_LIMITED | Gemini 限流（429）| ✓ |
| UPSTREAM_ERROR | 逾時/5xx 其他上游錯誤 | ✓ |
| BAD_REQUEST | 請求參數不合法 | ✓ |

**User's choice:** 直接顯示後端 message；分類碼「你自己決定」→ Claude 採完整集（含額外 MISSING_KEY 後端設定錯誤）
**Notes:** 後端持有繁體中文文案，前端原樣渲染，無需前端 i18n 或錯誤碼對照。

---

## Claude's Discretion

- **thinking 模式 production 模型**（使用者未選討論）：模型 ID 全進環境變數；production 預設用 stable（fast→gemini-3.5-flash、thinking→當期 stable pro 如 gemini-2.5-pro），保留 env 覆寫為 preview 的彈性，並提供 fallback 常數。
- **Phase 1 端點臨時防護**（未討論）：guard 骨架 Phase 1 建立並先放最簡 Origin/同源檢查（非裸奔）；完整限流/共享密鑰/CORS 排 Phase 4。
- **本地開發**（未討論）：先試 `vercel dev` 單進程；遇 Vite 6 整合坑退回 `server.proxy` 雙進程。

## Deferred Ideas

- Gemini 串流回應（STREAM-01）— v2。
- 清理 analyzeStockWithGemini / formatPromptData 死碼 — 技術債里程碑。
- 前端依 code 客製錯誤 UI — 本里程碑排除。
- 完整防濫用（Upstash/共享密鑰/CORS）— Phase 4。
