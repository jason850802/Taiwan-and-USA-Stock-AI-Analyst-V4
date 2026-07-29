# RUNBOOK — 單窗接力掛機執行（使用者 2026-07-29 授權）

模式：**同一視窗、四票依序接力（01→02→03→04）、每票自我驗證**。
使用者離線至隔日中午，過程**不停下來問**——語意決策已全數拍板
（spec.md＋ADR-0003＋CONTEXT.md「台股現股當沖」節）。
本檔在磁碟上：context 被壓縮後迷路，就回來重讀本檔＋當前票面＋spec。

## 步驟 0：前置（動工前一次做完）

1. 確認本窗是唯一在動這個 repo 的窗；確認沒有 dev server／檔案監看在跑
   （Windows 監看鎖 git 的既有教訓）。
2. `git status` 盤點工作樹（規劃窗留下的未 commit 內容是預期的）：
   - 費率提取重構（config 費率設定檔＋費稅模組改 import＋註解修正）：
     先 `npm run gate`，綠則**單獨一個 commit**（繁中 message，註明「另一窗產出、本窗代收基線」）。
   - 規劃文件（CONTEXT.md／ADR-0003／`.scratch/tw-day-trade/` 整包）：
     **單獨一個 docs commit**（純文件免跑 gate）。
3. 基線全綠後建分支 `phase/tw-day-trade`，全程在此分支工作。
4. 讀 spec.md 全文＋CONTEXT.md「台股現股當沖」節＋ADR-0003，再開票 01。

## 逐票協定（每張票重複）

1. **重讀票面**（防 compact 後漂移），Status 改 `claimed`。
2. **TDD**：先寫紅測（手算對數先手算、算完才寫斷言），再實作到綠。
3. **驗證**：`npx tsc --noEmit` → 相關測試檔 → `npm run gate` 全綠
   （gate 含 build＋AIza grep＋lock diff）。
4. **commit**：一票一 commit、繁中 message；票面標 `resolved`＋日期＋commit hash。
5. UI 票（03／04）額外：起 preview（單埠 3001 即完整 App）做 **DOM 驗證**
   （不靠截圖，截圖會逾時）；console 零紅字；預覽數字與手算比對；
   **驗完停掉 preview 再做 git 操作**。

## 全票完成後（票 04 的收尾段）

1. 批次 code-review：對 `main..HEAD` 全 diff 跑 Standards＋Spec 兩軸。
2. findings 修正另立 commit；不修的在 findings.md 記明理由。
3. 最終 `npm run gate` 全綠。
4. 寫 `REPORT.md`（內容清單見票 04）。
5. **停在 feature branch，不合併 main**——合併是使用者中午驗收後的動作，
   合併時 merge commit 帶 `Code-Review:` trailer（範例寫進 REPORT.md）。

## 疑義與卡死（掛機模式的處置規則）

- **語意疑義**：不停等使用者。取**保守解**（寧多課稅、不少課稅）＋記入 findings.md，
  繼續往下做。
- **紅線衝突**＝不是疑義，直接停：要改任何既有測試案例才能過、要升備份 schema 版本、
  要動手續費——寫 `BLOCKED.md` 說明狀況後安全停止。
- **環境卡死**（基線紅、npm 壞、gate 起不來）：寫 `BLOCKED.md`
  （現況＋已試過什麼＋建議下一步），停在最後一個綠的 commit 上。

## 紅線 recap

既有測試案例零修改／不升 `BACKUP_SCHEMA_VERSION`／對帳單匯入不重算・不反推／
手續費零變動／金鑰紅線（build 後 AIza grep 必須無結果）／
票據不寫檔案路徑與行號（耐久原則）／碰錢公式一律手算對數先行。
