// 程序核對原始量測、產品／工具指紋與全文，再產生摘要；不重跑或改寫原始樣本。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { reportFor } from './report.mjs';

const ticket = process.argv[2] || '09';
if (!['09', '12'].includes(ticket)) throw new Error('僅允許09或12');
const root = new URL('../../../../', import.meta.url);
const tools = new URL('./', import.meta.url);
const dir = new URL(`.scratch/optimization-followup/evidence/${ticket}/`, root);
const baseline = '06aa1cc8268479b8227269519c794be6a47a4f0d';
const hash = value => createHash('sha256').update(value).digest('hex');
const read = name => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
const assert = (value, message) => { if (!value) throw new Error(message); };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const expected = reportFor('PRIMARY');
const normalized = value => value.replace(/\s+/g, ' ').trim();
const inputHash = hash(expected.text), visibleHash = hash(normalized(expected.visible));
const checked = [];
function verify(name, row, expectPass = true) {
  assert(row.passed === expectPass && row.baseline === baseline, `${name}: 通過狀態或基準不符`);
  assert(row.errors?.length === 0, `${name}: 非預期例外`);
  for (const [file, value] of Object.entries(row.toolHashes)) {
    assert(value === hash(readFileSync(new URL(file, tools))), `${name}: 工具指紋 ${file}`);
  }
  for (const [file, value] of Object.entries(row.sourceHashes)) {
    const bytes = row.version === 'before' && ['App.tsx', 'components/portfolio/useHealthCheck.ts'].includes(file)
      ? execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' })
      : readFileSync(new URL(file, root));
    assert(value === hash(bytes), `${name}: 來源指紋 ${file}`);
  }
  if (!row.profile) assert(row.buildIndexSha256 === hash(readFileSync(new URL('dist/index.html', root))), `${name}: build不符`);
  checked.push({ file: name, sha256: hash(readFileSync(new URL(name, dir))), passed: row.passed });
}
const comparison = {};
for (const version of ['before', 'after']) {
  const rows = Array.from({ length: 7 }, (_, sample) => {
    const name = `${version}-market-${sample}.json`, row = read(name);
    verify(name, row);
    assert(row.inputBytes === 102400 && row.inputChunks === 1000, `${name}: 資料量不符`);
    assert([row.inputSha256, row.cachedSha256, row.stateSha256].every(h => h === inputHash), `${name}: 輸入／快取／最終props全文不同`);
    assert(row.visibleSha256 === visibleHash && row.rows === 2 && row.lists === 2, `${name}: Markdown不完整`);
    if (version === 'after') {
      const frames = new Set();
      for (const commit of row.commits.filter(c => c.chars > 0 && c.chars < expected.text.length)) {
        assert(!frames.has(commit.frame), `${name}: 同一影格多次常規提交`);
        frames.add(commit.frame);
      }
    }
    return row;
  });
  assert(new Set(rows.map(r => r.profileBundleSha256)).size === 1, `${version}: profile bundle漂移`);
  const measured = rows.slice(2);
  const stats = field => ({ median: median(measured.map(field)), worst: Math.max(...measured.map(field)) });
  comparison[version] = { cold: { initialModuleReadyMs: rows[0].initialModuleReadyMs, wallMs: rows[0].wallMs, renderMs: rows[0].renderMs, commits: rows[0].commits.length },
    excludedWarmup: 1, measuredSamples: [2, 3, 4, 5, 6], commits: stats(r => r.commits.length), renderMs: stats(r => r.renderMs), wallMs: stats(r => r.wallMs), completionLagMs: stats(r => r.completionLagMs),
    inputSha256: inputHash, visibleSha256: visibleHash, profileBundleSha256: rows[0].profileBundleSha256 };
}
const edgeNames = JSON.parse(readFileSync(new URL('edge-cases.mjs', tools), 'utf8').match(/export const names = (\[[^\n]+\]);/)[1].replaceAll("'", '"'));
for (const name of ['market', ...edgeNames, ...(ticket === '09' ? ['native'] : [])]) {
  const file = `app-${name}-0.json`, row = read(file);
  verify(file, row);
  if (['market', 'native'].includes(name)) {
    assert(row.inputChunks === 1000 && row.inputSha256 === inputHash && row.visibleSha256 === visibleHash, `${file}: 正式App全文不符`);
    if (name === 'market') assert(row.cachedSha256 === inputHash, `${file}: 正式App快取不符`);
    else assert(row.moduleBefore === 0 && row.moduleAfter === 1 && row.events.length === 3, `${file}: 原生操作或延後載入未驗證`);
  }
}
const summary = { baseline, ticket, inputBytes: 102400, inputChunks: 1000, method: '相同development React.Profiler；sample0冷頁面、sample1排除暖機、sample2..6五次中位數；MessageChannel分送假HTTP片段，非真實網路速度',
  comparison, appCases: edgeNames.length + (ticket === '09' ? 2 : 1), checked };
writeFileSync(new URL('stream-summary.json', dir), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ profiles: 14, appCases: summary.appCases, comparison }, null, 2));
