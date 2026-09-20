// 12重跑既有隔離站：只轉接輸出及觀察資料，不覆寫02～05歷史工具／結果。
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ticket = process.argv[2];
if (!['02', '03', '04', '05'].includes(ticket)) throw new Error('只接受02～05既有假站');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const oldDir = fileURLToPath(new URL(`../${ticket}/`, import.meta.url));
const sourcePath = path.join(oldDir, 'fixture-server.mjs');
const output = path.join(dir, `replay-${ticket}`);
mkdirSync(output, { recursive: true });
const sha = data => createHash('sha256').update(data).digest('hex');
const audit = JSON.parse(readFileSync(path.join(dir, 'audit.json'), 'utf8'));
const sourceHashes = Object.fromEntries(audit.files.map(({ path: p }) => [p, sha(readFileSync(path.join(root, p)))]));
const buildTime = statSync(path.join(root, 'dist/index.html')).mtimeMs;
if (audit.files.some(({ path: p }) => statSync(path.join(root, p)).mtimeMs > buildTime)) throw new Error('先建置當前來源');
const ownTools = ['replay-server.mjs', 'integration-bootstrap.js', 'holdings-cases.mjs'];
const toolPaths = [...readdirSync(oldDir).filter(p => /\.(mjs|jsx|js)$/.test(p)).map(p => path.join(oldDir, p)),
  ...ownTools.map(p => path.join(dir, p))];
const toolHashes = Object.fromEntries(toolPaths.map(p => [path.relative(root, p).replaceAll('\\', '/'), sha(readFileSync(p))]));
const binding = { ticket: '12', replayOf: ticket,
  candidate: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
  node: process.version, sourceHashes, toolHashes, buildIndexSha256: sha(readFileSync(path.join(root, 'dist/index.html'))) };
const ports = { '02': 4176, '03': 4177, '04': 4178, '05': 4179 };
const start = { pid: process.pid, origin: `http://127.0.0.1:${ports[ticket]}`, startedAt: new Date().toISOString(), ...binding };
writeFileSync(path.join(output, 'startup.json'), JSON.stringify(start, null, 2) + '\n');

let source = readFileSync(sourcePath, 'utf8');
const metaUrl = JSON.stringify(pathToFileURL(sourcePath).href);
source = source.replaceAll('import.meta.url', metaUrl);
source = source.replaceAll("from 'esbuild'", `from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/esbuild/lib/main.js')).href)}`);
const writes = [...source.matchAll(/\bwriteFile\(/g)].length;
if (writes !== 1) throw new Error(`既有輸出邊界改變：${writes}`);
source = source.replace(/\bwriteFile\(/g, 'captureWrite(');
const bootTag = '<script src="/__fixture/bootstrap.js"></script>';
if (!source.includes(bootTag)) throw new Error('既有HTML注入點改變');
source = source.replaceAll(bootTag, bootTag + '<script src="/__integration/bootstrap.js"></script>');
const urlMarker = 'const url = new URL(req.url, origin);';
if (source.split(urlMarker).length !== 2) throw new Error('既有路由邊界改變');
const route = `
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) { res.writeHead(403); res.end(); return; }
    if (url.pathname === '/__integration/meta') { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(integrationBinding)); return; }
    if (url.pathname === '/__integration/bootstrap.js') { res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-store'}); res.end(integrationBootstrap); return; }
    if (${JSON.stringify(ticket)} === '04' && url.pathname === '/__fixture/browser-cases.mjs') { res.writeHead(200, {'Content-Type':'text/javascript','Cache-Control':'no-store'}); res.end(integrationHoldings); return; }
    if (url.pathname === '/viewport') {
      const size = url.searchParams.get('size');
      const width = size === 'narrow' ? 390 : 1440, height = size === 'narrow' ? 844 : 900;
      const target = new URL(url.searchParams.get('path') || '/', origin);
      if (target.origin !== origin || !['/', '/harness'].includes(target.pathname)) { res.writeHead(403); res.end(); return; }
      const src = (target.pathname + target.search).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'"});
      res.end('<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>12隔離尺寸 '+size+'</title></head><body style="margin:0"><iframe id="app" title="整合驗收App" style="display:block;border:0" width="'+width+'" height="'+height+'" src="'+src+'"></iframe></body></html>'); return;
    }
`;
source = source.replace(urlMarker, urlMarker + route);
const prelude = `
const integrationBinding = ${JSON.stringify(binding)};
const integrationBootstrap = ${JSON.stringify(readFileSync(path.join(dir, 'integration-bootstrap.js'), 'utf8'))};
const integrationHoldings = ${JSON.stringify(readFileSync(path.join(dir, 'holdings-cases.mjs'), 'utf8'))};
async function captureWrite(file, content) {
  if (path.resolve(path.dirname(file)) !== ${JSON.stringify(path.resolve(oldDir))} || path.extname(file) !== '.json') throw new Error('拒絕歷史範圍以外的輸出');
  const data = JSON.parse(content);
  const width = data.integrationBrowser?.viewport?.width;
  const size = width === 390 ? 'narrow' : width === 1440 ? 'desktop' : 'host';
  const isApp = data.integrationBrowser?.pathname === '/';
  const prefix = ${JSON.stringify(ticket)} === '05' && !isApp ? '' : size + '-';
  const target = path.join(${JSON.stringify(output)}, prefix + path.basename(file));
  await writeFile(target, JSON.stringify({...data, integration: integrationBinding}, null, 2) + String.fromCharCode(10), 'utf8');
}
`;
// 既有import.meta都明確指回歷史工具所在位置；Node套件改絕對入口，無臨時檔或依賴變更。
await import(`data:text/javascript;base64,${Buffer.from(prelude + source).toString('base64')}`);
