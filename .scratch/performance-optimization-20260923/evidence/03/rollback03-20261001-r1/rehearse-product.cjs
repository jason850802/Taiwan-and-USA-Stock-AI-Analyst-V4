const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const main = process.cwd();
const out = path.join(main, '.scratch/performance-optimization-20260923/evidence/03/rollback03-20261001-r1');
const repo = path.join(main, '.scratch/performance-optimization-20260923/rehearsals/rollback03-20261001-r1');
const events = [];
function run(args, allowFailure = false) {
  const r = cp.spawnSync('git', ['-c', 'core.commitGraph=false', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  events.push({ at: new Date().toISOString(), args, exit: r.status, stdout: r.stdout, stderr: r.stderr });
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
  const sourceHead = '8f7a8a3bf20ab5719be6028b25ac248afdbbc1de';
  const original = '5a44fd58f32b978d27228efc635d50f618092cbd';
  const launcher = '5997b92968135fb0c06a64e5f63e246a4528beb4';
  const beforeRef = run(['rev-parse', 'HEAD']).stdout.trim();
  const beforeTree = run(['rev-parse', 'HEAD^{tree}']).stdout.trim();
  const candidateTree = run(['rev-parse', `${sourceHead}^{tree}`]).stdout.trim();
  if (beforeTree !== candidateTree || run(['status', '--porcelain']).stdout.trim()) throw new Error('隔離候選不是乾淨原固定點');
  const whole = run(['revert', '--no-commit', launcher, original], true);
  const wholeConflicts = run(['diff', '--name-only', '--diff-filter=U']).stdout.trim().split('\n').filter(Boolean);
  if (whole.status === 0) throw new Error('整提交撤回意外成功，須另外記錄範圍');
  run(['revert', '--abort']);
  if (run(['rev-parse', 'HEAD^{tree}']).stdout.trim() !== beforeTree || run(['status', '--porcelain']).stdout.trim()) throw new Error('整提交衝突後候選未復原');
  save('whole-commit-attempt.json', { sourceHead, commits: [launcher, original], exit: whole.status, conflicts: wholeConflicts, aborted: true, candidateRestored: true });
  const paths = run(['diff', '--name-only', `${original}^`, original, '--', 'api', 'vite.config.ts']).stdout.trim().split('\n');
  const before = snapshot('HEAD', paths);
  const patch = run(['diff', '--binary', `${original}^`, original, '--', ...paths]).stdout;
  save('product-original.patch', patch);
  const patchPath = path.join(out, 'product-original.patch');
  const attempt = run(['apply', '--reverse', '--3way', patchPath], true);
  const conflicts = run(['diff', '--name-only', '--diff-filter=U']).stdout.trim().split('\n').filter(Boolean);
  save('product-apply-attempt.json', { sourceHead, original, paths, patchSha256: sha(Buffer.from(patch)), exit: attempt.status, conflicts });
  if (attempt.status !== 0) throw new Error('產品反向補丁需追加衝突處置');
  const stagedDiff = run(['diff', '--cached', '--binary']).stdout;
  save('product-reverted.diff', stagedDiff);
  const changed = run(['diff', '--cached', '--name-only']).stdout.trim().split('\n');
  if (changed.some(p => !paths.includes(p))) throw new Error('反向補丁範圍擴大');
  run(['commit', '-m', '演練：只撤回 03 初始產品取消與代理設定，保留後續無關變更']);
  const revertedRef = run(['rev-parse', 'HEAD']).stdout.trim();
  const reverted = snapshot('HEAD', paths);
  run(['revert', '--no-edit', revertedRef]);
  const restored = snapshot('HEAD', paths);
  const fullTreeRestored = run(['rev-parse', 'HEAD^{tree}']).stdout.trim() === beforeTree;
  if (!fullTreeRestored) throw new Error('產品恢復後全樹不同');
  save('product.json', { sourceHead, originalCommit: original, beforeRef, beforeTree, paths, before, revertedRef, reverted, restored, changed, fullTreeRestored, preserveEvidence: true, runtimeExecuted: false });
  save('stage2.json', { sourceHead, productContentRollbackPass: true, fullTreeRestored, workingTreeClean: !run(['status', '--porcelain']).stdout.trim(), noRuntime: true, noNodeModules: !fs.existsSync(path.join(repo, 'node_modules')) });
} finally { save('commands-stage2.json', events); }
