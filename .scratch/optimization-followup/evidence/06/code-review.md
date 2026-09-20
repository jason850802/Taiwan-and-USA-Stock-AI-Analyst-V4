# 06 獨立雙軸覆核

日期：2026-09-21。兩個獨立 reviewer 沿用使用者已授權的 `5.6 high`，全程唯讀。

固定比較點：`12c544f4a58d2fe07b46e523e7ddfc796eb11f12`；候選：`7d3a4b30e5ab56598a7e54e174a6abfc5c15d3ba`。merge-base 已確認為固定點，區間只有本票提交，共 13 檔。

```text
git diff 12c544f4a58d2fe07b46e523e7ddfc796eb11f12...7d3a4b30e5ab56598a7e54e174a6abfc5c15d3ba
git log 12c544f4a58d2fe07b46e523e7ddfc796eb11f12..7d3a4b30e5ab56598a7e54e174a6abfc5c15d3ba --oneline
```

## Standards

完整覆核 **OPEN:0**，無實質 finding。共享 pending、配對世代、身分式失效與 finally 清理自洽；401／429、403／404／500、十分鐘沿用窗及 500 ms／兩次嘗試契約與固定點一致。12 項 Fowler 基線沒有值得回報的項目。

## Spec

完整覆核 **OPEN:0**；missing/partial、scope creep、implemented wrong 各 0。公開測試覆蓋新握手完成前／後才回舊 401，斷言不啟第三組，再反序完成主回應並驗暖請求配對。reviewer 確認 single-flight 在入口排除多握手反序，README 的不變量說明與測試一致；沒有用私有清除入口冒充公開驗收。

兩軸都核對完整 13 檔 diff、17 項新增測試、真 handler 合成鏈與完整 gate；全程唯讀、沒有替作者改檔或重跑服務。

## 作者實跑與邊界

原 40 項 Yahoo 行為鎖及改前新增 10 項契約測試皆綠；十個冷請求重現 10 組握手的紅燈保存。修正後新增 17 項及原 40 項全綠；完整 gate 44 檔／773 項通過。47 個既有測試／snapshot／package／lock 雜湊不變。

公開 handler 用假 upstream 驗證十個請求共用一組配對、維持成功 JSON 及 CDN 標頭。未呼叫真實 Yahoo、AI 或 Redis，未輸出真實憑證。本票只保證單一執行個體；不是跨個體鎖或真實網路品質驗收。
