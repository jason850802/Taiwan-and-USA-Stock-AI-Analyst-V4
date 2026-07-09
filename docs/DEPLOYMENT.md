# 部署與環境設定指南

本專案的核心紅線是：`GEMINI_API_KEY` 只存在後端環境變數，不可進前端 bundle，也不可提交到 git。Phase 4 新增的 `VITE_PROXY_SECRET` 會進 bundle，這是預期設計，用來提高外部直呼 `/api/*` 的門檻，請不要把它和 Gemini 金鑰混淆。

## 1. 環境變數清單

請以 [.env.example](../.env.example) 為準，並在 Vercel Project Settings → Environment Variables 補齊：

| 變數 | 用途 | 來源 |
| --- | --- | --- |
| `GEMINI_API_KEY` | 後端呼叫 Gemini 的真正金鑰，絕不可加 `VITE_` | Google AI Studio / Google Cloud |
| `GEMINI_MODEL_FAST` | 快速分析模型 | 專案預設或自行指定 |
| `GEMINI_MODEL_THINKING` | 深度分析模型 | 專案預設或自行指定 |
| `FINMIND_TOKEN` | FinMind 額度提升；選填，未填走公開額度 | FinMind 會員後台 |
| `ALLOWED_ORIGIN` | 允許呼叫 `/api/*` 的前端網域，逗號分隔 | 本地與部署後實際網域 |
| `PROXY_SHARED_SECRET` | 後端驗證 `X-Proxy-Secret` 的共享密鑰 | 自行產生 |
| `VITE_PROXY_SECRET` | 前端 fetch `/api/*` 時送出的共享密鑰，須與後端同值 | 同 `PROXY_SHARED_SECRET` |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL，供限流使用 | Upstash Console |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Token，供限流使用 | Upstash Console |

部署後請把實際網域（例如 `https://xxx.vercel.app`）加進 `ALLOWED_ORIGIN`。程式碼不硬編 production 網域。

## 2. 共享密鑰產生

產生一段隨機字串：

```bash
openssl rand -hex 24
```

把同一個值填入：

- 後端：`PROXY_SHARED_SECRET`
- 前端：`VITE_PROXY_SECRET`

前端會把 `VITE_PROXY_SECRET` 放進每次 `/api/*` 請求的 `X-Proxy-Secret` header。改密鑰後必須重新 `npm run build` 並重新部署，因為 `VITE_` 變數是 build-time 注入。

`VITE_PROXY_SECRET` 會出現在 `dist/` 是預期行為；它不是保護 Gemini 帳單的最後祕密，只是提高外部濫用門檻。真正不可外洩的是 `GEMINI_API_KEY`，驗收時 `grep -r "AIza" dist/` 必須為 0。

## 3. Upstash Redis 建立

1. 到 Upstash Console 建立 Redis database。
2. Region 選離 Vercel function region 較近者。
3. 進入 REST API 分頁，複製：
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. 填入 Vercel Environment Variables。

免費層對個人工具通常足夠。若 Upstash 故障或超額，本專案採 fail-open：請求會放行，並在後端 log 出現 `[guard] ratelimit unavailable, failing open`，可用性優先。

## 4. Vercel 設定

在 Vercel Dashboard → Project → Settings → Environment Variables 設定上述變數。

部署完成後，將實際 production 網域回填到 `ALLOWED_ORIGIN`，例如：

```text
ALLOWED_ORIGIN=http://localhost:3000,http://localhost:3001,https://xxx.vercel.app
```

若更新 `VITE_PROXY_SECRET`，必須重新 build/deploy；若只更新後端環境變數，也建議重新部署確認 function 讀到最新值。

## 5. FinMind token 取得

`FINMIND_TOKEN` 是選填。未填時仍可使用公開額度；填入後可提高額度。請到 FinMind 會員後台取得 token，填入 Vercel 的 `FINMIND_TOKEN`。

## 6. GCP Gemini 每日配額（最後財務防線）

這是手動操作，用來在共享密鑰或限流失效時封頂單日帳單：

1. 開啟 Google Cloud Console，選 Gemini API key 所屬 project。
2. 到 APIs & Services → Enabled APIs & services。
3. 選 Generative Language API。
4. 到 Quotas & System Limits。
5. 篩選 `GenerateContent` 與 `per day` / RPD。
6. 選 Edit quota，建議填約 200 次/天（應用層限流是 100 次/天，這裡留一點 headroom）。
7. Submit request。

RPD 通常以太平洋時間午夜重置。若使用 AI Studio 產生 key，它仍歸屬某個 Google Cloud project，配額也在該 project 管理。

## 7. 限流數值

- `/api/gemini`：每 IP 10 次/分鐘 + 100 次/天
- `/api/yahoo/chart`、`/api/yahoo/search`、`/api/finmind`：每 IP 60 次/分鐘
- 超限回 429，格式為 `{ code, message }`，前端既有錯誤 UI 會承接。

## 8. 部署後驗收清單

- 外部無密鑰 curl `/api/gemini` 應回 403。
- 對 `/api/gemini` 一分鐘連發超過 10 次，應觀察到 429。
- `curl -X OPTIONS -i` 檢查 CORS header，且不得出現 `Access-Control-Allow-Origin: *`。
- 2330 與 6488 都能顯示真實外資/投信籌碼，不應出現「籌碼暫時不可用」。
- `grep -r "AIza" dist/` 結果必須為 0。
- 若故意填錯 Upstash 變數，請求應 fail-open 放行，後端 log 應有 `[guard] ratelimit unavailable, failing open`。
