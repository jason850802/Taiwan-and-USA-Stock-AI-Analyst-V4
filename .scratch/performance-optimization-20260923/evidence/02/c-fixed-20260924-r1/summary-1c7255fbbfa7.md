# c-fixed-20260924-r1（fixed，entry c）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 1c7255fbbfa7）自 raw 重算；請勿手改。

- HEAD：`5b7a4307d7c15f8ec3fe5b588b42aa34bc0faf5c`
- problems：無
- thresholdPass：true

## 空 OPTIONS（plain 直連，min／median／max ms）

| 路由 | cold | warm | median≤150 | 每筆≤500 |
|---|---|---|---|---|
| yahoo-chart | 2090.9／2094.3／2097.6（n=2） | 16.9／18／21.4（n=20） | PASS | PASS |
| finmind | 1909.6／1937／1964.4（n=2） | 17／17.7／24.7（n=20） | PASS | PASS |

- OPTIONS 只量直連：Vite 的 CORS middleware 會在代理前自行回 preflight。
- traced OPTIONS 分段：父程序總時間 18.6／19.5／2153.2（n=44）；fork→子程序就緒 1861／1911.1／2037.9（n=4）；子程序模組圖載入 1756.7／1808.5／1929.8（n=4）；handler 內 0.4／0.5／1.4（n=44）
- 探針開銷（traced−plain warm 中位數差，跨 start 量級參考）：{"yahoo-chart":2.4,"finmind":2.7}

## 固定上游 GET（min／median／max ms）

| 區段 | 單支報價（直連） | 單支報價（經 Vite） | 單支 FinMind | 批次內報價 |
|---|---|---|---|---|
| clientTtfb | 74.3／76.1／211.4（n=10） | 76.9／77.7／91.9（n=10） | 76.6／77.9／90.4（n=10） | 75／91.6／97.2（n=110） |
| localCost | 19.1／21.2／29.8（n=10） | 21.1／22.1／30.9（n=10） | 19.8／21.6／39.6（n=10） | 21.1／29.5／35（n=110） |
| fixtureWait | 53.1／55.5／182.2（n=10） | 53／55.9／61.3（n=10） | 50.8／56／57.4（n=10） | 49.8／61.1／66.7（n=110） |
| parentPreFork | — | — | — | — |
| parentForkCall | — | — | — | — |
| parentForkToChildReady | — | — | — | — |
| parentReadyToProxy | — | — | — | — |
| parentProxyRoundTrip | 58.3／60.4／195.3（n=10） | 57.8／60.8／66.4（n=10） | 60.3／62.2／71.1（n=10） | 55.9／71.8／77.5（n=110） |
| childBootToPreload | — | — | — | — |
| childPreloadToDevServer | — | — | — | — |
| childDevServerToHandlerLoaded | — | — | — | — |
| childHandlerTotal | 55.1／57.1／190.9（n=10） | 54.5／57.6／62.9（n=10） | 56.2／58.7／67（n=10） | 51.1／62.5／67.8（n=110） |
| childHandlerBeforeFirstOutbound | 0.4／0.5／1.1（n=10） | 0.4／0.5／1（n=10） | 0.5／0.6／1.1（n=10） | 0.3／0.5／0.8（n=110） |
| childServiceTotal | 57.1／59.1／193.9（n=10） | 56.6／59.6／65（n=10） | 58.3／60.9／69.7（n=10） | 53.6／67.8／71.8（n=110） |
| unattributedClientVsParent | 0.9／1／1.2（n=10） | 2.6／3／10.3（n=10） | 0.9／1.1／1.3（n=10） | 0.9／1.9／3.9（n=110） |
| unattributedForkToReadyVsChildStartup | — | — | — | — |

- 本機成本（TTFB−固定等待）中位數≤200：PASS（19.1／21.2／29.8（n=10））
- Vite 代理一跳（經 Vite 與直連的未歸屬差額中位數差）：1.9 ms
- 十檔＋FX 三槽批次：首價 79.3／84／95.3（n=10）；全價＋FX 341.2／345／375.6（n=10）；peak 3
- 每請求獨立子程序：false；子程序實例 4／請求 140；付啟動成本的請求 0
- 父程序收件→轉進子程序：13.2／16.4／22.3（n=140）
- 握手對帳（每個服務報價的子程序實例）：{"quotes":130,"cookie":2,"crumb":2,"chart":130}；實例 2

## 候選對 B1 基準

- 基準 run：b1-fixed-20260923-r3；B1 本機成本中位 1836.1 → 候選 21.2；降低 0.988（≥0.8：PASS）
- B1 空 OPTIONS warm 中位：{"yahoo-chart":1833.3,"finmind":1839.9}
