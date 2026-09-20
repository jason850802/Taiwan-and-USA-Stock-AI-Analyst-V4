// 05 隔離假站：實際 HTTP 到達/結束計算峰值，固定延遲僅用於效能量測。
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const dist = path.join(root, 'dist');
const origin = 'http://127.0.0.1:4179';
const baseline = process.argv.includes('--baseline');
const fixedPoint = '0366f5fb1d58d963323cc9d519f49ec87217a048';
const hookSource = baseline
  ? execFileSync('git', ['show', `${fixedPoint}:components/portfolio/useHoldingPrices.ts`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  : await readFile(path.join(root, 'components/portfolio/useHoldingPrices.ts'), 'utf8');
const queueSource = baseline ? null : await readFile(path.join(root, 'components/portfolio/holdingPriceQueue.ts'), 'utf8');
let records = [], active = 0, peak = 0, generation = 0, delay = 80;
const hash = b => createHash('sha256').update(b).digest('hex');
const binding = async () => ({ source: baseline ? fixedPoint : 'working-tree', hookSha256: hash(hookSource),
  queueSha256: queueSource === null ? null : hash(queueSource), buildIndexSha256: hash(await readFile(path.join(dist, 'index.html'))) });
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
let bundle;
const chart = (symbol, price) => ({ chart: { error: null, result: [{ meta: { symbol, longName: `驗收 ${symbol}`, currency: 'USD', exchangeTimezoneName: 'America/New_York', regularMarketPrice: price }, timestamp: [1789747200], indicators: { quote: [{ open: [price], high: [price], low: [price], close: [price], volume: [1000] }] } }] } });
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.headers.host !== '127.0.0.1:4179' || (req.headers.origin && req.headers.origin !== origin)) return json(res, {}, 403);
    if (url.pathname === '/__fixture/state') return json(res, { records, active, peak, generation, delay });
    if (url.pathname.startsWith('/__fixture/') && req.method === 'POST') {
      let raw = ''; for await (const b of req) { raw += b; if (raw.length > 2000000) throw new Error('輸入過大'); }
      const data = JSON.parse(raw || '{}');
      if (url.pathname === '/__fixture/reset') {
        if (active) return json(res, { error: '前案尚未結束' }, 409);
        records = []; peak = 0; generation = 0; delay = data.delay ?? 80;
        return json(res, { ok: true });
      }
      if (url.pathname === '/__fixture/generation') { generation = data.value; return json(res, { generation }); }
      if (url.pathname === '/__fixture/result' && /^(before|after|red|green|manual)-[a-z0-9-]+$/.test(data.name)) {
        await writeFile(path.join(dir, `${data.name}.json`), JSON.stringify({ ...data.result, ...await binding() }, null, 2) + '\n');
        return json(res, { saved: data.name });
      }
      return json(res, {}, 403);
    }
    if (url.pathname === '/api/yahoo/chart') {
      const symbol = url.searchParams.get('symbol');
      if (url.searchParams.get('range') !== '5d') return json(res, chart(symbol, 150));
      const record = { symbol, generation, start: performance.now(), status: 'pending' };
      records.push(record); active++; peak = Math.max(peak, active);
      let ended = false;
      const done = () => { if (!ended) { ended = true; active--; record.end = performance.now(); } };
      res.once('close', done);
      setTimeout(() => {
        const fail = symbol.endsWith('005') && record.generation === 0;
        const price = symbol.endsWith('=X') ? 30 + record.generation : 100 + record.generation * 100;
        record.status = fail ? 503 : 200; record.price = price;
        done(); json(res, fail ? { message: '單檔預期失敗' } : chart(symbol, price), fail ? 503 : 200);
      }, delay);
      return;
    }
    if (url.pathname === '/api/finmind') return json(res, { msg: 'success', data: [] });
    if (url.pathname === '/api/yahoo/search') return json(res, { quotes: [] });
    if (url.pathname.startsWith('/api')) return json(res, { error: '假站拒絕未定義 API/AI' }, 403);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let content, type = 'text/javascript';
    if (url.pathname === '/harness') {
      type = 'text/html'; content = '<html lang="zh-TW"><head><meta charset="utf-8"><script src="/__fixture/bootstrap.js"></script></head><body><div id="root"></div><script type="module" src="/__fixture/holdings.js"></script></body></html>';
    } else if (url.pathname === '/__fixture/holdings.js') {
      if (!bundle) bundle = (await build({ entryPoints: [path.join(dir, 'holdings.jsx')], bundle: true, write: false, format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
        plugins: [{ name: 'exact-source', setup(builder) {
          builder.onLoad({ filter: /\.[jt]sx?$/ }, args => {
            const relative = path.relative(root, args.path).split(path.sep).join('/');
            if (baseline && !relative.startsWith('..') && !relative.startsWith('node_modules/') && !relative.startsWith('.scratch/')) {
              const contents = execFileSync('git', ['show', `${fixedPoint}:${relative}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
              return { contents, loader: relative.endsWith('tsx') ? 'tsx' : relative.endsWith('jsx') ? 'jsx' : 'ts', resolveDir: path.dirname(args.path) };
            }
            if (relative === 'components/portfolio/useHoldingPrices.ts') return { contents: hookSource, loader: 'ts', resolveDir: path.dirname(args.path) };
            if (relative === 'components/portfolio/holdingPriceQueue.ts') return { contents: queueSource, loader: 'ts', resolveDir: path.dirname(args.path) };
          });
        } }],
      })).outputFiles[0].contents;
      content = bundle;
    } else if (['/__fixture/bootstrap.js', '/__fixture/cases.mjs'].includes(url.pathname)) content = await readFile(path.join(dir, path.basename(url.pathname)));
    else {
      if (baseline) return json(res, { error: '基準模式只供 hook 宿主；正式 App 使用目前 dist' }, 403);
      const file = path.resolve(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''));
      if (!file.startsWith(dist + path.sep)) return json(res, {}, 403);
      content = await readFile(file); type = ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' })[path.extname(file)] || 'application/octet-stream';
      if (path.extname(file) === '.html') content = content.toString().replace(/<link\b[^>]*href="https:\/\/fonts\.googleapis\.com\/[^>]*>/g, '').replace('<head>', '<head><script src="/__fixture/bootstrap.js"></script>');
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" }); res.end(content);
  } catch (error) { json(res, { error: error.message }, 400); }
}).listen(4179, '127.0.0.1', () => console.log(JSON.stringify({ origin, pid: process.pid })));
