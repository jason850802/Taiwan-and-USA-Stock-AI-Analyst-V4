import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const root = process.cwd();
const featureRoot = path.join(root, '.scratch', 'performance-fix-20260922');
const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
};
const runId = valueOf('--run-id', 'formal-options-v2');
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error('--run-id 無效');
const runtimeBase = path.join(featureRoot, 'runtime', runId);
const evidence01 = path.join(featureRoot, 'evidence', '01', runId);
const evidence02 = path.join(featureRoot, 'evidence', '02', runId);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fileHash = file => sha256(fs.readFileSync(file));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();

for (const target of [evidence01, evidence02]) {
  if (fs.existsSync(target)) throw new Error(`v2 evidence 已存在，拒絕覆寫：${target}`);
}
if (fs.existsSync(path.join(runtimeBase, 'active.lock'))) throw new Error('formal runtime 仍有 active.lock，拒絕 prepare');

const head = git(['rev-parse', 'HEAD']);
const configCommit = git(['log', '-1', '--format=%H', '--', '.vercelignore']);
const configParent = `${configCommit}^`;
const show = (commit, file) => execFileSync('git', ['show', `${commit}:${file}`], {
  cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
const e0Vercelignore = show(configParent, '.vercelignore');
const e0Vite = show(configParent, 'vite.config.ts');
const e2Vercelignore = show(configCommit, '.vercelignore');
const e2Vite = show(configCommit, 'vite.config.ts');
if (fs.readFileSync(path.join(root, '.vercelignore'), 'utf8') !== e2Vercelignore) {
  throw new Error('目前 .vercelignore 與 02 設定 commit 不一致，停止建立 formal runtime');
}
if (fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8') !== e2Vite) {
  throw new Error('目前 vite.config.ts 與 02 設定 commit 不一致，停止建立 formal runtime');
}

const excludedProduct = /^(?:\.scratch|\.agents|\.claude|\.codex|\.planning|docs|dist|node_modules)(?:\/|$)/;
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  .split('\0')
  .filter(relative => relative && !excludedProduct.test(relative.replaceAll('\\', '/')));
const baseFiles = [];
const baseFileContents = new Map();
const materializedFromIndex = [];
for (const relative of tracked) {
  const normalized = relative.replaceAll('\\', '/');
  if (normalized === '.vercelignore' || normalized === 'vite.config.ts') continue;
  const source = path.join(root, relative);
  let content;
  let sourceKind = 'working-tree';
  if (fs.existsSync(source) && fs.statSync(source).isFile()) {
    content = fs.readFileSync(source);
  } else {
    try {
      content = execFileSync('git', ['show', `:${normalized}`], {
        cwd: root,
        encoding: null,
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      throw new Error(`tracked source 無法從 working tree 或 Git index 讀取：${normalized}`);
    }
    sourceKind = 'git-index';
    materializedFromIndex.push(normalized);
  }
  baseFileContents.set(normalized, content);
  baseFiles.push({ path: normalized, sha256: sha256(content), bytes: content.length, sourceKind });
}
baseFiles.sort((a, b) => a.path.localeCompare(b.path));
const baseManifestSha256 = sha256(baseFiles.map(file => `${file.path}\0${file.sha256}\n`).join(''));

const scratchRoot = path.join(root, '.scratch');
const scratchLayout = [];
const stack = [scratchRoot];
while (stack.length) {
  const dir = stack.pop();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(scratchRoot, absolute).replaceAll('\\', '/');
    if (relative === 'performance-fix-20260922/runtime' || relative.startsWith('performance-fix-20260922/runtime/')) continue;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) stack.push(absolute);
    else if (stat.isFile()) scratchLayout.push({ path: relative, bytes: stat.size });
  }
}
scratchLayout.sort((a, b) => a.path.localeCompare(b.path));
const scratchLayoutSha256 = sha256(scratchLayout.map(file => `${file.path}\0${file.bytes}\n`).join(''));

const envPath = path.join(root, '.env');
const envVariableNames = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => line.slice(0, line.indexOf('=')).trim()).filter(Boolean).sort()
  : [];

const variants = {
  e0: { vercelignore: e0Vercelignore, vite: e0Vite, scratchPayload: true, runtimeName: 'full' },
  e1: { vercelignore: e2Vercelignore, vite: e0Vite, scratchPayload: true, runtimeName: 'full' },
  e2: { vercelignore: e2Vercelignore, vite: e2Vite, scratchPayload: true, runtimeName: 'full' },
  clean: { vercelignore: e0Vercelignore, vite: e0Vite, scratchPayload: false, runtimeName: 'clean' },
};

fs.mkdirSync(runtimeBase, { recursive: true });
const runtimeRoots = {
  full: path.join(runtimeBase, 'full'),
  clean: path.join(runtimeBase, 'clean'),
};
for (const destination of Object.values(runtimeRoots)) {
  fs.mkdirSync(destination, { recursive: true });
  for (const file of baseFiles) {
    const target = path.join(destination, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = baseFileContents.get(file.path);
    if (!content) throw new Error(`缺 frozen source content：${file.path}`);
    fs.writeFileSync(target, content);
  }
  const vercelProject = path.join(root, '.vercel', 'project.json');
  if (fs.existsSync(vercelProject)) {
    fs.mkdirSync(path.join(destination, '.vercel'), { recursive: true });
    fs.copyFileSync(vercelProject, path.join(destination, '.vercel', 'project.json'));
  }
  if (fs.existsSync(envPath)) fs.copyFileSync(envPath, path.join(destination, '.env'));
}

const configRoot = path.join(runtimeBase, 'configs');
for (const [variant, config] of Object.entries(variants)) {
  const destination = path.join(configRoot, variant);
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, '.vercelignore'), config.vercelignore);
  fs.writeFileSync(path.join(destination, 'vite.config.ts'), config.vite);
}

// E0/E1/E2 共用同一個 full runtime，確保非產品負載逐檔完全相同；只在每次 start 前切換兩個設定檔。
// robocopy /CREATE 只建立同一路徑的零內容檔案，不複製歷史 evidence／env 內容。
const fullScratch = path.join(runtimeRoots.full, '.scratch');
fs.mkdirSync(fullScratch, { recursive: true });
const runRobocopy = (source, destination, excludes = []) => new Promise((resolve, reject) => {
  fs.mkdirSync(destination, { recursive: true });
  const copyArgs = [
    source,
    destination,
    '/E',
    '/CREATE',
    '/XJ',
    '/R:0',
    '/W:0',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NP',
  ];
  if (excludes.length) copyArgs.push('/XD', ...excludes);
  const child = spawn('robocopy', copyArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => {
    if (code !== null && code < 8) resolve(code);
    else reject(new Error(`robocopy /CREATE 失敗，exit=${code}\n${stderr}\n${stdout}`));
  });
});
const copyJobs = [];
const excludedRelativeDir = 'performance-fix-20260922/runtime';
const countFilesUnder = relativeDir => {
  if (!relativeDir) return scratchLayout.length;
  const prefix = `${relativeDir}/`;
  return scratchLayout.reduce((count, file) => count + (file.path.startsWith(prefix) ? 1 : 0), 0);
};
const scheduleDirectory = (source, destination, relativeDir = '') => {
  if (relativeDir === excludedRelativeDir || relativeDir.startsWith(`${excludedRelativeDir}/`)) return;
  const containsExcluded = relativeDir === '' || excludedRelativeDir.startsWith(`${relativeDir}/`);
  const count = countFilesUnder(relativeDir);
  if (relativeDir && count <= 500 && !containsExcluded) {
    copyJobs.push(() => runRobocopy(source, destination));
    return;
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const childSource = path.join(source, entry.name);
    const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (childRelative === excludedRelativeDir || childRelative.startsWith(`${excludedRelativeDir}/`)) continue;
    const stat = fs.lstatSync(childSource);
    if (stat.isSymbolicLink()) continue;
    const childDestination = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      scheduleDirectory(childSource, childDestination, childRelative);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(childDestination), { recursive: true });
      if (!fs.existsSync(childDestination)) fs.closeSync(fs.openSync(childDestination, 'w'));
      else if (!fs.lstatSync(childDestination).isFile()) throw new Error(`placeholder 型別衝突：${childDestination}`);
    }
  }
};
scheduleDirectory(scratchRoot, fullScratch);
let nextJob = 0;
const workers = Array.from({ length: Math.min(6, copyJobs.length) }, async () => {
  while (true) {
    const index = nextJob++;
    if (index >= copyJobs.length) return;
    await copyJobs[index]();
  }
});
await Promise.all(workers);
const powershellList = kind => {
  const escapedRoot = fullScratch.replaceAll("'", "''");
  const selector = kind === 'files' ? '-File' : '-Directory';
  const command = `Get-ChildItem -LiteralPath '${escapedRoot}' -Recurse ${selector} -Force -ErrorAction Stop | ForEach-Object { $_.FullName }`;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
};
const expectedFiles = new Set(scratchLayout.map(file => file.path));
const expectedDirs = new Set();
for (const file of scratchLayout) {
  let dir = path.posix.dirname(file.path);
  while (dir && dir !== '.') {
    expectedDirs.add(dir);
    const parent = path.posix.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

// robocopy 期間其他 worker 仍可能增刪 source `.scratch`；formal runtime 必須綁定本輪開始時
// 已凍結的 scratchLayout。因此 bulk copy 後再把 target 精確收斂到 frozen layout，而不是重讀 source。
let targetFiles = powershellList('files').map(file => path.relative(fullScratch, file).replaceAll('\\', '/'));
for (const relative of targetFiles) {
  if (!expectedFiles.has(relative)) fs.unlinkSync(path.join(fullScratch, relative));
}
for (const relative of expectedFiles) {
  const target = path.join(fullScratch, relative);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.closeSync(fs.openSync(target, 'w'));
  }
  const stat = fs.lstatSync(target);
  if (!stat.isFile()) throw new Error(`frozen placeholder 不是檔案：${target}`);
  if (stat.size !== 0) fs.truncateSync(target, 0);
}
const targetDirs = powershellList('directories').map(dir => path.relative(fullScratch, dir).replaceAll('\\', '/'))
  .filter(relative => relative && relative !== '.')
  .sort((a, b) => b.length - a.length);
for (const relative of targetDirs) {
  if (expectedDirs.has(relative)) continue;
  const absolute = path.join(fullScratch, relative);
  try { fs.rmdirSync(absolute); }
  catch (error) {
    if (error?.code !== 'ENOTEMPTY') throw error;
    throw new Error(`frozen layout 外仍有非空目錄：${relative}`);
  }
}
targetFiles = powershellList('files').map(file => path.relative(fullScratch, file).replaceAll('\\', '/'));
if (targetFiles.length !== scratchLayout.length || targetFiles.some(file => !expectedFiles.has(file))) {
  throw new Error(`full runtime scratch layout 未收斂：target=${targetFiles.length}, expected=${scratchLayout.length}`);
}
const fullScratchFiles = targetFiles.length;

// 初始 full/clean 都套 E0 設定；runner 之後只會在 full root 中原子切換 E0/E1/E2 設定。
for (const [runtimeName, variant] of [['full', 'e0'], ['clean', 'clean']]) {
  fs.copyFileSync(path.join(configRoot, variant, '.vercelignore'), path.join(runtimeRoots[runtimeName], '.vercelignore'));
  fs.copyFileSync(path.join(configRoot, variant, 'vite.config.ts'), path.join(runtimeRoots[runtimeName], 'vite.config.ts'));
}

fs.mkdirSync(evidence01, { recursive: true });
fs.mkdirSync(evidence02, { recursive: true });
const sourceManifest = {
  schemaVersion: 3,
  createdAt: new Date().toISOString(),
  head,
  baseManifestSha256,
  fileCount: baseFiles.length,
  materializedFromIndex,
  files: baseFiles,
};
const scratchManifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  sourceRoot: '.scratch',
  note: '只保存相對路徑與來源檔案大小；full runtime 內用 robocopy /CREATE 建立同一路徑零內容 placeholder，不保存任何 scratch 檔案內容或秘密值。E0/E1/E2 共用此 full runtime。',
  excluded: ['.scratch/performance-fix-20260922/runtime/**'],
  fileCount: scratchLayout.length,
  totalBytes: scratchLayout.reduce((sum, file) => sum + file.bytes, 0),
  layoutSha256: scratchLayoutSha256,
  files: scratchLayout,
};
const setup = {
  schemaVersion: 2,
  runId,
  createdAt: new Date().toISOString(),
  head,
  configCommit,
  configParent: git(['rev-parse', configParent]),
  runtimeBase,
  sourceManifestSha256: sha256(JSON.stringify(sourceManifest)),
  baseManifestSha256,
  scratchLayoutSha256,
  envFilePresent: fs.existsSync(envPath),
  envVariableNames,
  fullScratchFileCount: fullScratchFiles,
  variants: Object.fromEntries(Object.entries(variants).map(([variant, config]) => {
    const configDir = path.join(configRoot, variant);
    return [variant, {
      runtimeRoot: runtimeRoots[config.runtimeName],
      runtimeName: config.runtimeName,
      scratchPayload: config.scratchPayload,
      vercelignoreSha256: fileHash(path.join(configDir, '.vercelignore')),
      viteConfigSha256: fileHash(path.join(configDir, 'vite.config.ts')),
    }];
  })),
};
fs.writeFileSync(path.join(evidence01, 'source-manifest.json'), JSON.stringify(sourceManifest, null, 2) + '\n');
fs.writeFileSync(path.join(evidence01, 'scratch-layout.json'), JSON.stringify(scratchManifest, null, 2) + '\n');
fs.writeFileSync(path.join(evidence01, 'setup.json'), JSON.stringify(setup, null, 2) + '\n');
fs.writeFileSync(path.join(evidence02, 'setup-reference.json'), JSON.stringify({
  schemaVersion: 1,
  createdAt: setup.createdAt,
  setupPath: path.relative(root, path.join(evidence01, 'setup.json')).replaceAll('\\', '/'),
  setupSha256: fileHash(path.join(evidence01, 'setup.json')),
  sourceManifestPath: path.relative(root, path.join(evidence01, 'source-manifest.json')).replaceAll('\\', '/'),
  sourceManifestFileSha256: fileHash(path.join(evidence01, 'source-manifest.json')),
  scratchLayoutPath: path.relative(root, path.join(evidence01, 'scratch-layout.json')).replaceAll('\\', '/'),
  scratchLayoutFileSha256: fileHash(path.join(evidence01, 'scratch-layout.json')),
}, null, 2) + '\n');

console.log(JSON.stringify({
  runId,
  runtimeBase,
  head,
  configCommit,
  baseFiles: baseFiles.length,
  scratchFiles: scratchLayout.length,
  scratchBytes: scratchManifest.totalBytes,
  baseManifestSha256,
  scratchLayoutSha256,
  evidence01,
  evidence02,
}, null, 2));
