# Spec — 欠帳收口批次（票 04/05 ＋ F-01/02/03，自主連跑）

Status: resolved（2026-07-30，四票全數完結，無停損事項）

## 批次收尾紀錄（2026-07-30）

| 票 | 結果 | 證據 |
|---|---|---|
| 01 react-dom 型別 | resolved | 實作 007228b／merge b0a9ca8；strict 5→4；diff 限一套件 |
| 02 均線無值契約 | resolved | 實作 086c770／merge f4eb990；strict 4→0；行為鎖 7 案＋注入 2 紅 |
| 03 串流取消收斂 | resolved | 實作 7f8ff2e／merge 6c77374；翻轉 3 案紅燈先行＋注入 3 紅；F-02/F-03 已修 |
| 04 EPS 零值處置 | resolved | 6bafc80／merge f06aae7；收法(1)紀錄結案，零碼變更 |

批次驗收逐條：strict `--strict` exit 0（5→0）✓；679 案全綠（666→679，
既有案例僅票 03 清單三案翻轉）✓；gate 全綠 ✓；trailer 稽核 0 筆 ✓；
findings F-01（紀錄結案）/F-02/F-03（已修）標裁決＋證據、另登記 F-04 待裁決 ✓；
四票 resolved（日期＋證據 commit）✓；memory 已更新終局 ✓；push origin main ✓。
來源：使用者 2026-07-30 拍板。**本檔＝授權書＋執行章程**：單一視窗自主連跑四票，
過程不回報，停損或全部完成才回報。執行窗不需（也不應）中途問使用者——
會撞紅線的例外已在下方授權書逐項解鎖並鎖定範圍。

## 背景與範圍

strict 線收在 5 錯後留下的五個 user-gated 決策點，使用者已一次拍板全數處置：

| 項 | 出處 | 本批對應票 |
|---|---|---|
| 原票 04：`@types/react-dom` 缺型別（TS7016×1） | `.scratch/strict-backlog/triage.md` | 01 |
| 原票 05：均線暖身期無值契約（TS2345×4） | 同上 | 02 |
| F-02 取消後仍觸發 onDelta ＋ F-03 取消後 Promise 永不收斂 | `.scratch/strict-backlog/findings.md` | 03 |
| F-01 EPS 零值與無資料在圖上無法區分 | 同上 | 04 |

## 授權書（使用者 2026-07-30 拍板，逐項鎖範圍）

1. **票 01 解除「禁裝新 npm 套件」紅線，一次、一套件**：允許安裝 `@types/react-dom`
   （對齊 react-dom 主版本 ^19，devDependencies）。允許的 diff：`package.json` 增該一行；
   lockfile 僅該套件**及其自身依賴**（若含 `@types/react`）的條目。出現任何其他套件變動＝越權，停。
2. **票 02 零行為變更授權**：只准型別收斂。暖身期輸出（各均線值與方向 flat）改動前後
   必須一致，**行為鎖先行**證明之。若探索後發現無法零行為變更＝停損回報，不得自行選語意。
   領域型別檔（`types.ts`）diff 必須為空（相容性紅線）。
3. **票 03 語意變更授權**（使用者可見行為零變化——client 早已斷線）：cancel 後
   (a) Promise 以既有錯誤分類慣例的「取消」類 **reject**；(b) 後到增量不再觸發 onDelta；
   (c) 呼叫端 catch 取消分類後靜默收尾、不對已斷線 response 寫入、`res.end` 必被呼叫。
   **允許修改的既有測試案例僅限**鎖定 F-02/F-03 現況行為者——動工前先在票面 Comments
   列出清單，逐案紅燈先行。清單外的既有案例維持零修改。
4. **票 04 spike 預算制**，三種收法都算完結：(a) tooltip 既已可區分→紀錄結案；
   (b) ≤30 行產線 diff 的乾淨解→修；(c) 都不成→正式 wontfix 附原型證據。
5. **換窗紀律本批豁免**：單一視窗連跑（使用者明示「最後知道改好了就好」）。
   仍維持一票一 commit、branch → merge --no-ff ＋ `Code-Review:` trailer。
6. **全批收尾後 `git push origin main`**（已授權）。

## 執行迴圈（每票）

claim（票面標 claimed）→ 探索現況 → 依票面的「鎖先行／紅燈先行」要求動工 →
票面驗收逐條跑到全綠 → `npm run gate` 全綠 → merge --no-ff ＋ trailer（兩軸可對證，
是碼不得寫「免跑」）→ 票面標 resolved（日期＋證據 commit）→ 下一票。
驗收紅燈 → 修 → 重跑；**同一原因連紅 3 次＝停損**。

順序：01 → 02（此二票收掉 strict 歸零）→ 03（最重）→ 04（帶預算殿後）。
票間無硬依賴，但不得並行（單窗序跑）。

## 停損條件（任一成立即停，不硬闖）

- 撞到授權書未列的紅線衝突或語意決策。
- 票 01 裝完套件後，strict 冒出**非 React 入口局部**的新診斷。
- 票 02 無法做到零行為變更。
- 同一原因連紅 3 次。

停損時：已合併的票保留（main 每票收尾都是健康態）、當票寫 Comments 記卡點、
如實回報做到哪——**絕不為了收尾把紅燈改綠**。

## 批次驗收（「全部改好」的定義）

- [ ] `npx tsc --noEmit --strict` **exit 0**（5 → 0，strict 欠帳歸零）
- [ ] `npm run test` 全綠、總案數 ≥666；既有案例除票 03 列名清單外零修改
- [ ] `npm run gate` 全綠（票 01 的套件變動入 commit 之後）
- [ ] trailer 稽核 0 筆（`git log --merges code-review-trailer-start..HEAD --invert-grep --grep="^Code-Review:"`）
- [ ] `.scratch/strict-backlog/findings.md` 的 F-01/F-02/F-03 標上裁決結果與證據
- [ ] 本 spec 與四票全標 resolved（日期＋證據 commit）
- [ ] memory `strict-backlog-progress` 更新終局（strict 歸零、F 全數處置、擋票解除）
- [ ] 工作樹乾淨、`git push origin main` 完成

## 最終回報格式

一張表（票 → 結果 → 證據數字），加：strict 前後、測試數前後、翻轉案清單（票 03）、
F-01 走了哪種收法、停損事項（若有）。過程不回報。
