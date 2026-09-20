// 將每案公開結果綁定到目前 hook 原始碼與正式 build，不以檔案存在冒充通過。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { caseNames } from './browser-cases.mjs';
const root = new URL('../../../../', import.meta.url);
const hash = file => createHash('sha256').update(readFileSync(new URL(file, root))).digest('hex');
const hookSha256 = hash('components/portfolio/useHoldingPrices.ts');
const buildIndexSha256 = hash('dist/index.html');
const names = [...caseNames.map(name => `green-${name}`), 'green-app-overlap', 'manual-refresh'];
const cases = names.map(name => {
  const result = JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8'));
  return { name, passed: result.passed === true, hookMatches: result.hookSha256 === hookSha256,
    buildMatches: result.buildIndexSha256 === buildIndexSha256, uncaught: result.uncaught?.length ?? null };
});
const result = { baseline: 'b2e0e4d2903083e193b3ae3b7b83765044327379', node: process.version,
  hookSha256, buildIndexSha256, cases };
writeFileSync(fileURLToPath(new URL('./candidate-evidence.json', import.meta.url)), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exitCode = cases.every(row => row.passed && row.hookMatches && row.buildMatches && row.uncaught === 0) ? 0 : 1;
