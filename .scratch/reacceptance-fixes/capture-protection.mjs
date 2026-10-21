// 保存本案開始前的檔案位元組與工作區狀態；不跟隨 node_modules 等連結。
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const relative = file => path.relative(root, file).replaceAll('\\', '/');
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
const hashes = files => Object.fromEntries(files.sort().map(file => [file, sha(readFileSync(path.join(root, file)))]));
const history = [], links = {};
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) links[relative(file)] = readlinkSync(file);
    else if (stat.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(file);
    } else if (stat.isFile()) history.push(relative(file));
  }
}
walk(path.join(root, '.scratch/reacceptance-20260921'));
const ticket = process.argv[2];
if (!['01', '02'].includes(ticket)) throw new Error('請指定本案票號01或02');
const dir = path.join(root, '.scratch/reacceptance-fixes/evidence', ticket, `setup-${randomUUID()}`);
mkdirSync(dir, { recursive: true });
const result = {
  schema: 1, capturedAt: new Date().toISOString(), node: process.version,
  head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']),
  status: git(['status', '--short', '--untracked-files=all']),
  worktrees: git(['worktree', 'list', '--porcelain']),
  trackedDiff: git(['diff']), stagedDiff: git(['diff', '--cached']),
  trackedHashes: hashes(tracked),
  baselineTests: hashes(tracked.filter(file => /(?:\.test\.[cm]?[jt]sx?$|\.snap$)/.test(file))),
  packages: hashes(['package.json', 'package-lock.json']),
  historicalHashes: hashes(history), historicalLinks: links,
};
writeFileSync(path.join(dir, 'protection.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ file: relative(path.join(dir, 'protection.json')), head: result.head,
  trackedFiles: tracked.length, protectedTestsAndSnapshots: Object.keys(result.baselineTests).length,
  historicalFiles: history.length, historicalLinks: Object.keys(links).length }));
