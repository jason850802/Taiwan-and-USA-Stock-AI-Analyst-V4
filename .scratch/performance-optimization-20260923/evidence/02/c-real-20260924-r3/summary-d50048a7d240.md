# c-real-20260924-r3（real，entry c）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 d50048a7d240）自 raw 重算；請勿手改。

- HEAD：`5b7a4307d7c15f8ec3fe5b588b42aa34bc0faf5c`
- problems：無
- thresholdPass：null

## 真行情小批（min／median／max ms）

| 區段 | 報價 |
|---|---|
| clientTtfb | 225.7／302.6／3928.5（n=13） |
| parentPreFork | 85.8／85.8／85.8（n=1） |
| parentForkCall | 6.3／6.3／6.3（n=1） |
| parentForkToChildReady | 1976.4／1976.4／1976.4（n=1） |
| parentReadyToProxy | 2.8／2.8／2.8（n=1） |
| childBootToPreload | 25.8／25.8／25.8（n=1） |
| childPreloadToDevServer | 1872.9／1872.9／1872.9（n=1） |
| childDevServerToHandlerLoaded | 57.6／57.6／57.6（n=1） |
| childHandlerBeforeFirstOutbound | 0.4／0.6／1.9（n=13） |
| yahooCookie | 613.3／613.3／613.3（n=1） |
| yahooCrumb | 842.9／842.9／842.9（n=1） |
| yahooCookieToCrumbEnd | 1456.7／1456.7／1456.7（n=1） |
| yahooChart | 201.4／276.4／376.9（n=13） |
| childHandlerAfterLastOutbound | 0.2／0.3／1.4（n=13） |
| childHandlerTotal | 202.2／277.2／1837.3（n=13） |
| childServiceTotal | 205.3／279.5／1850.7（n=13） |
| unattributedClientVsParent | 1.2／2.3／6.5（n=13） |
| clientBody | 0／0.1／1.2（n=13） |
| realDispatch | 10.7／16.8／2065（n=13） |
| coldClientTtfb | 3928.5／3928.5／3928.5（n=1） |
| warmClientTtfb | 225.7／301.4／322.9（n=12） |
| warmParentRecvToProxy | 10.7／16.7／23.5（n=12） |
| warmChildServiceTotal | 205.3／278.7／295.1（n=12） |

- 自行握手的報價：1/13（握手總等待 1456.7 ms）；獨立子程序實例數：1；付啟動成本的報價 1；冷報價 1；暖報價 12
- 握手對帳：{"quotes":13,"cookie":1,"crumb":1,"chart":13}；實例 1
- outbound 計數：{"yahoo-cookie":1,"yahoo-crumb":1,"yahoo-chart":13,"finmind":1}，合計 16；預算 {"browserApi":14,"yahooOutboundNormal":15,"yahooOutboundWorst":78,"finmindOutbound":1,"outboundWorst":79}
- 上游 429／5xx／連線錯誤（trace 計數，含被 handler 重試隱藏者）：0
- halted：無
- 十檔＋FX 三槽批次：首價 241.1；全價＋FX 1214.5；peak 3
- FinMind：[{"clientTtfb":2268.5,"outboundMs":182,"status":200}]
