# c-fixed-20260924-r3（fixed，entry c）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 d50048a7d240）自 raw 重算；請勿手改。

- HEAD：`5b7a4307d7c15f8ec3fe5b588b42aa34bc0faf5c`
- problems：無
- thresholdPass：true

## 空 OPTIONS（plain 直連，min／median／max ms）

| 路由 | cold | warm | median≤150 | 每筆≤500 |
|---|---|---|---|---|
| yahoo-chart | 2029.2／2091.5／2153.7（n=2） | 16.7／17.6／21.4（n=20） | PASS | PASS |
| finmind | 1884.9／1934.5／1984（n=2） | 16.2／17.6／19.5（n=20） | PASS | PASS |

- OPTIONS 只量直連：Vite 的 CORS middleware 會在代理前自行回 preflight。
- traced OPTIONS 分段：父程序總時間 18.1／19.7／2074.8（n=44）；fork→子程序就緒 1863.9／1947.7／1956.7（n=4）；子程序模組圖載入 1768.1／1843.3／1850.4（n=4）；handler 內 0.4／0.5／1.3（n=44）
- 探針開銷（traced−plain warm 中位數差，跨 start 量級參考）：{"yahoo-chart":3.1,"finmind":2.9}

## 固定上游 GET（min／median／max ms）

| 區段 | 單支報價（直連） | 單支報價（經 Vite） | 單支 FinMind | 批次內報價 |
|---|---|---|---|---|
| clientTtfb | 74.3／75.9／210.1（n=10） | 77.7／79.1／94.4（n=10） | 75.7／77.6／103.5（n=10） | 75.4／92.1／100（n=110） |
| localCost | 19.7／20.3／29.2（n=10） | 21.4／22.9／34.3（n=10） | 20／20.8／41（n=10） | 20／29.1／35.8（n=110） |
| fixtureWait | 54.6／55.7／182.2（n=10） | 54.7／56.6／64.1（n=10） | 53.2／56.5／62.5（n=10） | 49.6／61.8／66.6（n=110） |
| parentPreFork | — | — | — | — |
| parentForkCall | — | — | — | — |
| parentForkToChildReady | — | — | — | — |
| parentReadyToProxy | — | — | — | — |
| parentProxyRoundTrip | 59.2／60.6／193.8（n=10） | 59.6／61.3／69.8（n=10） | 60.7／62.2／84.4（n=10） | 54.8／71.5／81（n=110） |
| childBootToPreload | — | — | — | — |
| childPreloadToDevServer | — | — | — | — |
| childDevServerToHandlerLoaded | — | — | — | — |
| childHandlerTotal | 56.2／57.2／189.7（n=10） | 56.4／58／66.6（n=10） | 57.5／59／79.9（n=10） | 51／63／67.9（n=110） |
| childHandlerBeforeFirstOutbound | 0.4／0.5／1.2（n=10） | 0.4／0.5／0.7（n=10） | 0.5／0.5／1.2（n=10） | 0.3／0.5／1（n=110） |
| childServiceTotal | 58.1／59.2／192.2（n=10） | 58.4／60／68.6（n=10） | 59.5／61／83（n=10） | 53.6／67.9／73.3（n=110） |
| unattributedClientVsParent | 0.9／1.2／2.3（n=10） | 2.7／3.4／12.8（n=10） | 1／1／1.8（n=10） | 0.9／1.8／3.2（n=110） |
| unattributedForkToReadyVsChildStartup | — | — | — | — |

- 本機成本（TTFB−固定等待）中位數≤200：PASS（19.7／20.3／29.2（n=10））
- Vite 代理一跳（經 Vite 與直連的未歸屬差額中位數差）：2.2 ms
- 十檔＋FX 三槽批次：首價 78.5／94.3／98.6（n=10）；全價＋FX 326／346／376.5（n=10）；peak 3
- 每請求獨立子程序：false；子程序實例 4／請求 140；付啟動成本的請求 0
- 父程序收件→轉進子程序：12.9／16.2／21.6（n=140）
- 握手對帳（每個服務報價的子程序實例）：{"quotes":130,"cookie":2,"crumb":2,"chart":130}；實例 2

## 候選對 B1 基準

- 基準 run：b1-fixed-20260924-r2；B1 本機成本中位 1878.9 → 候選 20.3；降低 0.989（≥0.8：PASS）
- B1 空 OPTIONS warm 中位：{"yahoo-chart":1861.3,"finmind":1860.7}
