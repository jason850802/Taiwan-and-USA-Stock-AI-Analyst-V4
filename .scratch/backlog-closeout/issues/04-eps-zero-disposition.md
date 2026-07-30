# 04 — EPS 零值顯示處置（F-01，spike 預算制）

Status: claimed（2026-07-30，單窗自主連跑）
Blocked by: —（依 spec 順序末票）

## What to build

處置 F-01：EPS 恰為 0 的季度在季度趨勢圖上與「無資料」無法區分（recharts 不畫
零高長條，也就沒有標籤錨點）。授權書第 4 條：三種收法都算完結，依序嘗試——

1. **先查 tooltip**：若 hover 零值季度已顯示 `0.00`、無資料季度顯示空或「—」，
   則區分已存在於 UI，紀錄證據結案（不改碼）。
2. **Spike**：≤30 行產線 diff 的乾淨解（讓零值長條有可讀的標籤或標記）。驗證
   照票 03（EPS formatter）的控制組方法：注入含精確 0 的資料、DOM 讀值取證——
   真實 FinMind 資料湊不出精確 0，不要嘗試從真資料驗。
3. **正式 wontfix**：spike 超過 30 行、或方案需要動 recharts 內部行為，直接放棄
   並在 findings 附原型證據（試了什麼、為何不值得）。

無論走哪條，這是顯示層工作：不得動資料層、不得動 EPS formatter 既有行為鎖。

## 驗收條件

- [ ] 三選一的收法完成，`.scratch/strict-backlog/findings.md` 的 F-01 標裁決結果與證據
- [ ] 若走 (1)：tooltip 對照證據（零值 vs 無資料的實際顯示）記入 findings
- [ ] 若走 (2)：DOM 讀值證據（注入資料含 0／null 的對照組）＋顯示行為的新鎖
- [ ] 若走 (3)：原型嘗試紀錄（行數／卡點）記入 findings
- [ ] 任何情況：既有案例零修改、`npm run gate` 全綠、strict 總數不變
