# BL-4a／BL-4b Production 量測報告（2026-07-14）

**量測環境**：Vercel production（taiwan-and-usa-stock-ai-analyst-v4.vercel.app）、內建瀏覽器、桌面寬頻。
**方法**：每輪新分頁（sessionStorage 冷）＋fetch hook 對 `/api/` 強制 `cache:'no-store'`（等同 DevTools Disable cache，繞過瀏覽器 HTTP 快取、CDN 語意不變）；hook 記錄 app 自身請求的精確 timing＋`x-vercel-cache`；UI 首繪＝spinner/骨架屏消失（MutationObserver）。N=3 循環、輪距 >360 秒（chart 的 s-maxage 60＋swr 300 過期）取 chart 冷樣本；CDN 冷／熱分開記。
**before**：BL-4a 於部署 `a9e4dd6`（Phase D、無 BL 改碼）後量測（06:22-06:59 UTC）。
**after**：BL-4b 於部署 `1c7db88`（BL-1/2/3＋覆核修正）後量測（10:43-11:08 UTC）。部署即清空 CDN，首輪首打＝全冷。

## Before / After 對照表（UI 首繪 ms；[樣本] → 中位數）

| 情境 | Before（BL-4a） | After（BL-4b） | 硬指標 | 判定 |
|---|---|---|---|---|
| 6488（上櫃）1d **全冷**（部署後首打，chart＋籌碼全 MISS） | 3094 | **2246** | ≤5000 | ✅（-27%） |
| 6488 1d chart冷＋籌碼熱（日常冷抓主情境） | [739, 1185] → 962 | [537, 787] → **662** | ≤5000 | ✅（-31%） |
| 2330（上市）完整管線（更新法；C1 為 chart 冷） | [1159, 460, 439] → 460 | [956, 602, 685] → 685* | ≤5000 | ✅ |
| AAPL（美股）1d 冷載 | [812, 1341, 941] → 941 | [771, 743, 653] → **743** | ≤5000 | ✅ |
| 6488 首切 1wk（chart MISS） | [572, 467, 483] → 483 | [788, 582, 582] → 582* | ≤5000 | ✅ |
| 6488 首切 1mo（chart MISS） | [455, 557, 437] → 455 | [527, 496, 436] → **496** | ≤5000 | ✅ |
| 快取命中切回 | 55ms／即時 | 0 請求／即時（無 spinner） | <300 | ✅ |
| CDN 熱全鏈（冷客戶端＋熱 CDN） | ~0.4s（chart STALE 40/HIT 41） | **~0.12s**（五路並行最長 122） | — | ✅ 更快 |
| 部署後首打網路包絡（2330 預設載入，不含名錄） | ~3.9s（串行：chart 1030→gap→trio 2447） | **~2.3s**（五路同刻並行） | — | ✅（-1.6s） |

\* 2330 更新與 1wk 的 after 中位數略高於 before——樣本間 CDN 狀態組成不同（before 的 2330 有兩筆 STALE 38/39ms 拉低中位；1wk 差異 ~100ms 在網路抖動幅度內，chart MISS 本身 320-410 vs 318-427 無回歸）。兩情境均遠低於門檻，無實質退化。

## BL-4b 硬指標判定（BL-PLAN §BL-4b）

1. **冷載入台股 1d（上市＋上櫃各一）首繪 ≤5 秒**：✅ 上櫃 6488 最壞（全冷）2.25s、日常 0.5-0.8s；上市 2330 全樣本 ≤0.96s。
2. **首次切 1wk / 1mo ≤5 秒**：✅ 0.44-0.79s。
3. **快取命中切回 <300ms**：✅ 0 請求即時。

**→ 三項全數達標，無未達標項，依檢查點 3 無需開新 backlog 條目。**

## Sonnet 覆核指定補列項（Drift #3 條件）

- **BL-2「總時間下降 ≥2 秒」**：該數字以 vercel dev 的 3.4s 串行尾巴校準。prod 的串行尾巴本來就較小（籌碼全冷 1.5-2.4s＋前端間隙 0.2-0.6s），實測 prod 節省：全冷首繪 -0.85s（3.09→2.25）、部署首打網路包絡 -1.6s（3.9→2.3）、日常冷抓 -0.3~-0.45s。**串行結構已徹底消除**（五路同刻 spread 0-3ms，三輪一致）——機制目標達成，絕對秒數依環境比例縮放。dev 環境效益另證：統測時 dev 實測 partial 首繪 ~6s vs dev 影片 before 6-8s＋首切 9-12s→現 <1s（dev 每請求代理開銷 ~5s 不變，省下的是第二串行段）。
- **BL-1「首繪 ≤5s」**：prod 全冷 2.25s ✅（正確環境的最終判定，取代 dev 字面值）。

## 兩段式在 production 的實際行為記錄

- 部署首打（CDN 全冷）：10y（1399ms）比 2y（1454ms）先到 → race 走「跳過 partial 直接 full」分支——設計的兩個分支皆在 prod 實證。
- 日常冷抓：2y 較快（380-410 vs 425-490）→ partial 先上屏 → full 到貨無感交換。
- 6488 1mo=141 根（上市 ~2015 年，<180 上限合理）；payload 4584B。
- forceRefresh（更新鈕）單段 10y 實證（僅一支 chart 請求，台股＋美股各一筆樣本）；三件套在更新路徑亦同刻並行。

## 原始數據

### BL-4a（before，部署 a9e4dd6）
- 部署首打（seed，06:22）：名錄 1717→chart 2330 10y 1030 MISS→gap 460→trio 491/2447/2041 全 MISS 串行；全鏈 ~5.7s（含名錄）
- C1（06:31-38）：6488 1d 全冷 UI 3094（chart 416 MISS、gap 630、trio 805/1170/1561 MISS）；1wk UI 572（427 MISS）；1mo UI 455（343 MISS，range=max 4626B）；AAPL 1d UI 812（469 MISS，70292B）；2330 切回 55ms；2330 更新 UI 1159（chart 378 MISS、gap 625、trio HIT 39-47）
- 熱探測（06:44）：6488 chart STALE 40／HIT 41；trio HIT 31-114
- C2（06:42-49）：6488 1d UI 739（chart 367 MISS、trio HIT）；1wk UI 467（318）；1mo UI 557（433）；AAPL UI 1341（406）；2330 更新 UI 460（STALE 38）
- C3（06:55-59）：6488 1d UI 1185（chart 414 MISS、trio HIT）；1wk UI 483（344）；1mo UI 437（335）；6488 切回即時；AAPL UI 941（408）；2330 更新 UI 439（STALE 39）
- 結構事實：串行鏈 chart→gap（228-630ms 前端處理）→trio；三件套 CDN 快取到台北午夜（api/_lib/finmind.ts）；chart s-maxage=60 swr=300

### BL-4b（after，部署 1c7db88）
- 部署首開（tab-6，10:44）：五路同刻 s=1001-1002；名 1669／法人 2309／量能 2101／2y 1454（9525B）／10y 1399（42818B）；包絡 ~2.3s；10y 先到走 skip-partial 分支
- C1（10:45-48）：6488 1d 全冷 UI 2246（五路 rel 3-4 全 MISS：2y 396／10y 471／名 811／法人 1164／量能 1310；快取 2426 根 full）；1wk UI 788（320 MISS）；1mo UI 527（**range=15y** 330 MISS、快取 141 根、4584B）；切回 0 請求；AAPL UI 771（2y 393＋10y 491 雙 MISS、零 finmind）；2330 更新 UI 956（**單段** 10y STALE 38＋trio 並行 HIT 443/40＋名 MISS 820）
- 熱探測（tab-8，10:55:57，+65s SWR 視窗）：2y STALE 39／10y STALE 122／trio HIT 121-122
- C2（10:54-58）：6488 1d UI 537（2y 387＋10y 447 MISS、trio HIT 33-50）；1wk UI 582（330 MISS）；1mo UI 496（324 MISS）；AAPL UI 743（383/430 MISS）；2330 更新 UI 602（單段 STALE 55＋trio HIT）
- C3（11:05-08）：6488 1d UI 787（2y 411＋10y 389 MISS、trio HIT 48-176）；1wk UI 582（410 MISS）；1mo UI 436（330 MISS）；AAPL UI 653（380/425 MISS）；AAPL 更新（誤按，額外樣本）：單段 10y HIT 45；2330 更新 UI 685（單段 STALE 42＋trio HIT 37-62）

## 結論

BL-PLAN 三項硬指標於 production 全數達標（最壞情境 2.25s，餘 <1s）；兩段式、並行起跑、range 收斂、骨架屏、快取只寫 full、abort 防線全部在 prod 實證與設計一致。全案（BL-4a→BL-2→BL-1→BL-3→BL-4b）完結。
