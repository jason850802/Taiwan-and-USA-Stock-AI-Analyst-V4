# 01 基準量測與 gate 摘要

固定比較點：`5f6b48a9e2a2077539ec8341b2dddb7d45e53d94` 之上的完整未提交候選。

## 機械驗收

- `npx.cmd tsc --noEmit`：exit 0。
- `npm.cmd run gate`：exit 0。
- Vitest：40 個測試檔、727 項測試全部通過。
- Vite：2678 modules transformed，正式 build 成功。
- 金鑰掃描：乾淨；掃描 `dist/`、Git 追蹤原始碼與本機 `.env` 值比對，未輸出秘密內容。
- `package.json`、`package-lock.json`：與固定 HEAD 無差異；SHA-256 在本票前後也一致。

完整輸出：`tsc.log`、`gate.log`。獨立 review 修正驗收工具後再跑完整 gate；最後一次結果以逐行去除尾端空白的可提交文字保存於 `gate-review-fixes-final.txt`，仍為 40 個測試檔／727 項全綠、build／金鑰掃描／package gate 全綠；原始 `.log` 留在本機 ignored 證據，不納入 Git。

## 首屏 JavaScript

`node scripts/measure-initial-bundle.mjs --skip-build --json`

- raw：283.17 KiB
- gzip：92.82 KiB
- 與第一輪完成快照相同。

原始結果：`bundle-baseline.json`。

review 修正後的最終 build 再量一次仍為 raw 283.17 KiB／gzip 92.82 KiB，保存於 `bundle-final.json`。

## 固定假行情

Node：v26.4.0。量測固定 `TZ=UTC`，整個全域 `Date` 的無參數建構與 `Date.now()` 都固定為 `2026-09-20T04:00:00.000Z`，sessionStorage 為空、`forceRefresh`、假網路延遲 0 ms。cold start 從首次 SSR 載入 `services/yahoo.ts` 前開始，到第一組 `getStockData` 完成為止；之後每組先暖機 1 次（不計統計），再做 5 次取中位數；不含真實網路延遲。

- cold start：578.08 ms
- warm-up：每組 1 次，不計統計
- measured runs：每組 5 次

| 標的／週期 | 輸入→輸出 | 中位數 | SHA-256 |
|---|---:|---:|---|
| AAPL / 1d | 2500→2500 | 21.09 ms | `58b94b8b00fd34cf3d14ba07c0c455e16a9ed5d0c978911a2c5e8bf030c0acac` |
| 2330.TW / 1d | 2500→2500 | 19.99 ms | `71bd8885399f1b0f9f9b3ebf34f6675f730d83ba01780e7d28ed14c7c0d852d5` |
| AAPL / 1wk | 520→520 | 8.27 ms | `79b4f970c6300ae10aefb6f1e34282abc3be862fc61f3eb489c8e0a7fde285e0` |
| AAPL / 60m | 1600→1600 | 13.71 ms | `0b841ab24ff416f399c3261cada985d1e1ff4655a13ba23355d4bd6b314cd2b5` |

四組輸出 SHA-256 與第一輪完成快照全部一致。這組數字使用本票修正後的共同量測規格，不與先前未暖機／未固定 clock 的數值做效能結論；本票只把它保存為後續同條件比較基準。

原始結果：`market-baseline.json`。

## 來源引用掃描

`node scripts/audit-source-usage.mjs`：91 個正式應用／API 程式檔，91 個均可從入口循引用到達，0 個整檔孤立候選。

原始結果：`source-audit.json`。

review 修正後再掃仍為 91/91 可達、0 個孤立候選，保存於 `source-audit-final.json`。

## 保存前後一致性

- `formal-source-sha256-before.txt` 與 `formal-source-sha256-after.txt`：零差異。
- `tests-snapshots-sha256-before.txt` 與 `tests-snapshots-sha256-after.txt`：零差異。
- `package-sha256.txt` 與本票結束時 package／lock 雜湊：零差異。
- review 修正後重新即時計算正式 source、tests/snapshots、package／lock SHA-256，仍與本票保存前清單零差異；review 修正只觸及驗收工具與證據文件。

因此 01 的票據／證據整理沒有暗改既有產品候選、既有測試或依賴檔。
