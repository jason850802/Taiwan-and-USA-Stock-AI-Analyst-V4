import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const featureDir = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: featureDir,
  encoding: 'utf8',
}).trim();

const args = process.argv.slice(2);
const valueOf = name => {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) return null;
  return args[index + 1];
};

const runId = valueOf('--run-id');
if (!runId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runId)) {
  throw new Error('必須提供安全的 --run-id（1～80 字元，只允許英數、點、底線、連字號）');
}

const defaultManifest = path.resolve(featureDir, '../performance-diagnosis-20260922/clean-manifest.json');
const manifestPath = path.resolve(repoRoot, valueOf('--manifest') || path.relative(repoRoot, defaultManifest));
const outputRoot = valueOf('--output-root')
  ? path.resolve(valueOf('--output-root'))
  : path.join(featureDir, 'evidence', '01');
const outputDir = path.join(outputRoot, runId);

if (fs.existsSync(outputDir)) throw new Error(`證據目錄已存在，拒絕覆寫：${outputDir}`);
if (!fs.existsSync(manifestPath)) throw new Error(`來源 manifest 不存在：${manifestPath}`);

const sha256Buffer = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const sha256File = file => sha256Buffer(fs.readFileSync(file));
const rel = file => path.relative(repoRoot, file).replaceAll('\\', '/');
const git = argv => execFileSync('git', argv, { cwd: repoRoot, encoding: 'utf8' });
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

const basis = readJson(manifestPath);
if (!Array.isArray(basis.files) || basis.files.length === 0) throw new Error('來源 manifest 缺少 files');

const sourceFiles = basis.files.map(entry => {
  if (!entry || typeof entry.path !== 'string') throw new Error('來源 manifest 含無效 path');
  const absolute = path.resolve(repoRoot, entry.path);
  const relative = rel(absolute);
  if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error(`來源越界：${entry.path}`);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`來源檔不存在：${entry.path}`);
  const contents = fs.readFileSync(absolute);
  const actualSha256 = sha256Buffer(contents);
  return {
    path: relative,
    size: contents.length,
    sha256: actualSha256,
    diagnosisSha256: typeof entry.sha256 === 'string' ? entry.sha256 : null,
    matchesDiagnosis: typeof entry.sha256 === 'string' ? entry.sha256 === actualSha256 : null,
  };
});

const trackedPaths = new Set([
  ...git(['diff', '--name-only', '--']).split(/\r?\n/).filter(Boolean),
  ...git(['diff', '--cached', '--name-only', '--']).split(/\r?\n/).filter(Boolean),
]);
const untrackedRaw = git(['ls-files', '--others', '--exclude-standard', '-z']);
const untrackedPaths = untrackedRaw.split('\0').filter(Boolean);
const untrackedByRoot = {};
for (const entry of untrackedPaths) {
  const root = entry.replaceAll('\\', '/').split('/')[0] || '.';
  untrackedByRoot[root] = (untrackedByRoot[root] || 0) + 1;
}

const packageFiles = ['package.json', 'package-lock.json'].map(name => ({
  path: name,
  sha256: sha256File(path.join(repoRoot, name)),
}));
const packageDiffNames = git(['diff', '--name-only', 'HEAD', '--', 'package.json', 'package-lock.json'])
  .split(/\r?\n/)
  .filter(Boolean);

const packageIdentity = relativePath => {
  const absolute = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolute)) return null;
  const json = readJson(absolute);
  return { path: relativePath.replaceAll('\\', '/'), version: json.version || null, sha256: sha256File(absolute) };
};

const envPath = path.join(repoRoot, '.env');
let envFileVariableNames = [];
if (fs.existsSync(envPath)) {
  envFileVariableNames = fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
    .filter(Boolean)
    .sort();
}

const toolFiles = fs.readdirSync(path.dirname(scriptPath), { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => path.join(path.dirname(scriptPath), entry.name))
  .sort()
  .map(file => ({ path: rel(file), sha256: sha256File(file) }));

const sourceManifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  runId,
  repoRoot,
  basis: {
    path: rel(manifestPath),
    sha256: sha256File(manifestPath),
    diagnosisHead: basis.head || null,
  },
  files: sourceFiles,
  summary: {
    count: sourceFiles.length,
    matchesDiagnosis: sourceFiles.filter(file => file.matchesDiagnosis === true).length,
    differsFromDiagnosis: sourceFiles.filter(file => file.matchesDiagnosis === false).length,
    missingDiagnosisHash: sourceFiles.filter(file => file.matchesDiagnosis === null).length,
  },
};

const identity = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  runId,
  git: {
    head: git(['rev-parse', 'HEAD']).trim(),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
    trackedChangedPaths: [...trackedPaths].sort(),
    untrackedPathCount: untrackedPaths.length,
    untrackedPathListSha256: sha256Buffer(Buffer.from(untrackedPaths.slice().sort().join('\0'))),
    untrackedByRoot,
  },
  sourceManifest: {
    file: 'source-manifest.json',
    count: sourceManifest.summary.count,
    differsFromDiagnosis: sourceManifest.summary.differsFromDiagnosis,
  },
  packageFiles,
  packageDiffNames,
  runtime: {
    nodeVersion: process.version,
    nodeExecutable: process.execPath,
    vercel: packageIdentity('node_modules/vercel/package.json'),
    vercelNode: packageIdentity('node_modules/@vercel/node/package.json'),
    platform: process.platform,
    arch: process.arch,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  environment: {
    envFilePresent: fs.existsSync(envPath),
    variableNames: envFileVariableNames,
    note: '只保存變數名稱；不保存秘密值或秘密雜湊。',
  },
  tools: {
    files: toolFiles,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'source-manifest.json'), JSON.stringify(sourceManifest, null, 2) + '\n');
fs.writeFileSync(path.join(outputDir, 'identity.json'), JSON.stringify(identity, null, 2) + '\n');

console.log(JSON.stringify({
  ok: true,
  runId,
  outputDir,
  head: identity.git.head,
  sourceFiles: sourceManifest.summary.count,
  differsFromDiagnosis: sourceManifest.summary.differsFromDiagnosis,
  trackedChangedPaths: identity.git.trackedChangedPaths.length,
  untrackedPathCount: identity.git.untrackedPathCount,
  packageDiffNames,
}, null, 2));
