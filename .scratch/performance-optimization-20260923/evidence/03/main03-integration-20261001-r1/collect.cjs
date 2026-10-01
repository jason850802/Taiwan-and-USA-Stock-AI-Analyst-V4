const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const origin = path.join(root, '.scratch/integration03-isolated-20261001-r1/.scratch/performance-optimization-20260923/evidence/03');
const destination = path.resolve(__dirname, '..');
const stages = ['gate3', 'guard', 'life2', 'app', 'terminal', 'cancel', 'search', 'finmind', 'gemini', 'chart', 'guardCancel'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const rows = [];
function inventory(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const relative = path.posix.join(prefix, item.name);
    return item.isDirectory() ? inventory(path.join(directory, item.name), relative)
      : [{ path: relative, sha256: sha(fs.readFileSync(path.join(directory, item.name))) }];
  });
}
for (const stage of stages) {
  const result = read(path.join(__dirname, `${stage}-result.json`));
  if (!result.pass || result.head !== '49654f3a1ad49b068c921fdba9545bc3f188e8b2') throw new Error(`階段未通過：${stage}`);
  rows.push({ stage, ...result });
}
const copies = [];
for (const name of fs.readdirSync(origin).filter(name => /^main03-/.test(name))) {
  const from = path.join(origin, name);
  const to = path.join(destination, name);
  if (fs.existsSync(to)) throw new Error(`證據已存在，拒絕覆寫：${name}`);
  const files = inventory(from);
  fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: true });
  const copied = inventory(to);
  if (JSON.stringify(files) !== JSON.stringify(copied)) throw new Error(`複本不相等：${name}`);
  copies.push({ runId: name, files });
}
const appDir = path.join(destination, 'main03-app-20261001-r1');
const app = read(path.join(appDir, fs.readdirSync(appDir).find(name => /^app-summary-/.test(name))));
const guard = read(path.join(destination, 'main03-guard-20261001-r1/raw.json'));
const lifeDir = path.join(destination, 'main03-life-20261001-r2');
const life = read(path.join(lifeDir, fs.readdirSync(lifeDir).find(name => /^lifecycle-summary-/.test(name))));
const terminal = read(path.join(destination, 'main03-terminal-20261001-r1/raw.json'));
const summary = { candidate: rows[0].head, stages: rows, copies,
  guard: { passed: guard.results.filter(item => item.pass).length, total: guard.results.length },
  life, app, terminal: { pass: terminal.pass, scenarioCount: terminal.scenarios?.length ?? terminal.cases?.length },
  note: '本輪新 raw 與原始失敗均保存；舊 Preview 不重跑，不新增 production。' };
fs.writeFileSync(path.join(__dirname, 'validation-summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidate: rows[0].head, copiedRuns: copies.length, stages: rows.length,
  guard: summary.guard, life: life.scenarios, appOps: app.viewports.map(item => ({ name: item.name,
    count: item.ops.length, frozenStep: item.frozenAtStep, frozenFinal: item.frozenFinal })) }));
