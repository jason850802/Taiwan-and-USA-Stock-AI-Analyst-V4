// 最終整合功能矩陣：逐項核對預期檔案、實際判定、兩尺寸與來源／工具／build指紋。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { caseNames as holdingCases } from './holdings-cases.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const only = process.argv[2];
if (only && !['02', '03', '04', '05'].includes(only)) throw new Error('請指定02～05或全部');
const sha = data => createHash('sha256').update(data).digest('hex');
const fileHash = file => sha(readFileSync(path.join(root, file)));
const source = JSON.parse(readFileSync(path.join(dir, 'audit.json'), 'utf8')).files.map(r => r.path);
const sourceHashes = Object.fromEntries(source.map(file => [file, fileHash(file)]));
const buildHash = fileHash('dist/index.html');
const expect = (value, message) => { if (!value) throw new Error(message); };
const names = {
  '02': ['race', 'retry', 'ai-success', 'ai-failure', 'same-symbol-early-error', 'same-symbol-late-success', 'cache-return', 'old-success-pending', 'unmount', 'ai-return-pending', 'ai-unmount'],
  '03': ['stale-return', 'switch-return', 'tab-return', 'force-pending', 'failure-retry'],
  '04': [...holdingCases, 'app-overlap'],
  '05': ['overlap', 'remove', 'unmount', 'cache', 'duplicate', 'retry'],
};
const rows = [];
for (const ticket of only ? [only] : Object.keys(names)) {
  const expected = ticket === '05'
    ? [1, 10, 30].flatMap(n => Array.from({ length: 7 }, (_, sample) => `after-load-${n}-${sample}.json`))
      .concat(names[ticket].map(name => `green-${name}-30-0.json`), ['desktop-green-app-30-0.json', 'narrow-green-app-30-0.json'])
    : ticket === '04' ? holdingCases.map(name => `desktop-green-${name}.json`).concat(['desktop-green-app-overlap.json', 'narrow-green-app-overlap.json'])
    : ['desktop', 'narrow'].flatMap(size => names[ticket].map(name => `${size}-green-${name}.json`)
      .concat(ticket === '03' ? [`${size}-manual-market.json`] : []));
  for (const name of expected) {
    const rel = `replay-${ticket}/${name}`;
    const raw = readFileSync(path.join(dir, rel));
    const result = JSON.parse(raw.toString('utf8'));
    expect(result.passed === true, `${rel}: ${result.error || '未通過'}`);
    const binding = result.integration;
    expect(binding?.ticket === '12' && binding.replayOf === ticket, `${rel}: 非12重跑`);
    expect(Object.keys(binding.sourceHashes).length === source.length, `${rel}: 來源指紋數量不符`);
    for (const [file, hash] of Object.entries(sourceHashes)) expect(binding.sourceHashes[file] === hash, `${rel}: 來源漂移 ${file}`);
    for (const [file, hash] of Object.entries(binding.toolHashes)) expect(fileHash(file) === hash, `${rel}: 工具漂移 ${file}`);
    expect(binding.buildIndexSha256 === buildHash, `${rel}: build不符`);
    const browser = result.integrationBrowser;
    expect(browser && browser.errors.length === 0, `${rel}: 未捕捉例外或console error`);
    const viewport = browser.viewport;
    const targetWidth = name.startsWith('desktop-') ? 1440 : name.startsWith('narrow-') ? 390 : null;
    if (targetWidth) expect(viewport.width === targetWidth && viewport.height === (targetWidth === 1440 ? 900 : 844), `${rel}: viewport不符`);
    // 純文字hook宿主不是產品版面，不把它的JSON長字串當作正式App寬度。
    if (browser.pathname === '/') expect(viewport.scrollWidth <= viewport.width + 1, `${rel}: 正式App整頁溢出`);
    expect((result.uncaught?.length ?? 0) === 0, `${rel}: 宿主未捕捉例外`);
    if (name.endsWith('manual-market.json')) {
      expect(browser.nativeKeys.length === 17 && browser.nativeKeys.every(k => k.trusted), `${rel}: 缺原生鍵盤證據`);
      expect(result.before === 64 && result.zoomed === 51, `${rel}: K線縮放讀值不符`);
      expect(result.readings.length === 7 && result.readings.some(r => r.step === '原生清空' && r.value === '')
        && result.readings.some(r => r.step === '原生方向鍵選股' && r.value.includes('2330'))
        && result.readings.some(r => r.step === '原生輸入美股' && r.query === 'AAPL' && r.quote === '222.00'), `${rel}: 搜尋操作讀值缺失`);
    }
    rows.push({ file: rel, passed: true, sha256: sha(raw), width: viewport.width, height: viewport.height,
      formalApp: browser.pathname === '/', scrollWidth: viewport.scrollWidth,
      expectedHttpFailures: browser.failures, warnings: browser.warnings.length, nativeKeys: browser.nativeKeys.length });
  }
}
writeFileSync(path.join(dir, only ? `verified-replay-${only}.json` : 'verified-replays.json'), JSON.stringify({
  ticket: '12', sourceHashes, buildIndexSha256: buildHash, cases: rows,
  note: 'HTTP故障注入依各case的成功斷言另列，不混成正常情境零失敗。hook宿主與正式App分開計數。',
}, null, 2) + '\n');
console.log(JSON.stringify({ group: only || 'all', cases: rows.length, formalApp: rows.filter(r => r.formalApp).length,
  sourceFiles: source.length, allPassed: true }));
