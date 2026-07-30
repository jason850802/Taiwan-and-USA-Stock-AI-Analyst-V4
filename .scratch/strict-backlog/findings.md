# strict 欠帳收斂 — findings

實作期翻出的可疑現行行為，**照登記不修**，交由使用者裁決。與各票的型別收斂本身無關。

---

## F-01 — EPS 恰為 0 的季度在圖上完全消失（無長條、無標籤）

**票號**：03（DOM 驗證期發現）
**性質**：現行行為，**與票 03 的修改無關**——放寬型別前後皆如此。

**現象**：EPS 長條圖中，某季 EPS 恰為 `0` 時，recharts 不產生該筆的
`.recharts-bar-rectangle`，連帶 `LabelList` 也沒有標籤節點。結果是「該季 EPS＝0」
與「該季無 EPS 資料」在畫面上**完全無法區分**——兩者都是一片空白。

**證據**（2026-07-30，2409 友達，經 App 自身 sessionStorage 快取層注入後實機 DOM 讀值）：

| 注入值 | 長條 | 標籤文字 |
|---|---|---|
| `0.001`（控制組，極小但非 0） | 有（height 0.2975） | `"0.00"` |
| `0`（精確零） | **無** | **無** |
| `-0` | **無** | **無** |
| `null` | 無 | 無 |
| 欄位整個缺（`undefined`） | 無 | 無 |

控制組是關鍵：`0.001` 會渲染且標籤literal 就是 `"0.00"`，證明 formatter 本身
對「顯示成 0.00」沒有問題，消失的原因在 recharts 不畫零高度長條，而不在格式化。

**為什麼可能重要**：EPS 恰為 0 是損益兩平，語意上與「這季沒有財報資料」完全不同，
但使用者在圖上看到的是同一片空白。台股實務上精確 0.00 的季度罕見（本輪 2330／2409
真實資料都沒有），所以影響面小，但一旦發生就是靜默的資訊遺失。

**未處理原因**：票 03 的範圍是型別契約，且這屬於「圖表要怎麼呈現零值」的顯示語意決策，
不是助手該順手改的。可能的處置方向（未實作、未評估）：零值改畫最小高度長條、
或在無資料季度顯示明確的「—」。

**裁決結果（2026-07-30）**：**收法 (1) 紀錄結案，零碼變更**——使用者拍板收口批次票 04
（授權書第 4 條，三收法依序嘗試），第一步查核即成立：tooltip 層已可區分零值與無資料。

**tooltip 對照證據**（2026-07-30，2409 注入資料實機 DOM 讀值；同一張圖同一輪取證）：

| 季度（注入值） | 長條／標籤 | tooltip 實際顯示 |
|---|---|---|
| 24Q3（1.25，對照） | 有／`1.25` | visible：「EPS 1.25 元」 |
| **25Q4（精確 0）** | **無／無**（F-01 基線重現） | **visible：「EPS 0.00 元」** |
| **26Q1（null 無資料）** | **無／無** | **hidden（整個 tooltip 不出現）** |
| 26Q2（0.73，對照） | 有／`0.73` | visible：「EPS 0.73 元」 |

區分語意：hover 零值季 → 跳出「EPS 0.00 元」；hover 無資料季 → 無任何 tooltip（票面
「顯示空」的收法判準）。機制：`EpsTooltip` 自寫 `d.eps != null ? toFixed(2)+' 元' : '—'`，
零值走 `0.00 元` 分支；無資料季 recharts 對 null 值產不出 payload 條目，`payload.length`
守衛讓 tooltip 整個不渲染（『—』分支在軸觸發路徑上實際到不了，但「無 tooltip」本身
即與零值的「0.00 元」可區分）。

**取證方法備註**：瀏覽器 pane 未顯示（截圖／座標滑鼠不可用，見 LESSONS），activation 走
recharts 3 內部 store 直接 `dispatch({type:'tooltip/setMouseOverAxisIndex', payload:{activeIndex,…}})`
——與真實滑鼠 hover 走的是同一個 reducer（滑鼠 handler 最終 dispatch 同一 action），
state 與 render 路徑逐位相同，僅繞過座標命中測試（與 tooltip 內容無關）。
資料注入走 App 自身 sessionStorage 快取層（`tw_fund_2409_<日期>`），已於取證後清除。

---

## F-02 — 取消之後，後到的增量仍會觸發 onDelta

**票號**：02（行為鎖撰寫期發現）
**性質**：現行行為，本票只照鎖不修。

**現象**：`cancelRef.cancel()` 會設 settled 旗標、清計時器、殺子程序，但**串流解析路徑
沒有檢查 settled**。因此取消後若 stdout 仍有資料抵達（kill 與 pipe 排空之間、或緩衝區
殘料），`onDelta` 照樣會被呼叫。

**證據**：行為鎖案例「取消後若仍有增量資料抵達，onDelta 仍會被呼叫」——cancel 之後再送一段
`content_block_delta`，`onDelta` 仍收到該段文字。

**為什麼可能重要**：串流的唯一呼叫端在 client 斷線時觸發 cancel，而它的 `onDelta` 實作是
往那個已經斷掉的 response 寫資料。也就是說取消後的回呼會寫進一個對端已消失的串流。
本輪**未實測**該寫入的實際後果（無聲丟棄／socket error／例外），不做進一步論斷。

**未處理原因**：票 02 明定只照鎖不修，且加不加 settled 檢查會改變取消語意，屬裁決事項。

**裁決結果（2026-07-30）**：**已修**——使用者拍板收口批次票 03（授權書第 3 條），
解析路徑補 settled 守衛，收斂後遲到增量靜默丟棄、不再觸發 onDelta。
證據 commit 7f8ff2e；行為鎖「取消後遲到的增量不再觸發 onDelta（F-02 收口）」，
故障注入拆守衛即紅。

---

## F-03 — 取消之後 Promise 永不收斂

**票號**：02（行為鎖撰寫期發現）
**性質**：現行行為，本票只照鎖不修。

**現象**：`cancel()` 只中止，**不 resolve 也不 reject**。取消後即使子程序照常送出 result
或 close，`settle()` 因 settled 已為 true 而全部無效，該 Promise 因此永遠停在 pending。

**證據**：行為鎖案例「取消後 Promise 維持未收斂」與「取消後遲到的 result 不會造成第二次
收斂」——推進時鐘 200 秒、再補送 result 與 close，收斂狀態始終為 null。

**為什麼可能重要**：呼叫端是 `await generateTextStream(...)`，取消後那個 await 永遠不會
往下走，handler 的 async frame 也就不會結束（`res.end()` 不會被呼叫）。因為 cancel 的觸發
條件正是 client 已斷線，實務衝擊有限，且該路由設有 `maxDuration`；但「永不收斂的 Promise」
本身仍是值得知道的性質。

**未處理原因**：同 F-02，改成 reject（或 resolve 已串流內容）都會改變對外語意，屬裁決事項。

**裁決結果（2026-07-30）**：**已修**——使用者拍板收口批次票 03（授權書第 3 條），
cancel 以新分類 CANCELLED reject（settled 先設，close／error／result 後到不二次收斂），
呼叫端 handler 捕捉取消分類後靜默收尾（不寫已斷線 response、res.end 必被呼叫）。
證據 commit 7f8ff2e；行為鎖三案＋handler 級 4 案，故障注入拆 reject／拆靜默分支各自精準紅。

---

## F-04 — `@types/react` 只靠傳遞依賴存在，整個 TSX 型檢押在上游間接依賴上

**票號**：收口批次票 01（順帶查核，登記不修）
**性質**：現行依賴結構風險，非行為缺陷。

**現象**：`package.json` 未宣告 `@types/react`，但 `node_modules/@types/react@19.2.14`
存在——來源是 `react-markdown` 與 `recharts → react-redux` 的依賴宣告
（`npm ls @types/react` 可證）。整個專案的 TSX 型別檢查（React 元件 props、hooks 簽章）
都押在這兩個上游套件「剛好」帶入的間接依賴上。

**為什麼可能重要**：任一上游改版把 `@types/react` 從 dependencies 移到 peerDependencies
（生態系常見走向），`npm install` 後型別就無聲消失，tsc 會在毫無本地改動的情況下
突然噴出大量 React 相關錯誤。屆時的錯誤訊息不會指向真正原因。

**未處理原因**：修法＝正式安裝 `@types/react` 進 devDependencies，但收口批次授權書
第 1 條只解鎖 `@types/react-dom` 一套件；擅自加裝即越權。

**裁決結果（2026-07-30）**：**已修**——使用者於收口批次回報後追加拍板，比照票 01 模式
再解一次套件紅線（一次、一套件）。釘住樹上既有版本 19.2.14 轉正入 devDependencies，
lockfile 零版本挪動（僅 root 鏡像行＋自身與 csstype 的 peer 旗標轉正）。
證據 commit f5a1bd8；strict 0 不變、679 案全綠、gate 全綠。
