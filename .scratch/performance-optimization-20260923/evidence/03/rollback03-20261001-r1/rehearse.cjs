const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const main = process.cwd();
const out = path.join(main, '.scratch/performance-optimization-20260923/evidence/03/rollback03-20261001-r1');
const repo = path.join(main, '.scratch/performance-optimization-20260923/rehearsals/rollback03-20261001-r1');
const events = [];
function run(args, cwd = repo, allowFailure = false) {
  const r = cp.spawnSync('git', ['-c', 'core.commitGraph=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  events.push({ at: new Date().toISOString(), cwd: path.relative(main, cwd), args, exit: r.status, stdout: r.stdout, stderr: r.stderr });
  if (r.status !== 0 && !allowFailure) throw new Error(`git ${args[0]} exit ${r.status}: ${r.stderr}`);
  return r;
}
function save(name, value) { fs.writeFileSync(path.join(out, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function snapshot(ref, paths) {
  return paths.map(p => {
    const r = cp.spawnSync('git', ['-c', 'core.commitGraph=false', 'show', `${ref}:${p}`], { cwd: repo, maxBuffer: 30 * 1024 * 1024 });
    return { path: p, exists: r.status === 0, sha256: r.status === 0 ? sha(r.stdout) : null, bytes: r.status === 0 ? r.stdout.length : null };
  });
}
try {
  if (fs.existsSync(repo)) throw new Error('隔離目錄已存在，拒絕覆寫');
  fs.mkdirSync(path.dirname(repo), { recursive: true });
  const head = run(['rev-parse', 'HEAD'], main).stdout.trim();
  if (head !== '8f7a8a3bf20ab5719be6028b25ac248afdbbc1de') throw new Error('來源固定點不同');
  run(['clone', '--shared', '--no-checkout', '--no-hardlinks', main, repo], main);
  run(['config', 'core.autocrlf', 'false']);
  run(['config', 'user.name', '03 隔離回復演練']);
  run(['config', 'user.email', '03-rehearsal@example.invalid']);
  run(['sparse-checkout', 'init', '--cone']);
  run(['sparse-checkout', 'set', 'api', 'utils', 'scripts', '.scratch/performance-optimization-20260923/tools']);
  run(['checkout', '--detach', head]);
  const beforeTree = run(['rev-parse', 'HEAD^{tree}']).stdout.trim();
  const toolCommits = ['4d2b2ba51fa2a6ba12a5f86915c6ca8be8d85a50', 'e6b6770883379cd3a22779588f08e9dbc0249fee', '241fba1b4e6be8f74719afd7d8b7b2fa87a5d6f6'];
  const toolPaths = [...new Set(toolCommits.flatMap(c => run(['diff-tree', '--no-commit-id', '--name-only', '-r', c]).stdout.trim().split('\n')))];
  const before = snapshot('HEAD', toolPaths);
  const reversals = [];
  for (const c of toolCommits) { run(['revert', '--no-edit', c]); reversals.push(run(['rev-parse', 'HEAD']).stdout.trim()); }
  const reverted = snapshot('HEAD', toolPaths);
  save('tools-reverted.diff', run(['diff', head, 'HEAD', '--', ...toolPaths]).stdout);
  const expected = snapshot('571be823bc4555d5c963f1507d77e4ca6b165c86', toolPaths);
  for (const c of [...reversals].reverse()) run(['revert', '--no-edit', c]);
  const restored = snapshot('HEAD', toolPaths);
  const toolsRestoredTree = run(['rev-parse', 'HEAD^{tree}']).stdout.trim();
  const tools = { originalCommits: toolCommits, paths: toolPaths, reversals, before, reverted, expected, restored, backTo571Content: reverted.every((r, i) => r.sha256 === expected[i].sha256), fullTreeRestored: beforeTree === toolsRestoredTree };
  if (!tools.backTo571Content || !tools.fullTreeRestored) throw new Error('七工具回復內容不符');
  save('tools.json', tools);
  const configCommit = '69e1cc797c8c6cf1d1819fa043bce150c70b2828';
  const configPaths = run(['diff-tree', '--no-commit-id', '--name-only', '-r', configCommit]).stdout.trim().split('\n');
  const configBefore = snapshot('HEAD', configPaths);
  const configAttempt = run(['revert', '--no-edit', configCommit], repo, true);
  if (configAttempt.status !== 0) throw new Error('取消配置反向提交衝突，須追加處置');
  const configReversal = run(['rev-parse', 'HEAD']).stdout.trim();
  const configAfter = snapshot('HEAD', configPaths);
  save('config-reverted.diff', run(['diff', head, 'HEAD', '--', ...configPaths]).stdout);
  run(['revert', '--no-edit', configReversal]);
  const configRestored = snapshot('HEAD', configPaths);
  const config = { originalCommit: configCommit, paths: configPaths, before: configBefore, reverted: configAfter, restored: configRestored, fullTreeRestored: beforeTree === run(['rev-parse', 'HEAD^{tree}']).stdout.trim() };
  if (!config.fullTreeRestored) throw new Error('取消配置恢復內容不符');
  save('config.json', config);
  save('stage1.json', { sourceHead: head, beforeTree, toolsPass: true, configPass: true, repo: path.relative(main, repo) });
} finally { save('commands-stage1.json', events); }
