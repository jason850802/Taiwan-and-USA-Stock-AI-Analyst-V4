// 只匯入核准的本機候選提交，以 compare-and-swap 更新 main；不切換大量無關修改的工作區。
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const candidate = path.join(root, '.scratch/integration03-isolated-20261001-r1');
const base = 'bf7599c53b0dcee2a5a814f3e62133c67844309a';
const commit = '1a9269fe781f4ae5e0d432d1c22b4c77d6cc3bcd';
const tested = '49654f3a1ad49b068c921fdba9545bc3f188e8b2';
const git = (cwd, args) => cp.execFileSync('git', args, { cwd, encoding: 'utf8',
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 64 * 1024 * 1024 }).trim();
if (git(root, ['rev-parse', 'main']) !== base) throw new Error('main 已前進，不能覆蓋，請重核範圍');
if (git(root, ['worktree', 'list', '--porcelain']).split('\n').includes('branch refs/heads/main')) throw new Error('main 已由其他工作區領用，停止 ref 更新');
if (git(candidate, ['rev-parse', `${commit}^{tree}`]) !== git(candidate, ['rev-parse', `${tested}^{tree}`])) throw new Error('合併樹不同於驗收樹');
if (!/^Code-Review:/m.test(git(candidate, ['log', '-1', '--format=%B', commit]))) throw new Error('缺雙軸 trailer');
const originalHead = git(root, ['rev-parse', 'HEAD']);
git(root, ['fetch', '--no-tags', candidate, 'refs/heads/codex/integration03-main:refs/heads/codex/integration03-main']);
git(root, ['update-ref', 'refs/heads/main', commit, base]);
const files = git(root, ['diff', '--name-only', base, 'main']).split('\n');
if (files.length !== 47 || git(root, ['rev-parse', 'main']) !== commit || git(root, ['rev-parse', 'HEAD']) !== originalHead) throw new Error('整合後身分不一致');
const tools = git(candidate, ['ls-files', '--', '.scratch/performance-optimization-20260923/tools']).split('\n').map(file => {
  const bytes = fs.readFileSync(path.join(candidate, file));
  const blob = cp.execFileSync('git', ['show', `${commit}:${file}`], { cwd: root });
  const sha = data => crypto.createHash('sha256').update(data).digest('hex');
  return { path: file, worktreeSha256: sha(bytes), blobSha256: sha(blob), exact: bytes.equals(blob) };
});
if (!tools.every(item => item.exact)) throw new Error('合併後工具位元組不同');
fs.writeFileSync(path.join(__dirname, 'integration-result.json'), JSON.stringify({ base, tested, commit,
  main: git(root, ['rev-parse', 'main']), originalHead, originalBranch: git(root, ['branch', '--show-current']),
  mergeTreeEqualsTestedTree: true, fileCount: files.length, files, tools,
  noPush: true, noDeployment: true, noRelease: true, pass: true }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ main: commit, exactFiles: files.length, exactTools: tools.length, originalHead, pass: true }));
