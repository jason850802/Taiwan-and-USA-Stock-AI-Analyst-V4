# OPTIONS formal v2 — 01 / E0 + clean setup

狀態：**OPEN，formal protocol 已 fail-fast 停止。**

本輪先建立 fresh v2 runtime 與身分鏈，未覆寫 v1 evidence。產品／設定來源以 `source-manifest.json` 綁定 HEAD `e9fa1a200255d860e3166fad0e2636b49178b894`，base manifest SHA-256 為 `cf857701eed03eaacdaae7ec982df45fc9dda33765dac3cd78a37eff7592a653`。E0／E1／E2 共用同一個 full runtime；`.scratch` 負載凍結為 8,960 個路徑、來源總大小 442,943,031 bytes，runtime 只建立零內容 placeholder，不複製 historical evidence 或秘密內容。同期 clean 使用同一份產品來源 manifest，但不含該 `.scratch` payload。

`e0/start-1` 已保存 actual process identity：Vite owned/listener PID 25780、port 4210；Vercel owned/listener PID 40880、port 3020。identity 同時保存 exact command、cwd、source/setup/config/tool hashes、Node 26.4.0、Vercel 55.0.0、Vite 6.4.1、時區與環境變數名稱。

正式 OPTIONS 在第一支 cold `/api/yahoo/chart` 即失敗：60,018.5263 ms 後 `AbortError: This operation was aborted`，status=null。`raw.json` 只保留這一列；capture 因 fail-fast 未發 FinMind 或 warm pair。Vercel stderr 在整段期間只到 `Retrieving project…`；Vite 已正常 ready。依 frozen protocol，本輪沒有執行 E0 start-2，也沒有進入 clean／E1／E2 formal capture。

證據入口：

- `setup.json`：四 variant runtime/config identity 與 frozen manifest。
- `source-manifest.json`：171 個產品／設定來源檔身分。
- `scratch-layout.json`：8,960 檔 frozen non-product layout；只含路徑與大小。
- `e0/start-1/identity.json`：actual PID/port/command/runtime/tool/config/source identity。
- `e0/start-1/raw.json`：唯一 cold timeout raw。
- `e0/start-1/status.json`：probe exit 1 與 owned process cleanup 結果。

因此 01 的 formal OPTIONS closure 尚未成立；這份 v2 evidence 的用途是保留可審查的失敗與新的 red-capable identity/structure protocol，不將 timeout 排除或以後續成功樣本取代。

收尾離線驗證：`e0/failure-validation.json` 由 v2 structural validator 正確判紅，列出 start 少於 2、probe exit 1、Yahoo timeout、FinMind/cold/warm/merged 缺失；`historical-threshold-sanity.json` 仍以 `protocol=threshold-only` 通過舊診斷方向（Yahoo 71.78%、FinMind 74.48% reduction），但不作 formal reference。最終 `self-test.mjs` 為 15/15 通過。
