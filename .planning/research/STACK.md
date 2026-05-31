# Stack Research

**Domain:** Vercel serverless backend proxy layer for an existing Vite/React static SPA (proxies Google Gemini, Yahoo Finance unofficial endpoints, FinMind; moves `GEMINI_API_KEY` server-side; adds basic anti-abuse)
**Researched:** 2026-06-01
**Confidence:** HIGH (核心執行環境、限制、版本均以 Vercel/Upstash/npm 官方文件查證；標 LOW 處為仍需實作驗證者)

---

## 結論先講（TL;DR）

| 決策 | 建議 | 信心 |
|------|------|------|
| 執行環境 | **Node.js runtime**（非 Edge），fluid compute 預設開啟 | HIGH |
| 函式組織 | 原生 `/api/*.ts` 檔案式 function，**不需要 Hono/Express** | HIGH |
| HTTP 轉發 | **原生 `fetch`**（Node 18+ 內建），不裝額外 HTTP client | HIGH |
| 金鑰讀取 | `process.env.GEMINI_API_KEY`，存於 Vercel Environment Variables（Production/Preview/Development），**不加 `VITE_` 前綴** | HIGH |
| 防濫用（主） | **`@upstash/ratelimit` + `@upstash/redis`**（HTTP-based，serverless 友善） | HIGH |
| 防濫用（輔） | Origin/Referer 檢查 + 共享密鑰 header；可選 Vercel WAF managed bot ruleset（Hobby 可用） | MEDIUM |
| 本地開發 | `vercel dev`（單一 origin 同時跑 Vite + `/api`），需設定 `vercel.json` 與 Vite proxy 二擇一 | MEDIUM |
| Gemini SDK | 升級 `@google/genai` 到 **2.x**（現為 1.35.0），只在後端 import | HIGH |

**Vercel Hobby（免費層）對本案的關鍵影響：** 函式**最長執行 300s**（fluid compute 預設），但真正的免費額度天花板是**計量配額**——每月 **4 CPU-hrs Active CPU**、**360 GB-hrs 記憶體**、**1,000,000 次呼叫**、**100 GB-hours 函式時長**。利多：**Active CPU 不計 I/O 等待**，而本案幾乎全是等待 Gemini/Yahoo/FinMind 回應的 I/O-bound 工作，所以 CPU 配額極難用盡。真正風險是 **Hobby 僅限非商業/個人用途**（fair-use），個人工具符合。

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Vercel Functions（Node.js runtime） | 平台層（部署時決定） | 承載 `/api/*` 後端代理端點 | Node.js runtime 是**預設且 Vercel 官方推薦**（建議從 Edge 遷回 Node 以提升相容性與穩定性）。Edge runtime 用 V8 isolate、只支援 Web 標準 API，**多數用到 Node API 的函式庫無法在 Edge 跑**——`@google/genai` 走 `node-fetch`/`fetch-blob` 依賴鏈，Node runtime 最安全。 |
| `@vercel/node` | `^5`（隨平台；提供 `VercelRequest`/`VercelResponse` 型別） | TypeScript 型別與本地 function 執行 | 提供 `request.query`/`request.body`/`response.json()` 等 helper 與型別，省去手動解析。亦可改用 Web 標準 `export default { fetch(req: Request) }` 簽章（無需此套件），二者擇一。 |
| `@google/genai` | **`^2.7.0`**（現專案為 `1.35.0`，借遷移升級） | 後端呼叫 Gemini 生成分析 | 2025-05 已 GA，是 Google 官方推薦 SDK。**只在後端 import**，前端 bundle 不再含 SDK 或金鑰。要求 Node 18+（Vercel 預設 Node 22 滿足）。順手把寫死且疑似失效的模型 ID 集中到後端設定。 |
| `@upstash/redis` | **`^1.35`** | 速率限制的後端儲存（serverless Redis over HTTP） | serverless function 無常駐連線，傳統 TCP Redis 會耗盡檔案描述子；Upstash 走 **HTTP/REST**，connectionless，完美契合 Vercel function 生命週期。 |
| `@upstash/ratelimit` | **`^2.0.8`** | 端點速率限制（防 Gemini 額度被盜刷） | 業界標準的 serverless rate limiter，唯一 connectionless 設計；支援 sliding window / fixed window；Redis 不可用時可設定 fail-open。 |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| 原生 `fetch` | Node 18+ 內建（無需安裝） | 後端轉發 Yahoo/FinMind/Gemini REST 呼叫 | **預設首選**。Node 22 已內建全域 `fetch`，無需 `node-fetch`/`axios`/`undici`。Yahoo 直接由後端呼叫即可——**伺服器對伺服器無瀏覽器 CORS 限制，公用 CORS proxy 全部移除**。 |
| `zod` | `^3.24` | 驗證前端傳入的 symbol/參數 | 選用但建議。端點公開後須驗證輸入（symbol 白名單/格式），避免被當成任意轉發 proxy（SSRF）。 |
| Hono | `^4`（**不建議本案採用**，見下） | 單一 function 內路由/middleware | 僅當端點數量多到想要集中路由與 middleware 時才考慮。本案端點少（gemini / yahoo / finmind / search），檔案式 `/api` 更簡單。 |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Vercel CLI（`vercel`，現為 `^48`+） | `vercel dev` 本地同時跑前端 + `/api` functions；`vercel env pull` 同步環境變數 | `npm i -g vercel` 或 `npx vercel`。`vercel dev` 在單一 port 同時服務靜態前端與 serverless functions，最貼近線上行為。 |
| `vercel env pull .env.local` | 把雲端環境變數拉到本地 | 讓本地 `vercel dev` 取得 `GEMINI_API_KEY`、Upstash 憑證，金鑰**不進 git**。 |

---

## Installation

```bash
# 後端執行階段依賴（隨前端 app 一起 npm install，但只在 /api 內 import）
npm install @google/genai@^2.7.0 @upstash/ratelimit@^2.0.8 @upstash/redis@^1.35

# 選用：輸入驗證（建議）
npm install zod

# 開發依賴：Vercel Node function 型別
npm install -D @vercel/node

# 工具：Vercel CLI（全域或 npx）
npm install -g vercel   # 或每次用 npx vercel
```

> 注意：現有前端 `index.html` 以 `esm.sh` importmap 載入 `@google/genai`。**後端不能用 importmap**——後端 function 由 Vercel 用 `package-lock.json` 跑 `npm install` 打包，所以 `@google/genai` 必須是真正的 `node_modules` 依賴。遷移後前端不再需要在 importmap 裡保留 `@google/genai`。

---

## 各子問題的明確選型與理由

### 1) Node.js runtime vs Edge runtime — 用 Node.js

- **`@google/genai` 必須走 Node runtime。** SDK 依賴鏈含 `node-fetch`/`fetch-blob` 等 Node 取向相依，Edge 的 V8 isolate「最小 Web 標準 API 面」不保證相容。Vercel 官方目前的方向也是**建議從 Edge 遷回 Node**（相容性與可靠性更好），Edge Functions 已標示為較舊路線。
- **Yahoo/FinMind 轉發**用原生 `fetch` 即可，Node 與 Edge 都行，但既然 Gemini 端點一定要 Node，**全部統一用 Node runtime** 降低心智負擔。
- **Edge 何時才值得？** 只在「純轉發、極在意冷啟動延遲、且完全不依賴 Node API」時。本案不符合（要跑 Gemini SDK），所以不用 Edge。
- **fluid compute（2025-04 起新專案預設開啟）**對本案是利多：併發複用同一 instance、用 idle 時間處理、降低冷啟動；對 I/O-bound 的 AI/外部 API 呼叫特別有效，且把 Hobby 最長時長拉到 300s。
- 信心：**HIGH**（Vercel runtimes/limitations 官方文件，last_updated 2026-05）。

### 2) HTTP 轉發方式 — 原生 `fetch`，不需要 Hono

- Node 18+（Vercel 預設 Node 22）**全域內建 `fetch`**，轉發 Yahoo (`query1/query2.finance.yahoo.com`)、FinMind (`api.finmindtrade.com/api/v4/data`) 不需任何 HTTP client 套件。**移除 `axios`/`node-fetch` 之類**——多餘且增加 bundle。
- **不需要 Hono/Express。** 本案端點數少（建議 4 個：`/api/gemini`、`/api/yahoo`、`/api/finmind`、`/api/search`），檔案式 `/api/*.ts` 一檔一端點最直觀、零設定。Hono 的價值在「單一 function 內集中路由 + middleware（CORS/auth/logger）」；當端點成長到十幾個、想共用 middleware 時再導入。
- **CORS proxy 全部移除**：瀏覽器 CORS 限制只存在於瀏覽器→Yahoo。改由**伺服器→Yahoo**後，無此限制，`corsproxy.io`/`allorigins.win` 依賴一併消失（也消除被竄改財務資料的風險）。
- 信心：**HIGH**。

### 3) 安全讀取環境變數 — `process.env`，存 Vercel Env Vars

- 在 function 內以 `process.env.GEMINI_API_KEY` 讀取。於 Vercel 專案 **Settings → Environment Variables** 設定，套用到 Production/Preview/Development 三環境。
- **關鍵：變數名稱不要加 `VITE_` 前綴**。Vite 只會把 `VITE_*` 暴露到前端 bundle；後端金鑰**絕不能**有此前綴，否則又外洩。`GEMINI_API_KEY` 這種無前綴名稱對 Vite 前端不可見、只對後端 function 可見，正是我們要的。
- 本地：`vercel env pull .env.local` 拉下來給 `vercel dev` 用，`.env.local` 已被 git 忽略。
- 同理，Upstash 憑證 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 也存在 Vercel Env Vars。
- **徹底移除** `vite.config.ts` 裡用 `define` 把金鑰文字替換進 bundle 的程式碼（這是現有 CRITICAL 問題的根因）。
- 信心：**HIGH**。

### 4) 端點防濫用 — Upstash rate limit（主）+ Origin/密鑰檢查（輔）

金鑰藏到後端後，端點本身變成「免費的 Gemini 代理」，**必須防止他人直接打你的端點盜刷額度**。分層：

- **速率限制（主）**：`@upstash/ratelimit` + `@upstash/redis`。以 IP 或共享密鑰為 key 做 sliding window（如「每 IP 每分鐘 N 次」）。connectionless HTTP 設計適合 serverless；可設 Redis 故障時 fail-open（不阻斷正常使用者）。
  ```ts
  import { Ratelimit } from "@upstash/ratelimit";
  import { Redis } from "@upstash/redis";
  const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(20, "1 m"),
  });
  // 取 IP：req.headers['x-forwarded-for'] / x-real-ip
  ```
- **Origin/Referer 檢查（輔）**：只接受來自自己網域的請求，擋掉最低階的直接呼叫。注意：Origin 可偽造，**不可當唯一防線**。
- **共享密鑰 header（輔）**：前端帶一個 build-time 注入的 header token；提高門檻但因為前端可被讀取，**仍非強防線**（這正是「個人工具無登入系統」的取捨）。
- **Vercel WAF / Bot 管理（平台層，選用）**：Vercel managed bot ruleset 與 rate limiting/challenge action **所有方案（含 Hobby）皆可用**；但 **WAF custom rules 在 Hobby 僅 3 條、IP blocking 僅 10 條**，自訂速率限制規則多半需 Pro。所以**程式層 Upstash 速率限制仍是本案主力**，WAF 當輔助。
- **不建議**為此導入完整登入系統（Auth.js/Clerk）——超出本里程碑範圍（PROJECT.md 明列「不需要多使用者身分」）。
- 信心：rate limit 機制 **HIGH**；Hobby 上 WAF 自訂規則限制 **MEDIUM**（方案細節可能調整）。

### 5) 本地開發 — `vercel dev`

- **首選 `vercel dev`**：在單一 origin 同時服務 Vite 前端與 `/api` functions，最貼近線上行為，前端 `fetch('/api/...')` 相對路徑直接可用。
- **已知坑（需在實作期處理，LOW/MEDIUM 信心）**：Vite 與 `vercel dev` 整合有歷史摩擦——
  - `/api/*.ts` 需要 `package.json` 設 `"type": "module"`（或 `/api` 內放對應 tsconfig），否則出現 `Cannot use import statement outside a module`。
  - `vercel.json` 的 SPA rewrite 在純 Vite dev server 下行為不同，`vercel dev` 與 `vite` 預設會各起一個 port。
- **替代方案（更穩、團隊常用）**：前端照舊 `npm run dev`（Vite, port 3000），在 `vite.config.ts` 設 `server.proxy` 把 `/api` 代理到本地 `vercel dev`（或一個本地 Node 後端）的 port。開發體驗最順、Vite HMR 不受影響；缺點是要顧兩個 process。
- **建議**：先試 `vercel dev` 單進程；若遇到 Vite 整合坑，退回「Vite + `server.proxy` → `vercel dev`」雙進程方案。
- 信心：`vercel dev` 存在且支援 `/api` **HIGH**；Vite 整合無坑 **LOW**（社群普遍回報需手動調整）。

---

## Vercel Hobby（免費層）限制對本案的具體影響

| 項目 | Hobby 額度 | 對本案影響 |
|------|-----------|-----------|
| 函式最長時長 | **300s**（fluid compute 預設，default=max） | Gemini「thinking」長回應、Yahoo 多檔抓取都綽綽有餘。**註：舊文件/比較表寫的「10s/60s」已過時**，以 duration 官方頁（2026-05）的 300s 為準。 |
| Active CPU | **4 CPU-hrs / 月** | **本案最不會卡的項目**：Active CPU **不計 I/O 等待**，而本案幾乎全在等 Gemini/Yahoo/FinMind 回應。實際 CPU 消耗極低。 |
| Provisioned Memory | **360 GB-hrs / 月** | 函式記憶體×執行時間。個人用量遠低於此。長時間等待 Gemini 會吃「時長」配額而非 CPU，需留意下一列。 |
| 函式時長配額 | **100 GB-Hours / 月** | 等待 Gemini 的長請求會累積此項。個人單人使用無虞；但**請務必為每個 function 設合理 `maxDuration`**（如 gemini 60–120s、yahoo/finmind 15–30s），避免 runaway 吃光配額。 |
| 函式呼叫數 | **1,000,000 次 / 月** | 個人工具不可能達到。 |
| 記憶體上限 | **2 GB / 1 vCPU**（Hobby 不可調） | 足夠；本案非運算密集。 |
| Request/Response body | **4.5 MB** | Gemini prompt 與行情 JSON 遠低於此。若未來回傳超大歷史資料需注意。 |
| 商業用途 | **僅限非商業/個人用途**（fair-use） | 本案為個人投資工具，符合。若日後商業化須升 Pro。 |
| WAF custom rules | **3 條**；IP block **10 條** | 自訂速率限制規則受限，故**靠 Upstash 程式層速率限制**而非 WAF。 |

**Upstash Redis 免費層（2025-03 新制）**：500K commands/月、256MB、200GB 頻寬/月、最多 10 個 DB。本案每次受保護請求約 1–2 個 Redis command，個人用量遠在免費額度內。信心 **HIGH**。

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Node.js runtime | Edge runtime | 純轉發、無 Node 依賴、極在意全球冷啟動延遲時。本案因 `@google/genai` 不適用。 |
| 檔案式 `/api/*.ts` | Hono（`@hono/node-server/vercel`） | 端點數成長到十幾個、需集中 middleware/路由/錯誤處理時。Vercel 對 Hono 零設定支援良好，是未來擴張的合理升級路徑。 |
| 原生 `fetch` | `undici` / `axios` | 需要連線池、攔截器、重試策略等進階控制時。本案簡單轉發不需要。 |
| `@upstash/ratelimit` | Vercel WAF Rate Limiting SDK | 想用平台層、不想自管 Redis 時；但 Hobby 自訂規則僅 3 條，彈性不足。Pro 以上可重新評估。 |
| `@upstash/ratelimit` | `@vercel/kv`（基於 Upstash） | 想用 Vercel 整合介面時。本質仍是 Upstash，直接用 Upstash SDK 更直接、文件更全。 |
| Origin + 共享密鑰 | 完整登入（Auth.js/Clerk） | 需要真正的使用者身分/多租戶時。**超出本里程碑範圍**，PROJECT.md 明列不做。 |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `vite.config.ts` 用 `define` 注入 `GEMINI_API_KEY` | 金鑰被文字替換進前端 bundle、公開外洩（現有 CRITICAL 問題根因） | 金鑰只存 Vercel Env Vars，後端 `process.env` 讀取 |
| 變數名加 `VITE_` 前綴存放後端金鑰 | Vite 會把 `VITE_*` 暴露到前端，等於再次外洩 | 用無前綴名稱（`GEMINI_API_KEY`），前端不可見 |
| 公用 CORS proxy（`corsproxy.io`/`allorigins.win`） | 限流、停機、可竄改財務資料；伺服器端根本不需要 | 後端伺服器對伺服器直接 `fetch` Yahoo/FinMind |
| 在 Edge runtime 跑 `@google/genai` | SDK 依賴 Node API（`node-fetch`/`fetch-blob`），Edge 最小 API 面不保證相容 | Node.js runtime |
| `node-fetch` / `axios`（純轉發用途） | Node 18+ 已內建全域 `fetch`，多裝增加 bundle | 內建 `fetch` |
| 傳統 TCP 連線的 Redis（如 ioredis 直連自管 Redis） | serverless 無常駐連線，易耗盡 1,024 file descriptor 上限 | `@upstash/redis`（HTTP/REST，connectionless） |
| 在前端 importmap 保留 `@google/genai` | 遷移後前端不該再直連 Gemini | 從 `index.html` importmap 移除，僅後端依賴 |
| 不設 `maxDuration` 就放長請求 | runaway 函式吃光 Hobby「100 GB-Hours 時長」配額 | 每端點設合理 `maxDuration`（gemini 60–120s、行情 15–30s） |

---

## Stack Patterns by Variant

**若日後端點數量暴增（>10 個）或需共用 auth/CORS/logger middleware：**
- 改用 **Hono**（`@hono/node-server/vercel`），單一 function 內集中路由
- 因為檔案式 `/api` 會讓 middleware 邏輯散落各檔，Hono 集中管理更乾淨

**若日後升級到 Vercel Pro（商業化）：**
- 可評估改用 **Vercel WAF Rate Limiting**（custom rules 上限 40 條）取代部分 Upstash 邏輯
- 可開啟 **BotID Deep Analysis** 做進階防自動化濫用
- 函式最長時長可調到 800s

**若 `vercel dev` 與 Vite 整合卡關：**
- 退回 **Vite `server.proxy`** 方案：Vite（3000）負責前端 HMR，`/api` 經 proxy 轉到本地後端 port
- 因為 Vite HMR 體驗在此方案下完全不受 Vercel CLI 影響

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Node 22（Vercel 預設） | `@google/genai@^2.7.0` | SDK 要求 Node 18+，Node 22 滿足；內建全域 `fetch` |
| `@upstash/ratelimit@^2.0.8` | `@upstash/redis@^1.35` | 官方搭配；`Redis.fromEnv()` 讀 `UPSTASH_REDIS_REST_URL/TOKEN` |
| Vite 6（前端） | Vercel Functions（後端） | 兩者獨立；前端只透過相對路徑 `fetch('/api/...')` 互動。注意後端金鑰名稱**勿用 `VITE_` 前綴** |
| `@vercel/node@^5` | TypeScript 5.8（現專案） | 提供 `VercelRequest/VercelResponse` 型別；`/api` 可能需獨立 tsconfig 或 `"type":"module"` |
| `@google/genai` 1.35.0 → 2.x | 本里程碑借機升級 | 升級時順手集中/修正寫死且疑似失效的模型 ID（現有 CRITICAL 之一） |

---

## Sources

- https://vercel.com/docs/functions/runtimes/node-js — Node.js runtime、`/api` 檔案式 function、Web 標準 fetch handler 簽章、TypeScript 支援（HIGH，官方，2026-05-19）
- https://vercel.com/docs/functions/limitations — Hobby 記憶體 2GB、payload 4.5MB、file descriptor 1024、Active CPU 不計 I/O（HIGH，官方，2026-05-14）
- https://vercel.com/docs/functions/configuring-functions/duration — Hobby 最長 300s（fluid compute 預設）、`maxDuration` 設定方式（HIGH，官方，2026-05-14）
- https://vercel.com/docs/plans/hobby — Hobby 額度：4 CPU-hrs、360 GB-hrs、1M 呼叫、100 GB-Hours 時長、非商業用途限制、WAF 規則上限（HIGH，官方，2026-02-27）
- https://vercel.com/docs/functions/runtimes/edge — Edge runtime 限制（V8 isolate、最小 Web API 面、Node 函式庫不相容）（HIGH，官方）
- https://vercel.com/docs/fluid-compute — fluid compute 2025-04 起預設、I/O-bound/AI 工作優勢（HIGH，官方）
- https://www.npmjs.com/package/@google/genai — 最新 2.7.0、要求 Node 18+、2025-05 GA（MEDIUM-HIGH，npm 官方頁）
- https://www.npmjs.com/package/@upstash/ratelimit — 最新 2.0.8、sliding/fixed window、connectionless（HIGH，npm + Upstash 文件）
- https://upstash.com/docs/redis/sdks/ratelimit-ts/overview — serverless rate limit 設計、`Redis.fromEnv()` 用法（HIGH，官方）
- https://upstash.com/blog/redis-new-pricing — 免費層 500K commands/月、256MB、200GB 頻寬（2025-03 新制）（MEDIUM-HIGH，官方部落格）
- https://vercel.com/docs/frameworks/backend/hono — Hono 在 Vercel 零設定部署、何時用（MEDIUM，官方）
- https://vercel.com/kb/guide/limit-abuse-with-rate-limiting / https://vercel.com/docs/bot-management — WAF/Bot ruleset 各方案可用性（MEDIUM，官方 KB）
- https://vercel.com/blog/vercel-dev + GitHub vercel/vercel discussions #6538/#10317 — `vercel dev` 行為與 Vite 整合已知坑（LOW-MEDIUM，社群 + 官方部落格）

---
*Stack research for: Vercel serverless backend proxy layer (Gemini + Yahoo + FinMind) on Vite/React static site*
*Researched: 2026-06-01*
