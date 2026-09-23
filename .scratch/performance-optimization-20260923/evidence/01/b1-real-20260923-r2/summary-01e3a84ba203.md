# b1-real-20260923-r2（real）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 01e3a84ba203）自 raw 重算；請勿手改。

- HEAD：`4ca3c3c1eee7818f8f886be6d6f1d069f41fd4ae`
- problems：無
- thresholdPass：null

## 真行情小批（min／median／max ms）

| 區段 | 報價 |
|---|---|
| clientTtfb | 3656.6／4045.7／4289.2（n=13） |
| parentPreFork | 18.3／19.8／84.2（n=13） |
| parentForkCall | 2.9／3.4／6.9（n=13） |
| parentForkToChildReady | 1784.5／2204.7／2240.7（n=13） |
| parentReadyToProxy | 0.5／0.6／2.2（n=13） |
| childBootToPreload | 21.1／22.7／26.2（n=13） |
| childPreloadToDevServer | 1690.9／2106.4／2141.4（n=13） |
| childDevServerToHandlerLoaded | 54.3／58.6／71.2（n=13） |
| childHandlerBeforeFirstOutbound | 1.4／3.2／3.6（n=13） |
| yahooCookie | 633.8／636.9／650.1（n=13） |
| yahooCrumb | 861.9／874.8／1078.8（n=13） |
| yahooCookieToCrumbEnd | 1496.3／1511.9／1729.8（n=13） |
| yahooChart | 272／292.3／313.2（n=13） |
| childHandlerAfterLastOutbound | 1.1／1.2／1.4（n=13） |
| childHandlerTotal | 1780.4／1828.5／2027.9（n=13） |
| childServiceTotal | 1793／1840.4／2039.5（n=13） |
| unattributedClientVsParent | 1.2／1.5／5.8（n=13） |
| clientBody | 0.1／0.1／0.7（n=13） |
| realDispatch | 1809.3／2224.5／2274.2（n=13） |

- 自行握手的報價：13/13；獨立子程序實例數：13
- outbound 計數：{"yahoo-cookie":13,"yahoo-crumb":13,"yahoo-chart":13,"finmind":1}，合計 40；預算 {"browserApi":14,"yahooOutboundNormal":39,"yahooOutboundWorst":78,"finmindOutbound":1,"outboundWorst":79}
- 上游 429／5xx／連線錯誤（trace 計數，含被 handler 重試隱藏者）：0
- halted：無
- 十檔＋FX 三槽批次：首價 4096.6；全價＋FX 16221.1；peak 3
- FinMind：[{"clientTtfb":2045.7,"outboundMs":194.3,"status":200}]
