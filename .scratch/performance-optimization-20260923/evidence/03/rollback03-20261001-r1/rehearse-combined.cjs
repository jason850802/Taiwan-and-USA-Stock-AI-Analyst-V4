const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const ts = require('typescript');
const main = process.cwd();
const out = path.join(main, '.scratch/performance-optimization-20260923/evidence/03/rollback03-20261001-r1');
const repo = path.join(main, '.scratch/performance-optimization-20260923/rehearsals/rollback03-20261001-r1');
const events = [];
function run(args) {
  const r = cp.spawnSync('git', ['-c', 'core.commitGraph=false', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  events.push({ at: new Date().toISOString(), args, exit: r.status, stdout: r.stdout, stderr: r.stderr });
  if (r.status !== 0) throw new Error(`git ${args[0]} exit ${r.status}`);
  return r.stdout;
}
function save(name, value) { fs.writeFileSync(path.join(out, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }
function blob(ref, p) {
  const r = cp.spawnSync('git', ['-c', 'core.commitGraph=false', 'show', `${ref}:${p}`], { cwd: repo, maxBuffer: 30 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}
function hash(b) { return b ? crypto.createHash('sha256').update(b).digest('hex') : null; }
try {
  const sourceHead = '8f7a8a3bf20ab5719be6028b25ac248afdbbc1de';
  const beforeTree = run(['rev-parse', 'HEAD^{tree}']).trim();
  if (beforeTree !== run(['rev-parse', `${sourceHead}^{tree}`]).trim() || run(['status', '--porcelain']).trim()) throw new Error('候選來源或狀態不同');
  const product = JSON.parse(fs.readFileSync(path.join(out, 'product.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(out, 'config.json'), 'utf8'));
  const paths = [...product.paths, ...config.paths];
  const beforeRef = run(['rev-parse', 'HEAD']).trim();
  run(['revert', '--no-edit', config.originalCommit]);
  const configUndo = run(['rev-parse', 'HEAD']).trim();
  run(['apply', '--reverse', '--3way', path.join(out, 'product-original.patch')]);
  run(['commit', '-m', '演練：平台取消設定與 03 初始產品取消一併撤回']);
  const revertedRef = run(['rev-parse', 'HEAD']).trim();
  const changed = run(['diff', '--name-only', beforeRef, revertedRef]).trim().split('\n');
  if (changed.some(p => !paths.includes(p))) throw new Error('合併回復擴大範圍');
  const syntax = product.paths.filter(p => p.endsWith('.ts')).map(p => {
    const b = blob('HEAD', p);
    if (!b) return { path: p, exists: false, skipReason: '03 新增檔隨原始反向補丁移除' };
    const parsed = ts.createSourceFile(p, b.toString('utf8'), ts.ScriptTarget.Latest, true);
    return { path: p, exists: true, sha256: hash(b), parseErrors: parsed.parseDiagnostics.map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') })) };
  });
  if (syntax.some(p => p.parseErrors?.length)) throw new Error('回復後 TypeScript 語法錯誤');
  const llmBefore = blob(beforeRef, 'api/_lib/llm.ts').toString('utf8');
  const llmAfter = blob('HEAD', 'api/_lib/llm.ts').toString('utf8');
  const retained = ['--strict-mcp-config', '--mcp-config', '--settings', 'getClaudeCliEffort'].map(literal => ({ literal, beforeCount: llmBefore.split(literal).length - 1, afterCount: llmAfter.split(literal).length - 1 }));
  if (retained.some(r => !r.beforeCount || r.beforeCount !== r.afterCount)) throw new Error('後續 CLI 隔離／effort 設定不同');
  save('combined-reverted.diff', run(['diff', '--binary', beforeRef, 'HEAD']));
  const before = paths.map(p => ({ path: p, sha256: hash(blob(beforeRef, p)) }));
  const after = paths.map(p => ({ path: p, sha256: hash(blob('HEAD', p)) }));
  run(['revert', '--no-edit', revertedRef, configUndo]);
  const restored = paths.map(p => ({ path: p, sha256: hash(blob('HEAD', p)) }));
  const fullTreeRestored = beforeTree === run(['rev-parse', 'HEAD^{tree}']).trim();
  if (!fullTreeRestored || run(['status', '--porcelain']).trim()) throw new Error('合併回復演練後未完整恢復候選');
  save('combined.json', { sourceHead, beforeRef, beforeTree, configUndo, revertedRef, paths, changed, before, reverted: after, restored, fullTreeRestored, syntax, retained, pass: true, noRuntime: true });
} finally { save('commands-stage3.json', events); }
