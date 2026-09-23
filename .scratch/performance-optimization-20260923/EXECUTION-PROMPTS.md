# 可直接交給 GPT6 SOL 或 Claude Code OPUS5.5 的執行指令

兩個工具使用同一組規格與門檻；任選一個作當票主要執行者。不要讓兩個實作者同時改同一套行情／入口檔案。覆核交給未參與該票實作的 reviewer。

## 第一次：採用計畫，只做「固定目前基線並拆出主要等待」

```text
採用第二輪效能計畫，先完成唯一第一票，不從舊案 01 重做。

Repo：E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4
Branch：codex/reacceptance-fixes-p1-s1
規劃核對 HEAD：30dfdb2；動工前重新確認，保留已完成的 e9fa1a2、2bd91f4、6eee87e。

完整讀 CORE_RULES.md、AGENTS.md（Claude 另讀 CLAUDE.md）、
.scratch/performance-optimization-20260923/PLAN.md、STATUS-AUDIT.md、spec.md、acceptance.md，
以及 issues/01-baseline-and-critical-path.md。
舊證據入口是 .scratch/performance-fix-20260922/RESULTS.md。

本次只做第一票：保存實際來源與隱藏變更，建立能判紅的目前 B1 日常入口等待分解，
釐清約 4.1 秒單次報價的 dispatch、Yahoo cookie/crumb/chart、queue、UI 各段成本，
產出下一票是否採同 handler 長駐本機原型的明確證據決定。
採用本計畫的新目標與前瞻比較，不把舊 E0 不可量或 v5 FAIL 追認成 PASS。

允許本票必要的本機隔離測試、固定上游、預算內只讀真行情小批、量測工具與精確提交。
不執行第二票、不替換日常入口、不提高三槽或 peak=3、不改金融語意／套件／測試收錄。
先固定 fixture 與請求預算才打真上游；無需再次詢問已明確授權的本票一般操作。
舊 E0 相同失敗不反覆重跑；不能取得 50% 暖基準就保留不可量，不阻斷新的 B1 優化。

注意：主工作區有 skip-worktree 與實體缺檔；git status 不足以證明乾淨。
不要清全樹 flags、restore 全樹、git add .、reset --hard、git clean。
新計畫文件可能尚未提交，開隔離 checkout 前先保存並帶入實際文件／候選來源，
不要只 checkout 30dfdb2 就遺失本輪計畫。
C:\pfv7\node_modules 是 junction；完整 gate 的來源須對應本輪候選，不得直接驗舊 6eee87e。
safe.directory 僅用 GIT_CONFIG_COUNT／GIT_CONFIG_KEY_0／GIT_CONFIG_VALUE_0 環境變數。
不提交 runtime；不碰 .scratch/reacceptance-fixes/HANDOFF.md、真帳本或本體五鍵；不用真 AI。
前輪 runtime .env 已清空，需要環境只送入後端並在收尾清本票複本。
所有產出繁體中文；不 push、不部署、不發版。

完成本票必要檢查、獨立 Standards＋Spec 覆核、票面、精確 commit 及固定交接後停止。
交接先寫實際瓶頸與下一個行動，不能只列工具與測試已通過。
```

## 後續：只執行已解除依賴的下一票

```text
繼續 E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4 的
.scratch/performance-optimization-20260923/PLAN.md。

先讀 CORE_RULES.md、spec.md、acceptance.md、目前票面與直接前置的交接；核對 Git 與實際來源。
先完成已 claimed 的當票；否則只領取編號最小且前置均已完成的一票。
必須尊重條件分支的實測選路；不重做上一輪的名稱解耦、FX 入列與 K 線 correctness。
唯一交接例外：07 因外部阻斷無法測完時，可依票面先做 08 報告／覆核／清理，
但不能把 07、真行情目標或全案狀態改成已完成。

授權本票計畫內的產品／工具實作、本機測試、預算內只讀真行情與精確提交。
同 handler 長駐候選須先完成原型 parity，才能在日常入口票採用；不要提前替換預設。
維持三槽、既有測試期望、金融／匯率／快取語意、package／lock 與 P1／S1。
真上游不足不能用 mock PASS 代替；gate 全綠不能代替效能門檻。

沿用本計畫工作區／junction／env／全新 port／證據不可覆寫等限制。
每次只完成一票：隔離 gate（實際候選來源）、獨立 Standards＋Spec 覆核、狀態、
精確 commit、清理與固定交接後停止。不 push、不部署、不發版；不用真 AI 或真帳本。
```

## 固定交接格式

```text
本票／狀態／來源與最終 commit：
這次真正改變的等待來源、採用與未採用分支：
使用者可感知的 before→after（來源、樣本、成功／失敗、時間口徑）：
各段時間與 browser／provider 請求數、重試、peak、快取：
正確性、FX、沿用窗、取消／世代、P1／S1、本體五鍵：
固定測試、真行情、正式 App、完整 gate、雙軸覆核各自結果：
證據入口、日常啟停／重跑命令、回復方式：
仍 OPEN 的具體原因、不可控下限與已嘗試措施：
下一票名稱、前置是否滿足、下一個可直接執行動作：
```

只讀過舊證據就寫「證據核對」；這次有重跑才寫「本輪執行」。未完成的目標保留 OPEN。不要再使用「收尾完成」代替整體症狀已改善。
