// 固定尺寸iframe使用真正window尺寸/媒體查詢；所有應用API只在loopback終止。
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chart, finmind } from '../07/fixtures.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const ticket = process.argv[2] || '10';
if (!['10', '12'].includes(ticket)) throw new Error('輸出只接受10或12');
const output = ticket === '10' ? dir : path.join(root, '.scratch/optimization-followup/evidence/12/keyboard');
await mkdir(output, { recursive: true });
const dist = path.join(root, 'dist'), origin = 'http://127.0.0.1:4183';
const sha = data => createHash('sha256').update(data).digest('hex');
const paths = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n'))]
  .filter(file => /^(services|components|utils|api)\/.*\.tsx?$/.test(file) && !file.includes('.test.') || ['App.tsx', 'index.tsx', 'types.ts', 'vite.config.ts'].includes(file));
const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async file => [file, sha(await readFile(path.join(root, file)))])));
const buildModified = (await stat(path.join(dist, 'index.html'))).mtimeMs;
if ((await Promise.all(paths.map(async file => (await stat(path.join(root, file))).mtimeMs))).some(time => time > buildModified)) throw new Error('dist過舊，先建置候選');
const compiled = await build({ entryPoints: [path.join(dir, 'modal-harness.jsx')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', define: { 'process.env.NODE_ENV': '"development"' } });
const bundle = compiled.outputFiles[0].contents;
const toolHashes = Object.fromEntries(await Promise.all(['fixture-server.mjs', 'bootstrap.js', 'modal-harness.jsx', 'native-plan.mjs', '../07/fixtures.mjs'].map(async file => [file, sha(await readFile(path.join(dir, file)))])));
const binding = { baseline: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceHashes, toolHashes,
  buildIndexSha256: sha(await readFile(path.join(dist, 'index.html'))), harnessSha256: sha(bundle), node: process.version };
let requests = [];
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.headers.host !== '127.0.0.1:4183' || req.headers.origin && req.headers.origin !== origin) return json(res, {}, 403);
    if (url.pathname === '/__fixture/meta') return json(res, binding);
    if (url.pathname === '/__fixture/state') return json(res, { requests });
    if (url.pathname === '/__fixture/result' && req.method === 'POST') {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 3 * 1024 * 1024) throw new Error('輸入過大'); }
      const data = JSON.parse(raw);
      if (!/^(red|green|native|integration)-[a-z0-9-]+$/.test(data.name)) throw new Error('結果名稱無效');
      await writeFile(path.join(output, `${data.name}.json`), JSON.stringify({ ...data.result, ...binding, requests }, null, 2) + '\n');
      return json(res, { saved: data.name });
    }
    if (url.pathname.startsWith('/api')) {
      requests.push({ path: url.pathname, symbol: url.searchParams.get('symbol'), interval: url.searchParams.get('interval'), dataset: url.searchParams.get('dataset') });
      if (url.pathname === '/api/yahoo/chart') return json(res, chart(url.searchParams.get('symbol'), url.searchParams.get('interval'), url.searchParams.get('range') === '5d' ? 5 : 80));
      if (url.pathname === '/api/finmind') return json(res, { msg: 'success', data: finmind(url.searchParams.get('dataset'), url.searchParams.get('data_id')) });
      if (url.pathname === '/api/yahoo/search') return json(res, { quotes: [{ symbol: 'AAPL', shortname: '合成 Apple', quoteType: 'EQUITY', exchange: 'NMS' }] });
      return json(res, { error: '未知API及真實AI禁止' }, 403);
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let content, ext;
    if (url.pathname === '/viewport') {
      const size = url.searchParams.get('size') || 'desktop', dimensions = { desktop: [1440, 900], narrow: [390, 844] }[size];
      if (!dimensions) throw new Error('未知尺寸');
      const route = url.searchParams.get('page') === 'harness' ? '/harness' : '/';
      content = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>隔離尺寸驗收 ${size}</title><style>html,body{margin:0;padding:0;background:#0f172a}iframe{border:0;display:block}</style><iframe id="app" title="隔離驗收App" width="${dimensions[0]}" height="${dimensions[1]}" src="${route}?size=${size}"></iframe></html>`; ext = '.html';
    } else if (url.pathname === '/harness') {
      requests = [];
      const css = (await readFile(path.join(dist, 'index.html'), 'utf8')).match(/<link[^>]*href="([^"]+\.css)"[^>]*>/)?.[0] || '';
      content = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">${css}<script src="/__fixture/bootstrap.js"></script></head><body><div id="root"></div><script type="module" src="/__fixture/harness.js"></script></body></html>`; ext = '.html';
    } else if (url.pathname === '/__fixture/harness.js') { content = bundle; ext = '.js'; }
    else if (url.pathname === '/__fixture/native-plan.mjs') { content = await readFile(path.join(dir, 'native-plan.mjs')); ext = '.js'; }
    else {
      const file = url.pathname === '/__fixture/bootstrap.js' ? path.join(dir, 'bootstrap.js') : path.resolve(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''));
      if (url.pathname !== '/__fixture/bootstrap.js' && !file.startsWith(dist + path.sep)) return json(res, {}, 403);
      content = await readFile(file); ext = path.extname(file);
      if (ext === '.html') { requests = []; content = content.toString().replace(/<link\b[^>]*href="https:\/\/fonts\.googleapis\.com\/[^>]*>/g, '').replace('<head>', '<head><script src="/__fixture/bootstrap.js"></script>'); }
    }
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' })[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" });
    res.end(content);
  } catch (error) { json(res, { error: error.message }, 400); }
}).listen(4183, '127.0.0.1', () => console.log(JSON.stringify({ origin, ticket, pid: process.pid, buildIndexSha256: binding.buildIndexSha256 })));
