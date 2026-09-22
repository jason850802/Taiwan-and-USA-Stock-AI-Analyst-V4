import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chart, finmind } from '../../../../optimization-followup/evidence/07/fixtures.mjs';
import { createRun } from './s1-run.mjs';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const dist = path.join(root, 'dist');
const origin = 'http://127.0.0.1:4185';
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceFiles = ['components/portfolio/useHealthCheck.ts', 'components/portfolio/HoldingsTable.tsx', 'components/Portfolio.tsx'];
const buildModified = (await stat(path.join(dist, 'index.html'))).mtimeMs;
if ((await Promise.all(sourceFiles.map(async file => (await stat(path.join(root, file))).mtimeMs))).some(time => time > buildModified)) {
  throw Error('正式 dist 比 S1 來源舊');
}
let requests = [];
const run = createRun('formal', ['desktop', 'narrow']);
const json = (res, value, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 1024 * 1024) throw Error('body 太大'); }
  return JSON.parse(text || '{}');
}
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return json(res, {}, 403);
    if (url.pathname === '/__state') {
      const page = url.searchParams.get('page');
      return json(res, { ...run.binding, requests: page ? requests.filter(request => request.page === page) : requests });
    }
    if (url.pathname === '/__result' && req.method === 'POST') {
      const data = await body(req);
      return json(res, run.accept(data));
    }
    if (url.pathname === '/api/gemini-stream' && req.method === 'POST') {
      const payload = await body(req);
      const tag = (url.searchParams.get('tag') || 'PRIMARY').replace(/[^A-Z0-9-]/g, '');
      const text = `## AAPL\n\n合成 ${tag} AAPL 報告\n\n續抱\n\n## MSFT\n\n合成 ${tag} MSFT 報告\n\n續抱`;
      requests.push({ path: url.pathname, page: url.searchParams.get('page'), tag,
        payloadSha256: hash(JSON.stringify(payload)), payload });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ t: 'delta', text }) + '\n' + JSON.stringify({ t: 'done', text }) + '\n');
      return;
    }
    if (url.pathname === '/api/yahoo/chart') return json(res, chart(url.searchParams.get('symbol'), url.searchParams.get('interval'), 80));
    if (url.pathname === '/api/finmind') return json(res, { msg: 'success', data: finmind(url.searchParams.get('dataset'), url.searchParams.get('data_id')) });
    if (url.pathname === '/api/yahoo/search') return json(res, { quotes: [] });
    if (url.pathname.startsWith('/api')) return json(res, { error: '未定義 API，禁止外送' }, 403);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const script = url.pathname === run.versionUrl('formal-bootstrap.js') ? path.join(dir, 'formal-bootstrap.js') : null;
    if (url.pathname.startsWith('/__s1/') && !script) return json(res, { error: '過期工具 URL' }, 410);
    const file = script || path.resolve(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (!script && !file.startsWith(dist + path.sep) && file !== path.join(dist, 'index.html')) return json(res, {}, 403);
    run.verifyInputs();
    let content = await readFile(file);
    const ext = path.extname(file);
    if (ext === '.html') content = content.toString()
      .replace(/<link\b[^>]*href="https:\/\/fonts\.googleapis\.com\/[^>]*>/g, '')
      .replace('<head>', `<head><script>${run.bindingScript}</script><script src="${run.versionUrl('formal-bootstrap.js')}"></script>`);
    res.writeHead(200, {
      'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' })[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    });
    res.end(content);
  } catch (error) {
    json(res, { error: error.message }, error.status || 400);
  }
}).listen(4185, '127.0.0.1', async () => {
  run.saveStartup(origin);
  console.log(JSON.stringify({ origin, pid: process.pid, manifest: path.join(run.directory, 'manifest.json') }));
});
