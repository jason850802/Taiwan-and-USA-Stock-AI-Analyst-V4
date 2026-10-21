# c-fixed-20260924-r4（fixed，entry c）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 f2bc858cc29b）自 raw 重算；請勿手改。

- HEAD：`5b7a4307d7c15f8ec3fe5b588b42aa34bc0faf5c`
- problems：無
- thresholdPass：true

## 空 OPTIONS（plain 直連，min／median／max ms）

| 路由 | cold | warm | median≤150 | 每筆≤500 |
|---|---|---|---|---|
| yahoo-chart | 2091／2114.5／2137.9（n=2） | 16.2／17.5／19.9（n=20） | PASS | PASS |
| finmind | 1904.9／1943.1／1981.2（n=2） | 16／17.3／20.2（n=20） | PASS | PASS |

- OPTIONS 只量直連：Vite 的 CORS middleware 會在代理前自行回 preflight。
- traced OPTIONS 分段：父程序總時間 17.7／19.1／2078.5（n=44）；fork→子程序就緒 1907.3／1932.1／1968（n=4）；子程序模組圖載入 1809.4／1823.9／1864.5（n=4）；handler 內 0.4／0.5／1.3（n=44）
- 探針開銷（traced−plain warm 中位數差，跨 start 量級參考）：{"yahoo-chart":2.6,"finmind":2.9}

## 固定上游 GET（min／median／max ms）

| 區段 | 單支報價（直連） | 單支報價（經 Vite） | 單支 FinMind | 批次內報價 |
|---|---|---|---|---|
| clientTtfb | 74.1／76.3／206.6（n=10） | 76.8／78.7／93.9（n=10） | 76.1／77.6／90.9（n=10） | 74.4／81.8／97.4（n=110） |
| localCost | 19.6／20.6／27.6（n=10） | 20.4／21.8／31.4（n=10） | 19.4／21／38.4（n=10） | 19.9／27.8／32.8（n=110） |
| fixtureWait | 54.3／56.3／179.1（n=10） | 54.7／57.3／64.9（n=10） | 50.1／56.2／58.1（n=10） | 49.5／56.4／66.3（n=110） |
| parentPreFork | — | — | — | — |
| parentForkCall | — | — | — | — |
| parentForkToChildReady | — | — | — | — |
| parentReadyToProxy | — | — | — | — |
| parentProxyRoundTrip | 59.4／61.3／190.3（n=10） | 59.3／61.7／70.4（n=10） | 60.9／62.3／75.3（n=10） | 56.2／62.8／79.9（n=110） |
| childBootToPreload | — | — | — | — |
| childPreloadToDevServer | — | — | — | — |
| childDevServerToHandlerLoaded | — | — | — | — |
| childHandlerTotal | 55.9／57.9／186.5（n=10） | 56.2／58.8／66.8（n=10） | 57／59.1／70.7（n=10） | 51.1／57.9／67.5（n=110） |
| childHandlerBeforeFirstOutbound | 0.4／0.5／1.3（n=10） | 0.4／0.4／0.7（n=10） | 0.5／0.6／1.2（n=10） | 0.3／0.5／1.1（n=110） |
| childServiceTotal | 57.8／60.1／188.9（n=10） | 58.1／60.5／68.7（n=10） | 59.7／61.1／73.4（n=10） | 53.5／60.4／73.9（n=110） |
| unattributedClientVsParent | 0.9／1.1／1.6（n=10） | 2.6／3／11.1（n=10） | 0.8／1／1.4（n=10） | 0.9／1.8／3.8（n=110） |
| unattributedForkToReadyVsChildStartup | — | — | — | — |

- 本機成本（TTFB−固定等待）中位數≤200：PASS（19.6／20.6／27.6（n=10））
- Vite 代理一跳（經 Vite 與直連的未歸屬差額中位數差）：1.9 ms
- 十檔＋FX 三槽批次：首價 76.2／81.8／96.6（n=10）；全價＋FX 311.1／342／372.3（n=10）；peak 3
- 每請求獨立子程序：false；子程序實例 4／請求 140；付啟動成本的請求 0
- 父程序收件→轉進子程序：11.4／16.2／21.2（n=140）
- 握手對帳（每個服務報價的子程序實例）：{"quotes":130,"cookie":2,"crumb":2,"chart":130}；實例 2

## 候選對 B1 基準

- 基準 run：b1-fixed-20260924-r3；B1 本機成本中位 1886.8 → 候選 20.6；降低 0.989（≥0.8：PASS）
- B1 空 OPTIONS warm 中位：{"yahoo-chart":1863.1,"finmind":1870.5}
