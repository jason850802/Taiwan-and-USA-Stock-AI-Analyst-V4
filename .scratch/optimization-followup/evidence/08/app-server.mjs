// 08 正式 dist 的隔離壓力／儲存故障站；只服務合成行情，未知 API 一律拒絕。
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chart, finmind } from '../07/fixtures.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const ticket = process.argv[2] || '08';
if (!['08', '12'].includes(ticket)) throw new Error('只能輸出08或12');
const output = path.join(root, '.scratch/optimization-followup/evidence', ticket);
await mkdir(output, { recursive: true });
const dist = path.join(root, 'dist');
const origin = 'http://127.0.0.1:4181';
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceFiles = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n'))]
  .filter(file => /^(services|components|utils|api)\/.*\.tsx?$/.test(file) && !file.includes('.test.') || ['App.tsx', 'index.tsx', 'types.ts', 'vite.config.ts'].includes(file));
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, sha(await readFile(path.join(root, file)))])));
const buildModified = (await stat(path.join(dist, 'index.html'))).mtimeMs;
const sourceModified = await Promise.all(sourceFiles.map(async file => (await stat(path.join(root, file))).mtimeMs));
if (sourceModified.some(time => time > buildModified)) throw new Error('正式 dist 比候選原始碼舊，請先對當前候選跑完整 gate');
const binding = { baseline: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceHashes,
  buildIndexSha256: sha(await readFile(path.join(dist, 'index.html'))), node: process.version,
  tools: Object.fromEntries(await Promise.all(['app-server.mjs', 'app-bootstrap.js', 'app-cases.mjs', '../07/fixtures.mjs'].map(async name => [name, sha(await readFile(path.join(dir, name)))]))) };
let requests = [];
const json = (res, value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.headers.host !== '127.0.0.1:4181' || (req.headers.origin && req.headers.origin !== origin)) return json(res, {}, 403);
    if (url.pathname === '/__fixture/state') return json(res, { requests });
    if (url.pathname === '/__fixture/reset' && req.method === 'POST') { requests = []; return json(res, { ok: true }); }
    if (url.pathname === '/__fixture/result' && req.method === 'POST') {
      let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 4 * 1024 * 1024) throw new Error('結果過大'); }
      const data = JSON.parse(text);
      if (!/^app-(pressure|quota|denied|corrupt|oversize)$/.test(data.name)) throw new Error('結果名稱錯誤');
      await writeFile(path.join(output, `${data.name}.json`), JSON.stringify({ ...data.result, requests, ...binding }, null, 2) + '\n');
      return json(res, { saved: data.name });
    }
    if (url.pathname === '/api/yahoo/chart') {
      const symbol = url.searchParams.get('symbol');
      const interval = url.searchParams.get('interval');
      const range = url.searchParams.get('range');
      const bars = range === '5d' ? 5 : range === '2y' ? 500 : symbol === 'OVERSIZE' && interval === '1d' ? 20000 : ({ '1d': 2500, '1wk': 520, '60m': 1600 })[interval] || 64;
      const value = chart(symbol, interval, bars);
      requests.push({ path: url.pathname, symbol, interval, range, bars, price: value.chart.result[0].meta.regularMarketPrice, status: 200 });
      return json(res, value);
    }
    if (url.pathname === '/api/finmind') {
      const dataset = url.searchParams.get('dataset');
      const id = url.searchParams.get('data_id');
      requests.push({ path: url.pathname, dataset, id, status: 200 });
      return json(res, { msg: 'success', data: finmind(dataset, id) });
    }
    if (url.pathname === '/api/yahoo/search') return json(res, { quotes: [] });
    if (url.pathname.startsWith('/api')) return json(res, { error: '禁止真實 API/AI' }, 403);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const script = { '/__fixture/bootstrap.js': 'app-bootstrap.js', '/__fixture/cases.mjs': 'app-cases.mjs' }[url.pathname];
    const file = script ? path.join(dir, script) : path.resolve(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (!script && !file.startsWith(dist + path.sep)) return json(res, {}, 403);
    let content = await readFile(file);
    if (path.extname(file) === '.html') content = content.toString().replace(/<link\b[^>]*href="https:\/\/fonts\.googleapis\.com\/[^>]*>/g, '')
      .replace('<head>', '<head><script src="/__fixture/bootstrap.js"></script>');
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" });
    res.end(content);
  } catch (error) { json(res, { error: error.message }, 400); }
}).listen(4181, '127.0.0.1', () => console.log(JSON.stringify({ origin, ticket, pid: process.pid, buildIndexSha256: binding.buildIndexSha256 })));
