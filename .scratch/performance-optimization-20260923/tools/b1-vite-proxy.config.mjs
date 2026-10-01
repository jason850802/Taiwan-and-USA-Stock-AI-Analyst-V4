// 01 票「經 Vite 代理」對照組：只為量 /api 代理這一跳的成本，不服務頁面。
// 代理設定逐項對齊產品 vite.config.ts 的 server.proxy['/api']（target 用 localhost、changeOrigin: true），
// 只把 target 的埠換成本票新起的 B1 vercel dev；不改來源標頭、不加白名單、不繞守門。
// 預打包快取指到本票 runtime，避免與使用者正在跑的 Vite 共用 node_modules/.vite。
import { defineConfig } from 'vite';

const backendPort = process.env.PERF01_BACKEND_PORT;
if (!backendPort) throw new Error('缺 PERF01_BACKEND_PORT');

export default defineConfig({
  envPrefix: 'VITE_',
  cacheDir: process.env.PERF01_VITE_CACHE_DIR,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: {
    host: '127.0.0.1',
    watch: { ignored: ['**/.claude/**', '**/.scratch/**'] },
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
