# Phase 4: 防濫用強化 ＋ 部署驗收 - Research

**Researched:** 2026-07-09
**Domain:** Vercel Node serverless 防濫用層（持久化限流／CORS／共享密鑰／輸入驗證）＋ 部署文件
**Confidence:** HIGH（限流/CORS/IP 皆對照官方現行文件驗證；共享密鑰為工程慣例判斷 MEDIUM）

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01（Gemini 雙層限流）**：`/api/gemini` per-IP **10 次/分鐘 ＋ 100 次/天**，兩層皆用 Upstash sliding window。
- **D-02（行情單層限流）**：`/api/yahoo/*`、`/api/finmind` per-IP **60 次/分鐘**，不設日上限（CDN 命中不進 function 不計數）。
- **D-03（fail-open）**：Upstash 連不上（故障、超免費額度）時**全部端點放行**；fail-open 時後端 log 警告（如 `[guard] ratelimit unavailable, failing open`）。
- **D-04（production 網域未定）**：程式碼**不得硬編任何猜測網域**；CORS allowlist／`ALLOWED_ORIGIN` 沿用現有環境變數機制；部署文件明確指示「部署後把實際網域回填 `ALLOWED_ORIGIN`」。

### Claude's Discretion
- **共享密鑰方案**：build-time 注入前端 bundle（Vite env `VITE_*` ＋ 自訂 header）；密鑰在 bundle 可見是**已接受的設計**（HMAC 明列 Out of Scope）。header 名稱、驗證位置（`api/_lib/guard.ts` 或各端點）、後端環境變數名由 planner 定。金鑰紅線（`grep AIza dist/` = 0）**只針對 GEMINI_API_KEY**；共享密鑰入 bundle 不違反紅線，但命名要能區分兩者、部署文件要說明差異。
- **本地開發行為**：後端未設 `PROXY_SHARED_SECRET` 時跳過密鑰檢查（優雅降級，`vercel dev` 開箱即用）；設了就強制驗。
- **無 Origin 請求收緊**：共享密鑰成主防線後，Origin 檢查維持對瀏覽器的輔助防線；同源 GET fetch 可能不帶 Origin，不可只靠 Origin 擋。
- **CORS 實作**：正確處理 OPTIONS preflight、回應絕不出現 `Access-Control-Allow-Origin: *`、allowlist 沿用 `getAllowedOrigins()`。
- **超限體驗**：沿用既有 `{ code, message }`＋`RATE_LIMITED` code，回 429＋繁中訊息；前端不需新 UI。
- **Upstash 建置**：帳號區域建議與 Vercel function 區域相近、免費層額度說明寫進部署文件；環境變數 `UPSTASH_REDIS_REST_URL`／`UPSTASH_REDIS_REST_TOKEN`。
- **部署文件位置與深度**：README 章節或獨立 `docs/DEPLOYMENT.md` 由 planner 定；必涵蓋 Vercel 環境變數清單、FinMind token 取得、Upstash 建立步驟、GCP Gemini 每日配額上限設定指引（建議值以 100 次/天為基準推導）。
- **GCP 配額**：手動操作（無法程式碼驗收），文件寫清楚步驟即可，建議值由 planner 依 D-01 推導。

### Folded Todos（併入本 phase）
- **Fix invalid FinMind OTC dataset names**：`TaiwanOTCStockInstitutionalInvestorsBuySell` 與 `TaiwanOTCStockInfo` 非真實 FinMind dataset（2026-07-09 用 6488 實測確認），上櫃股籌碼／中文名從專案初始就靜默失敗。修法：
  1. `services/yahoo.ts`：`fetchInstitutionalData` 移除 `isOTC` 分支，統一 `TaiwanStockInstitutionalInvestorsBuySell`；`fetchFinMindStockInfo` 只查 `TaiwanStockInfo`。
  2. `api/_lib/finmind.ts`：`ALLOWED_DATASETS` 移除兩個不存在條目。
  3. 驗收：6488（上櫃）與 2330（上市）都顯示真實外資/投信買賣超。
  **範圍**：只改 dataset 名稱與白名單，不動 Phase 3 快取/誠實化架構；`.TWO` 後綴判斷若用於 K 線 fallback 等其他用途**不要順手改**。

### Deferred Ideas (OUT OF SCOPE)
- **HMAC 請求簽章**（REQUIREMENTS.md Out of Scope 明列）、**多金鑰輪替**、**OAuth／帳號系統**。
- **Add TW stock fundamentals tab**（獨立 phase，FinMind 白名單留擴充點但本 phase 不碰）。
- **CACHE-01**（FinMind 目錄/FX 後端快取擴充）、**STREAM-01**（Gemini 串流）、**VALID-01**（zod schema 驗證上游 payload）——皆 v2，非本 phase。
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GUARD-01 | Upstash 持久化 per-IP 速率限制（gemini 嚴、行情寬） | Standard Stack（@upstash/ratelimit 2.0.8）＋ Pattern 1（雙 Ratelimit 實例）＋ Pattern 4（IP 取得）＋ Pattern 5（fail-open） |
| GUARD-02 | CORS allowlist 只允許 production origin＋正確處理 OPTIONS preflight | Pattern 2（CORS/OPTIONS handler）＋ Pitfall 3（`*` 禁用）＋ 現有 `getAllowedOrigins()` |
| GUARD-03 | 共享密鑰驗證，阻擋非自家前端呼叫 | Pattern 3（共享密鑰 build-time 注入＋timing-safe 比對）＋ FEATURES 專節（強度分析） |
| GUARD-04 | 輸入參數白名單/驗證（interval/range/dataset），防開放代理（SSRF） | 現有 `validateChartParams`/`validateSearchParams`/`validateFinMindParams` 已建立模式；folded todo 修白名單；Security Domain V5 |
| DEPLOY-01 | `.env.example` 列出所有必要環境變數 | `.env.example` 現況＋新增 Upstash/共享密鑰項（見 Deliverable A） |
| DEPLOY-02 | 部署文件（Vercel 設定、FinMind token、GCP 每日配額上限） | Deliverable B（部署文件大綱）＋ GCP 配額步驟（Code Examples §GCP quota） |
</phase_requirements>

## Summary

本 phase 在四個既有 Vercel Node serverless 端點上統一套一層防濫用 pipeline，並補齊部署文件。技術核心已被里程碑研究鎖定且本次逐一對照現行官方文件驗證：**持久化限流用 `@upstash/ratelimit@2.0.8` + `@upstash/redis@1.38.0`**（HTTP/connectionless，跨 serverless 實例共享狀態，正解 serverless 記憶體計數器失效問題）。Gemini 端點的「10/分 AND 100/天」雙層限流**必須用兩個 `Ratelimit` 實例分別 `.limit()`**——官方明言單一實例不支援多重限制。IP 來源在 Vercel 上讀 `x-forwarded-for` 即可：Vercel 平台會覆寫此 header 且**不轉發外部 IP**（平台級防偽），因此網路上「XFF 可偽造、取最右值」的通則在 Vercel **不適用**——這是本次最重要的認知修正。

CORS 要在每個 handler（或抽共用）處理 `OPTIONS` preflight：回應 `Access-Control-Allow-Origin` 只 echo allowlist 命中的 origin、絕不 `*`、`Access-Control-Allow-Headers` 要含自訂密鑰 header。共享密鑰經 Vite build-time（`import.meta.env.VITE_*`）注入前端三個 service 呼叫點，後端用 timing-safe 比對；未設密鑰時優雅降級讓 `vercel dev` 開箱即用。fail-open（D-03）需**同時**靠 `@upstash/ratelimit` 的 `timeout` 選項（Redis 慢時放行）**與** try/catch 包住 `.limit()`（Redis 報錯/超額時放行並 log 警告）。GCP 每日配額是最後財務防線，屬手動設定，只需文件化步驟。

**Primary recommendation:** 在 `api/_lib/` 新增 `ratelimit.ts`（模組層建立兩組 Ratelimit 實例＋`Redis.fromEnv()`）與 `checkSharedSecret()`，把 `isAllowedOrigin` 升級為完整 CORS/OPTIONS 處理，組成單一 `applyGuards(req, res)` pipeline 供四端點前置呼叫；限流 identifier 用 `x-forwarded-for` 第一段、本地 dev fallback；全程 fail-open 且 log 警告。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-IP 持久化限流 | API / Backend（Vercel function）| Database / Storage（Upstash Redis）| serverless 無狀態，計數必須落在跨實例共享的外部 store；function 讀 IP、Redis 存 window |
| CORS allowlist ＋ OPTIONS preflight | API / Backend | — | preflight 與 `Access-Control-*` header 只能由回應端點設定；瀏覽器 tier 只發起、不決策 |
| 共享密鑰驗證 | API / Backend（比對）| Browser / Client（build-time 注入 header）| 密鑰在前端 bundle 可見（非機密），真正的准駁在後端 |
| 輸入白名單/SSRF 防護 | API / Backend | — | 開放代理風險只能在後端把關 upstream URL 組裝；已在各 `validate*Params` 建立 |
| GCP 每日配額上限 | External Service（Google Cloud）| — | 帳單封頂在供應商端，與應用層獨立，屬手動設定 |
| 部署文件／`.env.example` | 專案倉庫（文件）| — | 供未來部署者重建環境 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@upstash/ratelimit` | `^2.0.8` | 持久化 sliding-window per-IP 限流 | serverless 專用；connectionless HTTP，跨冷啟動/多實例共享狀態；內建 `ephemeralCache`＋`timeout`（fail-open）[VERIFIED: npm registry 2.0.8, 2026-07-09] |
| `@upstash/redis` | `^1.38.0` | Ratelimit 的儲存後端（REST client）| 無常駐連線、`Redis.fromEnv()` 讀 `UPSTASH_REDIS_REST_URL/TOKEN`；適合 Vercel Node function [VERIFIED: npm registry 1.38.0, 2026-07-09] |

> 里程碑研究 SUMMARY.md 建議 `@upstash/redis@^1.35`；registry 現行 latest 為 **1.38.0**（向後相容，採 `^1.38.0`）。`@upstash/ratelimit` 仍為 **2.0.8**（與研究一致，2026-07-09 modified）。

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node 內建 `crypto` | (runtime) | `timingSafeEqual` 常數時間比對共享密鑰 | 密鑰比對避免 timing side-channel；免額外依賴 |
| Node 18+ 內建 `fetch` | (runtime) | 既有 upstream 轉發 | 已在用，本 phase 不新增 HTTP client |

**不建議本 phase 引入 `zod`**：SUMMARY.md 曾列 zod 為建議，但 REQUIREMENTS 把「上游 payload schema 驗證（VALID-01）」明列 **v2**。GUARD-04 的輸入白名單已由現有手寫 `validate*Params`（`api/_lib/yahoo.ts`／`api/_lib/finmind.ts`）覆蓋且風格一致；本 phase 只需**複核/收緊**這些既有 validator（含 folded todo 修白名單），不必新增 zod 依賴、避免範圍膨脹與 bundle/冷啟動成本。若 planner 判斷需要，zod 屬 Claude's Discretion 外的擴張，應先確認。

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Upstash Redis | Vercel KV | Vercel KV 現已由 Upstash 提供（Marketplace 整合），底層相同；直接用 `@upstash/*` 更少抽象、環境變數更直接。CONTEXT 已鎖 Upstash。|
| 兩個 Ratelimit 實例 | 單實例多限制 | **不可行**：`@upstash/ratelimit` 單實例不支援多重限制（官方明載），雙層必須兩實例 [CITED: upstash.com/docs/.../ratelimit-ts/features] |
| `slidingWindow` | `fixedWindow` / `tokenBucket` | sliding window 平滑、無邊界突刺；research SUMMARY 與 CONTEXT D-01/D-02 已指定 sliding window |

**Installation:**
```bash
npm install @upstash/ratelimit@^2.0.8 @upstash/redis@^1.38.0
```
> 依賴雷區（CLAUDE.md）：`@upstash/*` 是**純後端依賴，只進 `package.json`，不進 `index.html` 的 esm.sh importmap**（雙處維護規則僅適用前端 runtime 依賴）。

## Package Legitimacy Audit

> slopcheck 在本環境（Windows/PowerShell，pip 未確認可用）未執行；改以官方文件對照＋npm registry 版本＋既有里程碑研究三方交叉驗證。兩套件皆為 Upstash 官方發行、下載量高、源碼倉庫公開，屬業界標準，風險極低。planner 若採 `checkpoint:human-verify` gate 亦為更安全的作法。

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@upstash/ratelimit` | npm | 成熟（2.x GA）| 高（Upstash 官方）| github.com/upstash/ratelimit-js | 未執行 | Approved（官方文件＋registry 驗證）|
| `@upstash/redis` | npm | 成熟 | 高（Upstash 官方）| github.com/upstash/upstash-redis | 未執行 | Approved（官方文件＋registry 驗證）|

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**postinstall 檢查:** 未發現高風險 postinstall（Upstash 套件為純 JS SDK）。建議 planner 在安裝任務加 `npm view @upstash/ratelimit scripts.postinstall` 一次性複核。

## Architecture Patterns

### System Architecture Diagram

```
瀏覽器（自家前端 SPA）
  │  fetch()  +  header: X-Proxy-Secret（build-time 注入）
  │  （跨源時）先發 OPTIONS preflight ──┐
  ▼                                     │
┌─────────────────────────────────────────────────────────┐
│ Vercel Node Function（/api/gemini|yahoo/*|finmind）       │
│                                                           │
│  applyGuards(req, res) pipeline:                          │
│   1. OPTIONS? → 回 CORS preflight header + 204，結束 ◀────┘
│   2. setCorsHeaders(res, origin)  ── echo allowlist origin│
│   3. isAllowedOrigin(req)         ── 瀏覽器輔助防線        │
│   4. checkSharedSecret(req)       ── 主防線（timing-safe） │
│   5. checkRateLimit(ip)  ──────────┐                      │
│                                    │  .limit(ip)          │
│   6. validate*Params(query/body)  ─┼──→ SSRF 白名單複核   │
└────────────────────────────────────┼──────────────────────┘
         │ 通過                        │
         ▼                            ▼
   upstream（Gemini/         ┌──────────────────────┐
   Yahoo/FinMind）           │ Upstash Redis (REST) │
                             │  sliding window 計數  │
                             │  跨實例共享狀態        │
                             └──────────────────────┘
              ▲ Redis 逾時/報錯 → fail-open + log 警告（D-03）

外部財務防線（手動、與應用層獨立）：
  Google Cloud → Generative Language API → RPD 配額上限（DEPLOY-02）
```

CDN 註記：FinMind 命中 `s-maxage`（既有）時請求不進 function、不計限流數——正確方向，計數只落在真正打上游的請求（CONTEXT §Integration Points）。

### Recommended Project Structure
```
api/
├── _lib/
│   ├── guard.ts        # 升級：isAllowedOrigin + setCorsHeaders + handleOptions + checkSharedSecret + applyGuards
│   ├── ratelimit.ts    # 新增：Redis.fromEnv() + 三組 Ratelimit（geminiPerMin/geminiPerDay/marketPerMin）+ getClientIp + checkRateLimit（fail-open）
│   ├── config.ts       # 沿用：getAllowedOrigins()；新增 getSharedSecret()（讀 PROXY_SHARED_SECRET）
│   ├── finmind.ts      # 修改：ALLOWED_DATASETS 移除兩個不存在 dataset（folded todo）
│   └── yahoo.ts        # 沿用 validate*Params（GUARD-04 複核）
├── gemini.ts           # 前置 applyGuards（雙層限流）
├── yahoo/chart.ts      # 前置 applyGuards（單層限流）
├── yahoo/search.ts     # 前置 applyGuards（單層限流）
└── finmind.ts          # 前置 applyGuards（單層限流）
services/
├── _shared/ (建議)     # 抽共用 fetch helper：統一加 X-Proxy-Secret header，避免三處複製
├── gemini.ts           # fetch('/api/gemini') 加密鑰 header
├── yahoo.ts            # fetch('/api/finmind'|'/api/yahoo/chart') 加密鑰 header；移除 isOTC 分支
└── stockDirectory.ts   # fetch('/api/finmind'|'/api/yahoo/search') 加密鑰 header
docs/
└── DEPLOYMENT.md (或 README 章節)  # DEPLOY-02
.env.example            # 擴充（DEPLOY-01）
```

### Pattern 1: 雙層 sliding-window 限流（兩個 Ratelimit 實例）
**What:** Gemini 端點要同時套 10/分 與 100/天；`@upstash/ratelimit` 單實例不支援多重限制，必須建兩個實例分別 `.limit()`，任一 `success===false` 即拒。
**When to use:** `/api/gemini`（雙層）；`/api/yahoo/*`、`/api/finmind` 只用單層（60/分）。
```ts
// Source: upstash.com/docs/redis/sdks/ratelimit-ts/features  [CITED]
// api/_lib/ratelimit.ts —— 實例建在模組層（handler 外），讓熱函式共享 ephemeralCache
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv(); // 讀 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN

export const geminiPerMin = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  ephemeralCache: new Map(),   // 熱函式內短路，省 Redis 呼叫
  timeout: 1000,               // Redis >1s 未回 → 放行（fail-open 第一層）
  prefix: 'rl:gemini:min',
  analytics: false,            // 省 Redis commands（免費層額度）
});
export const geminiPerDay = new Ratelimit({
  redis, limiter: Ratelimit.slidingWindow(100, '1 d'),
  ephemeralCache: new Map(), timeout: 1000, prefix: 'rl:gemini:day',
});
export const marketPerMin = new Ratelimit({
  redis, limiter: Ratelimit.slidingWindow(60, '1 m'),
  ephemeralCache: new Map(), timeout: 1000, prefix: 'rl:market:min',
});
```
`.limit()` 回傳 `{ success, limit, remaining, reset, pending, reason }`。雙層檢查：
```ts
const [a, b] = await Promise.all([geminiPerMin.limit(ip), geminiPerDay.limit(ip)]);
if (!a.success || !b.success) { /* 429 RATE_LIMITED */ }
```

### Pattern 2: CORS allowlist ＋ OPTIONS preflight（絕不 `*`）
**What:** 自訂密鑰 header 會讓瀏覽器對跨源請求先發 OPTIONS preflight；同源部署（現況規劃）瀏覽器不發 preflight，但 GUARD-02 仍要求正確處理 OPTIONS。回應只 echo allowlist 命中的 origin。
**When to use:** 所有四端點前置。
```ts
// api/_lib/guard.ts
export function setCorsHeaders(res, origin?: string) {
  const allowed = getAllowedOrigins();
  const norm = origin?.replace(/\/$/, '');
  if (norm && allowed.includes(norm)) {
    res.setHeader('Access-Control-Allow-Origin', norm); // 只回命中者，絕不 '*'
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Proxy-Secret'); // 含自訂密鑰 header
  res.setHeader('Access-Control-Max-Age', '86400');
}
// handler 最前面：
if (req.method === 'OPTIONS') { setCorsHeaders(res, getHeader(req,'origin')); res.status(204).end(); return; }
```
> 亦可用 `vercel.json` 的 `headers` 設 CORS，但**靜態 `vercel.json` 無法依 origin 動態 echo**（只能寫死單一 origin 或 `*`），與 D-04「不硬編網域」＋「絕不 `*`」衝突。**建議在 handler 程式碼處理**，dev/prod 行為一致。

### Pattern 3: 共享密鑰（build-time 注入 ＋ timing-safe 比對）
**What:** 前端用 `import.meta.env.VITE_PROXY_SECRET`（Vite build 時靜態替換為字面值進 bundle），每次 fetch 帶 `X-Proxy-Secret` header；後端用 `crypto.timingSafeEqual` 比對 `process.env.PROXY_SHARED_SECRET`。密鑰在 bundle 可見是**已接受設計**（提高門檻、非密碼學保證）。
**When to use:** 四端點主防線；未設後端密鑰時**優雅降級跳過**（`vercel dev` 開箱即用）。
```ts
// api/_lib/guard.ts
import { timingSafeEqual } from 'crypto';
export function checkSharedSecret(req): boolean {
  const expected = process.env.PROXY_SHARED_SECRET;
  if (!expected) return true;                 // 未設 → 跳過（本地 dev）
  const got = getHeader(req, 'x-proxy-secret') ?? '';
  const a = Buffer.from(got), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b); // 常數時間
}
```
```ts
// services/_shared/apiClient.ts（建議抽共用，三處呼叫點統一）
const secret = import.meta.env.VITE_PROXY_SECRET;   // Vite build-time 替換
export const proxyHeaders = secret ? { 'X-Proxy-Secret': secret } : {};
```
> **命名區分紅線**：後端 `PROXY_SHARED_SECRET`（無 `VITE_`）與前端 `VITE_PROXY_SECRET`（有 `VITE_`，值相同）是同一密鑰的兩端。金鑰紅線 `grep AIza dist/`=0 只查 GEMINI_API_KEY；共享密鑰**會**出現在 `dist/`（預期行為，勿誤判外洩）。部署文件要說明此差異。

### Pattern 4: 取得 client IP（Vercel 平台化，非通則）
**What:** Vercel 平台會**覆寫** `x-forwarded-for` 為真實 public client IP 且**不轉發外部傳入的 XFF**（平台級防偽）。因此網路通則「XFF 可偽造、取最右值」在 Vercel **不適用**——讀 `x-forwarded-for` 第一段即為可信 client IP。
**When to use:** 限流 identifier。
```ts
// api/_lib/ratelimit.ts
export function getClientIp(req): string {
  const xff = getHeader(req, 'x-forwarded-for'); // Vercel 平台覆寫，可信
  if (xff) return xff.split(',')[0].trim();
  return getHeader(req, 'x-real-ip') ?? '127.0.0.1'; // 本地 vercel dev fallback
}
```
> [CITED: vercel.com/docs/headers/request-headers] `x-forwarded-for`＝client public IP；「If you are trying to use Vercel behind a proxy, we currently overwrite the X-Forwarded-For header and do not forward external IPs. This restriction is in place to prevent IP spoofing.」`x-real-ip`／`x-vercel-forwarded-for` 與其相同。**本地 `vercel dev` 可能無此 header**（回 `::1`/undefined），需 fallback，否則限流 key 為 undefined。

### Pattern 5: fail-open（D-03，雙保險）
**What:** Upstash 不可用時全端點放行。`timeout` 選項處理「Redis 慢/連不上」；但「超免費額度／Redis 回錯」會讓 `.limit()` **throw**，須額外 try/catch 放行並 log 警告。
```ts
export async function checkRateLimit(rl: Ratelimit[], ip: string): Promise<boolean> {
  try {
    const results = await Promise.all(rl.map(r => r.limit(ip)));
    return results.every(r => r.success); // true=放行
  } catch (e) {
    console.warn('[guard] ratelimit unavailable, failing open'); // D-03 要求的警告
    return true; // fail-open
  }
}
```

### Anti-Patterns to Avoid
- **`Access-Control-Allow-Origin: *`**：等於端點對全網開放盜用（PITFALLS §Security Mistakes）。改 echo allowlist origin。
- **記憶體計數器做限流**：serverless 多實例/冷啟動下失效（PITFALLS Pitfall 7）。用 Upstash。
- **只靠 Origin 檢查擋濫用**：curl/Postman 不帶 Origin 就過（現行 `guard.ts` L15-17 的洞）。主防線改共享密鑰＋限流。
- **在 handler 內 `new Ratelimit()`**：破壞 `ephemeralCache` 熱函式共享。實例建在模組層。
- **fail-closed**：Upstash 掛掉就全站不能用，違反 D-03 可用性優先。
- **順手改 `.TWO` 後綴判斷**：folded todo 只改 dataset 名稱與白名單，K 線 fallback 等其他 `.TWO` 用途不動。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 跨實例持久化限流 | 自寫 Redis INCR + TTL sliding window | `@upstash/ratelimit` slidingWindow | 邊界突刺、原子性、時鐘漂移、ephemeral cache 都已處理 |
| fail-open 逾時 | 自寫 Promise.race timeout | Ratelimit `timeout` 選項 ＋ try/catch | 官方內建；try/catch 補「報錯」路徑 |
| Redis REST client | 自寫 fetch 包 Upstash REST API | `@upstash/redis` `Redis.fromEnv()` | 自動讀環境變數、序列化、pipeline |
| 密鑰比對 | `got === expected`（`==`）| `crypto.timingSafeEqual` | 避免 timing side-channel（Security V6）|
| client IP 解析 | 自寫多 header 優先序/最右值邏輯 | Vercel 已覆寫 `x-forwarded-for` | 平台已防偽，通則不適用，過度處理反而出錯 |

**Key insight:** serverless 限流的所有陷阱（無狀態、冷啟動、多實例、時鐘、原子性）Upstash 已封裝；本 phase 的價值在**正確組裝 pipeline 與 fail-open**，不在重造限流演算法。

## Common Pitfalls

### Pitfall 1: 雙層限流誤用單實例或未同時檢查
**What goes wrong:** 以為 `Ratelimit` 能一次設多限制，或只檢查其中一層。
**Why it happens:** 直覺以為 limiter 支援陣列。
**How to avoid:** 建兩個實例（不同 `prefix`），`Promise.all` 後 `.every(r=>r.success)`。
**Warning signs:** 100/天 從未觸發，或分鐘限流生效但日限流無效。

### Pitfall 2: 本地 dev 限流 key = undefined
**What goes wrong:** `vercel dev` 無 `x-forwarded-for`，所有請求共用 `undefined` key 或崩潰。
**Why it happens:** 平台 header 只在真 Vercel 環境注入。
**How to avoid:** `getClientIp` fallback 到 `x-real-ip`／`127.0.0.1`；本地未設 Upstash 環境變數時 `Redis.fromEnv()` 會 throw → 靠 fail-open try/catch 放行（順帶讓 dev 免 Upstash）。
**Warning signs:** 本地 `vercel dev` 一啟動就 500 或限流異常。

### Pitfall 3: CORS 設 `*` 或 preflight 未回 header
**What goes wrong:** 加自訂 header 後跨源 preflight 失敗，或圖省事設 `*` 開放盜用。
**How to avoid:** OPTIONS 回 204＋完整 `Access-Control-*`（含 `X-Proxy-Secret`）；`Allow-Origin` 只 echo allowlist 命中值。
**Warning signs:** 瀏覽器 console CORS error；或外部 Postman 竟能成功呼叫（`*` 洩漏）。

### Pitfall 4: fail-open 只靠 `timeout` 漏掉「報錯」路徑
**What goes wrong:** Redis 超免費額度回錯（非逾時），`.limit()` throw 未被接住 → 500，端點全掛（等於 fail-closed）。
**How to avoid:** try/catch 包 `.limit()`，catch 放行＋`console.warn` 警告（D-03）。
**Warning signs:** Upstash dashboard 顯示額度用盡時，端點回 500 而非放行。

### Pitfall 5（folded todo）：不存在的 FinMind dataset 靜默失敗
**What goes wrong:** `TaiwanOTCStockInstitutionalInvestorsBuySell`／`TaiwanOTCStockInfo` 非真實 dataset，上櫃股籌碼/中文名靜默回空。
**How to avoid:** `ALLOWED_DATASETS` 與 `services/yahoo.ts` 統一用 `TaiwanStockInstitutionalInvestorsBuySell`／`TaiwanStockInfo`（上市上櫃同源）。
**Warning signs:** 6488 等上櫃股顯示「籌碼暫不可用」而 2330 正常。

### Pitfall 6: 共享密鑰進 bundle 被誤判為金鑰外洩
**What goes wrong:** 驗收時 `grep` 掃 `dist/` 看到密鑰字串，誤以為違反紅線。
**How to avoid:** 紅線只查 `AIza`（GEMINI_API_KEY）；共享密鑰**應**出現在 bundle（設計如此）。部署文件與驗收步驟明確區分。
**Warning signs:** 驗收步驟寫成「dist 不得有 VITE_PROXY_SECRET」——錯誤。

## Code Examples

### applyGuards pipeline（端點前置，統一四端點）
```ts
// api/_lib/guard.ts —— 組合成單一入口
export async function applyGuards(req, res, rateLimiters: Ratelimit[]): Promise<boolean> {
  const origin = getHeader(req, 'origin');
  setCorsHeaders(res, origin);
  if (req.method === 'OPTIONS') { res.status(204).end(); return false; }
  if (!isAllowedOrigin(req))    { res.status(403).json({ code:'BAD_REQUEST', message:'請求來源不被允許。' }); return false; }
  if (!checkSharedSecret(req))  { res.status(403).json({ code:'BAD_REQUEST', message:'請求未通過驗證。' }); return false; }
  const ok = await checkRateLimit(rateLimiters, getClientIp(req)); // fail-open 內建
  if (!ok) { res.status(429).json({ code:'RATE_LIMITED', message:'請求過於頻繁，請稍後再試。' }); return false; }
  return true; // 通過，handler 繼續
}
// gemini.ts: if (!await applyGuards(req,res,[geminiPerMin,geminiPerDay])) return;
// yahoo/*, finmind.ts: if (!await applyGuards(req,res,[marketPerMin])) return;
```
> `RATE_LIMITED` code 已存在於 FinMind 分類（`api/_lib/finmind.ts`）；gemini 的 `statusByCode` 也已含 `RATE_LIMITED:429`。可全端點共用既有錯誤模型，前端既有錯誤顯示路徑自動承接。

### GCP Gemini 每日配額上限（DEPLOY-02 文件步驟）
```
Google Cloud Console → 選 Gemini API key 所屬 project
→ APIs & Services → Enabled APIs & services → "Generative Language API"
→ Quotas & System Limits 分頁
→ 篩選 "GenerateContent request ... per day"（RPD）/ "per minute"（RPM）
→ 該列右側三點 → Edit quota → 填新值 → Submit request
```
- RPD 配額於**太平洋時間午夜**重置 [CITED: docs.cloud.google.com/apis/docs/capping-api-usage]。
- 建議值：以 D-01 的 100 次/天為應用層目標，GCP 端設**略高於**該值的封頂（例如 200–300/天）作為「即使限流失效仍封頂帳單」的最後防線，而非卡到正常用量。此為建議、非硬性；由 planner 定案寫入文件。
- 提醒：AI Studio 產生的 key 仍屬某個 GCP project，配額在該 project 管理；若用免費層另有 Google 端預設限制。

## Runtime State Inventory

> 本 phase 主要為新增防濫用層＋改 dataset 白名單，非大規模 rename；但 folded todo 涉及既有資料/呼叫，逐項確認：

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Upstash Redis 為**新建** store，無既有資料需遷移；限流 key 以 `prefix` 命名空間隔離，無歷史包袱 | 無遷移；建帳號＋建 DB |
| Live service config | **GCP Gemini 配額**（存在 Google Cloud console，非 git）需手動設定；**Upstash DB region** 在 console 設定；**Vercel 環境變數** `ALLOWED_ORIGIN`/`PROXY_SHARED_SECRET`/`UPSTASH_*` 需在 Vercel dashboard 設 | 手動設定＋文件化（DEPLOY-02）|
| OS-registered state | 無（無 Task Scheduler/pm2 等）| None — verified：專案為 Vercel 部署，無 OS 級註冊 |
| Secrets/env vars | 新增 `PROXY_SHARED_SECRET`（後端）＋`VITE_PROXY_SECRET`（前端，同值）＋`UPSTASH_REDIS_REST_URL`/`_TOKEN`；既有 `GEMINI_API_KEY`/`FINMIND_TOKEN`/`ALLOWED_ORIGIN` 不變 | 更新 `.env.example`＋Vercel 環境變數＋部署文件 |
| Build artifacts | `VITE_PROXY_SECRET` 會被 build 進 `dist/`（預期）；改 `.env`/`VITE_*` 後**必須重 build** 才生效 | 部署文件註明：改共享密鑰要重新 `npm run build`＋重 deploy |

**FinMind dataset 名稱（folded todo）**：屬**程式碼白名單常數**，非外部 stored state；改 `ALLOWED_DATASETS` 陣列＋`services/yahoo.ts` 分支即可，無資料遷移。

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | 全部 | ✓ | v26.4.0 | — |
| npm | 安裝套件 | ✓ | 11.17.0 | — |
| TypeScript (tsc) | `tsc --noEmit` 驗證 | ✓ | 5.8.3 | — |
| Vercel CLI | `vercel dev` 本地驗證 | ✓ | 54.21.1 | — |
| Upstash Redis 帳號 | GUARD-01 限流 | ✗（外部服務）| — | **fail-open**：本地未設 `UPSTASH_*` 時 `Redis.fromEnv()` throw → checkRateLimit try/catch 放行，dev 免 Upstash 可跑 |
| Google Cloud console 存取 | DEPLOY-02 配額設定 | ✗（手動）| — | 無——屬文件化步驟，無法程式碼驗收 |

**Missing dependencies with no fallback:** GCP console 存取（手動步驟，只需文件化，不阻塞程式實作）。
**Missing dependencies with fallback:** Upstash 帳號——本地 dev 靠 fail-open 免建；但**production 驗收（成功標準 2「限流跨 serverless 實例一致」）必須在真 Vercel 環境＋真 Upstash 實測**，本機無法覆蓋（同 Phase 2 crumb 的部署後實測要求）。

## Validation Architecture

> nyquist_validation=true，但本專案**刻意無自動化測試跑道**（CLAUDE.md：無 test runner／lint，tsconfig 非 strict；自動化測試在 REQUIREMENTS Out of Scope）。以下反映專案實際驗證手段。

### Test Framework
| Property | Value |
|----------|-------|
| Framework | **none**（專案無 test runner；驗證＝tsc + build + 手動 curl/瀏覽器）|
| Config file | none |
| Quick run command | `npx tsc --noEmit` |
| Full suite command | `npx tsc --noEmit && npm run build`（build 後 Bash `grep -r "AIza" dist/` 須 0）|

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GUARD-01 | per-IP 限流跨實例一致、超限回 429 | manual（需真 Vercel＋Upstash）| 部署後 curl 連發觀察 429；本機無法驗跨實例 | ❌ 手動 |
| GUARD-02 | 無 `*`、OPTIONS 正確、preflight 通過 | manual + smoke | `curl -X OPTIONS -i` 檢查回 header；`curl -i` 檢查無 `Allow-Origin: *` | ❌ 手動 |
| GUARD-03 | 帶密鑰通過、不帶/錯密鑰被擋、未設密鑰降級 | manual | `curl` 帶/不帶 `X-Proxy-Secret` 比對 200/403 | ❌ 手動 |
| GUARD-04 | 非法 interval/range/dataset 回 400；6488 籌碼正常 | manual | `curl` 打非白名單 dataset 回 400；6488/2330 籌碼實測 | ❌ 手動 |
| DEPLOY-01/02 | 環境變數齊全、文件可依循重建 | manual review | 人工核對 `.env.example` 與文件 | ❌ 手動 |
| （型別/建置）| 全端點編譯通過、金鑰未外洩 | automated | `npx tsc --noEmit && npm run build && grep -r "AIza" dist/`（Bash）| ✅ |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit`
- **Per wave merge:** `npx tsc --noEmit && npm run build`＋Bash `grep -r "AIza" dist/`=0（＋確認共享密鑰**有**進 dist 屬預期）
- **Phase gate:** 部署到 Vercel＋真 Upstash 後，手動 curl 驗收五條成功標準（外部 curl 無密鑰被擋、限流 429、無 CORS `*`、非法輸入 400、6488 籌碼正常）

### Wave 0 Gaps
- None — 專案刻意無測試基礎設施（REQUIREMENTS Out of Scope「自動化測試建置」）。驗證沿用 tsc + build + grep + 手動 curl/瀏覽器；planner **不應**在本 phase 新建 test framework（範圍膨脹）。

## Security Domain

> security_enforcement=true，ASVS Level 1，block_on=high。

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | 無帳號系統（PROJECT Out of Scope）；共享密鑰屬 access gate 非使用者驗證 |
| V3 Session Management | no | 純 SPA 無 server session |
| V4 Access Control | **yes** | 共享密鑰（timing-safe 比對）＋ Origin allowlist ＋ per-IP 限流組成縱深防禦；主防線=密鑰＋限流 |
| V5 Input Validation | **yes** | `validate*Params` 白名單（interval/range/dataset/data_id/date pattern）防開放代理（SSRF）；GUARD-04 核心 |
| V6 Cryptography | **partial** | 密鑰比對用 `crypto.timingSafeEqual`（非自寫 `==`）；HMAC 簽章明列 Out of Scope，不引入 |
| V7 Error Handling & Logging | yes（既有）| `{code,message}` 不透傳上游原文；log 前綴 `[scope:code]`、redact `key=`/`AIza`；fail-open 加 `console.warn` |

### Known Threat Patterns for Vercel Node proxy + 個人工具
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| 開放代理／SSRF（把端點當任意 upstream 轉發）| Tampering / Info Disclosure | 輸入白名單：dataset allowlist、symbol/interval/range enum、data_id regex（已建，GUARD-04 複核）|
| Gemini/FinMind 額度盜刷（腳本直呼端點）| Elevation / DoS | 共享密鑰＋per-IP 限流＋GCP 每日配額（縱深）|
| 跨站盜用（他站瀏覽器 JS 打端點）| Spoofing | CORS allowlist（echo origin，不 `*`）+ 共享密鑰 |
| IP 偽造繞限流 | Spoofing | Vercel 覆寫 `x-forwarded-for` 且不轉發外部 IP（平台防偽）；讀首段即可信 |
| 密鑰比對 timing side-channel | Info Disclosure | `crypto.timingSafeEqual`（常數時間）|
| fail-open 被利用（打爆 Upstash 後無限流）| DoS | 縱深：即使限流失效，共享密鑰＋GCP 每日配額仍封頂財務風險（D-03 明確接受）|

> **誠實標註**：共享密鑰在前端 bundle 可見，對能讀 DevTools 的人非機密（FEATURES.md 專節已定調）。其價值是把「全網可盜刷」降為「願逆向 app 者才能」，配合 GCP 每日配額對未公開推廣的個人工具為合理且足夠強度。HMAC 屬 Out of Scope，不在本 phase 提升。

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Vercel KV（獨立品牌）| Vercel Marketplace 整合 Upstash（底層同源）| 2024–2025 | 直接用 `@upstash/*`＋`UPSTASH_*` 環境變數最直接；CONTEXT 已鎖 |
| XFF「取最右值防偽」通則 | Vercel 平台覆寫 XFF、不轉發外部 IP → 讀首段即可信 | 平台特性 | 本專案**不套用**通則的最右值邏輯，避免過度處理出錯 |
| Upstash 免費層 10K commands/日 | **500K commands/月**（≈16.7K/日）| 2025-03 起 | 單人工具＋dual limit＋ephemeralCache 遠在額度內；fail-open 保底 [CITED: upstash.com/pricing/redis] |

**Deprecated/outdated:**
- SUMMARY.md 的 `@upstash/redis@^1.35` → 現行 latest `1.38.0`（相容升級）。
- SUMMARY.md 曾建議 zod：本 phase 不採（VALID-01 屬 v2，避免範圍膨脹）。

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Upstash 免費層 500K commands/月足以支撐單人 dual-limit 用量 | State of the Art | 低——即使超額，fail-open 放行不阻塞；只是限流暫失效（已被 GCP 配額＋密鑰兜底）|
| A2 | Vite build 對 `import.meta.env.VITE_*` 的靜態替換不受 index.html esm.sh importmap 影響（services/*.ts 由 Vite 打包，env 替換為 build 期轉換，與 importmap 執行期解析無關）| Pattern 3 | 中——若替換未生效，前端不帶密鑰、被後端擋。**驗收**：build 後 `grep VITE_PROXY_SECRET dist/` 應見到實際密鑰值（非變數名）。建議 planner 加此驗收步驟。 |
| A3 | GCP 配額建議值 200–300/天（D-01 的 100/天＋headroom）| Code Examples | 低——屬文件建議值，planner 可調；使用者手動設定 |
| A4 | 同源部署下瀏覽器不發 OPTIONS preflight（自訂 header 於跨源才觸發）| Pattern 2 | 低——GUARD-02 仍要求正確處理 OPTIONS，程式已涵蓋；同源與否都安全 |

**A2 特別提示 planner**：這是唯一「機制層」假設，且與 CLAUDE.md 的「雙處維護 importmap」特殊架構相關。實作後**務必**用 build+grep 確認密鑰確實注入前端 bundle，否則 GUARD-03 前端側靜默失效。

## Open Questions

1. **共享密鑰值如何產生與保管？**
   - What we know：build-time 注入、bundle 可見、後端 `timingSafeEqual` 比對。
   - What's unclear：由誰產生一組隨機值、放哪（本地 `.env` + Vercel 環境變數 + 前端 `VITE_`）。
   - Recommendation：部署文件給「產生一段隨機字串（如 `openssl rand -hex 24`）→ 同值填後端 `PROXY_SHARED_SECRET` 與前端 `VITE_PROXY_SECRET`」的步驟；planner 定 header 名稱（建議 `X-Proxy-Secret`）。

2. **Upstash DB region 選哪個？**
   - What we know：CONTEXT 建議與 Vercel function 區域相近以降延遲。
   - What's unclear：本專案 Vercel function 實際部署區域未定（尚未部署過）。
   - Recommendation：部署文件建議選離 Vercel project region 最近者（台灣使用者＋Vercel 預設 region 常為 `sfo1`/`hnd1`；Upstash 選對應 region）；限流走 ephemeralCache 熱路徑短路，region 延遲影響有限。

3. **production 網域（D-04）**
   - What we know：尚未部署，程式不硬編。
   - Recommendation：部署後回填 `ALLOWED_ORIGIN`＝實際網域（如 `https://xxx.vercel.app`）；文件列為明確步驟。已鎖定，非阻塞。

## Sources

### Primary (HIGH confidence)
- [Vercel Request headers](https://vercel.com/docs/headers/request-headers) — `x-forwarded-for` 平台覆寫、不轉發外部 IP、防偽（last_updated 2025-12-13）
- [Upstash Ratelimit Features](https://upstash.com/docs/redis/sdks/ratelimit-ts/features) — 單實例不支援多限制、ephemeralCache、timeout（fail-open）、analytics
- [Upstash Redis Pricing](https://upstash.com/pricing/redis) — 免費層 500K commands/月
- [Google Cloud — Capping API usage / Quotas](https://docs.cloud.google.com/apis/docs/capping-api-usage) — Quotas & System Limits 頁 Edit quota、RPD 太平洋午夜重置
- npm registry（2026-07-09）：`@upstash/ratelimit@2.0.8`、`@upstash/redis@1.38.0`、`zod@4.4.3`（版本驗證）
- 既有程式碼：`api/_lib/guard.ts`、`config.ts`、`finmind.ts`、`api/gemini.ts`、`api/yahoo/{chart,search}.ts`、`api/finmind.ts`、`services/{gemini,yahoo,stockDirectory}.ts`、`vite.config.ts`

### Secondary (MEDIUM confidence)
- [Vercel KB — How to enable CORS](https://vercel.com/kb/guide/how-to-enable-cors) — OPTIONS handler 模式、setHeader
- [How X-Forwarded-For works / perils](https://adam-p.ca/blog/2022/03/x-forwarded-for/) — 通則（在 Vercel 被平台特性覆蓋，故不套用）
- 里程碑研究 `.planning/research/{PITFALLS,FEATURES,SUMMARY}.md` — 防濫用縱深組合、共享密鑰強度、stack 建議

### Tertiary (LOW confidence)
- 各 CORS/rate-limit 教學部落格（僅佐證通用模式，已與官方交叉驗證）

## Metadata

**Confidence breakdown:**
- Standard stack：HIGH — 版本 npm registry 驗證、官方文件對照
- Architecture（限流/CORS/IP/fail-open）：HIGH — 全對照 Vercel/Upstash 現行官方文件
- 共享密鑰強度判斷：MEDIUM — 工程慣例＋FEATURES 專節，非單一權威來源（已誠實標註）
- Vite env 注入不受 importmap 影響：MEDIUM — 機制推理，A2 要求 build+grep 實測驗收
- GCP 配額步驟：MEDIUM-HIGH — 官方文件路徑，UI 細節可能隨版本微調

**Research date:** 2026-07-09
**Valid until:** 2026-08-09（Upstash/Vercel 為活躍平台，30 天內複驗版本；Gemini 模型 ID 與 GCP UI 變動較快）
