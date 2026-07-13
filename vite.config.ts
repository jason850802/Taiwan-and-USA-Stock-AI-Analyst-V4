/// <reference types="vitest/config" />
import path from 'path';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
