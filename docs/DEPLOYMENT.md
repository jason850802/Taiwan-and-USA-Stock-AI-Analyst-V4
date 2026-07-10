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

## 6. GCP Gemini 財務防線（Billing 預算與快訊）

這是純 GCP Console 手動操作，用來在共享密鑰或限流失效時封頂每月帳單。它不是程式碼或本專案設定檔能重現的步驟，因此以下只描述 Console 操作路徑，供未來人工重做。

**為何不用「設每日配額（RPD）」做這件事**：本專案金鑰所屬 project 為付費層（Tier 1 / Postpay）。在 Console 的「配額與系統限制」頁面篩選 `per day` / `generatecontent` 後，可見的每日配額全部是 free tier 專屬的 input token 數限制，或僅限有接 Google Search grounding / Map grounding 的呼叫才會計入；本專案 `services/gemini.ts` 是純文字分析呼叫、未使用 Search/Map grounding，因此不受這些 per day 配額影響。付費層對一般 GenerateContent 請求並沒有可調整的每日請求配額（RPD）可設，故舊版「編輯每日配額、設約 200 次/天」的做法在此帳戶類型下找不到對應項目、實際操作不了。真正落地的財務防線改用 Billing 的每月預算與快訊。

實際操作路徑：

1. 開啟 Google Cloud Console → Billing（帳單）。
2. 左側選 Budgets & alerts（預算與快訊）。
3. 按 Create budget（建立預算）。
4. Scope（範圍）鎖定 Gemini API key 所屬 project（本專案為 `chuan-483103`），避免涵蓋同帳單帳戶下其他 project。
5. Budget type 選 Specified amount（指定金額），設每月固定金額（本專案設約 $10 USD／月）。
6. 設定 alert thresholds 門檻 50% / 90% / 100%。
7. 通知對象勾選 email 給帳單管理員（Billing account admins/users）。

不設定任何自動化斷線動作（不接 Pub/Sub 觸發關閉服務），純 email 快訊。理由是避免誤傷同 project／同帳單帳戶下其他非 Gemini 服務（例如 BigQuery、Compute Engine）。

預算以「月」為週期計算與重置（非每日重置）。即使用 AI Studio 產生的 key，它仍歸屬某個 Google Cloud project，帳單與預算都在該 project／其帳單帳戶管理。

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
