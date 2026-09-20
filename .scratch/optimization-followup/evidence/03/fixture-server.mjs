// 03 專屬假站：沿用前票靜態站，僅以同源 HTTP 邊界控制行情完成順序。
import { createServer } from 'node:http';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const evidence = fileURLToPath(new URL('./', import.meta.url));
const dist = path.resolve(fileURLToPath(new URL('../../../../dist/', import.meta.url)));
const origin = 'http://127.0.0.1:4177';
await access(path.join(dist, 'index.html'));
let plans = {};
const counters = new Map();
const pending = new Map();
const requests = [];

function json(res, value, status = 200, group = '') {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Fixture-Group': group });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 256000) throw new Error('驗收請求過大');
  }
  return JSON.parse(value || '{}');
}
function chart(symbol, range, price) {
  const count = range === '2y' ? 12 : 64;
  const start = Date.parse(range === '2y' ? '2024-09-18T16:00:00Z' : '2016-09-19T16:00:00Z') / 1000;
  const end = Date.parse('2026-09-18T16:00:00Z') / 1000;
  const timestamp = Array.from({ length: count }, (_, i) => Math.round(start + (end - start) * i / (count - 1)));
  const close = timestamp.map((_, i) => price - count + i + 1);
  const taiwan = symbol.includes('.TW');
  return { chart: { error: null, result: [{
    meta: { symbol, longName: `驗收 ${symbol}`, currency: taiwan ? 'TWD' : 'USD', exchangeTimezoneName: taiwan ? 'Asia/Taipei' : 'America/New_York', regularMarketPrice: price },
    timestamp,
    indicators: { quote: [{ open: close.map(n => n - 1), high: close.map(n => n + 2), low: close.map(n => n - 2), close, volume: close.map(() => 1000000) }] },
  }] } };
}
function controlledChart(res, url) {
  const symbol = url.searchParams.get('symbol');
  const interval = url.searchParams.get('interval');
  const range = url.searchParams.get('range');
  const key = `${symbol}|${interval}|${range}`;
  const attempt = (counters.get(key) || 0) + 1;
  counters.set(key, attempt);
  const group = `${key}|${attempt}`;
  const record = { group, symbol, interval, range, status: 'pending' };
  requests.push(record);
  const finish = (fail = false, price) => {
    if (record.status !== 'pending') return false;
    pending.delete(group);
    const value = price ?? (symbol === 'AAPL' ? range === '2y' ? 111 : 222 : symbol === 'MSFT' ? range === '2y' ? 333 : 444 : 150);
    record.status = fail ? 503 : 200;
    record.price = fail ? null : value;
    json(res, fail ? { message: `驗收 ${symbol} 行情失敗` } : chart(symbol, range, value), record.status, group);
    return true;
  };
  res.on('close', () => {
    if (record.status === 'pending') { record.status = 'aborted'; pending.delete(group); }
  });
  if (plans[group] === 'hold') pending.set(group, finish);
  else finish(plans[group] === 'fail');
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.headers.host !== '127.0.0.1:4177' || (req.headers.origin && req.headers.origin !== origin)) return json(res, {}, 403);
    if (url.pathname === '/__fixture/state') return json(res, { requests, pending: [...pending.keys()] });
    if (url.pathname.startsWith('/__fixture/') && req.method === 'POST') {
      const data = await body(req);
      if (url.pathname === '/__fixture/reset') {
        if (pending.size) return json(res, { message: '先釋放上一個案例' }, 409);
        plans = data.plans || {};
        counters.clear(); requests.length = 0;
        return json(res, { ok: true });
      }
      if (url.pathname === '/__fixture/plan') { Object.assign(plans, data.plans); return json(res, { ok: true }); }
      if (url.pathname === '/__fixture/release') {
        plans[data.group] = data.fail ? 'fail' : 'success';
        return json(res, { released: pending.get(data.group)?.(Boolean(data.fail), data.price) ? 1 : 0 });
      }
      if (url.pathname === '/__fixture/result' && /^(red|green|manual)-[a-z-]+$/.test(data.name)) {
        const index = await readFile(path.join(dist, 'index.html'));
        const result = { ...data.result, buildIndexSha256: createHash('sha256').update(index).digest('hex') };
        await writeFile(path.join(evidence, `${data.name}.json`), JSON.stringify(result, null, 2) + '\n', 'utf8');
        return json(res, { saved: data.name });
      }
      return json(res, {}, 404);
    }
    if (url.pathname === '/api/yahoo/chart') return controlledChart(res, url);
    if (url.pathname === '/api/yahoo/search') return json(res, { quotes: [] });
    if (url.pathname === '/api/finmind') {
      const dataset = url.searchParams.get('dataset');
      return json(res, { msg: 'success', data: dataset === 'TaiwanStockInfo' ? [{ stock_id: '2330', stock_name: '驗收台股', type: 'twse' }] : [] });
    }
    if (url.pathname.startsWith('/api')) return json(res, { message: '驗收站禁止 AI 與未定義 API' }, 403);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const scripts = { '/__fixture/bootstrap.js': 'bootstrap.js', '/__fixture/browser-cases.mjs': 'browser-cases.mjs' };
    const file = scripts[url.pathname] ? path.join(evidence, scripts[url.pathname]) : path.resolve(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (!scripts[url.pathname] && !file.startsWith(dist + path.sep)) return json(res, {}, 403);
    let content = await readFile(file);
    const ext = path.extname(file);
    if (ext === '.html') content = Buffer.from(content.toString().replace(/<link\b[^>]*href="https:\/\/fonts\.googleapis\.com\/[^>]*>/g, '').replace('<head>', '<head><script src="/__fixture/bootstrap.js"></script>'));
    res.writeHead(200, {
      'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' })[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    });
    res.end(content);
  } catch (error) { json(res, { message: error.code === 'ENOENT' ? '驗收檔案不存在' : '驗收請求無效' }, 400); }
});
server.listen(4177, '127.0.0.1', () => console.log(JSON.stringify({ origin, pid: process.pid, dist })));
