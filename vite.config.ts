/// <reference types="vitest/config" />
import path from 'path';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 金鑰紅線的最後一道機制：只有 `VITE_` 前綴的 .env 變數會被內聯進前端 bundle。
  // GEMINI_API_KEY／FINMIND_TOKEN 等後端秘密之所以進不了 dist/，靠的就是這一行
  // （原本靠 Vite 的同名預設值，等於零防護——見 docs/gate-audit-findings.md G3）。
  // 放寬前綴（如 ['VITE_', 'GEMINI_']）或加 define: { 'process.env': ... } 會讓後端秘密
  // 立刻有資格進 bundle，因此由 utils/viteConfigGuard.test.ts 鎖住；要動請先讀那支測試。
  // （`envPrefix: ''` 這種寫法 Vite 自己會 throw，不必本鎖擋——實測見該測試的說明。）
  envPrefix: 'VITE_',
  test: {
    // agent worktree 內的測試複本不屬於本專案測試母體（曾致 32 案例被重複計成 64）
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    // .claude/（agent worktree、本機設定）不屬於 app 原始碼：不監看，
    // 否則 worktree 內的檔案變動會觸發整頁 reload，鎖住的檔案更會讓 watcher EBUSY 崩潰
    watch: {
      ignored: ['**/.claude/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
          recharts: ['recharts'],
          markdown: ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
});
