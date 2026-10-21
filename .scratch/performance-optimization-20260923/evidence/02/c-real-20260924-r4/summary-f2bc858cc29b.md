# c-real-20260924-r4（real，entry c）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 f2bc858cc29b）自 raw 重算；請勿手改。

- HEAD：`5b7a4307d7c15f8ec3fe5b588b42aa34bc0faf5c`
- problems：無
- thresholdPass：null

## 真行情小批（min／median／max ms）

| 區段 | 報價 |
|---|---|
| clientTtfb | 223.8／309.5／3887.4（n=13） |
| parentPreFork | 90.3／90.3／90.3（n=1） |
| parentForkCall | 5.8／5.8／5.8（n=1） |
| parentForkToChildReady | 2011／2011／2011（n=1） |
| parentReadyToProxy | 2.6／2.6／2.6（n=1） |
| childBootToPreload | 31.8／31.8／31.8（n=1） |
| childPreloadToDevServer | 1900.8／1900.8／1900.8（n=1） |
| childDevServerToHandlerLoaded | 58.8／58.8／58.8（n=1） |
| childHandlerBeforeFirstOutbound | 0.5／0.6／1.7（n=13） |
| yahooCookie | 613.3／613.3／613.3（n=1） |
| yahooCrumb | 855.5／855.5／855.5（n=1） |
| yahooCookieToCrumbEnd | 1469.4／1469.4／1469.4（n=1） |
| yahooChart | 202.6／281.1／378.6（n=13） |
| childHandlerAfterLastOutbound | 0.3／0.3／1.6（n=13） |
| childHandlerTotal | 203.6／289.1／1754.2（n=13） |
| childServiceTotal | 205.9／291.3／1768.5（n=13） |
| unattributedClientVsParent | 1.2／1.4／6.1（n=13） |
| clientBody | 0.1／0.1／0.7（n=13） |
| realDispatch | 14.5／15.6／2103.9（n=13） |
| coldClientTtfb | 3887.4／3887.4／3887.4（n=1） |
| warmClientTtfb | 223.8／309.2／403.3（n=12） |
| warmParentRecvToProxy | 14.5／15.5／26（n=12） |
| warmChildServiceTotal | 205.9／285.8／385（n=12） |

- 自行握手的報價：1/13（握手總等待 1469.4 ms）；獨立子程序實例數：1；付啟動成本的報價 1；冷報價 1；暖報價 12
- 握手對帳：{"quotes":13,"cookie":1,"crumb":1,"chart":13}；實例 1
- outbound 計數：{"yahoo-cookie":1,"yahoo-crumb":1,"yahoo-chart":13,"finmind":1}，合計 16；預算 {"browserApi":14,"yahooOutboundNormal":15,"yahooOutboundWorst":78,"finmindOutbound":1,"outboundWorst":79}
- 上游 429／5xx／連線錯誤（trace 計數，含被 handler 重試隱藏者）：0
- halted：無
- 十檔＋FX 三槽批次：首價 244.1；全價＋FX 1243.5；peak 3
- FinMind：[{"clientTtfb":2269.2,"outboundMs":212.8,"status":200}]
