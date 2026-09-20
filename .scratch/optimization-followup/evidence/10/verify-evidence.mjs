// 核對公開焦點、原生事件及來源／工具／build指紋，不以passed旗標代替斷言。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const ticket = process.argv[2] || '10';
if (!['10', '12'].includes(ticket)) throw new Error('僅允許10或12');
const root = new URL('../../../../', import.meta.url), tools = new URL('./', import.meta.url);
const output = ticket === '10' ? tools : new URL('../12/keyboard/', import.meta.url);
const fixed = '6493c4c78b8282db1dae1202ca94df9aa08e8b40';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sourceHashes = new Map(), oldHashes = new Map();
const compiled = await build({ entryPoints: [fileURLToPath(new URL('modal-harness.jsx', tools))], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', define: { 'process.env.NODE_ENV': '"development"' } });
const harnessHash = hash(compiled.outputFiles[0].contents);
const cases = [];
const names = ['modal', 'fallback', 'conditional', 'analysis', 'add', 'import', 'indicator'];
for (const name of [...['desktop', 'narrow'].flatMap(size => names.map(name => `green-${size}-${name}`)), 'green-narrow-scroll']) {
  const bytes = readFileSync(new URL(`${name}.json`, output)), row = JSON.parse(bytes);
  assert(row.passed && row.errors.length === 0, `${name}: 有失敗或錯誤`);
  assert(row.readings.length >= 3 && row.readings.every(r => r.passed && Object.entries(r.checks).every(([key, value]) => r[key] === value)), `${name}: 焦點或捲動斷言不符`);
  const width = name.includes('narrow') ? 390 : 1440, height = width === 390 ? 844 : 900;
  assert(row.viewport.width === width && row.viewport.height === height && row.viewport.scrollWidth <= width + 1, `${name}: 尺寸或水平溢出`);
  assert(row.events.filter(event => event.kind === 'key' && event.trusted).length >= 3, `${name}: 沒有足夠原生鍵盤事件`);
  for (const [file, expected] of Object.entries(row.sourceHashes)) {
    if (!sourceHashes.has(file)) sourceHashes.set(file, hash(readFileSync(new URL(file, root))));
    assert(expected === sourceHashes.get(file), `${name}: 產品來源漂移 ${file}`);
  }
  for (const [file, expected] of Object.entries(row.toolHashes)) assert(hash(readFileSync(new URL(file, tools))) === expected, `${name}: 工具漂移 ${file}`);
  assert(row.harnessSha256 === harnessHash && row.buildIndexSha256 === hash(readFileSync(new URL('dist/index.html', root))), `${name}: 建置指紋不符`);
  if (name.endsWith('indicator')) {
    assert(row.retainedFocus && row.periodBefore === '5' && row.periodAfter === '6' && row.pressed === 'false', `${name}: 修改天數或開關後焦點／狀態錯誤`);
    assert(row.names.filter(control => control.name.includes('均線')).length >= 12 && row.names.every(control => control.name.trim()), `${name}: 操作缺名稱`);
  }
  if (name.endsWith('modal')) assert(row.longContentScrolled && row.readings.some(r => r.dialogCount === 2) && row.readings.at(-1).activeId === 'open', `${name}: 疊層或長內容未驗證`);
  cases.push({ name, passed: true, readings: row.readings.length, nativeKeys: row.events.filter(e => e.kind === 'key' && e.trusted).length, sha256: hash(bytes) });
}
const red = [];
if (ticket === '10') for (const name of ['red-desktop-modal', 'red-desktop-indicator', 'red-desktop-conditional']) {
  const bytes = readFileSync(new URL(`${name}.json`, output)), row = JSON.parse(bytes);
  const redFixed = name.endsWith('conditional') ? '04fa1b7e14a26da3464145293f25451faa6fe534' : fixed;
  assert(row.baseline === redFixed && row.passed === false && row.errors.length === 0 && row.readings.some(r => !r.passed), `${name}: 紅燈未真正重現`);
  for (const [file, expected] of Object.entries(row.sourceHashes)) {
    if (expected === sourceHashes.get(file)) continue;
    const key = `${redFixed}:${file}`;
    if (!oldHashes.has(key)) {
      const text = execFileSync('git', ['show', key], { cwd: root, encoding: 'utf8' });
      oldHashes.set(key, [hash(text), hash(text.replace(/\r?\n/g, '\r\n'))]);
    }
    let matches = oldHashes.get(key).includes(expected);
    if (!matches && name.endsWith('conditional') && file === 'components/ui/Modal.tsx') {
      // Windows patch 保留未修改行的 CRLF，新增行是 LF。反向還原唯一修正，
      // 同時要求原始 bytes 指紋相符及正規化後與 Git 候選逐位元組相同。
      const current = readFileSync(new URL(file, root), 'utf8');
      const recovered = current.replace(/  const sourceRef = useRef<HTMLElement \| null>\(null\);\r?\n/, '')
        .replace(/    const active = document.activeElement;\r?\n    \/\/ StrictMode[^\n]*\n    if \(active instanceof HTMLElement && !dialog.contains\(active\)\) sourceRef.current = active;\r?\n    const source = sourceRef.current;/,
          '    const source = document.activeElement instanceof HTMLElement ? document.activeElement : null;');
      const committed = execFileSync('git', ['show', key], { cwd: root, encoding: 'utf8' });
      matches = hash(recovered) === expected && recovered.replace(/\r\n/g, '\n') === committed.replace(/\r\n/g, '\n');
    }
    assert(matches, `${name}: 不屬固定點來源 ${file}`);
  }
  red.push({ name, reproduced: true, sha256: hash(bytes) });
}
const result = { ticket, fixed, cases, red, sourceHashes: Object.fromEntries(sourceHashes), harnessSha256: harnessHash, buildIndexSha256: hash(readFileSync(new URL('dist/index.html', root))) };
writeFileSync(new URL('verified-evidence.json', output), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ greenCases: cases.length, nativeKeys: cases.reduce((sum, row) => sum + row.nativeKeys, 0), redCases: red.length, sourceFiles: sourceHashes.size }));
