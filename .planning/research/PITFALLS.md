# Pitfalls Research

**Domain:** 在 Vercel Serverless 上代理 Google Gemini（@google/genai）、非官方 Yahoo Finance 端點、FinMind API；把 `GEMINI_API_KEY` 移到後端、加基本防濫用，前端維持既有 Vite/React SPA
**Researched:** 2026-06-01
**Confidence:** HIGH（Vercel 限制、Vite 前綴外洩、Gemini 模型策略、Yahoo crumb 行為皆有官方/一手來源佐證；FinMind 限流數字為官方文件 MEDIUM-HIGH；少數延遲體感數字為社群觀察 MEDIUM）

> 範圍：本研究聚焦「新增後端代理」的遷移風險。既有前端問題（量能基準、NaN 驗證、錯誤分類、Error Boundary）已記錄於 `CONCERNS.md`，本里程碑明確列為 Out of Scope，此處只在會被代理層放大或誤觸時點到。

---

## Critical Pitfalls

### Pitfall 1: 金鑰搬了家卻仍從前端洩漏（VITE_ 前綴 / 回應 / log 三條路徑）

**What goes wrong:**
做了後端代理，但 `GEMINI_API_KEY` 仍以三種方式回到瀏覽器或公開處：
1. 為了「方便前端讀」誤把金鑰命名為 `VITE_GEMINI_API_KEY`，Vite 在 build 時把所有 `VITE_` 前綴變數做**字面字串替換**嵌進 bundle（與現況 `vite.config.ts` 的 `define` 同樣的洩漏機制，只是換個前綴）。
2. 後端 catch 區塊把 Google 回傳的錯誤物件（可能含 request URL、含 `key=` 查詢參數）原封不動 `JSON.stringify` 回傳給前端，或 `console.log(error)` 印到 Vercel function log。
3. 把整個 Google API URL（含 `?key=...`）或 SDK 的 raw error 透傳到前端 `error` 狀態。

**Why it happens:**
既有專案的 CRITICAL 問題就是 `vite.config.ts` 用 `define` 把金鑰塞進 bundle（`CONCERNS.md` L11-17）。開發者把後端建好後，容易「複製貼上」舊習慣，或為了 debug 暫時把 key 印出來忘了拿掉。`@google/genai` 在某些錯誤路徑會把含 key 的 URL 放進 message。

**How to avoid:**
- 後端金鑰變數命名**絕不含 `VITE_`/`NEXT_PUBLIC_` 等公開前綴**；只用 `GEMINI_API_KEY`（Vercel 環境變數，不勾選 expose）。
- 移除 `vite.config.ts` 中所有與 `API_KEY`/`GEMINI_API_KEY` 相關的 `define`；前端 `services/gemini.ts` 不得再 `new GoogleGenAI({ apiKey })`，改為 `fetch('/api/gemini')`。
- 後端統一錯誤映射：永遠回傳分類後的乾淨訊息（`{ code: 'RATE_LIMIT' | 'MODEL_NOT_FOUND' | 'UPSTREAM_ERROR' }`），**絕不透傳 upstream error 原文**。
- log 前用 redact 函式遮罩 `key=[^&]+`、`apiKey` 欄位。
- build 後做一次 grep：`grep -r "AIza" dist/`（Google key 前綴）必須 0 命中，列為 CI/手動驗收項。
- proxy 上線後**輪換金鑰**（舊 key 視為已外洩，`CONCERNS.md` L21）。

**Warning signs:**
- `dist/` 中能搜到 `AIza` 或 `generativelanguage.googleapis.com?key=`。
- 前端 Network tab 對 `/api/*` 的錯誤回應 body 出現 `key=`、`AIza`、完整 Google URL。
- Vercel function log 出現完整 Google endpoint URL。

**Phase to address:** 後端骨架 + Gemini 代理階段（最早、最高優先；這是整個里程碑的根本目的）。

---

### Pitfall 2: 免費層 function 逾時砍斷 Gemini thinking 模式長回應

**What goes wrong:**
`gemini-3.1-pro-preview`（thinking 模式）對技術分析這類長提示常需數十秒才產生完整回應。Vercel Hobby（免費）標準 function **預設逾時 10s（部分舊文寫 5s）、可設定上限 60s**；若代理函式採「等 Gemini 回完整 JSON 再一次回傳」(非串流)，pro/thinking 回應就可能撞到 60s 上限被砍，前端收到 504/空白，使用者以為分析壞了。

**Why it happens:**
既有前端直接呼叫 Google，瀏覽器端沒有 serverless 逾時概念；搬到 Vercel 後**多了一個 60s 硬上限**，而 thinking 模式正好是最慢的路徑。開發者用 fast 模式（`gemini-3.5-flash`）測試時很快，沒測到 pro/thinking 的長尾。

**How to avoid:**
- 代理函式設定 `export const maxDuration = 60`（Hobby 上限），不要留預設。
- thinking/pro 路徑**改用串流**：後端以 `generateContentStream` 取得 chunk，邊收邊以 SSE/chunked 回前端。串流會在逾時前持續送出 byte，避免「整段等完才回」撞牆，也改善體感。
- 若仍不夠，評估開啟 **Fluid Compute**（Hobby 可達 300s）作為長回應的逃生門；但須確認仍在免費額度內（Budget 約束）。
- 對 pro/thinking 設定合理的 `thinkingBudget`（限制思考預算）以壓低延遲與 token 量。
- 前端對 `/api/gemini` 設定足夠的 client timeout 並顯示「分析中…」串流進度，而非固定轉圈。

**Warning signs:**
- Vercel log 出現 `Task timed out after 60.00 seconds` / 函式回 504。
- 只有 thinking/pro 模式偶發失敗、fast 模式正常。
- 回應長度越長越容易失敗（長尾被砍）。

**Phase to address:** Gemini 代理階段（決定串流 vs 一次回、設定 maxDuration）。

---

### Pitfall 3: 非官方 Yahoo 端點從伺服器 IP 呼叫被 401/crumb-cookie 挑戰

**What goes wrong:**
把 Yahoo 呼叫從「瀏覽器經公用 CORS proxy」搬到「Vercel 伺服器直接呼叫」後，行為改變：Yahoo 對 `query1/query2.finance.yahoo.com` 的 datacenter IP 更常要求 **cookie + crumb**（先 GET 取得 cookie，再 `GET /v1/test/getcrumb` 取 crumb，後續請求帶上），否則回 **401 Unauthorized / 429**。社群實測：取得 cookie/crumb 後可用，但 **約 10–20 分鐘後 cookie 過期**又被擋。Vercel 多區域、IP 共享，更易觸發限流。

**Why it happens:**
原本經 `corsproxy.io`/`allorigins.win` 時，外連 IP 是 proxy 的住宅/雲端 IP 且帶了瀏覽器式 header；搬到 Vercel 後變成可辨識的雲端 IP、且若沒有 cookie/crumb/`User-Agent`，Yahoo 反爬機制就挑戰。開發者在本機（住宅 IP）測試正常，部署到 Vercel（datacenter IP）才開始 401。

**How to avoid:**
- 後端實作完整 Yahoo 握手：(1) GET `https://fc.yahoo.com` 或任一頁取得 `Set-Cookie`；(2) 帶 cookie 呼叫 `https://query2.finance.yahoo.com/v1/test/getcrumb` 取 crumb；(3) chart/search 請求帶上 cookie + `crumb` 參數。
- 設定**瀏覽器式 `User-Agent`** 與 `Accept` header（缺省 UA 更易被擋）。
- **快取 cookie/crumb 於 function 記憶體並設短 TTL（約 10 分鐘）**，過期自動重取；不要每次請求都重握手（會放大被限流機率）。
- 對 401/429 做**指數退避重試**，並保留 FinMind 作為 TW 日線 fallback（既有架構已有）。
- 後端加**短期回應快取**（例如同 symbol/interval 30–60s），大幅減少打 Yahoo 次數。
- 評估把行情代理函式釘在**單一 region**（`vercel.json` regions），減少多 IP 觸發風險。

**Warning signs:**
- 本機正常、部署後 Yahoo 路徑回 401/429 或空資料。
- 服務啟動後前 10–20 分鐘正常，之後集體失敗（cookie 過期特徵）。
- log 出現 `Invalid Crumb` / `Unauthorized`。

**Phase to address:** Yahoo 代理階段（必須包含 cookie/crumb 握手與快取，不能只是把 fetch 搬到後端）。

---

### Pitfall 4: FinMind 免費層在伺服器共用 IP 下集中限流

**What goes wrong:**
FinMind 免費層**未登入約 300 次/小時、登入帶 token 約 600 次/小時**（依官方 API 使用次數頁）。既有設計在 TW 股每次載入會打多次 FinMind（名稱＋籌碼＋價量，`CONCERNS.md` L185）。搬到後端後，**所有使用者共用同一個 Vercel 出口 IP**，原本分散在各使用者瀏覽器 IP 的請求全部集中計數，免費額度被快速吃光，回傳空籌碼資料且**靜默 fallback 成 `[]`**（外資/投信顯示為 0，與真實 0 無法區分，`CONCERNS.md` L89-93）。

**Why it happens:**
前端直連時，限流是 per-client-IP，幾乎不會踩到；後端代理後變成 per-server-IP 的全域共用，數量級不同。開發者一個人測試時遠低於 300/hr，看不出問題。

**How to avoid:**
- 後端**取得 FinMind token 並帶上**（600/hr 較寬），token 存 Vercel 環境變數。
- **積極快取**：TW 目錄已有 7 天快取（`stockDirectory.ts`），籌碼/價量目前未快取——加上至少數分鐘～當日的快取（盤後資料一天只變一次，可快取到當日收盤後）。
- 把「籌碼資料不可用」做成**明確狀態**回前端（`chipDataUnavailable: true`），不要用 `[]` 假裝是真實 0（直接修掉 `CONCERNS.md` L89-93 在代理層被放大的問題）。
- 對 FinMind 402/429 做退避，必要時短時間內降級為「只用 Yahoo」。

**Warning signs:**
- 部署後一段時間，TW 股的外資/投信全變 0 或載入變慢。
- FinMind 回應出現 402 / `Requests reach the upper limit`。
- 同一檔股票在不同時段籌碼資料時有時無。

**Phase to address:** FinMind 代理階段（含 token、快取、unavailable 狀態）。

---

### Pitfall 5: CORS 設錯——前端打不到自家端點，或設成 `*` 失去保護

**What goes wrong:**
兩個方向都會出事：
- **太緊/設錯**：前端與 `/api` 同源時其實**不需要 CORS**；但若開發者誤加 CORS header 又設錯 origin、或沒處理 `OPTIONS` 預檢，瀏覽器擋下請求，前端「打不到自家端點」。
- **太鬆**：為了「先讓它通」設 `Access-Control-Allow-Origin: *`，等於開放任何網站從使用者瀏覽器盜用你的 Gemini 代理（額度被刷），把 Pitfall 1 的努力抵銷。

**Why it happens:**
既有前端習慣對付公用 proxy 的 CORS；遷移後容易把 CORS 心智模型套到「自家同源端點」上而過度設定。`*` 是最常見的「先求能動」捷徑。

**How to avoid:**
- **首選同源部署**：前端與 serverless 函式都在同一個 Vercel 專案／網域，`/api/*` 與 SPA 同源，**完全不需要 CORS header**。這是最簡單也最安全的路。
- 若確實需要跨網域（例如 SPA 與 API 不同網域），`Access-Control-Allow-Origin` **白名單明確網域**，**絕不用 `*`**，並正確回應 `OPTIONS` 預檢（method、headers、204）。
- CORS **不是防濫用機制**（只擋瀏覽器、擋不住 curl/伺服器端呼叫）；防濫用要靠 Pitfall 7 的措施，不要把 CORS 當保護。

**Warning signs:**
- 前端 console 出現 `blocked by CORS policy` / 預檢 `OPTIONS` 回 405。
- 回應 header 出現 `Access-Control-Allow-Origin: *`（檢視即視為紅旗）。
- 從不相干網站 / Postman 能直接呼叫到 `/api/gemini` 並成功消耗額度。

**Phase to address:** 後端骨架階段（決定同源部署策略）；防濫用階段（確認 CORS 不被誤當保護）。

---

### Pitfall 6: 模型名稱仍寫死在後端——preview 模型停用即整批失敗

**What goes wrong:**
既有程式把模型寫死為 `gemini-3.5-flash`（stable）與 `gemini-3.1-pro-preview`（**preview**）（`CONCERNS.md` L175、`INTEGRATIONS.md` L14）。把這些字串原封搬到後端常數仍沒解決根本問題：**preview 模型依官方政策可在 2 週通知後變更或停用**，一旦下架，每次分析都回 `404 model not found`，又因錯誤被壓成籠統字串（`CONCERNS.md` L84-87），使用者只看到「分析失敗」，無從判斷是模型問題。

> 註：以 2026-06 官方文件查證，`gemini-3.5-flash` 與 `gemini-3.1-pro-preview` 目前是**有效的** model ID（先前審計疑為失效屬訓練資料過時）。真正風險不是「現在無效」，而是 **preview 模型的不穩定性 + 寫死 + 錯誤分類缺失**三者疊加。

**Why it happens:**
本里程碑只把模型名稱「集中到後端設定」（Active L35），若只是搬位置而沒處理 (a) preview vs stable 選擇、(b) model-not-found 的獨立錯誤分類、(c) fallback，問題只是換地方躺著。

**How to avoid:**
- 後端用**單一可設定常數/環境變數**存模型 ID（`GEMINI_MODEL_FAST`、`GEMINI_MODEL_THINKING`），改模型不動程式碼。
- 生產預設選 **stable 模型**（官方建議 production 用具體 stable ID，而非 preview 或 `*-latest` 別名）；thinking 路徑若需 pro，評估改用 stable 的 `gemini-2.5-pro` 或當期 stable，避免長期依賴 preview。
- 把 **`MODEL_NOT_FOUND`（404）獨立成一類錯誤**，回前端可辨識的訊息，並可自動 fallback 到備援模型常數。
- 啟動時或部署後做一次健康檢查呼叫（minimal prompt）驗證設定的模型 ID 仍有效。

**Warning signs:**
- 某天起所有分析同時失敗、訊息一致為籠統「分析失敗」。
- Gemini 回應為 `404` / `model not found` / `is not supported`。
- 失敗集中在 thinking/pro 路徑（preview 模型）。

**Phase to address:** Gemini 代理階段（模型集中設定 + 錯誤分類 + stable 預設）。

---

### Pitfall 7: 防濫用「太弱（等於沒有）」或「太強（擋到自己）」

**What goes wrong:**
金鑰藏到後端後，`/api/gemini` 成為「用你的額度免費呼叫 Gemini」的公開端點。兩種失敗：
- **太弱**：只靠 CORS（擋不住伺服器端呼叫）或完全不設限，他人寫腳本直接刷爆你的 Gemini 免費額度（1,500 req/day）與 FinMind 配額。
- **太強/做錯**：在 serverless 用「程序內記憶體計數器」做 rate limit——但 serverless **無狀態、會冷啟動、多實例並存**，記憶體計數器在實例間不共享也會被回收，導致限流忽鬆忽緊；或把單一共用密鑰寫進前端 bundle（又繞回 Pitfall 1）；或閾值設太低把正常使用者擋掉。

**Why it happens:**
個人專案沒有帳號系統（PROJECT.md Out of Scope），開發者直覺用記憶體變數計數，但那在 serverless 不成立。或乾脆「之後再說」先裸奔上線。

**How to avoid:**
- **務實分層**（個人工具規模）：
  1. 後端檢查 `Origin`/`Referer` 為自家網域（擋掉最低階的跨站盜用，但知道可偽造、非主防線）。
  2. 加一個**非公開、非 `VITE_` 前綴的共用請求簽章/密鑰**——但因前端是純 SPA 無法真正藏密鑰，故此項效力有限，主要靠下一點。
  3. **以持久化儲存做 IP 速率限制**：用 Vercel KV / Upstash Redis（免費層）做 per-IP token bucket，serverless 實例共享狀態，才不會被冷啟動/多實例破功。
  4. 在 **Google Cloud 端設 per-day quota cap**（`CONCERNS.md` L20）作為最後防線——就算端點被刷，帳單有上限。
- 閾值設**寬鬆且可調**（環境變數），先觀測真實用量再收緊，避免擋到自己。
- 明確記住：**CORS 不是防濫用**（見 Pitfall 5）。

**Warning signs:**
- Gemini/FinMind 用量在沒有對應使用者活動時暴增。
- 用 in-memory 計數器時，限流行為不一致（同一人有時被擋有時不被擋）= 冷啟動/多實例特徵。
- Vercel function 呼叫數遠高於合理個人使用量。

**Phase to address:** 防濫用階段（持久化 rate limit + GCP quota cap）。

---

### Pitfall 8: 冷啟動延遲讓「原本即時」的搜尋/載入變慢，被誤判為壞掉

**What goes wrong:**
免費 Hobby 函式閒置後冷啟動約 **1–3 秒**（社群實測），疊加 Gemini/Yahoo 本身延遲。原本前端直連 Google/Yahoo 幾乎即時，搬到後端後，每個閒置後的第一次股票搜尋自動完成、行情載入都多了冷啟動延遲，使用者體感「變鈍」甚至以為當掉。bundle 越大（含 `@google/genai` 等依賴）冷啟動越久。

**Why it happens:**
serverless 本質：閒置即回收。個人工具流量稀疏 = 幾乎每次都冷啟動。開發者連續操作時函式是熱的，測不出冷啟動體感。

**How to avoid:**
- **拆分函式**：把高頻、輕量的**搜尋自動完成**獨立成小函式（依賴少、冷啟動快），不要和重依賴的 Gemini 函式綁一起。
- 控制每個函式的 bundle 大小（冷啟動與依賴大小正相關）——Gemini 函式才 import `@google/genai`，Yahoo/搜尋函式不要。
- 評估 **Fluid Compute**（Hobby 可用，能讓暖實例共享、減少冷啟動）。
- 前端對代理端點顯示 skeleton/「載入中」狀態，避免空白被當壞掉；搜尋加 debounce 減少觸發次數。
- 對行情/搜尋加短期快取（同時也解 Pitfall 3/4 的限流）。

**Warning signs:**
- 一段時間沒用後，第一次操作明顯卡 1–3 秒，之後變順。
- Vercel log 顯示冷啟動 init 時間偏高。

**Phase to address:** 後端骨架階段（函式拆分策略）；前端接線階段（載入狀態/快取/debounce）。

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| 用 `VITE_` 前綴存金鑰「方便前端讀」 | 少寫一層 fetch | 金鑰直接外洩進 bundle（等於沒搬）| **絕不** |
| 後端 Yahoo 只是把 fetch 搬過去、不做 cookie/crumb 握手 | 本機立刻能動 | 部署後 401/429，且 10–20 分後集體失效 | **絕不**（datacenter IP 必握手）|
| in-memory 記憶體做 rate limit | 不需外部儲存 | serverless 多實例/冷啟動下失效，限流不可靠 | 僅本機原型；正式須持久化儲存 |
| `Access-Control-Allow-Origin: *` 先求能動 | 馬上不被 CORS 擋 | 端點對全網開放盜用 | **絕不**（改用同源部署）|
| 模型 ID 從前端常數搬到後端常數就算「集中」 | 改了一行 | preview 下架仍整批失敗、無 fallback | 僅當同時加錯誤分類 + stable 預設 |
| upstream error 原文透傳前端方便 debug | 看得到細節 | 可能洩漏含 `key=` 的 URL | 僅本機；正式須 redact + 分類 |
| 籌碼/價量不快取，每次重打 FinMind | 程式簡單 | 共用 IP 下快速撞 300/600 次限流 | 僅低用量原型 |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Gemini (@google/genai) | thinking/pro 用「等完整回應再回傳」撞 60s 逾時 | thinking 路徑串流 `generateContentStream` + `maxDuration=60`（+ 必要時 Fluid 300s）|
| Gemini 模型 ID | 寫死 preview（`gemini-3.1-pro-preview`），下架即全掛 | 環境變數存 ID、production 用 stable、404 獨立分類 + fallback |
| Yahoo Finance | 從 Vercel IP 直接呼叫不帶 cookie/crumb → 401 | 完整 cookie→crumb 握手、瀏覽器式 UA、快取 crumb ~10 分、退避重試 |
| Yahoo Finance | 每請求都重新握手 | 記憶體快取 cookie/crumb 短 TTL，減少握手次數與被限流 |
| FinMind | 共用 IP 未帶 token、未快取 → 撞 300/hr | 帶 token（600/hr）、籌碼/價量快取到當日、unavailable 狀態 |
| Vercel CORS | 同源還硬加 CORS 或設 `*` | 前端與 `/api` 同源部署，免 CORS；跨域才白名單 origin |
| Vercel 防濫用 | in-memory 計數器 / 只靠 CORS | Vercel KV / Upstash per-IP 限流 + GCP per-day quota cap |
| Vercel 冷啟動 | 把搜尋與重依賴 Gemini 綁同一函式 | 拆函式、控 bundle 大小、輕量高頻端點獨立 |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| 冷啟動疊加上游延遲 | 閒置後首次操作卡 1–3s | 拆輕量函式、控 bundle、Fluid、前端 skeleton | 流量稀疏的個人工具幾乎每次（本專案正是）|
| 行情/籌碼零快取重打 | 載入變慢、出現 429/402 | 同 symbol 短期快取、盤後快取到當日 | 共用伺服器 IP 後，幾位使用者即觸發 |
| thinking 模式長回應非串流 | 偶發 504、長回應更易失敗 | 串流 + maxDuration 60/Fluid | 提示越長、pro 模式越易撞 60s |
| Yahoo crumb 過期未處理 | 啟動 10–20 分後集體失敗 | crumb 短 TTL 快取 + 自動重取 | 任何持續運行的部署 |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| 金鑰用 `VITE_`/`NEXT_PUBLIC_` 前綴 | 金鑰嵌進 bundle 公開外洩、被盜刷帳單 | 僅 `GEMINI_API_KEY`、不 expose；build 後 grep `AIza` 須 0 命中 |
| upstream error/URL 透傳前端或進 log | 含 `key=` 的 URL 洩漏 | 錯誤分類 + redact `key=`、`AIza` |
| `Access-Control-Allow-Origin: *` | 任意網站盜用 Gemini 代理額度 | 同源部署或白名單 origin |
| 把 CORS 當防濫用 | curl/伺服器端可繞過，額度被刷 | 真正防濫用用持久化 rate limit + GCP quota cap |
| proxy 上線後沿用舊金鑰 | 舊 key 已隨歷史 build 外洩仍有效 | 上線後立即輪換金鑰 |
| 防濫用端點裸奔 | 公開端點被腳本刷爆免費額度 | Origin 檢查 + per-IP 限流 + GCP 每日上限 |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| 冷啟動 + 上游延遲讓首次操作像當掉 | 使用者以為壞了、重整 | skeleton/「分析中…」、搜尋 debounce、輕量函式拆分 |
| thinking 長回應整段等完才顯示 | 長時間空白轉圈 | 串流逐段顯示分析內容 |
| 籌碼限流後靜默回 0 | 外資/投信誤顯示為真實 0，誤導判斷 | 明確「籌碼資料暫時無法取得」狀態 |
| 防濫用閾值設太低 | 正常連續查股被擋 | 寬鬆可調閾值，先觀測再收緊 |
| 代理失敗只回「分析失敗」 | 無法分辨限流/模型/網路 | 錯誤分類後給具體可行訊息 |

## "Looks Done But Isn't" Checklist

- [ ] **金鑰已搬到後端：** 常漏 build 後驗證 — `grep -r "AIza" dist/` 須 0 命中、移除 `vite.config.ts` 的 `define`、前端不再 `new GoogleGenAI`
- [ ] **Yahoo 代理：** 常漏 cookie/crumb 握手 — 部署到 Vercel（非本機）實測 ≥30 分鐘不出 401（涵蓋 cookie 過期週期）
- [ ] **FinMind 代理：** 常漏 token + 快取 — 連續多檔 TW 股查詢後仍未撞 300/600 次、籌碼有 unavailable 狀態
- [ ] **Gemini 模型設定：** 常漏錯誤分類 — model-not-found 回可辨識訊息、有 fallback、production 用 stable ID
- [ ] **thinking 模式：** 常漏串流 — 用最長提示測 pro/thinking 不撞 60s 逾時
- [ ] **防濫用：** 常漏「serverless 無狀態」 — 限流用持久化儲存（非記憶體）、GCP 設每日 quota cap
- [ ] **CORS：** 常漏「同源免 CORS」 — 確認沒有 `*`、預檢 OPTIONS 正確、外部 Postman 無法盜用
- [ ] **錯誤不洩漏：** 常漏 redact — 前端錯誤 body 與 Vercel log 皆無 `key=`/`AIza`/完整 Google URL

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| 金鑰仍外洩進 bundle | MEDIUM | 立即輪換金鑰、移除前綴/`define`、重 deploy、grep 驗證、檢視 GCP 用量是否被盜 |
| Yahoo 部署後 401 | MEDIUM | 補 cookie/crumb 握手 + UA、加 crumb 快取與退避；暫時加大 FinMind fallback 權重 |
| FinMind 限流 | LOW | 補 token、加快取、降級為只用 Yahoo 直到額度恢復 |
| 模型 preview 下架全掛 | LOW | 改環境變數模型 ID 為 stable、重 deploy（因已集中設定故便宜）|
| thinking 逾時 504 | LOW-MEDIUM | 改串流或開 Fluid Compute、設 thinkingBudget |
| 端點被刷爆額度 | MEDIUM | 啟用 KV/Upstash per-IP 限流、收緊閾值、GCP quota cap、必要時輪換金鑰 |
| CORS `*` 被盜用 | LOW | 改同源或白名單 origin、重 deploy |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. 金鑰仍外洩（前綴/回應/log）| 後端骨架 + Gemini 代理 | `grep AIza dist/` = 0；前端/log 無 `key=` |
| 2. thinking 逾時被砍 | Gemini 代理 | 最長提示 pro 模式不撞 60s、串流可見 |
| 3. Yahoo 401/crumb | Yahoo 代理 | Vercel 上實測 ≥30 分不出 401 |
| 4. FinMind 共用 IP 限流 | FinMind 代理 | 連續多檔查詢未撞額度、有 unavailable 狀態 |
| 5. CORS 設錯/太鬆 | 後端骨架 + 防濫用 | 無 `*`、外部無法盜用、前端同源可達 |
| 6. 模型寫死/preview 下架 | Gemini 代理 | 模型為環境變數、404 獨立分類、stable 預設 |
| 7. 防濫用太弱/太強 | 防濫用 | 持久化限流跨實例一致、GCP 有每日上限 |
| 8. 冷啟動體感 | 後端骨架 + 前端接線 | 閒置後首次操作有 skeleton、輕量函式獨立 |

## Sources

- Vercel Functions duration / Hobby 限制（預設逾時、上限 60s、Fluid 300s）— https://vercel.com/docs/functions/configuring-functions/duration ， https://vercel.com/docs/functions/limitations （HIGH）
- Vercel 冷啟動與 Fluid Compute（串流/I/O 工作負載、暖實例共享）— https://vercel.com/kb/guide/how-can-i-improve-serverless-function-lambda-cold-start-performance-on-vercel ， https://vercel.com/blog/scale-to-one-how-fluid-solves-cold-starts （HIGH/MEDIUM 體感數字）
- Vite `VITE_` 前綴字面替換進 bundle 之外洩機制 — https://vite.dev/guide/env-and-mode ， 案例：https://www.sprocketsecurity.com/blog/hunting-secrets-in-javascript-at-scale-how-a-vite-misconfiguration-lead-to-full-ci-cd-compromise （HIGH）
- Yahoo Finance cookie/crumb 與約 10–20 分過期 — https://github.com/gadicc/yahoo-finance2/issues/741 ， getcrumb 端點：https://query2.finance.yahoo.com/v1/test/getcrumb （MEDIUM-HIGH，社群一手實測）
- FinMind 免費層使用次數（未登入 300/hr、登入 600/hr）— https://finmind.github.io/api_usage_count/ ， https://finmind.github.io/quickstart/ （MEDIUM-HIGH，官方文件）
- Gemini 模型清單與 production 用 stable、preview 2 週通知政策、thinking 與 `generateContentStream` — https://ai.google.dev/gemini-api/docs/models ， https://ai.google.dev/gemini-api/docs/thinking ， https://www.npmjs.com/package/@google/genai （HIGH）
- Gemini 免費層額度（1,500 req/day 等，作為 quota cap 參考）— https://ai.google.dev/gemini-api/docs （MEDIUM）
- 既有專案稽核 — `.planning/codebase/CONCERNS.md`、`.planning/codebase/INTEGRATIONS.md`、`.planning/PROJECT.md`（HIGH，一手）

---
*Pitfalls research for: Vercel Serverless 代理 Gemini / Yahoo Finance / FinMind（金鑰後端化 + 基本防濫用）*
*Researched: 2026-06-01*
