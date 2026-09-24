# smoke-02d-runner-c（fixed，entry c）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 f2bc858cc29b）自 raw 重算；請勿手改。

- HEAD：`5b7a4307d7c15f8ec3fe5b588b42aa34bc0faf5c`
- problems：只跑部分 start（工具 smoke，不作成績）：B-trace-fixture
- thresholdPass：false

## 空 OPTIONS（plain 直連，min／median／max ms）

| 路由 | cold | warm | median≤150 | 每筆≤500 |
|---|---|---|---|---|
| yahoo-chart | — | — | FAIL | FAIL |
| finmind | — | — | FAIL | FAIL |

- OPTIONS 只量直連：Vite 的 CORS middleware 會在代理前自行回 preflight。
- traced OPTIONS 分段：父程序總時間 17.7／19／1977.3（n=22）；fork→子程序就緒 1823.3／1841.3／1859.3（n=2）；子程序模組圖載入 1724.1／1739.2／1754.3（n=2）；handler 內 0.4／0.5／1.3（n=22）
- 探針開銷（traced−plain warm 中位數差，跨 start 量級參考）：{"yahoo-chart":null,"finmind":null}

## 固定上游 GET（min／median／max ms）

| 區段 | 單支報價（直連） | 單支報價（經 Vite） | 單支 FinMind | 批次內報價 |
|---|---|---|---|---|
| clientTtfb | 74.5／75.6／212.7（n=5） | 77.2／78.3／93（n=5） | 76.9／77.3／89.5（n=5） | 75／82.8／97.8（n=55） |
| localCost | 19.6／20.6／26.9（n=5） | 20.7／22／30.9（n=5） | 19.9／20.1／37（n=5） | 19.4／28.2／32.1（n=55） |
| fixtureWait | 54.4／55／185.8（n=5） | 55.4／56.5／62.1（n=5） | 52.5／57.1／57.6（n=5） | 50／56.1／67.2（n=55） |
| parentPreFork | — | — | — | — |
| parentForkCall | — | — | — | — |
| parentForkToChildReady | — | — | — | — |
| parentReadyToProxy | — | — | — | — |
| parentProxyRoundTrip | 59.7／60.1／196.7（n=5） | 60.4／61.5／67.6（n=5） | 61.1／62.3／72.5（n=5） | 56.7／65.1／78.7（n=55） |
| childBootToPreload | — | — | — | — |
| childPreloadToDevServer | — | — | — | — |
| childDevServerToHandlerLoaded | — | — | — | — |
| childHandlerTotal | 55.9／56.7／193（n=5） | 57.3／58.1／64.3（n=5） | 57.7／59.2／68.1（n=5） | 51.3／57.6／68.1（n=55） |
| childHandlerBeforeFirstOutbound | 0.4／0.5／1.4（n=5） | 0.4／0.5／0.6（n=5） | 0.5／0.5／1.1（n=5） | 0.3／0.5／0.7（n=55） |
| childServiceTotal | 57.9／58.8／195.4（n=5） | 59／60.1／66.4（n=5） | 59.9／61.1／71（n=5） | 53.2／61／72.7（n=55） |
| unattributedClientVsParent | 0.9／1／1.4（n=5） | 2.6／3／10.1（n=5） | 1／1／1.8（n=5） | 0.9／1.6／3.2（n=55） |
| unattributedForkToReadyVsChildStartup | — | — | — | — |

- 本機成本（TTFB−固定等待）中位數≤200：PASS（19.6／20.6／26.9（n=5））
- Vite 代理一跳（經 Vite 與直連的未歸屬差額中位數差）：2 ms
- 十檔＋FX 三槽批次：首價 81.8／92.2／96.4（n=5）；全價＋FX 323.8／343.3／362.1（n=5）；peak 3
- 每請求獨立子程序：false；子程序實例 2／請求 70；付啟動成本的請求 0
- 父程序收件→轉進子程序：12.5／15.9／21.6（n=70）
- 握手對帳（每個服務報價的子程序實例）：{"quotes":65,"cookie":1,"crumb":1,"chart":65}；實例 1

## 候選對 B1 基準

- 基準 run：b1-fixed-20260923-r3；B1 本機成本中位 1836.1 → 候選 20.6；降低 0.989（≥0.8：PASS）
- B1 空 OPTIONS warm 中位：{"yahoo-chart":1833.3,"finmind":1839.9}
