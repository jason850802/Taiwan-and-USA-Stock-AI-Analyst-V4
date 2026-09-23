# smoke-01a（fixed）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 01e3a84ba203）自 raw 重算；請勿手改。

- HEAD：`4ca3c3c1eee7818f8f886be6d6f1d069f41fd4ae`
- problems：產品樹與 HEAD 不一致；產品樹與 30dfdb2 產品內容不一致；缺 identityAfter（結束時身分未核對）；只跑部分 start（工具 smoke，不作成績）：B-trace-fixture
- thresholdPass：false

## 空 OPTIONS（plain 直連，min／median／max ms）

| 路由 | cold | warm | median≤150 | 每筆≤500 |
|---|---|---|---|---|
| yahoo-chart | — | — | FAIL | FAIL |
| finmind | — | — | FAIL | FAIL |

- OPTIONS 只量直連：Vite 的 CORS middleware 會在代理前自行回 preflight。
- traced OPTIONS 分段：父程序總時間 1871.3／1997.8／4216.9（n=22）；fork→子程序就緒 1787.7／1939.5／3511.9（n=22）；子程序模組圖載入 1696.5／1844／3239.2（n=22）；handler 內 0.8／0.9／1.5（n=22）
- 探針開銷（traced−plain warm 中位數差，跨 start 量級參考）：{"yahoo-chart":null,"finmind":null}

## 固定上游 GET（min／median／max ms）

| 區段 | 單支報價（直連） | 單支報價（經 Vite） | 單支 FinMind | 批次內報價 |
|---|---|---|---|---|
| clientTtfb | 2412.3／2412.3／2412.3（n=1） | — | 2144.4／2144.4／2144.4（n=1） | 2363.7／2651／2728.5（n=11） |
| localCost | 2240.4／2240.4／2240.4（n=1） | — | 2093.5／2093.5／2093.5（n=1） | 2192.8／2480.8／2560.3（n=11） |
| fixtureWait | 171.9／171.9／171.9（n=1） | — | 50.8／50.8／50.8（n=1） | 167.5／170.8／185.3（n=11） |
| parentPreFork | 31.5／31.5／31.5（n=1） | — | 45.7／45.7／45.7（n=1） | 25.4／50.9／115.2（n=11） |
| parentForkCall | 5.1／5.1／5.1（n=1） | — | 6.8／6.8／6.8（n=1） | 3／4.5／5.2（n=11） |
| parentForkToChildReady | 2180.8／2180.8／2180.8（n=1） | — | 2008.4／2008.4／2008.4（n=1） | 2116.4／2390.3／2417.6（n=11） |
| parentReadyToProxy | 0.8／0.8／0.8（n=1） | — | 0.6／0.6／0.6（n=1） | 0.5／0.7／0.9（n=11） |
| parentProxyRoundTrip | 196.9／196.9／196.9（n=1） | — | 87.9／87.9／87.9（n=1） | 195.7／201.5／213.2（n=11） |
| childBootToPreload | 24.7／24.7／24.7（n=1） | — | 24／24／24（n=1） | 20.8／22.2／24.3（n=11） |
| childPreloadToDevServer | 2078.3／2078.3／2078.3（n=1） | — | 1899.5／1899.5／1899.5（n=1） | 2019.1／2289.6／2310.4（n=11） |
| childDevServerToHandlerLoaded | 58.5／58.5／58.5（n=1） | — | 63.9／63.9／63.9（n=1） | 59／63.2／67.1（n=11） |
| childHandlerTotal | 179.4／179.4／179.4（n=1） | — | 69.7／69.7／69.7（n=1） | 177.5／179.5／193.1（n=11） |
| childHandlerBeforeFirstOutbound | 1.2／1.2／1.2（n=1） | — | 1.5／1.5／1.5（n=1） | 1.3／1.5／1.7（n=11） |
| childServiceTotal | 193.9／193.9／193.9（n=1） | — | 85.1／85.1／85.1（n=1） | 192.7／194.3／206.6（n=11） |
| unattributedClientVsParent | 1.7／1.7／1.7（n=1） | — | 1.3／1.3／1.3（n=1） | 1.6／3.6／7.5（n=11） |
| unattributedForkToReadyVsChildStartup | 18.9／18.9／18.9（n=1） | — | 20.7／20.7／20.7（n=1） | 16.7／17.9／20.6（n=11） |

- 本機成本（TTFB−固定等待）中位數≤200：FAIL（2240.4／2240.4／2240.4（n=1））
- Vite 代理一跳（經 Vite 與直連的未歸屬差額中位數差）：— ms
- 十檔＋FX 三槽批次：首價 2723.3／2723.3／2723.3（n=1）；全價＋FX 10391.9／10391.9／10391.9（n=1）；peak 3
- 每請求獨立子程序：true
