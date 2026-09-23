# 02 — 驗證同 handler 的長駐本機 API 原型

Status: ready-for-agent
Blocked by: 01
Type: task

## 要回答的問題

讓正式 handler 在同一本機程序處理多支請求，是否能消除已量到的固定成本並安全重用 Yahoo 握手，而不改變 API 契約？

## 工作

- 使用已裝工具與 Node 能力，建立局部、可選、可停止的原型；先核可用的 TypeScript 載入方式。業務 handler／guard 重用，不複製一套閹割版 API。
- 列完整路由與 request／response adapter 契約；先以固定請求 differential 驗證目前入口與原型。
- 空 OPTIONS／固定 GET 分別量現在入口與原型；再用 server fetch 計數證明 cookie／crumb 熱命中、pending join 及 TTL。
- 列所有跨請求共享 state，驗證依 spec 的隔離、失效與取消；AI 路由用假 provider，SSE 也要走真 adapter。
- 先不取代日常預設入口，不要求使用者遷移資料，不改套件／三槽。

## 驗收

- [ ] 空 OPTIONS 與固定 GET 達 PLAN 本機成本目標；分別報 dispatch 收益與握手重用收益。
- [ ] query／body／header／status／CORS／守門序／限流／timeout／SSE／取消的正反案例與目前 handler 等價。
- [ ] 併發 handshake pending、TTL、401／429 世代與重試上限通過，實際 outbound 數對帳。
- [ ] 啟停只作用於 owned PID，bind localhost，秘密留在後端。
- [ ] 若收益不足，附明確否證與成本表；不以功能不完整的極快原型通過。
- [ ] 原型的程式及測試經隔離 gate、獨立 Standards／Spec 覆核後精確提交；產品預設仍由下一票決定。

## 不實作分支

只有前票已量得本機固定成本低於 500 ms 且不足總等待 20%，並證明 Yahoo 握手已跨請求共享或可省成本低於 100 ms 且不足單次等待 10%，才以證據將本分支判定不值得實作。OPTIONS／固定 GET 若仍未達絕對目標，必須保留 FAIL 並列替代選路。有效否證可將本票標 resolved 並同列分支結果，不代表本機效能目標通過；無法完成原型或缺證據不算否證。兩次同修法無效即回到等待分解。
