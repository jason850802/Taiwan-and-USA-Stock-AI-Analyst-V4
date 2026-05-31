# Architecture Research

**Domain:** Vite/React SPA → 加一層 Vercel Serverless 後端代理（Gemini / Yahoo / FinMind），金鑰移到伺服器端，端點加基本防濫用
**Researched:** 2026-06-01
**Confidence:** HIGH（Vercel 慣例、執行限制以官方文件查證；前後端切分依既有契約推導）

> 本文件只研究「新增後端代理層後，前後端如何切分與整合」。既有分層（App.tsx 集中狀態、services/ 做 I/O、utils/ 純計算）不重研究，視為固定地基。

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (Vite/React SPA — 不變的領域型別 StockDataPoint[] / StockInfo)│
│  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌───────────┐ ┌──────────┐  │
│  │StockChart│ │EntryCheck│ │AnalysisRes.│ │ Portfolio │ │StockSearch│ │
│  └────┬─────┘ └────┬─────┘ └─────┬──────┘ └─────┬─────┘ └────┬─────┘  │
│       └────────────┴─── App.tsx (集中狀態) ──────┴────────────┘        │
│                              │ props/callbacks                         │
│  ┌───────────────────────────┴────────────────────────────────────┐   │
│  │  services/  (薄客戶端 — 只改「呼叫誰」，回傳契約不變)             │   │
│  │  yahoo.ts   stockDirectory.ts   gemini.ts                       │   │
│  │  └── 全部改打 fetch('/api/...') 取代 corsproxy / 直連 Google     │   │
│  └───────────────────────────┬────────────────────────────────────┘   │
└──────────────────────────────┼─────────────────────────────────────────┘
                               │ HTTPS（同源 /api/*，無 CORS、無金鑰）
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Vercel（同一個 project：靜態 SPA + Serverless Functions）            │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  api/  (Node.js runtime functions — 持有金鑰、防濫用、設定中心)  │  │
│  │                                                                  │  │
│  │  api/_lib/   ← 共用：CORS/同源檢查、rate-limit、upstream fetch   │  │
│  │  api/gemini.ts        ← 代理 Gemini（金鑰 + 模型名稱集中於此）   │  │
│  │  api/yahoo/chart.ts   ← 代理 Yahoo chart                         │  │
│  │  api/yahoo/search.ts  ← 代理 Yahoo search                       │  │
│  │  api/finmind.ts       ← 代理 FinMind（目錄/籌碼/日線/名稱）      │  │
│  └─────────────────────────────────┬───────────────────────────────┘  │
│       env: GEMINI_API_KEY / GEMINI_MODEL_* / FINMIND_TOKEN(可選)       │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      ▼
        ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
        │ Yahoo query2      │  │ FinMind v4 API    │  │ Google Gemini API │
        │ (chart / search)  │  │                   │  │ (@google/genai)   │
        └──────────────────┘  └──────────────────┘  └──────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `services/*.ts`（前端） | 唯一變動點：把 upstream URL 換成同源 `/api/*`；解析回傳；**保持回傳型別不變** | `fetch('/api/...')` + 既有 normalize/indicator 邏輯 |
| `api/_lib/`（後端共用） | 同源/Referer 檢查、rate-limit、統一 upstream fetch + 錯誤映射 | Node.js helper 模組（非端點） |
| `api/yahoo/*`（後端） | 代理 Yahoo chart/search，剝離 CORS proxy，回傳 Yahoo 原始 JSON | Node handler，`fetch` 直連 query2 |
| `api/finmind.ts`（後端） | 代理 FinMind dataset 查詢（目錄、籌碼、日線、名稱），可選注入 token | Node handler，轉發 querystring |
| `api/gemini.ts`（後端） | 持有 `GEMINI_API_KEY`、集中模型名稱、呼叫 `@google/genai`、回傳文字 | Node handler + `@google/genai` SDK |
| `App.tsx` / `components/` | **完全不動**（契約相容是本里程碑的硬約束） | 既有 React 結構 |
| `utils/*`（純計算） | **完全不動**（仍在前端執行，見下方權衡） | 既有指標/濾網 |

**邊界一句話：** 元件（不變）→ services（只換目標 URL）→ `/api/*`（持金鑰、防濫用、設定）→ 第三方。金鑰與 proxy 知識只活在 `/api` 之內，**絕不跨過邊界回到瀏覽器**。

---

## Recommended Project Structure

```
專案根/
├── api/                      # Vercel Serverless Functions（檔案即路由）
│   ├── _lib/                 # 底線前綴 = 不對應路由，僅共用工具
│   │   ├── http.ts           # upstream fetch + 逾時 + 錯誤→中文訊息映射
│   │   ├── guard.ts          # 同源/Referer 檢查 + 記憶體 rate-limit
│   │   └── config.ts         # 讀 env：GEMINI_MODEL_FAST / _THINKING 等
│   ├── gemini.ts             # POST /api/gemini  （代理 Gemini）
│   ├── yahoo/
│   │   ├── chart.ts          # GET  /api/yahoo/chart
│   │   └── search.ts         # GET  /api/yahoo/search
│   └── finmind.ts            # GET  /api/finmind  （dataset 轉發）
├── services/                 # 前端服務層（既有，僅內部改 URL）
│   ├── yahoo.ts              # getStockData / getLatestPrice — 契約不變
│   ├── stockDirectory.ts     # ensureTaiwanDirectory / searchYahoo — 契約不變
│   └── gemini.ts             # analyze* — 契約不變
├── components/  utils/  types.ts        # 完全不動
├── vite.config.ts            # 移除 GEMINI_API_KEY 的 define 注入（關鍵）
└── vercel.json               # 可選：functions maxDuration / 區域設定
```

### Structure Rationale

- **`api/` 放在專案根（與 `src` 同層）：** Vercel 的硬性慣例 — 偵測到根目錄 `api/` 就把每個檔案編譯成一個 function，與框架無關。Vite 靜態輸出 + `api/` 是官方支援的「frontend + functions 同一 project」模式，零額外設定即可同源部署，避免另開後端服務或第二個 CORS 來源。
- **`api/_lib/` 用底線前綴：** Vercel 只把 `api/` 下「會匯出 handler 的檔案」當路由；以 `_` 開頭（或放進不被當端點的子資料夾）的共用模組不會變成多餘的 function，能省下 Hobby 方案「每 deployment 最多 12 個 function」的額度。
- **`api/yahoo/` 用子資料夾：** chart 與 search 的快取策略、參數、上游路徑不同，拆兩個 function 邊界更乾淨；巢狀路徑天然對應 `/api/yahoo/chart`。
- **`vite.config.ts` 移除 `define` 注入：** 這是本里程碑的根本目的 — 金鑰不再進前端 bundle。前端對 Gemini 一無所知，只認得 `/api/gemini`。

---

## 第三方端點切分：每個一個端點 vs 單一閘道

**建議：採「每個第三方一個端點（依上游分組）」，而非單一萬用閘道。**

| 取捨面向 | 多端點（建議） | 單一閘道 `/api/proxy` |
|----------|----------------|------------------------|
| 關注點分離 | 高 — 每個 handler 只懂一個上游的參數/錯誤/快取 | 低 — 一個 handler 內 if/else 分流，易長成第二個 god-object |
| 防濫用粒度 | 可對 `/api/gemini`（花錢）設嚴格 rate-limit，對 Yahoo 較寬 | 全部共用一條規則，難以差別對待 |
| 快取策略 | 可逐端點設 `Cache-Control`（目錄可快取、Gemini 不可） | 難以逐上游調整 |
| Hobby 12-function 上限 | 本案 4 個端點，遠在上限內 | 省 function 數，但本案無此壓力 |
| 前端對應 | service 函式一對一對應端點，心智負擔低 | 前端要多帶一個「target」參數，契約較鬆散 |

→ 本案上游種類少（3 個來源、4 個端點），多端點的清晰度遠勝於閘道節省的 function 數。**唯一例外**：FinMind 多個 dataset（目錄/籌碼/日線/名稱）共用一個 `api/finmind.ts`、以 `dataset` 參數分流即可 —— 因為它們上游、認證、錯誤模型一致，屬「同一上游的多查詢」，不是「多上游」。

---

## 前端 services 改接的最小變動方式（契約不變）

**原則：只改「呼叫誰」與「URL 怎麼拼」，不動 normalize、不動指標計算、不動回傳型別。**

### Pattern 1：URL 改寫，回傳結構維持上游原樣

**What:** 後端代理 Yahoo/FinMind 時，**原封不動回傳上游 JSON**（如 Yahoo 的 `{ chart: { result: [...] } }`）。前端 `processYahooResult` / `processYahooResult`、FinMind 解析、`utils/math.ts` 指標計算全部不變。
**When to use:** Yahoo chart、Yahoo search、FinMind —— 這些前端已有成熟的 normalize 邏輯。
**Trade-offs:** 後端是「啞代理」最簡單、最不易引入回歸；代價是前端仍負責解析（這正是我們要的：契約零變動）。

```typescript
// services/yahoo.ts —— 唯一改動：把 PROXIES + YAHOO_BASE 拼接，換成同源端點
// before: fetch(proxy + encodeURIComponent(YAHOO_BASE + symbol + '?...'))
// after:
const fetchRawData = async (symbol, interval, range) => {
  const qs = new URLSearchParams({ symbol, interval, range });
  const res = await fetch(`/api/yahoo/chart?${qs}`);          // 同源、無 proxy
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<YahooChartResponse>;           // 同一型別，下游不變
};
// getStockData / processYahooResult / 指標計算：一行都不用改
```

### Pattern 2：Gemini 端點回傳純文字（維持現有回傳形狀）

**What:** `analyze*` 系列現在回傳 `string`（markdown）。後端 `/api/gemini` 同樣回傳 `string`；前端只把「`new GoogleGenAI` + `generateContent`」整段替換成一次 `fetch`。
**When to use:** 四個 Gemini 進入點（`analyzeStockWithGemini` / `analyzeEntryWithGemini` / `analyzeTradeDecision` / `analyzePortfolioHealth`）。
**Trade-offs:** prompt 與 systemInstruction **可選擇**留前端（後端純轉送 `{ prompt, systemInstruction, mode }`）或搬後端。建議**第一版把 prompt 留前端**（後端只收組好的 prompt + mode），如此 `services/gemini.ts` 的 1030 行 prompt 邏輯零搬遷、風險最低；模型名稱與金鑰則一定在後端。

```typescript
// services/gemini.ts —— 每個 analyze* 內部
const callGemini = async (payload: {
  prompt: string; systemInstruction: string; mode: 'fast' | 'thinking';
}): Promise<string> => {
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());  // 維持既有 try/catch 行為
  const { text } = await res.json();
  return text || 'No analysis generated.';
};
// 移除：process.env.API_KEY 檢查、new GoogleGenAI、modelName 三元式（搬到後端）
```

### Pattern 3：後端共用 fetch + 錯誤映射（DRY 防濫用）

**What:** `api/_lib/http.ts` 統一做 upstream fetch、逾時、429 偵測、把上游錯誤映射成前端既有預期的訊息形狀，讓四個 handler 不重複。
**When to use:** 所有 handler。
**Trade-offs:** 一點點抽象成本，換來四個端點行為一致、好維護。

---

## 請求/回應契約設計（前端傳什麼、後端回什麼）

| 端點 | 方法 | 前端送 | 後端回 | 備註 |
|------|------|--------|--------|------|
| `/api/yahoo/chart` | GET | `?symbol=2330.TW&interval=1d&range=10y` | Yahoo 原始 `{ chart: {...} }` JSON（啞代理） | 後端只允許白名單 interval/range，避免被當開放 proxy |
| `/api/yahoo/search` | GET | `?q=台積電` | Yahoo search 原始 JSON | 同上 |
| `/api/finmind` | GET | `?dataset=TaiwanStockInfo&data_id=2330&start_date=...` | FinMind 原始 `{ msg, data }` JSON | `dataset` 白名單；token 由後端注入（若有） |
| `/api/gemini` | POST | `{ prompt, systemInstruction, mode:'fast'|'thinking' }` | `{ text: string }` | 金鑰+模型名後端決定；mode→模型映射在後端 |

**設計準則：**
- **Yahoo/FinMind：回原始 JSON**（不在後端 normalize）→ 前端解析契約零變動，這是維持 `StockDataPoint[]` 相容最省力的路。
- **Gemini：回 `{ text }`** 而非裸字串 → 留擴充空間（之後可加 `usage`、`model`、`error` 結構化欄位）且 JSON 比裸文字好驗證。
- **參數白名單化**：後端對 `interval`/`range`/`dataset` 做 enum 檢查，防止端點被外人當通用代理盜用（防濫用的一環）。
- **錯誤契約**：非 2xx 時後端回中文錯誤訊息字串（與既有 service `throw new Error(中文)` 行為對齊），前端 `catch` → UI 行為不變。

---

## 指標計算：留前端還是搬後端？

**建議：留在前端（`services/yahoo.ts` + `utils/math.ts` 不動）。後端只做啞代理。**

| 權衡面向 | 指標留前端（建議） | 指標搬後端 |
|----------|---------------------|------------|
| Vercel 執行時間 | 後端僅 I/O 轉發，回應快，遠低於 10s 預設逾時 | 5–10 年日線 × RAW+ADJ 雙套指標在 function 內算，逼近 Hobby 預設 10s（雖可調至 60s/Fluid 300s，但無必要） |
| 契約風險 | 零 — `StockDataPoint[]` 在前端組裝，型別不動 | 高 — 要把 `processYahooResult`+aggregation+timezone 移植到後端，回歸風險大 |
| 冷啟動/cold start | 後端輕，cold start 影響小 | 後端變重、bundle 變大、cold start 更久 |
| 前端負擔 | 維持現狀（已可接受；主執行緒同步運算） | 略減前端 CPU，但本案非瓶頸 |
| 本里程碑範圍 | 與「行為不變」硬約束一致 | 等同重寫資料管線，超出「加代理」範圍 |

**結論：** 本里程碑的目的是「藏金鑰 + 去公用 proxy」，**不是**重構資料管線。指標搬後端會把一個低風險的代理工作，膨脹成高風險的管線移植，且 Vercel 執行時間限制反而對「在 function 內跑重運算」不利。維持「後端啞代理、前端算指標」是風險與成本都最低的切法。（前端主執行緒同步運算的疑慮屬獨立效能主題，已在 PROJECT.md Out of Scope。）

---

## 環境變數與設定擺放位置

| 設定 | 位置 | 說明 |
|------|------|------|
| `GEMINI_API_KEY` | Vercel 環境變數（後端 only） | 本里程碑根本目的；**從 `vite.config.ts` 的 `define` 移除**，前端 bundle 不再內嵌 |
| `GEMINI_MODEL_FAST` / `GEMINI_MODEL_THINKING` | Vercel 環境變數，由 `api/_lib/config.ts` 讀取 | 集中模型名稱；修正寫死且疑似失效的 ID（註：2026 年 `gemini-3.1-pro`、`gemini-3.5-flash` 等 ID 實際存在，但仍應集中設定，避免散落、好一鍵切換） |
| `FINMIND_TOKEN`（可選） | Vercel 環境變數 | 若改用 FinMind 認證額度，由 `api/finmind.ts` 注入，前端永不接觸 |
| 同源/rate-limit 規則 | `api/_lib/guard.ts`（程式內常數，可選環境變數覆寫） | 防濫用設定集中一處 |

**準則：** 任何「秘密」或「可能要一鍵切換的營運參數」（金鑰、模型名、token、限流閾值）都只能活在 `api/` 與 Vercel env；前端只認端點路徑。`vite.config.ts` 的 `define` 注入必須拿掉，否則里程碑目標未達成。

---

## Data Flow

### Request Flow（主分析路徑，代理後）

```
使用者選股
   ↓
StockSearch → App.fetchData → services/yahoo.getStockData
   ↓
fetch('/api/yahoo/chart?symbol=...&interval=...&range=...')   ← 同源、無金鑰、無 CORS proxy
   ↓
[Vercel] api/yahoo/chart.ts → _lib/guard（同源+限流）→ _lib/http → Yahoo query2
   ↓
回傳 Yahoo 原始 JSON（啞代理）
   ↓
前端 processYahooResult + utils/math 指標計算  → StockDataPoint[]（型別不變）
   ↓
App 存 data/info → runEntryFilter（前端純函式）→ EntryFilterResult
   ↓
App 組 prompt → services/gemini → fetch('/api/gemini', {prompt, systemInstruction, mode})
   ↓
[Vercel] api/gemini.ts → 注入金鑰 + 映射 mode→模型 → @google/genai
   ↓
回 { text } → AnalysisResult 渲染 markdown（行為不變）
```

### Key Data Flows

1. **行情/搜尋/籌碼：** 前端 → `/api/yahoo/*` 或 `/api/finmind` → 上游 → 原始 JSON 回前端 → 前端 normalize+算指標。後端不持有領域知識，純轉發。
2. **AI 分析：** 前端組好 prompt → `/api/gemini`（持金鑰、決定模型）→ Gemini → `{ text }`。金鑰與模型名只在後端。
3. **目錄快取：** `localStorage` 快取與 `stockDirectory.ts` 的記憶體快取**維持前端**；只有「首次抓 FinMind 全清單」那一步改打 `/api/finmind`。

---

## 建議建置順序（元件相依）

**建議順序：Gemini 先，Yahoo/FinMind 次之。** 理由是「風險與價值」而非技術相依（四個端點彼此獨立，無硬相依）。

| 階段 | 內容 | 為何此序 |
|------|------|----------|
| 0. 地基 | 建 `api/_lib/`（http/guard/config）、加 `vercel.json`（如需調 maxDuration）、確認 Vercel project 偵測到 `api/` | 後續每個端點都依賴共用層；先立骨架 |
| 1. **Gemini 端點**（先） | `api/gemini.ts` + 前端 `services/gemini.ts` 改接 + **從 `vite.config.ts` 移除金鑰 define** | 唯一的 CRITICAL（金鑰外洩、會直接燒錢）；只有一個端點、回傳是單純字串，是最小可驗證的端到端切片；先做能立刻封住金錢風險 |
| 2. **Yahoo 端點** | `api/yahoo/chart.ts` + `search.ts`，前端 `yahoo.ts` / `stockDirectory.searchYahoo` 改接 | 影響最廣（主分析路徑全靠它），但回傳啞代理、契約不變，做完即除掉公用 proxy 依賴 |
| 3. **FinMind 端點** | `api/finmind.ts`，前端 `stockDirectory.ensureTaiwanDirectory` + yahoo.ts 的 FinMind fallback 改接 | 相依 Yahoo 路徑已穩（FinMind 是 fallback/enrichment）；最後收尾，風險最低 |
| 4. **防濫用強化** | 在 `_lib/guard` 補同源/Referer 檢查 + Gemini 端點較嚴的 rate-limit | 四端點到位後統一套上；Gemini 是花錢端點，限流最該嚴 |

**相依重點：**
- 階段 0 是所有端點的前置（共用層）。
- 階段 1（Gemini）獨立、價值最高、切片最小 → **第一個端到端驗證點**，先證明「前端→/api→第三方→回前端」這條鏈路在 Vercel 上通。
- 階段 2、3 共享 Yahoo/FinMind 的 fallback 關係：Yahoo 主、FinMind 副，故先 Yahoo 後 FinMind，符合資料路徑的依賴方向。
- 防濫用（階段 4）邏輯上可與各端點同步加，但集中最後做能用一致規則覆蓋全部，避免每端點各寫一套。

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 個人/數人（現況） | Hobby 免費層足夠；4 個 function 遠低於 12 上限；記憶體 rate-limit 即可 |
| 偶發分享/數十人 | 注意 Gemini 額度（端點限流是主防線）；Yahoo 非官方端點可能限流 → 在 `/api/yahoo` 加短期快取（`Cache-Control` / `/tmp`） |
| 持續多人 | 記憶體 rate-limit 在多 instance 下不可靠 → 換 Vercel KV/Edge Config 做共享限流；考慮升 Pro 或換付費行情源（已在 Out of Scope） |

### Scaling Priorities

1. **第一個瓶頸：Gemini 額度被盜刷/燒完** → `/api/gemini` 的 rate-limit + 同源檢查是核心防線（本里程碑已涵蓋）。
2. **第二個瓶頸：Yahoo 非官方端點對 Vercel 出口 IP 限流** → 在 Yahoo 端點加短 TTL 快取、必要時保留 FinMind fallback。

---

## Anti-Patterns

### Anti-Pattern 1：後端做 normalize / 算指標（過度搬遷）

**What people do:** 趁加後端，把 `processYahooResult` + 指標計算一起搬進 function。
**Why it's wrong:** 把低風險的代理工作膨脹成高風險的管線移植，破壞 `StockDataPoint[]` 契約相容，且重運算撞上 Vercel 執行時間限制。
**Do this instead:** 後端啞代理回原始 JSON，前端維持既有 normalize/指標。搬遷留待獨立重構里程碑。

### Anti-Pattern 2：把金鑰「藏進前端再轉送」或保留 `define` 注入

**What people do:** 加了後端，卻忘了從 `vite.config.ts` 移除 `define` 的 `GEMINI_API_KEY` 注入。
**Why it's wrong:** 金鑰仍進 bundle，里程碑根本目的未達成。
**Do this instead:** 移除 `define` 注入；前端對金鑰零知識，只認 `/api/gemini`。

### Anti-Pattern 3：單一萬用閘道 `/api/proxy?url=...`

**What people do:** 做一個轉發任意 URL 的端點圖省事。
**Why it's wrong:** 等於把公用 CORS proxy 的風險搬到自家伺服器，且任何人可拿它代打、盜用你的出口與金鑰。
**Do this instead:** 依上游分端點 + 參數白名單（interval/range/dataset enum）。

### Anti-Pattern 4：把 `_lib` 共用檔放成端點

**What people do:** 共用工具放 `api/utils.ts`，被 Vercel 當成一個 function。
**Why it's wrong:** 浪費 Hobby 12-function 額度、暴露非預期路由。
**Do this instead:** 底線前綴 `api/_lib/`，不被當路由。

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Google Gemini | `api/gemini.ts` 內用 `@google/genai`，金鑰來自 env | 模型名集中 env；mode→模型映射在後端；回 `{ text }` |
| Yahoo Finance (query2) | `api/yahoo/*` 直連，剝離 CORS proxy | 非官方端點，注意限流；參數白名單 |
| FinMind v4 | `api/finmind.ts` 轉發 dataset 查詢，可選注入 token | `dataset` 白名單；token 永在後端 |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `services/*` ↔ `api/*` | HTTP（同源 `/api/*`，JSON/字串） | 唯一新增的內部邊界；契約見上方表格 |
| `api/*` ↔ `api/_lib/*` | 直接函式呼叫 | 共用 fetch/guard/config，不對外暴露 |
| `App`/`components` ↔ `services/*` | 既有 props/callbacks + 函式呼叫 | **不變** — 這是契約相容的保證面 |

---

## Sources

- Vercel Functions — Runtimes（last_updated 2026-05-12）：`api/` 檔案即路由、每檔一個 function、Hobby 每 deployment 12 個 function 上限、Node.js runtime、唯讀檔案系統 + `/tmp`、env 變數 — https://vercel.com/docs/functions/runtimes （HIGH）
- Vercel Functions — Duration / Limits：Hobby 預設 10s、可設 maxDuration 1–60s、Fluid Compute 最高 300s、504 FUNCTION_INVOCATION_TIMEOUT — https://vercel.com/docs/functions/configuring-functions/duration ／ https://vercel.com/docs/functions/limitations （HIGH）
- Google Gemini API — Models（2026）：Gemini 2.5 Flash/Pro GA；Gemini 3.1 Pro（2026-02）、3.1 Flash Lite（2026-03）；`@google/genai` 範例含 `gemini-3.5-flash`，佐證既有模型 ID 可能有效但仍應集中設定 — https://ai.google.dev/gemini-api/docs/models （MEDIUM — WebSearch 為主）
- 既有契約來源（本 repo）：`types.ts`（StockDataPoint/StockInfo）、`services/yahoo.ts`（getStockData/getLatestPrice/fetchRawData）、`services/stockDirectory.ts`、`services/gemini.ts`（4 個 analyze* 進入點）、`vite.config.ts`（define 注入金鑰）、`.planning/codebase/ARCHITECTURE.md`、`.planning/codebase/STRUCTURE.md`、`.planning/PROJECT.md` （HIGH）

---
*Architecture research for: Vite/React SPA + Vercel Serverless 代理層*
*Researched: 2026-06-01*
