# 04 — LITE 賣出一次性資料修復（使用者實機 runbook）

Status: ready-for-human
Blocked by: 01, 02

## 目標

票 01／02 合併並在使用者環境生效後，把這次被幻影缺口誤殺的 LITE 碎股賣出補記回去：
重匯同一份對帳單，讓庫存（扣掉三批）、已實現帳本（多一筆 2.802 賣出）、
歷史曲線三者歸一致。

## 背景（為什麼可能要清鍵）

按「確認匯入」時，**全部**交易的去重鍵都會記成已匯入——含被略過的賣出。
若使用者當時按了確認，LITE 賣出的鍵已在匯入紀錄裡，重匯同檔會被去重擋掉，
須先移除該鍵。若當時取消了，直接重匯即可。維持「確認即記鍵」語意是拍板 2 的
決定（ADR-0004 決策 4），本票是一次性修復不是語意變更。

流水儲存依鍵去重（appendTxns），重匯**不會**重複記流水；匯入紀錄裡 batches 的
count 只是資訊性摘要，清鍵後不必修它。

## 步驟（使用者在 Edge 上操作；App 網址照常開）

1. **先下載備份**（App 內建「下載備份」鈕）——修復前的保命快照。
2. F12 開 DevTools → Console，貼**診斷 snippet**：

   ```js
   const log = JSON.parse(localStorage.getItem('portfolio_import_log_v1') ?? '{}');
   const hit = (log.keys ?? []).filter(k => k.includes('|LITE|sell|'));
   console.log(hit.length ? `已記鍵（走步驟 3）：${JSON.stringify(hit)}` : '未記鍵（跳過步驟 3，直接重匯）');
   ```

3. （僅診斷顯示「已記鍵」時）貼**清鍵 snippet**，然後**重新整理頁面**：

   ```js
   const KEY = 'portfolio_import_log_v1';
   const log = JSON.parse(localStorage.getItem(KEY));
   const before = log.keys.length;
   log.keys = log.keys.filter(k => !k.includes('|LITE|sell|'));
   localStorage.setItem(KEY, JSON.stringify(log));
   console.log(`已移除 ${before - log.keys.length} 個 LITE 賣出鍵`);
   ```

4. 庫存分頁 → 匯入券商對帳單 → 選**當初那份**含 LITE 賣出的國泰複委託檔案。
5. 預覽應顯示：**賣出計入損益 1**、其餘筆數全在「略過重複」、**沒有缺口列**。
   若仍出現 LITE 缺口列 → 停下回報（引擎修正未生效或另有真缺口），不要硬補成本。
6. 按確認匯入。

## 驗收（使用者實機檢查）

- 庫存：LITE 三批消失（全賣）；若對帳單只賣部分則剩餘股數正確且顯示為小數原值。
- 已實現帳本：出現該筆賣出，股數欄顯示「2.802」（實際以對帳單為準）、
  損益金額與券商對帳單一致。
- 歷史損益曲線與庫存一致（該賣出先前若已入流水，曲線本來就把 LITE 視為清倉，
  修復後兩邊對齊；有疑慮可按「重算歷史回推」再看一次）。
- Console 零紅字。

## Comments

- 診斷／清鍵 snippet 由規劃窗預寫（2026-08-04）；localStorage 鍵名是儲存契約
  （CONTEXT.md「本體資料」），非程式路徑。
- 使用者用 Edge 開 App 是既定事實（memory：user-app-browser-edge），
  Console snippet 是既定協作模式。
