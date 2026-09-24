# c-real-20260924-r1（real，entry c）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 1c7255fbbfa7）自 raw 重算；請勿手改。

- HEAD：`5b7a4307d7c15f8ec3fe5b588b42aa34bc0faf5c`
- problems：無
- thresholdPass：null

## 真行情小批（min／median／max ms）

| 區段 | 報價 |
|---|---|
| clientTtfb | 225.4／297.6／4167.2（n=13） |
| parentPreFork | 93／93／93（n=1） |
| parentForkCall | 6.4／6.4／6.4（n=1） |
| parentForkToChildReady | 2064.2／2064.2／2064.2（n=1） |
| parentReadyToProxy | 2.7／2.7／2.7（n=1） |
| childBootToPreload | 27.5／27.5／27.5（n=1） |
| childPreloadToDevServer | 1955.8／1955.8／1955.8（n=1） |
| childDevServerToHandlerLoaded | 61.2／61.2／61.2（n=1） |
| childHandlerBeforeFirstOutbound | 0.5／0.6／1.8（n=13） |
| yahooCookie | 819.3／819.3／819.3（n=1） |
| yahooCrumb | 874.8／874.8／874.8（n=1） |
| yahooCookieToCrumbEnd | 1694.6／1694.6／1694.6（n=1） |
| yahooChart | 201.9／275.7／301.1（n=13） |
| childHandlerAfterLastOutbound | 0.3／0.3／1.3（n=13） |
| childHandlerTotal | 202.7／276.6／1983（n=13） |
| childServiceTotal | 205.2／278.9／1996.6（n=13） |
| unattributedClientVsParent | 1.1／1.7／5.8（n=13） |
| clientBody | 0.1／0.1／0.7（n=13） |
| realDispatch | 0／0／2159.8（n=13） |
| warmClientTtfb | 225.4／296.7／338.1（n=12） |
| warmParentRecvToProxy | 14.9／15.4／27.3（n=12） |
| warmChildServiceTotal | 205.2／278.3／306.9（n=12） |

- 自行握手的報價：1/13；獨立子程序實例數：1；付啟動成本的報價 1；暖報價 12
- 握手對帳：{"quotes":13,"cookie":1,"crumb":1,"chart":13}；實例 1
- outbound 計數：{"yahoo-cookie":1,"yahoo-crumb":1,"yahoo-chart":13,"finmind":1}，合計 16；預算 {"browserApi":14,"yahooOutboundNormal":15,"yahooOutboundWorst":78,"finmindOutbound":1,"outboundWorst":79}
- 上游 429／5xx／連線錯誤（trace 計數，含被 handler 重試隱藏者）：0
- halted：無
- 十檔＋FX 三槽批次：首價 238.3；全價＋FX 1178.6；peak 3
- FinMind：[{"clientTtfb":2283.2,"outboundMs":207.3,"status":200}]
