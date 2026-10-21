# smoke-02d-runner-b1（fixed，entry b1）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 f2bc858cc29b）自 raw 重算；請勿手改。

- HEAD：`5b7a4307d7c15f8ec3fe5b588b42aa34bc0faf5c`
- problems：只跑部分 start（工具 smoke，不作成績）：A-plain
- thresholdPass：false

## 空 OPTIONS（plain 直連，min／median／max ms）

| 路由 | cold | warm | median≤150 | 每筆≤500 |
|---|---|---|---|---|
| yahoo-chart | 2058.5／2058.5／2058.5（n=1） | 1858.7／1870.1／1971.8（n=10） | FAIL | FAIL |
| finmind | 1904.4／1904.4／1904.4（n=1） | 1847.4／1869.1／1948.6（n=10） | FAIL | FAIL |

- OPTIONS 只量直連：Vite 的 CORS middleware 會在代理前自行回 preflight。
- traced OPTIONS 分段：父程序總時間 —；fork→子程序就緒 —；子程序模組圖載入 —；handler 內 —
- 探針開銷（traced−plain warm 中位數差，跨 start 量級參考）：{"yahoo-chart":null,"finmind":null}

## 固定上游 GET（min／median／max ms）

| 區段 | 單支報價（直連） | 單支報價（經 Vite） | 單支 FinMind | 批次內報價 |
|---|---|---|---|---|
| clientTtfb | — | — | — | — |
| localCost | — | — | — | — |
| fixtureWait | — | — | — | — |
| parentPreFork | — | — | — | — |
| parentForkCall | — | — | — | — |
| parentForkToChildReady | — | — | — | — |
| parentReadyToProxy | — | — | — | — |
| parentProxyRoundTrip | — | — | — | — |
| childBootToPreload | — | — | — | — |
| childPreloadToDevServer | — | — | — | — |
| childDevServerToHandlerLoaded | — | — | — | — |
| childHandlerTotal | — | — | — | — |
| childHandlerBeforeFirstOutbound | — | — | — | — |
| childServiceTotal | — | — | — | — |
| unattributedClientVsParent | — | — | — | — |
| unattributedForkToReadyVsChildStartup | — | — | — | — |

- 本機成本（TTFB−固定等待）中位數≤200：FAIL（—）
- Vite 代理一跳（經 Vite 與直連的未歸屬差額中位數差）：— ms
- 十檔＋FX 三槽批次：首價 —；全價＋FX —；peak null
- 每請求獨立子程序：true；子程序實例 0／請求 0；付啟動成本的請求 0
- 父程序收件→轉進子程序：—
- 握手對帳（每個服務報價的子程序實例）：{"quotes":0,"cookie":0,"crumb":0,"chart":0}；實例 0
