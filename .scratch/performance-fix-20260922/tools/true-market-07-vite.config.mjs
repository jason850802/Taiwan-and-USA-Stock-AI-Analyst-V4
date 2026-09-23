import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendOrigin = process.env.PERF_TRUE_MARKET_BACKEND ?? 'http://127.0.0.1:3041';

// 07 真行情 cold 協定：/api 回應帶 stale-while-revalidate，瀏覽器會在 300 秒內直接回舊資料，
// 同 origin 重載探針即被快取污染（05 v3、07 v4 已由 Resource Timing transferSize=0 實證）。
// 改為「每頁一個從未開過的 port」：新 origin 沒有任何 HTTP 快取，冷載入由結構保證。
// 曾試 Clear-Site-Data: "cache"，但嵌入式瀏覽器仍混用舊伺服器的預打包模組（React 兩份），已放棄。
// 每個 Vite 用獨立 cacheDir，避免多個程序同時寫同一個預打包目錄。
export default defineConfig({
  envPrefix: 'VITE_',
  cacheDir: process.env.PERF_VITE_CACHE_DIR || undefined,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: backendOrigin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', proxyReq => {
            // 沿用 05 的量測設定：只在 proxy 邊界把來源正規化成 backend 同源，不新增白名單或繞過守門。
            proxyReq.setHeader('origin', backendOrigin);
            proxyReq.setHeader('referer', `${backendOrigin}/`);
          });
        },
      },
    },
  },
});
