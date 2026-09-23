import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendOrigin = process.env.PERF_TRUE_MARKET_BACKEND ?? 'http://127.0.0.1:3010';

export default defineConfig({
  envPrefix: 'VITE_',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: backendOrigin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', proxyReq => {
            // 量測 Vite 使用隔離 port；只在 proxy 邊界把瀏覽器來源正規化成實際 backend 同源，
            // 沿用正式 guard 的 same-origin 契約，不新增白名單或繞過 shared secret／rate limit。
            proxyReq.setHeader('origin', backendOrigin);
            proxyReq.setHeader('referer', `${backendOrigin}/`);
          });
        },
      },
    },
  },
});
