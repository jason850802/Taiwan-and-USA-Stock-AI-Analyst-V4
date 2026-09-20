import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const viteConfigSource = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

describe('App 首屏 lazy 邊界', () => {
  it('圖表與 AI 報告只在需要時載入', () => {
    expect(appSource).toContain("const StockChart = lazy(() => import('./components/StockChart'))");
    expect(appSource).toContain("const AnalysisResult = lazy(() => import('./components/AnalysisResult'))");
    expect(appSource).not.toMatch(/import StockChart from ['"]\.\/components\/StockChart['"]/);
    expect(appSource).not.toMatch(/import AnalysisResult from ['"]\.\/components\/AnalysisResult['"]/);
  });

  it('不以全域 manual chunk 破壞 lazy 邊界', () => {
    expect(viteConfigSource).not.toMatch(/\brecharts\s*:\s*\[['"]recharts['"]\]/);
    expect(viteConfigSource).not.toMatch(/\bmarkdown\s*:\s*\[[^\]]*react-markdown/);
  });
});
