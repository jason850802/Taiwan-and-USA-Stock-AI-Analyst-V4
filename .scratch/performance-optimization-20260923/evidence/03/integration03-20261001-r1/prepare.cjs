// 03 精確整合準備：僅操作新的隔離 repository，不改主 index／HEAD／main。
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const sourceHead = '8f7a8a3bf20ab5719be6028b25ac248afdbbc1de';
const runDir = __dirname;
const isolated = path.join(root, '.scratch', 'integration03-isolated-20261001-r1');
const git = (args, cwd = root) => cp.execFileSync('git', args, { cwd, maxBuffer: 80 * 1024 * 1024 });
const text = value => value.toString('utf8').trim();
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (name, value) => fs.writeFileSync(path.join(runDir, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const main = text(git(['rev-parse', 'main']));
if (fs.existsSync(isolated)) throw new Error('隔離目錄已存在，拒絕覆寫');
fs.mkdirSync(isolated);
git(['init', '--initial-branch=codex/integration03-preparation'], isolated);
git(['config', 'core.autocrlf', 'false'], isolated);
git(['config', 'user.name', '03 Integration Preparation'], isolated);
git(['config', 'user.email', '03-integration@local.invalid'], isolated);
git(['fetch', '--no-tags', root, main], isolated);
git(['checkout', '--detach', main], isolated);
git(['switch', '-c', 'codex/integration03-candidate'], isolated);
const records = [];
const apply = (name, patch) => {
  write(name, patch);
  git(['apply', '--check', path.join(runDir, name)], isolated);
  git(['apply', path.join(runDir, name)], isolated);
  records.push({ name, sha256: sha(patch), applyCheck: true });
};
// 01/02 的票面與其他產品改動不搬入；只取03必要的 watcher 排除。
apply('01-required-scratch-ignore.patch', git(['diff', 'c92dfa1^', 'c92dfa1', '--', '.vercelignore', 'vite.config.ts']));
const productPaths = ['api/_lib/clientAbort.ts', 'api/_lib/http.cancel.test.ts', 'api/_lib/http.ts', 'api/_lib/llm.ts', 'api/_lib/yahoo.handshake.test.ts', 'api/_lib/yahoo.ts', 'api/finmind.ts', 'api/gemini-stream.test.ts', 'api/gemini-stream.ts', 'api/gemini.ts', 'api/yahoo/chart.ts', 'api/yahoo/search.ts', 'vite.config.ts'];
apply('02-original-03-product.patch', git(['diff', '5a44fd5^', '5a44fd5', '--', ...productPaths]));
apply('03-approved-platform-configuration.patch', git(['diff', '69e1cc7^', '69e1cc7', '--', 'vercel.json', 'utils/vercelConfigGuard.test.ts']));
// 僅收 vitest 的 scratch 排除這個必要 hunk，不帶同提交的提示詞變更。
const viteFile = path.join(isolated, 'vite.config.ts');
const vite = fs.readFileSync(viteFile, 'utf8');
const oldExclude = "exclude: [...configDefaults.exclude, '**/.claude/**'],";
if (!vite.includes(oldExclude)) throw new Error('預期 vitest exclude 不符');
fs.writeFileSync(viteFile, vite.replace(oldExclude, "exclude: [...configDefaults.exclude, '**/.claude/**', '**/.scratch/**'],"));
const toolsDir = '.scratch/performance-optimization-20260923/tools/';
const tools = text(git(['ls-tree', '-r', '--name-only', sourceHead, '--', toolsDir])).split('\n').filter(Boolean);
const excludedTools = ['self-test.mjs', 'self-test-02.mjs', 'v5-segments.mjs'];
const selectedTools = tools.filter(file => !excludedTools.includes(path.basename(file)));
const copied = [...selectedTools, 'scripts/start-dev.ps1'];
const files = [];
for (const file of copied) {
  const bytes = git(['show', `${sourceHead}:${file}`]);
  const target = path.join(isolated, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  files.push({ path: file, sourceCommit: sourceHead, sha256: sha(bytes), role: file.startsWith(toolsDir) && !/-03\.|daily-dev/.test(file) ? '必要共用工具依賴（非整票01/02）' : '03工具／回復入口' });
}
git(['add', '--', ...productPaths, '.vercelignore', 'vercel.json', 'utils/vercelConfigGuard.test.ts', ...copied], isolated);
const completePatch = git(['diff', '--cached', '--binary', '--full-index'], isolated);
write('candidate-main.patch', completePatch);
write('candidate-stat.txt', git(['diff', '--cached', '--stat'], isolated));
write('candidate-files.txt', git(['diff', '--cached', '--name-only'], isolated));
git(['diff', '--cached', '--check'], isolated);
const finalPaths = text(git(['diff', '--cached', '--name-only'], isolated)).split('\n');
for (const file of finalPaths.filter(file => !copied.includes(file))) {
  files.push({ path: file, sourceCommit: file === '.vercelignore' ? 'c92dfa1 精確加 .scratch 並保留main原有排除' : file === 'vite.config.ts' ? 'c92dfa1 + 5a44fd5 + 67c81ec必要exclude hunk' : file === 'vercel.json' || file === 'utils/vercelConfigGuard.test.ts' ? '69e1cc7' : '5a44fd5', sha256: sha(fs.readFileSync(path.join(isolated, file))), role: '03產品／設定' });
}
const unchangedPaths = ['package.json', 'package-lock.json', 'services/gemini.ts', 'services/_shared/geminiCache.ts', 'components/MarkdownReport.tsx'];
const unchanged = unchangedPaths.filter(file => { try { return fs.readFileSync(path.join(isolated, file)).equals(git(['show', `${main}:${file}`])); } catch { return false; } });
git(['commit', '-m', '準備 03 精確整合候選（尚未合入 main）'], isolated);
const candidateCommit = text(git(['rev-parse', 'HEAD'], isolated));
const sourceMainAfter = text(git(['rev-parse', 'main']));
write('manifest.json', { runId: 'integration03-20261001-r1', sourceHead, sourceMain: main, sourceMainAfter, mergeBase: text(git(['merge-base', main, sourceHead])), isolated, candidateCommit, patchSha256: sha(completePatch), fileCount: finalPaths.length, patchChecks: records, files, unchangedVerified: unchanged, packageAndLockUnchanged: unchanged.includes('package.json') && unchanged.includes('package-lock.json'), fullGateRun: false, runtimeRun: false, conflicts: [], exclusions: ['01/02完整票與raw', '其他庫存／K線／行情效能票', 'AI模型／effort／CLI隔離', '提示詞／Markdown／快取世代', 'CORE／Skills／全域規則', 'main獨有變更'], mainMerged: false, push: false, deployment: false });
console.log(JSON.stringify({ main, candidateCommit, fileCount: finalPaths.length, patchSha256: sha(completePatch), conflicts: 0, isolated }));
