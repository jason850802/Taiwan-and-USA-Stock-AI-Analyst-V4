# smoke-02a（fixed，entry c）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 bce8f497a2be）自 raw 重算；請勿手改。

- HEAD：`5b7a4307d7c15f8ec3fe5b588b42aa34bc0faf5c`
- problems：只跑部分 start（工具 smoke，不作成績）：B-trace-fixture；證據疑似含秘密：child-10816.jsonl:cookie-field,child-25372.jsonl:cookie-field
- thresholdPass：false

## 空 OPTIONS（plain 直連，min／median／max ms）

| 路由 | cold | warm | median≤150 | 每筆≤500 |
|---|---|---|---|---|
| yahoo-chart | — | — | FAIL | FAIL |
| finmind | — | — | FAIL | FAIL |

- OPTIONS 只量直連：Vite 的 CORS middleware 會在代理前自行回 preflight。
- traced OPTIONS 分段：父程序總時間 17.3／18.1／1997.3（n=22）；fork→子程序就緒 1811.1／1847／1883（n=2）；子程序模組圖載入 1712.3／1744.9／1777.4（n=22）；handler 內 0.4／0.5／1.7（n=22）
- 探針開銷（traced−plain warm 中位數差，跨 start 量級參考）：{"yahoo-chart":null,"finmind":null}

## 固定上游 GET（min／median／max ms）

| 區段 | 單支報價（直連） | 單支報價（經 Vite） | 單支 FinMind | 批次內報價 |
|---|---|---|---|---|
| clientTtfb | 204.5／204.5／204.5（n=1） | 89.6／89.6／89.6（n=1） | 88.1／88.1／88.1（n=1） | 76.2／80.1／93.7（n=11） |
| localCost | 26.7／26.7／26.7（n=1） | 27.9／27.9／27.9（n=1） | 33.1／33.1／33.1（n=1） | 24.5／25.7／30.5（n=11） |
| fixtureWait | 177.8／177.8／177.8（n=1） | 61.7／61.7／61.7（n=1） | 55／55／55（n=1） | 49.9／53.9／64.2（n=11） |
| parentPreFork | — | — | — | — |
| parentForkCall | — | — | — | — |
| parentForkToChildReady | — | — | — | — |
| parentReadyToProxy | — | — | — | — |
| parentProxyRoundTrip | 189.5／189.5／189.5（n=1） | 67.3／67.3／67.3（n=1） | 73.8／73.8／73.8（n=1） | 58.2／63.7／73.7（n=11） |
| childBootToPreload | 28.8／28.8／28.8（n=1） | 28.8／28.8／28.8（n=1） | 25.7／25.7／25.7（n=1） | 28.8／28.8／28.8（n=11） |
| childPreloadToDevServer | 1777.4／1777.4／1777.4（n=1） | 1777.4／1777.4／1777.4（n=1） | 1712.3／1712.3／1712.3（n=1） | 1777.4／1777.4／1777.4（n=11） |
| childDevServerToHandlerLoaded | 54.5／54.5／54.5（n=1） | 54.5／54.5／54.5（n=1） | 55.6／55.6／55.6（n=1） | 54.5／54.5／54.5（n=11） |
| childHandlerTotal | 185.6／185.6／185.6（n=1） | 63.4／63.4／63.4（n=1） | 69.6／69.6／69.6（n=1） | 52.5／55.6／65.7（n=11） |
| childHandlerBeforeFirstOutbound | 1.2／1.2／1.2（n=1） | 0.6／0.6／0.6（n=1） | 1.3／1.3／1.3（n=1） | 0.4／0.5／0.7（n=11） |
| childServiceTotal | 188.1／188.1／188.1（n=1） | 65.6／65.6／65.6（n=1） | 72.4／72.4／72.4（n=1） | 55.9／57.3／69.9（n=11） |
| unattributedClientVsParent | 1.2／1.2／1.2（n=1） | 9.3／9.3／9.3（n=1） | 1／1／1（n=1） | 1.1／1.6／2.4（n=11） |
| unattributedForkToReadyVsChildStartup | — | — | — | — |

- 本機成本（TTFB−固定等待）中位數≤200：PASS（26.7／26.7／26.7（n=1））
- Vite 代理一跳（經 Vite 與直連的未歸屬差額中位數差）：8.1 ms
- 十檔＋FX 三槽批次：首價 84.3／84.3／84.3（n=1）；全價＋FX 329／329／329（n=1）；peak 3
- 每請求獨立子程序：false；子程序實例 2／請求 14；付啟動成本的請求 0
- 父程序收件→轉進子程序：12.7／15.8／19.8（n=14）
- 握手對帳（每個服務報價的子程序實例）：{"quotes":13,"cookie":1,"crumb":1,"chart":13}；實例 1

## 候選對 B1 基準

- 基準 run：b1-fixed-20260923-r3；B1 本機成本中位 1836.1 → 候選 26.7；降低 0.985（≥0.8：PASS）
- B1 空 OPTIONS warm 中位：{"yahoo-chart":1833.3,"finmind":1839.9}
