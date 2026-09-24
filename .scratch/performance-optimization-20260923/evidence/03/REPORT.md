# 03 — 日常入口接入與取消修復

日期：2026-09-24。基準 HEAD：`6a7b029`。分支：`codex/reacceptance-fixes-p1-s1`。本票採用 02 的同 handler 長駐候選；全案效能驗收仍 OPEN。

## 1. 實際改變

日常啟動改為單一命令，同時啟動只綁 `127.0.0.1` 的 Vercel API 與 Vite App。候選的預載只給 Vercel 程序，原正式 handler、guard、Vercel 部署配置及三槽保留。啟動前拒絕占用埠；五條正式函式以 OPTIONS 預熱，全部 204 才報 ready。每輪記錄 owned PID 與獨立日誌；停止只針對該輪核對過身分的程序，確認兩埠和狀態檔都清除。

Vite 代理後端使用明確的 `127.0.0.1` 埠，並傳送原前端 Host 作 `X-Forwarded-Host`，讓既有同源 guard 能識別頁面；沒有改白名單或放行跨站來源。正反驗證：本機頁面 Origin 200，外部偽造 Origin 403。

`@vercel/node` 5.8.23 的本機 dev-server 轉送時漏帶取消訊號。本機函式子程序的預載把外層斷線連到 `undici.request`，正式路由以回應的未完成 `close` 偵測斷線。五條路由在等待限流 guard 前註冊取消監聽，guard 前後均檢查中止狀態，避免斷線後才啟動上游。Yahoo chart／search 與 FinMind 在個別請求取消時中止本次上游；cookie／crumb 握手以等待者計數共用，最後一位等待者取消才中止上游，另一位還在時保留握手。Gemini 非串流及串流路由將取消傳至假 CLI 或 SDK 的 `abortSignal`，斷線後不再寫回應。版本不符時預載拒絕啟用，不暗中改走舊入口。正式部署沒有載入這個本機預載。

## 2. 來源身分

本票十一個候選產品／測試檔在主工作樹及隔離 `C:/pfv7` 的實體 SHA-256 逐檔一致，之後才跑目標測試與 gate：

| 檔案 | SHA-256 |
|---|---|
| `api/_lib/http.cancel.test.ts` | `20152D73CB030A0E921A79A0E820EEA7A4260E2D06FF6B3F639808D947DDBEA2` |
| `api/_lib/http.ts` | `E2F6E703DE46CD0AF46AE7E15F5D4E1B23C673C730C51A0054EB2DDD78BAB203` |
| `api/_lib/llm.ts` | `6A872672CC5815E179FDABFC85D67FD6E18EF0E3854D06B59D151E3FDE24E400` |
| `api/finmind.ts` | `B22A2C517EE48515C9E692E7298A9631765111DA3B46BCB9846345E5CA45C7B5` |
| `api/gemini-stream.ts` | `BD7CDF33915C7749C58993C843D14CBFBC774FDA74C2173115BC3FF5CD0EB31A` |
| `api/gemini-stream.test.ts` | `F1CF2D80278E1BDA20648D7903DEEE2332601A8B77287BDDDDE25B7566CA3147` |
| `api/gemini.ts` | `38AA5D06CE1F5712BC6EE697F862303B8D8F13F66256D9F6F4F2006A658EAC87` |
| `api/yahoo/chart.ts` | `A71DE04C8C92A4B924D5526049D965A560C070A9B91D4240692F37EB1A828424` |
| `api/_lib/yahoo.ts` | `180CAFA90EB62B95C2E76F94BB6398C58D058343F3B4D6D293BF972C98230815` |
| `api/yahoo/search.ts` | `5D4FFD44A179A61C305CEBEA35E61405E52A459D008DC9D503F8F55CD18EE40B` |
| `vite.config.ts` | `D196FB891F4AD627FC067A6DF906D8C35F92F9F23AA156AB0BCEACB9EBC99953` |

取消、固定成本與 HMR 原始資料另記工具／實際來源 SHA-256；重載工具在起跑時比對隔離候選與主工作樹十一檔的實體雜湊，結束後逐位元組復原。工作區有 skip-worktree 檔，沒有把 `git status` 當來源證明。定稿前將 FinMind 與 Yahoo search 的 CRLF 換行正規化為專案規定的 LF，並以 `git hash-object --no-filters` 對照 index blob，十一檔原始位元組全數一致；正規化前的兩路由 run 僅保留歷史，不作最終來源 PASS。

## 3. 固定資料與使用者畫面

| 項目 | 本輪結果 | 口徑 |
|---|---|---|
| 暖 OPTIONS | 20/20 為 204；中位 15.364、最大 18.168 ms | `daily03-cost-20260924-r5`，`4561` Vite 同源代理，固定資料；raw 記錄啟動器與前後相同的 owned PID |
| 暖 GET | 20/20 為 200；中位 61.766、最大 81.295 ms | 同上，包含固定 chart 等待，不扣等待；較早 run 的不同時間保留在原檔 |
| 假 AI 取消 | 首段後斷線；代理與 handler 都收到中止，假 CLI 在第 1 段被 kill，無 done | `cancel03-green-20260924-r4`；舊入口有效紅燈為 `red-r4` |
| chart 取消隔離 | A 的 chart `AbortError`、沒有 headers；B 同時 200 | `chart03-final-20260924-r4`，固定上游 |
| 握手取消隔離 | A 單獨在 cookie 階段取消時，上游 `AbortError`、未進入 chart；共享時 A 取消，B 沿用握手並回 200 | `chart03-cookie-20260924-r3`、`chart03-shared-cookie-20260924-r3` |
| 其餘路由取消 | Yahoo search、FinMind 的假上游均 `AbortError`；非串流假 AI 在斷線後 kill、無 done；Gemini API 用假 SDK 測 `abortSignal` 傳遞，串流斷線後不寫錯誤 | `route03-search-20260924-r3`、`route03-finmind-20260924-r3`、`route03-gemini-20260924-r3`，隔離測試 |
| 限流等待中取消 | 五條正式路由都先到達延遲限流，再斷線；handler 收到中止，限流返回後無行情或 AI 上游工作 | LF 最終來源 `guard03-20260924-r2`，固定假限流，5/5 PASS |
| App 路徑 | 台股、美股、K 線、隔離庫存與假 AI 五段輸出均可見 | 新來源 `4393` 與 `4395`，詳見 [LIFECYCLE](LIFECYCLE.md) |

固定 GET 與 OPTIONS 表示低成本在日常代理後仍成立；02 的正式兩次啟動固定資料協定提供直接 B1↔C 對照。本輪單一入口樣本不替代 PLAN 第 3 節全部分組，也不冒充 App 十檔冷載入數字。

## 4. 重載、隔離與 gate

`reload03-allroutes-20260924-r8` 在 `C:/pfv7` 以 B1 和 C 同設定對照十步：基準、依賴訊息變更、語法錯誤、語法恢復、`.env` 加入／移除測試密鑰、刪除／恢復路由、依賴還原、串流中改碼。各步狀態與 body 對等，候選每次偵測變更；語法錯誤兩邊 500 而非舊碼 200，刪路由兩邊 404，還原後 200；長串流兩邊完整回 200。摘要 `diffs=[]`、`problems=[]`、`productClean=true`、`testFilesRemoved=true`，隔離測試的 `.env`／`.vercel` 已刪除。舊 `reload03-allroutes-20260924-r4` 因執行期間來源漂移而判無效，不能引用作 PASS；`r7` 仍屬換行正規化前的來源，其他舊 run 皆保留歷史。

`hmr03-20260924-r1` 於相同隔離 checkout 分別短暫修改 `App.tsx`、`index.css`，Vite WebSocket 依序收到 `/App.tsx`、`/index.css` 更新，兩檔逐位元組還原，owned Vite PID 停止。埠衝突、兩次同埠啟停及殘留狀態保護見 [LIFECYCLE](LIFECYCLE.md)。最終啟動器在 `4561/4562` 預熱五路由後通過固定成本驗收並停止；兩埠沒有 listener，日常 `state.json` 不存在。

隔離 gate：`GIT_CONFIG_COUNT/KEY_0/VALUE_0` 僅在程序環境指定 `C:/pfv7` 為 safe.directory，執行 `npm.cmd run gate -- --require-env`：tsc 0 錯，Vitest 50 檔 827/827，build 成功，金鑰掃描 15 個 dist 檔、3753 個追蹤來源檔和主工作樹 `.env` 六筆值均乾淨，package／lock 與 HEAD 一致。相關目標測試與 02 工具自測另有前輪紀錄；沒有修改 Vitest 設定、範圍或既有期望。

## 5. 判定與仍 OPEN

03 票日常入口、取消、固定資料成本、App 路徑、重載／例外、HMR 與完整 gate 已有對應證據，狀態為 `resolved`。獨立 Standards／Spec 覆核發現共享握手取消、前端 env 黑名單、控制管道失聯時的舊服務保護，以及其餘正式路由的取消四項缺口；已補實作與上述新 run，定稿覆核見 [REVIEW](REVIEW.md)。目前明確未量的是 PLAN 第 3 節的正式 App 十檔冷庫存、十檔 K 線與暖回訪 B1↔C 配對，亦未做真行情新入口量測；這些留給 04～07，不能把 03 的固定資料 PASS 寫成全案 PASS。舊 05 的 fresh B0↔C 雙 40% 與舊 01～03 的 E0 限制仍 OPEN。沒有正式部署驗證。

## 6. 日常命令與回復

在 repo 根目錄：

```powershell
node .scratch/performance-optimization-20260923/tools/daily-dev.mjs start
node .scratch/performance-optimization-20260923/tools/daily-dev.mjs status
node .scratch/performance-optimization-20260923/tools/daily-dev.mjs stop
```

預設 App `http://127.0.0.1:3000`、API `127.0.0.1:3001`；若被其他服務占用，只能另指定 `start --front-port 4300 --api-port 4301`，不接管別人程序。停止後可再 `start`；若版本鎖不符，先閱讀日誌及修正候選，不會自動切回一般 Vercel dev。要撤回本票，在本票尚為 HEAD 時執行 `git revert --no-edit HEAD`；日常入口也可直接停用，原有 `npx vercel dev --listen 3001` 與 `npm run dev` 仍可手動啟動。

重跑證據使用全新 run-id 與空埠，例：

```powershell
node .scratch/performance-optimization-20260923/tools/cancel-03.mjs <新代號> c <空埠>
node .scratch/performance-optimization-20260923/tools/chart-cancel-03.mjs <新代號> <空埠>
node .scratch/performance-optimization-20260923/tools/chart-cancel-03.mjs <新代號> <空埠> cookie
node .scratch/performance-optimization-20260923/tools/chart-cancel-03.mjs <新代號> <空埠> shared-cookie
node .scratch/performance-optimization-20260923/tools/route-cancel-03.mjs <新代號> <search|finmind|gemini> <空埠>
node .scratch/performance-optimization-20260923/tools/guard-cancel-03.mjs <新代號> <五個連續空埠的起點>
node .scratch/performance-optimization-20260923/tools/stale-state-03.mjs <新代號> <舊空埠> <新前端空埠> <新後端空埠>
node .scratch/performance-optimization-20260923/tools/c-reload.mjs --candidate-03 --run-id <新代號> --port-base <連續空埠> --workdir C:/pfv7
node .scratch/performance-optimization-20260923/tools/hmr-03.mjs <新代號> C:/pfv7 <空埠>
```

以上工具的固定模式只用假上游／假 AI；正式日常命令不會啟用固定模式。
