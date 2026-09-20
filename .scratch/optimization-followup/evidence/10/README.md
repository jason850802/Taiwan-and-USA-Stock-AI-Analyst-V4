# 10 視窗焦點與指標控制可及性

固定比較點 `6493c4c78b8282db1dae1202ca94df9aa08e8b40`；開始時工作區乾淨，01～09已結案。

## 重現與修改

`red-desktop-modal.json` 以真正的共用Modal及原生Enter／Tab／Shift+Tab／Escape重現：反向焦點跑到背景「無控制項視窗」，關閉後也未回到來源。`red-desktop-indicator.json` 在正式App重現：均線5改6後原輸入DOM卸載、焦點丟失。

產品修改僅兩處：

- `components/ui/Modal.tsx`：合理初始焦點、可操作且可見控制項間正反循環、沒有子項目留在容器、來源回復與失效來源的替代控制。小型開啟視窗清單統一最上層鍵盤與視覺順序；只由最上層處理Escape及背景focus。動態隱藏／disabled／移除以MutationObserver檢查當前焦點；關閉後等React移除DOM再還原，不奪走新開視窗的焦點。原背景點擊與捲動樣式保留，沒有引入視窗框架或body鎖定。
- `components/ChartToolbar.tsx`：原本在render內定義React子元件，每次設定變更都形成新component type。改成普通render函式使控制項DOM保持身分；均線色點／眼睛、天數／顏色有明確繁中名稱，開關及週期提供aria-pressed，Escape回指標來源。均線值、顏色、計算與預設設定均未改。

## 實際鍵盤與尺寸

同源iframe設定真正的內部視窗為1440×900及390×844；CSS媒體查詢、document.activeElement與滾動在該實際viewport驗證。這是桌面瀏覽器的兩種CSS尺寸，不冒充手機硬體或螢幕閱讀器實機。

兩種尺寸均驗證七組原生操作（14案），另有窄螢幕背景長頁捲動（1案）：

| 案例 | 直接觀察 |
|---|---|
| modal | 初始關閉鈕、首末Tab循環、停用／隱藏當前項目、長內容捲動、兩個真Modal內外層Escape及來源還原 |
| fallback | 無子控制項留容器、來源移除或停用回有效控制；窄螢幕另點背景關閉 |
| conditional | StrictMode條件掛載、首末循環、關閉回真正來源、重新開啟再關閉 |
| analysis | 正式App選空手、動態啟用送出、正反循環、Escape回AI分析；沒有發送AI |
| add | 正式App輸入假AAPL、動態表單、正反循環、長內容及Escape回新增持股；沒有新增實際持股 |
| import | 從新增來源反向Tab到匯入、Enter開啟、到選檔控制、正反循環、Escape還原；沒有選取或匯入檔案 |
| indicator | 正式App原生ArrowUp將MA5改6，輸入DOM及焦點保留；Space切換aria-pressed=false，Escape回來源 |
| narrow-scroll | 視窗關閉後Ctrl+Home／End可正常捲動背景長頁，回頁首不受影響 |

起點定位採可見來源控制的focus，之後開啟、循環、選擇與關閉均用Desktop原生keyboard，`events`逐一記錄isTrusted。匯入來源亦由原生反向Tab導航到達。每一步`readings`保存名稱、activeElement、視窗數、控制項、scrollTop、viewport及公開檢查。兩層情境是測試宿主開啟兩個真正共用Modal，不宣稱正式App新增了疊層流程。

原生操作14組及背景捲動均通過，每頁未處理例外、拒絕Promise與console.error為0，沒有水平整頁溢出。Desktop DOM可及性快照亦實際讀到「顯示第1條均線（MA6）」pressed=false及天數／顏色名稱；完整涉及控制的公開名稱清單保存在indicator原始結果。

`precheck-narrow-layout.json` 是驗收工具最初要求scrollWidth恰等於390的錯誤：瀏覽器8px捲軸使內容寬382，並非溢出。正確條件為scrollWidth不超過viewport。`precheck-narrow-scroll.json` 是原生平滑捲動尚未結束就取值，後續按可觀察捲動位置等待後通過。兩者保留為工具診斷，不用於宣稱產品修復。

## 覆核修正

Standards指出既有賣出視窗採條件掛載，StrictMode重播effect會再次擷取已在視窗內的焦點，覆蓋真正來源。`red-desktop-conditional.json`在首次候選`04fa1b7`原生重現；改由ref跨effect重播保存來源，active已在dialog內時不覆寫。兩尺寸新增conditional案例並全組重跑，原13案存於`precheck-review/`，不納入最終通過。

最終原生重跑使用`native-plan.mjs`的297個操作／觀察步驟，由Desktop工具逐個發送鍵盤與背景點擊，並於每案重新載入頁面。15案共141個trusted按鍵。一次Ctrl+End接受後未捲動，工具停止並檢查公開scroll位置，再以獨立原生Ctrl+End確認捲動後續驗；原始events保留該次額外按鍵，沒有以改數值斷言掩蓋。測試的捲動條件仍要求實際pageScrollY大於0及返回0。

Windows來源曾混用未改行的CRLF與patch新行的LF。conditional紅燈指紋以反向還原唯一ref修正所得原始bytes，並同時要求其正規化內容與`04fa1b7`完全相同；不接受只看正常化雜湊而略過原始指紋。

## 重跑

```powershell
node .scratch/optimization-followup/evidence/check.mjs 10 gate
node .scratch/optimization-followup/evidence/10/fixture-server.mjs
```

4183只綁loopback，所有應用API為固定假資料、AI及未知API拒絕，CSP同源。使用 `/viewport?size=desktop&page=harness`、`size=narrow`，以及`page=app`。對照各JSON的events與readings依序重播原生鍵盤；真實產品原始碼及build指紋由假站在啟動時綁定，產品或工具變更需重啟並重跑。

`node .scratch/optimization-followup/evidence/10/verify-evidence.mjs` 重新比對焦點斷言、原生鍵數、來源、工具、正式build、esbuild宿主、紅燈基準及原始檔指紋。JSON內的passed不是唯一判準。原有51個測試／snapshot／依賴雜湊由 `check.mjs 10 verify` 核對；本票新增的行為驗證是實際瀏覽器案例，Vitest測試數不因此增加。

最終gate為47檔／805項通過，型別／build／秘密掃描均成功且沒有掃描降級；51個原有測試／snapshot／依賴保持雜湊不變。首屏291.26 KiB raw／95.79 KiB gzip，相對01低於5%調查門檻。`verified-evidence.json`核對15案、141次原生按鍵、3份修改前紅燈及94個產品來源。最後假站停止狀態見`cleanup.json`，分頁轉至唯讀metadata並保留給後續票。

獨立雙軸結論另存 `code-review.md`。本票沒有螢幕閱讀器實機驗證，不能據此宣稱全部可及性要求已涵蓋。

## 中斷續作與最後清理

續作時重新核對15案、141次原生按鍵、3份紅燈、94個來源及51個受保護檔案，全部一致。Spec覆核發現原`cleanup.json`仍是第一輪13案的03:58紀錄；該紀錄現保留於`precheck-review/cleanup-first.json`，不當作最後一輪清理。

由作業系統程序資料找回04:10:13啟動的PID17228，命令列精確指向本票`fixture-server.mjs`；其`/__fixture/meta`的候選、build及宿主指紋均符合最終15案，記於`recovered-process.json`。將保留分頁導向metadata後，只停止該已確認程序；`cleanup.json`記錄04:35:53檢查4183 listener為0。最初空白的格式化列表未用作最後判定，最後以明確整數計數確認。
