# 01 既有工作區來源分類

固定比較點：`5f6b48a9e2a2077539ec8341b2dddb7d45e53d94`。

本票沒有把舊 HEAD 當成完整候選。分類依據是第一輪規格、第一輪完成報告、完整 Git diff／未追蹤清單，以及獨立唯讀 worker 的交叉盤點。未追蹤檔沒有 Git base，因此其來源只標示為「文件互證」，不宣稱 Git 能證明作者或逐行時間。

## A — 第一輪接手前已存在、但屬同一最佳化脈絡

- `components/ui/Banner.tsx`：`role=alert/status` 語意；第一輪規格明載接手時已存在 Banner 語意修改。
- `vite.config.ts`：圖表／Markdown 不再固定進首屏 manual chunk；第一輪報告明載接手時已存在圖表／報告延遲載入。
- `App.tsx` 的 StockChart／AnalysisResult lazy import、fallback 與 Suspense 屬此批；同檔其餘 Gemini 動態 import 與清理屬 B。
- `scripts/measure-initial-bundle.mjs`：第一輪規格明載接手時已有量測腳本；檔案在 Git 中原本未追蹤，故無法逐行證明時間，整檔以文件互證保存。

## B — 第一輪最佳化成果

追蹤檔：

- `App.tsx`：市場 AI 動態 import、未用型別／回呼清理部分。
- `components/FundamentalsPanel.tsx`、`components/Portfolio.tsx`、`components/portfolio/useHealthCheck.ts`：AI 入口延後載入。
- `components/StockChart.tsx`：React memo 與未用 props/import 清理。
- `components/StockSearch.tsx`、`services/stockDirectory.ts`：搜尋並行、Abort、過期回應守衛、狀態與 ARIA。
- `services/yahoo.ts`：`Intl.DateTimeFormat` 重用；相同代碼報價進行中請求共用與快取競態保護。
- `components/portfolio/HoldingsTable.tsx`、`components/portfolio/ImportStatementModal.tsx`、`services/gemini.ts`、`utils/math.ts`、`utils/statementParsers/index.ts`：編譯器確認的未用宣告／import 清理。

未追蹤成果與證據：

- `.scratch/optimization-2026-09-18/`：第一輪規格、前後量測、gate、假資料站與驗收紀錄。
- `docs/optimization-2026-09-20.md`：第一輪完成報告。
- `scripts/audit-source-usage.mjs`、`scripts/benchmark-market-data.mjs`：來源掃描與固定假行情量測。
- `services/stockDirectory.loading.test.ts`、`services/yahoo.loading.test.ts`、`utils/appLazyBoundaries.test.ts`：第一輪新增公開行為測試。

## C — 本輪 follow-up 規劃與 01 證據

- `PLAN.md`。
- `.scratch/optimization-followup/spec.md`、`acceptance.md`、`drafts/`、`issues/`。
- `.scratch/optimization-followup/evidence/01/`：固定點、工作區 patch、SHA-256、實跑 gate／量測、瀏覽器驗收與覆核證據。

## D — 不明或無關內容

沒有找到可確定為無關修改的整個路徑。兩個需要保留語意差異的例外是：

1. `App.tsx` 同時含 A 與 B，不能整檔宣稱只來自單一批次。
2. `scripts/measure-initial-bundle.mjs` 因原本未追蹤，逐行來源無 Git 證據；只依第一輪文件與檔案時間互證。

`components/ui/Banner.tsx` 與 `utils/math.ts` 的 Git 輸出提示未來可能有 CRLF→LF 轉換；本票沒有重寫這兩個檔案，提交以現有實質 diff 為準。

## 回復方式

本票保存完成後，以「反向套用本票基準 commit」作為回復單位；先檢查後續票依賴與當前工作區差異。不得用 reset 回舊 HEAD，因舊 HEAD 不包含上述 A／B 未提交成果。
