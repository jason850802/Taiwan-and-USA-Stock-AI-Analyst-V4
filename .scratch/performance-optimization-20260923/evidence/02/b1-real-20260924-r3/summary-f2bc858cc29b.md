# b1-real-20260924-r3（real，entry b1）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 f2bc858cc29b）自 raw 重算；請勿手改。

- HEAD：`5b7a4307d7c15f8ec3fe5b588b42aa34bc0faf5c`
- problems：無
- thresholdPass：null

## 真行情小批（min／median／max ms）

| 區段 | 報價 |
|---|---|
| clientTtfb | 3794.9／4240.4／4542.1（n=13） |
| parentPreFork | 17.9／21.6／90.1（n=13） |
| parentForkCall | 2.9／3.2／6.3（n=13） |
| parentForkToChildReady | 2012.6／2268.7／2445.5（n=13） |
| parentReadyToProxy | 0.5／0.7／2.6（n=13） |
| childBootToPreload | 24.7／27.5／30.8（n=13） |
| childPreloadToDevServer | 1913.2／2166.3／2334.1（n=13） |
| childDevServerToHandlerLoaded | 55.4／60.1／64.5（n=13） |
| childHandlerBeforeFirstOutbound | 1.5／1.8／2.7（n=13） |
| yahooCookie | 606.3／613.5／659（n=13） |
| yahooCrumb | 835.3／842.6／1309.1（n=13） |
| yahooCookieToCrumbEnd | 1446.4／1462／1968.6（n=13） |
| yahooChart | 261.2／280.1／300.7（n=13） |
| childHandlerAfterLastOutbound | 1.1／1.3／1.7（n=13） |
| childHandlerTotal | 1710.8／1759.4／2251.6（n=13） |
| childServiceTotal | 1723.3／1773.1／2266.7（n=13） |
| unattributedClientVsParent | 1.2／1.9／6.8（n=13） |
| clientBody | 0.1／0.1／0.7（n=13） |
| realDispatch | 2034.5／2288.3／2479.2（n=13） |
| coldClientTtfb | 3794.9／4240.4／4542.1（n=13） |
| warmClientTtfb | — |
| warmParentRecvToProxy | — |
| warmChildServiceTotal | — |

- 自行握手的報價：13/13（握手總等待 20817.8 ms）；獨立子程序實例數：13；付啟動成本的報價 13；冷報價 13；暖報價 0
- 握手對帳：{"quotes":13,"cookie":13,"crumb":13,"chart":13}；實例 13
- outbound 計數：{"yahoo-cookie":13,"yahoo-crumb":13,"yahoo-chart":13,"finmind":1}，合計 40；預算 {"browserApi":14,"yahooOutboundNormal":39,"yahooOutboundWorst":78,"finmindOutbound":1,"outboundWorst":79}
- 上游 429／5xx／連線錯誤（trace 計數，含被 handler 重試隱藏者）：0
- halted：無
- 十檔＋FX 三槽批次：首價 4241.1；全價＋FX 16643.4；peak 3
- FinMind：[{"clientTtfb":2149.7,"outboundMs":173.9,"status":200}]
