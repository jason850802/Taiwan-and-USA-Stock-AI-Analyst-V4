# Feature Research

**Domain:** 為現有純前端台股/美股 React App 新增「Vercel Serverless 後端 API 代理層」（代理 Gemini / Yahoo Finance / FinMind，隱藏 `GEMINI_API_KEY`，防端點濫用）
**Researched:** 2026-06-01
**Confidence:** HIGH（Vercel 限制與代理模式以官方文件＋多來源驗證；個人工具的取捨判斷為工程慣例，標註於各項）

---

## 範圍提醒

本里程碑是「架構轉型」而非新產品：前端功能（搜尋、指標、進場過濾、AI 報告、庫存）已完成且**不在本研究範圍**。本文件只盤點「一個保護金鑰、轉發第三方 API 的後端代理層」這類元件**典型該具備的行為**，並依「個人、不公開推廣的工具」這個現實情境做取捨。

核心驅動需求（來自 `PROJECT.md` Active ＋ `CONCERNS.md`）：
1. **CRITICAL** — `GEMINI_API_KEY` 經 `vite define` 內嵌進前端 bundle，任何已部署版本都外洩金鑰、可被盜刷 Google 帳單。
2. 所有 Yahoo 行情繞經公用 CORS proxy（`corsproxy.io` / `allorigins.win`），有限流、停機、竄改財務資料風險。
3. Gemini 模型名稱寫死且疑似失效，失效時整批分析直接失敗。

> **關鍵平台事實（HIGH，Vercel 官方文件 2026-05-14）：** Hobby（免費）方案在 Fluid Compute（現為預設）下，函式 `maxDuration` 預設與上限皆為 **300 秒**；記憶體 2 GB/1 vCPU；**請求與回應 body 上限各 4.5 MB**。等待第三方 I/O（呼叫 AI、抓行情）**不計入 active CPU 時間計費**。這推翻了網路上仍流傳的「Hobby 只有 10 秒/60 秒」舊資訊，並直接影響下方「串流」與「批次代理」的取捨。

---

## Feature Landscape

### Table Stakes（沒有就「不安全」或「不可用」）

一個 API 代理層若缺這些，等於沒達成本里程碑目的，或代理本身不能正確運作。

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **伺服器端金鑰注入（金鑰只存在 Vercel 環境變數）** | 本里程碑的根本目的；金鑰絕不可再進前端 bundle 或 git | LOW | `process.env.GEMINI_API_KEY` 只在 serverless handler 讀取；移除 `vite.config.ts` 的 `define` 注入；前端 bundle 不得再出現金鑰字串。部署後**輪換舊金鑰**（舊金鑰須視為已外洩） |
| **Gemini 呼叫代理端點** | 前端不得再 `new GoogleGenAI({apiKey})`；改打自家 `/api/...` | LOW | 一個 `/api/gemini` handler 接收 prompt/模型/config，伺服器端帶金鑰呼叫 `ai.models.generateContent`，回傳 markdown 文字 |
| **Yahoo Finance 行情/搜尋代理端點** | 移除前端對公用 CORS proxy 的依賴（消除竄改/限流風險） | LOW | `/api/yahoo`（chart + search）。後端對 Yahoo 是 server-to-server 呼叫，**沒有瀏覽器 CORS 限制**，可直接打 `query1/query2.finance.yahoo.com`，公用 proxy 整個移除 |
| **FinMind 呼叫代理端點** | 目錄、籌碼、價量、中文名稱統一走後端 | LOW | `/api/finmind`。後端集中呼叫可順帶上 FinMind token（若有）並做快取（見下） |
| **CORS：只允許自家前端 Origin** | 防止他人網站直接從瀏覽器盜用你的端點額度 | LOW | 回應 `Access-Control-Allow-Origin` 只列自家 production 網域（＋本機 dev origin）；正確處理 `OPTIONS` preflight。**注意：CORS 只擋瀏覽器跨站，擋不了 curl/腳本**，故須搭配下方「防濫用」 |
| **回應正規化：維持既有領域型別** | Constraint 明定資料服務層回傳的 `StockDataPoint[]` 等型別不變，避免動到圖表/過濾器/提示詞 | MEDIUM | 後端做與既有 `processYahooResult` 等價的整形，或前端保留整形、後端只透傳原始 JSON。**建議：把整形邏輯整段搬到後端**，前端拿到的就是乾淨領域型別，順便集中 null 處理 |
| **錯誤分類與對應（meaningful errors）** | `CONCERNS` 指出所有錯誤被壓成 generic string，呼叫端只能分辨「API Key is missing」 | MEDIUM | 後端把上游失敗對應成穩定的錯誤類別：`UPSTREAM_RATE_LIMIT`(429) / `UPSTREAM_AUTH`(401-403) / `MODEL_NOT_FOUND`(Gemini 404) / `BAD_TICKER`(空結果) / `UPSTREAM_DOWN`(5xx/timeout) / `PARSE_ERROR`。回 JSON `{code, message}`，前端依 code 顯示中文訊息。**直接解掉「模型寫死失效時整批靜默失敗」** |
| **Gemini 模型名稱集中於後端設定** | 寫死且疑似失效的 model ID 是 active 需求；搬遷時一併修正 | LOW | 後端一個常數/環境變數定義 fast/thinking 模型；模型不存在時回 `MODEL_NOT_FOUND` 而非 generic fail。可附 fallback 模型 |
| **端點基本防濫用（速率限制或共享密鑰，二擇一以上）** | 金鑰藏到後端後，端點本身變成新的攻擊面；裸端點＝把盜刷風險從「金鑰外洩」換成「端點被刷」 | MEDIUM | 見下「驗證 vs 速率限制」分析。**對個人工具，IP 速率限制即為 table stakes 下限**；共享密鑰是更強的加分 |
| **`.env.example` 與部署設定文件** | `CONCERNS` 指出 `.gitignore` 已 whitelist 但檔案不存在；新環境無從得知必要變數 | LOW | 列出 `GEMINI_API_KEY`、（可選）`FINMIND_TOKEN`、`ALLOWED_ORIGIN`、`PROXY_SHARED_SECRET` 等 |

### Differentiators（額外價值，非必要但顯著划算）

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **後端快取：FinMind 目錄/籌碼 + FX 匯率** | FinMind 免費層限流，目錄/籌碼/匯率是高重複、低變動資料；快取大幅省第三方額度且加速 | MEDIUM | TW 股目錄每日級、FX 小時級、籌碼當日級。**個人工具優先用 Vercel CDN 快取**（`Cache-Control: s-maxage` + `stale-while-revalidate`，回應自動進 Edge 快取，**零額外服務**）。需跨函式共享精準 key 時才上 Vercel KV / Upstash Redis。前端 localStorage 目錄快取可保留為第二層 |
| **Gemini 串流回應（streaming）** | AI 報告較長，串流讓使用者「邊產生邊看」，體感延遲大降 | MEDIUM | 技術上完全可行：Hobby 在 Fluid Compute 下有 300s，遠超 Gemini 回應時間，**串流不是為了繞過 timeout，而是純 UX**。用 `generateContentStream` + Edge runtime 或 Node streaming 回 SSE/ReadableStream。**成本警示**：前端目前用 `react-markdown` 一次渲染、且有從自由文字「regex 抽決策」的脆弱解析（`Portfolio.tsx`），串流需改前端漸進渲染並確保串完才做解析。**建議列為 v1.x**，先把安全（金鑰/CORS/防濫用）做穩 |
| **共享密鑰 / 簽章驗證（在 IP 速率限制之上）** | 對「不公開推廣的個人工具」，前端內嵌一個 build-time 密鑰，能擋掉絕大多數隨機腳本濫用 | LOW–MEDIUM | 見下方專節。**對本專案足夠**：不需要帳號系統。注意密鑰會在前端 bundle 可見（提高門檻、非密碼學保證），故仍要保留 IP 速率限制與 Google 端每日配額上限做縱深防禦 |
| **上游回應 schema 驗證（zod/手寫 guard）** | `CONCERNS` 指出外部 JSON 以 `as any` 直接餵進指標數學/圖表；上游改格式時靜默產生壞數字 | MEDIUM | 在後端整形時驗證 Yahoo/FinMind 形狀，壞資料「大聲失敗」回 `PARSE_ERROR` 而非餵 NaN。與「回應正規化」天然同階段做。**注意：資料正確性修正本身在本里程碑 Out of Scope**，此處僅指「形狀驗證以利錯誤分類」，不碰量能基準等語意修正 |
| **集中常數 / 單一 `isTaiwanStock`** | `CONCERNS` 列為技術債：`PROXIES`、FinMind base、台股 regex 散落多處 | LOW | 搬到後端時自然集中；但**技術債清理在 PROJECT Out of Scope**，僅在「不額外擴張範圍」前提下順手收斂 |
| **多金鑰輪替 / 負載平衡** | 社群 Gemini proxy 常見功能，分散單金鑰限流 | MEDIUM | 個人單人用量幾乎用不到單金鑰額度；**列為 differentiator 但不建議本里程碑做**，避免過度工程 |
| **請求日誌 / 用量觀測** | 目前零觀測（僅 console）；後端可記錄端點呼叫量、上游失敗率 | LOW–MEDIUM | Vercel 內建函式 log 已可看；輕量自管即可，不必上 Sentry。屬 nice-to-have |

### Anti-Features（個人工具刻意不做 — 做了是淨負債）

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **完整 OAuth / 第三方登入** | 「保護端點」直覺聯想到登入 | 個人單人工具無多使用者；引入 IdP、callback、session 是巨大複雜度與維運負擔，與 `PROJECT` 明示「個人工具不需要多使用者身分」直接衝突 | 共享密鑰 ＋ IP 速率限制 ＋ CORS allowlist |
| **使用者帳號系統 / 多租戶** | 想「依使用者限流/隔離」 | 沒有第二個使用者；資料庫、註冊、密碼重設全是純負債 | 單一密鑰即可；用量管控交給速率限制與 Google 端每日配額 |
| **API Gateway / 自管 Auth 伺服器 / JWT 簽發** | 企業級「正規」做法 | Vercel serverless 已含路由與環境變數；再疊一層 gateway/JWT 簽發是為一個人架基礎設施 | 直接用 Vercel function handler ＋ 環境變數 |
| **資料庫 just for 速率限制** | 教學常示範 Redis 計數器 | 為個人工具的限流養一個 always-on 資料庫過重 | 優先用 in-memory（熱函式內計數）＋ Vercel CDN 快取；真要持久化才用 Upstash（HTTP、免連線、有免費層） |
| **付費/官方行情供應商整合** | 想根治 Yahoo 非官方端點不穩 | `PROJECT` 明示本次沿用 Yahoo/FinMind、不換供應商；換供應商是獨立主題 | 本里程碑只「改由後端呼叫」；穩定性/正確性修正留後續里程碑 |
| **語意層級資料正確性修正（量能基準、盤中量能預估、NaN 驗證）** | 既然動到資料層「順手修」 | `PROJECT` 明列為下一個里程碑、刻意避免範圍膨脹 | 本里程碑只搬遷與整形透傳；語意修正獨立進行 |
| **React Error Boundary / 全站免責聲明 UI** | 與錯誤處理相關 | `PROJECT` 列為後續穩定性/UX 里程碑 | 本里程碑只做「後端錯誤分類回傳」，前端 UI 呈現留後續 |
| **WAF / DDoS 級防護 / Captcha** | 「防濫用」極端化 | 個人、不公開推廣的工具不是 DDoS 目標；Captcha 破壞自用體驗 | Vercel 平台層已有基礎防護；應用層維持 IP 限流＋密鑰即足夠 |
| **自動化測試建置** | 動到核心資料路徑想加測試 | `PROJECT` 明列獨立主題、待核心穩定後再補 | 本里程碑以「行為對使用者不變」為驗收，不在此建測試框架 |

---

## 驗證機制專節：共享密鑰／簽章 對「個人工具」是否足夠？

**結論：足夠，且為推薦下限組合（縱深防禦）。** 這是工程慣例判斷（MEDIUM confidence），非單一權威來源。

| 機制 | 擋得住什麼 | 擋不住什麼 | 對本工具評價 |
|------|-----------|-----------|-------------|
| **CORS allowlist** | 別人網站的瀏覽器 JS 跨站打你端點 | curl / Postman / 伺服器端腳本（CORS 不適用非瀏覽器） | 必備，但單獨不夠 |
| **共享密鑰（前端內嵌 header/token）** | 隨機掃描、不知道密鑰的腳本 | 願意打開 DevTools 抄走密鑰的人（前端 bundle 可見） | 提高門檻、足以擋 99% 隨機濫用；對「不公開推廣」工具夠用 |
| **IP 速率限制** | 同一來源高頻盜刷、把單一濫用者的傷害封頂 | 分散 IP 的協同濫用（個人工具非目標） | 必備；把「最壞情況花費」封頂 |
| **HMAC 簽章（時間戳＋密鑰簽請求）** | 重放、竄改；比裸 token 強 | 仍需密鑰在前端；對單人工具屬過度 | 加分但非必要；裸共享密鑰已足夠 |
| **Google 端每日配額上限（在 Gemini 主控台設）** | 把帳單絕對上限封死，與應用層獨立 | — | **強烈建議同時設定**，最後一道財務防線 |

**建議組合（依個人工具強度）：** CORS allowlist ＋ 前端內嵌共享密鑰 ＋ IP 速率限制（in-memory 為主）＋ Google 端每日配額上限。**不需要** OAuth、帳號、JWT 簽發、簽章。

> 誠實標註：因為純前端 SPA 沒有真正的伺服器端 session，任何「前端持有的密鑰」對能讀 bundle 的人都不是機密。其價值是把「全網任何人都能盜刷」降為「願意逆向你 app 的人才能」，對未公開推廣的個人工具，這個門檻配合每日配額上限即為合理且足夠的強度。

---

## 串流（Streaming）決策摘要

- **可行性：HIGH。** Hobby + Fluid Compute 有 300s，Gemini 串流遠在限內；串流**不是**繞 timeout 的手段，純粹是 UX 升級。
- **成本：MEDIUM。** 後端 `generateContentStream` 回 SSE/ReadableStream（Edge runtime 需 25s 內開始回應、可串 300s；Node runtime 亦可串流）。前端要從「一次性 markdown 渲染」改成漸進渲染，且 `Portfolio.tsx` 「自由文字 regex 抽決策」必須等串流結束才解析。
- **取捨建議：列為 v1.x differentiator。** v1 先把安全三件套（金鑰隱藏／CORS／防濫用）與錯誤分類做穩、行為對使用者不變（非串流即可）；串流在安全地基穩固後再加，避免一次動太多前端渲染路徑。

---

## Feature Dependencies

```
[伺服器端金鑰注入] ──requires──> (移除 vite.config define ＋ 前端改打 /api)
        └──requires──> [Gemini 代理端點]
                           └──enhances──> [模型名稱集中於後端設定]
                           └──enables───> [Gemini 串流]（differentiator, v1.x）

[Yahoo 代理端點] ──removes──> [前端公用 CORS proxy 依賴]
[FinMind 代理端點] ─enables─> [後端快取（目錄/籌碼/FX）]（differentiator）

[所有代理端點] ──requires──> [CORS allowlist]
              ──requires──> [防濫用（IP 速率限制 / 共享密鑰）]
              ──requires──> [回應正規化（維持領域型別）]
                                └──enhances──> [錯誤分類與對應]
                                └──enhances──> [上游 schema 驗證]

[共享密鑰驗證] ──depends-on──> [前端服務層改接後端]（密鑰隨請求送出）
[IP 速率限制(in-memory)] ──conflicts-with──> [強一致跨函式限流]
        → 需強一致時才升級到 Vercel KV / Upstash（避免無謂引入資料庫）
```

### Dependency Notes

- **金鑰注入 requires 三個代理端點：** 金鑰藏到後端的前提是前端不再直接呼叫 Google；故 Gemini 端點是金鑰隱藏的載體，Yahoo/FinMind 端點則順帶解掉公用 proxy 風險。三者同屬地基。
- **錯誤分類 enhances 回應正規化：** 兩者都在「後端整形上游回應」這一層發生，自然同階段實作；錯誤分類直接修好「模型失效時整批靜默失敗」。
- **快取 depends-on FinMind/Yahoo 端點先存在：** 快取是在後端代理之上的優化，端點不先落地就無處可快取。優先用 Vercel CDN（`s-maxage`），避免為限流/快取硬引入資料庫（anti-feature）。
- **串流 enables-by Gemini 端點、但延後：** 串流改動前端渲染與決策解析路徑，與「行為對使用者不變」的 v1 驗收有張力，故拆到 v1.x。
- **IP 限流 vs 跨函式強一致：** in-memory 計數只在「熱」函式內有效，serverless 多實例下非全域精準。對個人工具夠用；只有需要嚴格全域配額時才升級 KV/Upstash。

---

## MVP Definition

### Launch With (v1) — 安全地基，行為對使用者不變

- [ ] **伺服器端金鑰注入** — 解 CRITICAL；移除 `vite define`，金鑰只在 Vercel 環境變數
- [ ] **Gemini 代理端點（含模型名稱集中設定）** — 前端不再碰金鑰；順修寫死失效的 model ID
- [ ] **Yahoo 代理端點** — 移除公用 CORS proxy 依賴
- [ ] **FinMind 代理端點** — 目錄/籌碼/價量/中文名稱統一走後端
- [ ] **CORS allowlist** — 只允許自家 Origin
- [ ] **防濫用：IP 速率限制 ＋ 前端共享密鑰** — 端點不裸奔；搭配 Google 端每日配額上限
- [ ] **回應正規化（維持領域型別）＋ 錯誤分類對應** — 行為不變、且修好「靜默整批失敗」
- [ ] **前端服務層改接後端（`yahoo.ts`/`stockDirectory.ts`/`gemini.ts`）** — 對使用者透明
- [ ] **`.env.example` ＋ 部署設定** — 可重現部署

### Add After Validation (v1.x) — 地基穩固後

- [ ] **後端快取（FinMind 目錄/籌碼 + FX）** — 觸發點：觀察到 FinMind 限流或想省額度；優先 Vercel CDN 快取
- [ ] **Gemini 串流回應** — 觸發點：v1 安全穩定、願意調整前端漸進渲染與決策解析時機
- [ ] **上游 schema 驗證（zod/guard）** — 觸發點：上游格式變動造成壞數字時，升級錯誤分類為形狀驗證

### Future Consideration (v2+)

- [ ] **多金鑰輪替 / 負載平衡** — 延後：單人用量遠不及單金鑰額度
- [ ] **請求日誌 / 用量觀測強化** — 延後：Vercel 內建 log 先夠用
- [ ] **HMAC 簽章** — 延後：裸共享密鑰對個人工具已足夠

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| 伺服器端金鑰注入 | HIGH（防盜刷帳單） | LOW | P1 |
| Gemini 代理端點 ＋ 模型集中設定 | HIGH | LOW | P1 |
| Yahoo 代理端點（去公用 proxy） | HIGH | LOW | P1 |
| FinMind 代理端點 | HIGH | LOW | P1 |
| CORS allowlist | MEDIUM（與密鑰互補） | LOW | P1 |
| 防濫用：IP 限流 ＋ 共享密鑰 | HIGH（封頂財務風險） | MEDIUM | P1 |
| 回應正規化（維持領域型別） | HIGH（不破壞前端） | MEDIUM | P1 |
| 錯誤分類與對應 | MEDIUM（修靜默失敗） | MEDIUM | P1 |
| 後端快取（目錄/籌碼/FX） | MEDIUM（省額度/提速） | MEDIUM | P2 |
| Gemini 串流回應 | MEDIUM（UX） | MEDIUM | P2 |
| 上游 schema 驗證 | MEDIUM | MEDIUM | P2 |
| 多金鑰輪替 | LOW（用不到） | MEDIUM | P3 |
| 用量觀測強化 | LOW | LOW–MEDIUM | P3 |

**Priority key:** P1 = v1 必備（安全＋行為不變）；P2 = v1.x 驗證後加值；P3 = v2+ 未來考慮。

---

## Competitor Feature Analysis

對照常見「serverless API key proxy」開源實作（Gemini-on-Vercel 類專案）與一般慣例：

| Feature | 社群 Gemini Proxy 常見做法 | 一般 BFF/serverless proxy | 我們的取法 |
|---------|---------------------------|--------------------------|-----------|
| 金鑰隱藏 | 環境變數＋伺服器端注入 | 同 | 採用（table stakes） |
| 多金鑰輪替 | 常見賣點 | 少見 | 不做（單人用量用不到） |
| 串流 | 多數支援 | 視情況 | v1.x 再加（UX，非繞 timeout） |
| 驗證 | 常用一個 proxy token | 多為 API key/JWT | 共享密鑰＋IP 限流（不上 OAuth/帳號） |
| 速率限制 | 常配 Upstash | 常配 gateway | 優先 in-memory＋CDN 快取，必要才 KV |
| 快取 | 不一定 | 視資料而定 | 對 FinMind 目錄/籌碼/FX 做 CDN 快取（省免費層額度） |
| 多租戶/帳號 | 否（多為單人/小團隊） | 視產品 | 明確不做（anti-feature） |

---

## Sources

- Vercel Functions Limits（官方，2026-05-14）— maxDuration（Hobby Fluid Compute 300s）、記憶體、4.5MB body、串流 25s/300s、I/O 不計 CPU 計費。HIGH。<https://vercel.com/docs/functions/limitations>
- Vercel — Configuring Maximum Duration for Functions。HIGH。<https://vercel.com/docs/functions/configuring-functions/duration>
- Upstash `@upstash/ratelimit`（serverless 連線less 限流；sliding window；熱函式快取）— 速率限制選項驗證。MEDIUM。<https://github.com/upstash/ratelimit-js> / <https://upstash.com/docs/redis/sdks/ratelimit-ts/overview>
- Ratelimit with Upstash Redis（Vercel 範本）。MEDIUM。<https://vercel.com/templates/next.js/ratelimit-with-upstash-redis>
- 社群 Gemini-on-Vercel proxy 專案（金鑰隱藏／多金鑰／串流模式之慣例參考）。LOW–MEDIUM。<https://github.com/PublicAffairs/openai-gemini> / <https://github.com/DavidKk/Vercel-Gemini-Proxy>
- 「環境變數若呼叫發生在瀏覽器仍會外洩，必須把呼叫搬到伺服器端」— 金鑰隱藏前提之佐證。MEDIUM。<https://medium.com/@amarharolikar/your-api-key-is-visible-in-the-browser-even-if-you-stored-it-as-a-secret-environment-variable-170e36b3a3f0>
- 專案內部稽核：`.planning/PROJECT.md`、`.planning/codebase/INTEGRATIONS.md`、`.planning/codebase/CONCERNS.md`。HIGH（一手）。
- 驗證機制強度、串流取捨、in-memory vs KV 之取捨：工程慣例綜合判斷。MEDIUM（標註於各項）。

---
*Feature research for: Vercel Serverless 後端 API 代理層（個人台股/美股分析工具）*
*Researched: 2026-06-01*
