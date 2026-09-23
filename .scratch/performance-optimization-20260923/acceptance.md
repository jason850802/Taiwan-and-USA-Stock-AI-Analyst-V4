# 第二輪共同驗收與量測協定

本文件與 PLAN 在第一票先凍結。新增欄位只用來回答已列出的假設；不重新建大型證據系統。

## 1. 每輪身分與工作區

- 新 run-id、新檔名、未用過的 page origin；輸出若存在即拒絕覆寫。不要把「小於 1 秒」當快取定義，快取判斷用 Resource Timing／實際 server trace／預期 request 對帳。
- 保存 commit、實際來源 manifest、未提交差異、工具與設定雜湊、browser／Node／Vercel 版本、cwd、owned PID／listener PID、port、快取模式。PID 不符立即 fail，不只寫警告。
- `.env` 排除於 manifest；只記需要的變數名稱／是否一致，不記秘密值或其雜湊。不要把 runtime 完整內容或依賴副本提交。
- 服務前後核對身分；來源標籤不得只由 URL `variant` 決定。隔離 checkout 必須與本次被測候選相同，不因路徑叫 pfv7 就認為來源正確。
- 同一 formal run 不與其他重負載／gate 平行執行。先清理本案已停止程序，保留其他使用者服務。

## 2. 一次請求要拆出的區間

| 邊界 | 欄位／證據 | 要回答的問題 |
|---|---|---|
| UI／queue | 入列、取槽、fetch start、headers、body、有效值發布 | 是排隊、網路還是發布等待？ |
| 本機入口 | 入口收件、proxy、啟動／child ready、handler entry | 約 1.8 秒空請求落在哪？ |
| handler | guard 完成、provider begin/end、encode/end | 安全檢查、上游與編碼各占多少？ |
| Yahoo outbound | cookie／crumb／chart、命中／pending join／世代、retry 原因 | 每支 quote 是否重複做握手？ |
| FinMind outbound | dataset 類別、開始、headers、body、結果狀態 | context 的真正慢段在哪？ |
| K 線 UI | 搜尋提交、2y／10y、PV／法人／名稱、enrich、React commit、下一 rAF | 哪一段實際 gate 可見結果？ |

每個程序以自己的 monotonic clock 算區間，用 trace ID 連結；禁止直接相減不同程序的 `performance.now()`。不能用 OPTIONS 值直接相減 GET 來宣布 runtime 占比。跨程序整體差額只稱未歸屬成本，直到入口／child 邊界補足。記錄階段代號與耗時，不記認證值、完整帶秘密 URL 或真帳本。

可先對隔離的現有 CLI 做暫時計時，不修改全域已安裝 CLI；變更前後雜湊與量測開銷要有紀錄，正式成績用無多餘 debug 的候選。

## 3. 最小紅燈與單變因實驗

1. 保留既有 v5 驗證器的 exit 1 作保存樣本重播，不稱 fresh run。
2. 在 B1 正式 API 路徑使用固定上游，量 OPTIONS、Yahoo quote、FinMind 以及一次多請求。先取得可重跑的慢段，再嘗試長駐候選。
3. 同來源分別量目前 Vercel 與長駐候選。固定成功／失敗回應驗證所有守門與 provider 行為，再以真上游小批確認方向。
4. 長駐的 fork／dispatch 與 handshake 重用是兩個因素：分別報 no-upstream 成本與 outbound 數／耗時；不能把總收益全歸因於其中一個。
5. 原型失敗先給具體 counterexample。跳過長駐必須同時證明：本機 dispatch 低於 500 ms 且不足總等待 20%；Yahoo 握手已跨請求共享，或其可省成本低於 100 ms 且不足單次等待 10%。若空 OPTIONS／固定 GET 仍未達絕對目標，另列可執行的替代假設並保留 FAIL；不能因原型寫不出來就宣稱無收益。

## 4. 取樣與正式通過規則

- OPTIONS：沿用 Yahoo chart 與 FinMind 兩個代表路由；每入口 2 個獨立 start，每 route cold 1＋交錯 warm 10 對，所有 204，cold 另列。其他路由仍做契約驗證，不混入這個效能母體。目標見 PLAN，額外給 min／median／max，不給小樣本 p95。
- 固定行情：至少五個有效回合，固定 clock、payload、完整 symbol 集、可手動釋放的 pending，涵蓋 cold／warm／force。錯誤結束不算有效價格完成。
- 真十檔新目標：在正式 App 可見庫存面板量 B1、C 各三批交錯；每批 5 台股＋5 美股及 FX，使用合成持股搭配真行情。首價必須在目標列可見；全部完成須十列有效價格與本輪有效 FX 已發布。固定起點與畫面判定，API／hook 時間只作診斷，不能代替這項數值 gate。
- 舊 05 重驗：另外沿用原正式 hook 口徑，B0、C 各三批交錯，判原雙 40%。這組不能取代正式 App。上述兩組均需 same-day 同期配對、每頁新 origin，按每批結果算中位數，不把單支 request 池化後稱批次改善率。
- 真 K 線：B1、C 各三批十檔，主要畫面時間在正式 App 可見面板量；台／美分列各批首批／完整中位數再比較，並列每檔原值。固定資料覆蓋全部五種週期；真上游冷日線完整矩陣外，其他週期只做預先列出的台／美代表小樣本。
- App DOM 命中必須是目標股票、週期、非 skeleton 的有效 K 線；完整時間還須對應必要 context 與完整歷史。hook／API 時間作診斷輔助，不能代替 App 可見目標。先辨識預設股票的自動請求並計入起點與預算，不先暖載它再稱冷測；不同頁／股票的冷狀態於第一票固定。
- 三十檔最後只做 B1↔C 各一批觀察，沒有獨立正式改善百分比承諾。
- 量測中面板必須可見；visibility 中途失效或 rAF 逾時則該頁無效，保存 raw、不覆蓋。rAF 記「可繪製」，不能冒稱螢幕物理出光。
- 取消只排除明確同 symbol／世代的 10y 已成功後，被取代 2y 的設計內 AbortError；原始錯誤保留，另列排除規則及對應成功證據。其他 abort／HTTP 非 200 不能一律忽略。

## 5. 真上游預算與停止

先固定 browser API 與 server→provider **兩張**預算表。既有十檔是 11 Yahoo＋5 FinMind browser API；逐請求 cold 握手可能造成 38 outbound。十檔 K 線的 35 browser API 可能造成 75 outbound；取消是否阻止 outbound 須在 server 邊界證明。

正式全矩陣的參考 browser 數：App 十檔 B1↔C 三組約 96、舊 05 hook B0↔C 三組約 96、App K 線三組兩臂約 210、三十檔兩臂約 92，合計約 494；**這些數字不含真正 App 搜尋／名錄、額外週期或 handler 內 retry，不能當實際上游總額。** 若合法重用減少 browser API，另證明每項需求資料齊全，不能沿用舊驗證器硬鎖 16 來判錯或放行漏項。

執行者在開跑前依實際 handler 路徑計算正常與最壞（含既有一次重試）outbound，將 App 額外項目納入，記錄每批及總額上限。超出預算即停止新工作，保留在途處理／取消契約；不把測試重試外加在 handler retry 上。無法計數就先補固定探針，不先跑大矩陣。

先做一個台股、一個美股的有界方向確認；固定 gate 與候選選定後才跑完整矩陣。429、持續 5xx、timeout 或來源身分失敗立即停止該批後續起跑並保留 raw；遵循上游等待資訊，不密集重跑。真上游不可用時完成固定資料工作、保持真行情目標 OPEN。

## 6. 必要負向與等價案例

原型／入口：OPTIONS 短路、method／origin／secret／rate limit 拒絕、query／body 邊界、非預期路由、upstream 4xx／5xx／timeout、SSE 首 chunk／取消／錯誤、模組修改／刪除／語法錯誤／重新啟動、埠衝突及停止只殺 owned PID。

Yahoo：併發共用一次 pending handshake、熱命中、TTL 到期、401／429 世代失效、舊世代不得覆蓋新世代、重試上限、取消互不污染。長駐 shared state 清單逐項驗，不只沿用原單 request 測試。

前端：force 與一般讀取重疊、連續 force、移除／重加、卸載、多 subscriber 個別取消、名稱晚到、FX 先／後／失敗。K 線驗 2y／10y 任一先到及失敗、PV／法人／名稱獨立故障、背景刷新、A→B→A。固定最終結果與既有基線 hash／逐欄一致。

App 五鍵：每操作各留 raw before／after；只讀操作全相同；合成編輯／快照保存依 fixture 的允許變更清單精確比對。desktop 與窄版都要完整，不能只列鍵名。

## 7. 每票收尾與整體判定

TypeScript 批次至少 `npx.cmd tsc --noEmit`；產品碼票在完整隔離 checkout 跑：

```powershell
$env:GIT_CONFIG_COUNT='1'
$env:GIT_CONFIG_KEY_0='safe.directory'
$env:GIT_CONFIG_VALUE_0='C:/pfv7'
npm.cmd run gate -- --require-env
```

若 checkout 是其他核實路徑，VALUE_0 隨之精確變更；不改全域 Git 設定。先證明隔離來源等於該票候選，再跑。新增工具／原始碼精確納入待提交清單後，金鑰掃描也必須涵蓋本輪新檔；不能用舊 HEAD 的 source scan 代替。

Standards／Spec 由未參與該票實作的 reviewer 獨立驗；效能數字與 raw、來源、request budget 可對帳。全 gate PASS 只代表機械／正確性，不自動滿足 PLAN 的效能目標。

選路票可在有效否證後結束，量測票可在完整記錄 FAIL 後結束，讓後續獨立工作及最後報告能繼續；票面須同列分支結果／效能結果，不能把工作結束當成目標 PASS。任一全案數值目標仍 FAIL／未驗時，spec 與全案狀態維持 OPEN。

每票一個精確 commit；不覆寫既有 evidence、不提交 runtime、不修改既有測試期望。完成後停止本票服務、刪本票 env 複本、保留日誌及無關變更。最終表每列分開填「已實作／固定驗證／真上游／使用者畫面／是否達標」。
