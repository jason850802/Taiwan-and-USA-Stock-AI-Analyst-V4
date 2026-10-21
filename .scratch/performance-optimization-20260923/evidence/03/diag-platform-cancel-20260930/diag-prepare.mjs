// 03 平台取消診斷用 Preview 包（非正式證據，輸出在 scratchpad，不寫進 repo／evidence）：
// 同一份已提交的 api/gemini-stream.ts 打成三個路由，只差 supportsCancellation 與觀測用事件監聽。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = 'E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'diag03-preview');
const require = createRequire(path.join(ROOT, 'package.json'));
const { build } = require('esbuild');
const sha = buf => createHash('sha256').update(buf).digest('hex');

if (fs.existsSync(OUT)) throw new Error(`輸出目錄已存在：${OUT}`);
// 產品碼必須等於已提交版本（有差異時 git diff --quiet 以 exit 1 丟出例外）
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'api/'], { cwd: ROOT });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();

const output = path.join(OUT, '.vercel/output');
fs.mkdirSync(path.join(output, 'static'), { recursive: true });
fs.copyFileSync(path.join(ROOT, '.vercel/project.json'), path.join(OUT, '.vercel/project.json'));
fs.writeFileSync(path.join(output, 'config.json'), JSON.stringify({ version: 3 }, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'static/index.html'),
  '<!doctype html><meta charset="utf-8"><title>03 平台取消診斷</title><p>03 平台取消診斷用固定資料探針；不是日常 App。</p>');

// .env 中秘密名的值：打包內容不得出現（只印 key 名）
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_PAT)$/i;
const secrets = [];
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m || /^\s*#/.test(line) || !SECRET_NAME.test(m[1])) continue;
  const v = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  if (v.length > 8) secrets.push({ key: m[1], value: v });
}

const variants = [
  { route: 'gemini-stream', supportsCancellation: true, extraEvents: false },
  { route: 'gemini-stream-events', supportsCancellation: true, extraEvents: true },
  { route: 'gemini-stream-control', supportsCancellation: undefined, extraEvents: false },
];
const manifest = { head, createdAt: new Date().toISOString(), handler: 'api/gemini-stream.ts',
  handlerSha256: sha(fs.readFileSync(path.join(ROOT, 'api/gemini-stream.ts'))), secretsChecked: secrets.map(s => s.key), routes: [] };
for (const v of variants) {
  const folder = path.join(output, 'functions/api', v.route + '.func');
  fs.mkdirSync(folder, { recursive: true });
  await build({
    stdin: { contents: `const fixture = require(${JSON.stringify(path.join(HERE, 'diag-fixture.cjs'))}); const handler = require(${JSON.stringify(path.join(ROOT, 'api/gemini-stream.ts'))}).default; module.exports = fixture.wrap(handler);`, resolveDir: ROOT },
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: path.join(folder, 'index.cjs'),
    define: { __DIAG_EXTRA_EVENTS__: v.extraEvents ? 'true' : 'false' }, logLevel: 'silent',
  });
  const vcConfig = { runtime: 'nodejs22.x', handler: 'index.cjs', launcherType: 'Nodejs', shouldAddHelpers: true,
    supportsResponseStreaming: true, maxDuration: 60, ...(v.supportsCancellation ? { supportsCancellation: true } : {}) };
  fs.writeFileSync(path.join(folder, '.vc-config.json'), JSON.stringify(vcConfig, null, 2) + '\n');
  const bundle = fs.readFileSync(path.join(folder, 'index.cjs'));
  const leaked = secrets.filter(s => bundle.includes(Buffer.from(s.value, 'utf8'))).map(s => s.key);
  if (leaked.length) throw new Error(`打包內容含秘密值：${leaked.join(',')}`);
  manifest.routes.push({ route: '/api/' + v.route, vcConfig, extraEvents: v.extraEvents, bundleSha256: sha(bundle), bundleBytes: bundle.length });
}
fs.writeFileSync(path.join(HERE, 'diag03-prepare.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
