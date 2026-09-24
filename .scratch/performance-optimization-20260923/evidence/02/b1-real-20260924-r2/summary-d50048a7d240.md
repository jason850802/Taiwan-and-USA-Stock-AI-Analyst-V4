# b1-real-20260924-r2（real，entry b1）判定摘要

由 verify-b1-breakdown.mjs（內容雜湊 d50048a7d240）自 raw 重算；請勿手改。

- HEAD：`5b7a4307d7c15f8ec3fe5b588b42aa34bc0faf5c`
- problems：無
- thresholdPass：null

## 真行情小批（min／median／max ms）

| 區段 | 報價 |
|---|---|
| clientTtfb | 3866.6／4229.2／4368.1（n=13） |
| parentPreFork | 17.5／20.3／93.6（n=13） |
| parentForkCall | 2.8／3.5／6.2（n=13） |
| parentForkToChildReady | 2022／2387／2457.9（n=13） |
| parentReadyToProxy | 0.6／0.7／2.2（n=13） |
| childBootToPreload | 23.8／27.8／31.3（n=13） |
| childPreloadToDevServer | 1919.3／2281.1／2353.8（n=13） |
| childDevServerToHandlerLoaded | 54.3／60.3／64.1（n=13） |
| childHandlerBeforeFirstOutbound | 1.4／1.7／2.4（n=13） |
| yahooCookie | 606.1／611.7／663.1（n=13） |
| yahooCrumb | 838.2／857.4／1053.2（n=13） |
| yahooCookieToCrumbEnd | 1448.1／1468.2／1667（n=13） |
| yahooChart | 263.3／279.4／313.4（n=13） |
| childHandlerAfterLastOutbound | 1.1／1.2／1.7（n=13） |
| childHandlerTotal | 1720.9／1774.7／1956.9（n=13） |
| childServiceTotal | 1735.6／1790／1970.3（n=13） |
| unattributedClientVsParent | 1.2／1.9／6.9（n=13） |
| clientBody | 0.1／0.1／0.8（n=13） |
| realDispatch | 2071.2／2406.6／2495.5（n=13） |
| coldClientTtfb | 3866.6／4229.2／4368.1（n=13） |
| warmClientTtfb | — |
| warmParentRecvToProxy | — |
| warmChildServiceTotal | — |

- 自行握手的報價：13/13（握手總等待 19718 ms）；獨立子程序實例數：13；付啟動成本的報價 13；冷報價 13；暖報價 0
- 握手對帳：{"quotes":13,"cookie":13,"crumb":13,"chart":13}；實例 13
- outbound 計數：{"yahoo-cookie":13,"yahoo-crumb":13,"yahoo-chart":13,"finmind":1}，合計 40；預算 {"browserApi":14,"yahooOutboundNormal":39,"yahooOutboundWorst":78,"finmindOutbound":1,"outboundWorst":79}
- 上游 429／5xx／連線錯誤（trace 計數，含被 handler 重試隱藏者）：0
- halted：無
- 十檔＋FX 三槽批次：首價 4252.1；全價＋FX 16821.6；peak 3
- FinMind：[{"clientTtfb":2259.3,"outboundMs":193.7,"status":200}]
