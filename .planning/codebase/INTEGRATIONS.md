# External Integrations

**Analysis Date:** 2026-05-31

All integrations are called directly from the browser (no backend). Cross-origin
market-data calls are routed through public CORS proxies.

## APIs & External Services

**AI / LLM - Google Gemini:**
- Generates stock analysis reports and entry-signal analysis (technical / chip / news, BUY/SELL/HOLD with entry/stop/target levels). Output rendered as markdown.
- SDK/Client: `@google/genai` `^1.35.0` (`GoogleGenAI` client)
- Integration point: `services/gemini.ts` (large file, ~1000+ lines; functions `analyzeStockWithGemini`, `analyzeEntryWithGemini`, plus secondary analyses)
- Models: `gemini-3.5-flash` (fast mode), `gemini-3.1-pro-preview` (thinking mode); some calls hardcode `gemini-3.5-flash`
- Calls: `ai.models.generateContent({ model, ... })`
- Prompt template: `prompts/持股庫存健檢系統_AI提示詞_adapted.md` (portfolio health-check prompt)
- Auth: `process.env.API_KEY` (from `GEMINI_API_KEY` in `.env`, injected by `vite.config.ts`). Each function guards with `if (!process.env.API_KEY) throw new Error("API Key is missing.")`.

**Market Data - Yahoo Finance:**
- Primary OHLC/price/volume source for TW and US stocks, plus symbol metadata.
- Integration point: `services/yahoo.ts`
- Endpoints:
  - Chart: `https://query2.finance.yahoo.com/v8/finance/chart/{symbol}` (interval/range params, `includeAdjustedClose=true`)
  - Search: `https://query1.finance.yahoo.com/v1/finance/search` (used in `services/stockDirectory.ts`)
- Auth: None (public endpoints)
- Access: routed through CORS proxies (Yahoo blocks direct browser CORS). Multiple proxies tried in sequence with retry/fallback (`fetchRawData` / `queryYahoo`).

**Market Data - FinMind:**
- Secondary/fallback source for Taiwan stocks: institutional investor (chip) data, price/volume, Chinese stock names, and the full TW stock directory.
- Integration point: `services/yahoo.ts` and `services/stockDirectory.ts`
- Endpoint: `https://api.finmindtrade.com/api/v4/data` (datasets e.g. `TaiwanStockInfo`, price/volume, institutional)
- Auth: None observed (public/anonymous tier)
- Role: fallback when Yahoo fails for TW daily data; authoritative for TW chip/volume and Traditional-Chinese names.

**CORS Proxies (infrastructure):**
- Used to reach Yahoo/FinMind from the browser:
  - `https://corsproxy.io/?`
  - `https://api.allorigins.win/raw?url=`
- Declared in `services/yahoo.ts` and `services/stockDirectory.ts`; tried in order with fallback.

**CDN (runtime dependency delivery):**
- `https://esm.sh/...` - import map in `index.html` loads React, `@google/genai`, `recharts`, `lucide-react`, `react-markdown`, `remark-gfm` at runtime.
- `https://cdn.tailwindcss.com` - Tailwind Play CDN.
- `https://fonts.googleapis.com` - Inter font.

## Data Storage

**Databases:**
- None. No server-side datastore, ORM, or backend.

**File Storage:**
- Local filesystem only (static build output in `dist/`).

**Client-Side Persistence (browser `localStorage`):**
- Portfolio holdings: key `portfolio_items` (read/written in `App.tsx`, `useState` initializer + `useEffect`).
- TW stock directory cache: keys `tw_stock_directory_v1` (+ timestamp key) in `services/stockDirectory.ts`, refreshed from FinMind on expiry.

**Caching:**
- In-memory + `localStorage` caching of the TW stock directory (`stockDirectory.ts`). No HTTP-layer caching.

## Authentication & Identity

**Auth Provider:**
- None. No user accounts or login. The only credential is the Gemini API key (client-side).

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/equivalent). Errors surfaced to the UI via `error` state in `App.tsx` and logged with `console.warn` / `console.error` / `console.log` in services.

**Logs:**
- Browser console only.

## CI/CD & Deployment

**Hosting:**
- Static site origin from Google AI Studio (README ai.studio link). Artifact: `dist/`.

**CI Pipeline:**
- None detected (no `.github/workflows`, no CI config).

## Environment Configuration

**Required env vars:**
- `GEMINI_API_KEY` - Google Gemini API key. Without it all AI functions throw "API Key is missing."

**Secrets location:**
- `.env` at repo root (git-ignored via `.gitignore`: `.env`, `.env.*`, with `.env.example` allowed). Never commit.
- SECURITY NOTE: `vite.config.ts` injects the key via `define` into client-side code, so it ships in the front-end bundle. Treat as a known concern.

## Webhooks & Callbacks

**Incoming:** None.

**Outgoing:** None beyond direct client-side calls to Gemini, Yahoo Finance, and FinMind (via CORS proxies).

---

*Integration audit: 2026-05-31*
