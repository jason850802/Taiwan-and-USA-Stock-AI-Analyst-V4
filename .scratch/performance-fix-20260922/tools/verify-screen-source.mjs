// 可見畫面量測前後核對本機服務 PID、實際送出的探針與隔離產品副本身分。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const valueOf = flag => { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1] ?? null; };
const variant = valueOf('--variant');
const port = Number(valueOf('--port'));
const output = valueOf('--output');
if (!['before', 'after'].includes(variant) || !Number.isInteger(port) || port < 1 || port > 65535 || !output) throw new Error('需要 --variant before|after、--port 與 --output');
const root = process.cwd();
const featureRoot = path.join(root, '.scratch', 'performance-fix-20260922');
const evidenceRoot = path.join(featureRoot, 'evidence', '07');
const outputPath = path.resolve(root, output);
if (!outputPath.startsWith(evidenceRoot + path.sep) || path.extname(outputPath) !== '.json') throw new Error('output 必須是本案 07 evidence 下的 JSON');
const runtime = path.join(featureRoot, 'runtime', variant === 'before' ? '07-before-444d6b1' : '07-after-6eee87e');
const prior = JSON.parse(fs.readFileSync(path.join(featureRoot, 'evidence', '07', 'true-market-07-20260923-v4', 'identity.json'), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const files = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ['node_modules', '.perf07-cache'].includes(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else {
      const relative = path.relative(runtime, absolute).replaceAll('\\', '/');
      if (['app-acceptance.html', 'app-acceptance.jsx', 'app-screen-capture.html', 'app-screen-capture.mjs'].includes(relative)) continue;
      files.push({ path: relative, sha256: hash(fs.readFileSync(absolute)) });
    }
  }
};
walk(runtime);
files.sort((a, b) => a.path.localeCompare(b.path));
const manifestSha256 = hash(files.map(file => `${file.path}\0${file.sha256}\n`).join(''));
if (files.length !== prior.runtimes[variant].fileCount || manifestSha256 !== prior.runtimes[variant].manifestSha256) {
  throw new Error(`${variant} 產品副本與先前真行情身分不一致：${files.length}／${manifestSha256}`);
}
const lines = execFileSync('netstat', ['-ano'], { encoding: 'utf8' }).split(/\r?\n/);
const listener = lines.map(line => line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i))
  .find(match => match && Number(match[1]) === port);
if (!listener) throw new Error(`port ${port} 無 listener`);
const listenerPid = Number(listener[2]);
const sourcePath = path.join(runtime, 'app-screen-capture.mjs');
const htmlPath = path.join(runtime, 'app-screen-capture.html');
for (const name of ['app-acceptance.html', 'app-acceptance.jsx', 'app-screen-capture.html', 'app-screen-capture.mjs']) {
  if (hash(fs.readFileSync(path.join(runtime, name))) !== hash(fs.readFileSync(path.join(featureRoot, 'tools', name)))) {
    throw new Error(`${variant} 驗收探針副本與工具來源不同：${name}`);
  }
}
const htmlResponse = await fetch(`http://127.0.0.1:${port}/app-screen-capture.html`, { cache: 'no-store' });
const scriptResponse = await fetch(`http://127.0.0.1:${port}/app-screen-capture.mjs`, { cache: 'no-store' });
if (!htmlResponse.ok || !scriptResponse.ok) throw new Error('實際服務未提供畫面量測探針');
const html = await htmlResponse.text();
const script = await scriptResponse.text();
if (!html.includes('app-screen-capture.mjs') || !script.includes('screen-capture-evidence')) throw new Error('服務內容不是預期探針');
const record = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  variant,
  sourceCommit: prior.runtimes[variant].commit,
  runtime,
  fileCount: files.length,
  manifestSha256,
  expectedManifestSha256: prior.runtimes[variant].manifestSha256,
  listenerPid,
  origin: `http://127.0.0.1:${port}`,
  servedHtmlSha256: hash(html),
  servedScriptSha256: hash(script),
  localScreenHtmlSha256: hash(fs.readFileSync(htmlPath)),
  localScreenScriptSha256: hash(fs.readFileSync(sourcePath)),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ variant, listenerPid, port, manifestSha256, output }));
