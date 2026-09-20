// 本機假持股與可手動釋放報價；真實 App 用 dist，hook 宿主用已安裝的 esbuild。
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const dist = path.join(root, 'dist');
const origin = 'http://127.0.0.1:4178';
const pending = new Map();
const counts = new Map();
const requests = [];
const sha = value => createHash('sha256').update(value).digest('hex');
const binding = async () => ({
  hookSha256: sha(await readFile(path.join(root, 'components/portfolio/useHoldingPrices.ts'))),
  buildIndexSha256: sha(await readFile(path.join(dist, 'index.html'))),
});
const json = (res, value, status = 200, group = '') => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Fixture-Group': group });
  res.end(JSON.stringify(value));
};
const chart = (symbol, price, date = '2026-09-18') => ({ chart: { error: null, result: [{
  meta: { symbol, longName: `驗收 ${symbol}`, currency: 'USD', exchangeTimezoneName: symbol.endsWith('.TW') ? 'Asia/Taipei' : 'America/New_York', regularMarketPrice: price },
  timestamp: [Date.parse(`${date}T16:00:00Z`) / 1000],
  indicators: { quote: [{ open: [price - 1], high: [price + 1], low: [price - 2], close: [price], volume: [1000] }] },
}] } });
let bundle;
let bundleHash;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.headers.host !== '127.0.0.1:4178' || (req.headers.origin && req.headers.origin !== origin)) return json(res, { error: '非驗收來源' }, 403);
    if (url.pathname === '/__fixture/state') return json(res, { requests, pending: [...pending.keys()] });
    if (url.pathname.startsWith('/__fixture/') && req.method === 'POST') {
      let text = '';
      for await (const chunk of req) { text += chunk; if (text.length > 1000000) throw new Error('驗收輸入過大'); }
      const data = JSON.parse(text || '{}');
      if (url.pathname === '/__fixture/reset') {
        if (pending.size) return json(res, { error: '仍有未釋放請求' }, 409);
        counts.clear(); requests.length = 0;
        return json(res, { ok: true });
      }
      if (url.pathname === '/__fixture/release') {
        const finish = pending.get(data.group);
        if (!finish) return json(res, { error: `找不到 ${data.group}` }, 404);
        pending.delete(data.group); finish(data);
        return json(res, { released: data.group });
      }
      if (url.pathname === '/__fixture/result' && /^(red|green|manual)-[a-z-]+$/.test(data.name)) {
        await writeFile(path.join(evidence, `${data.name}.json`), JSON.stringify({ ...data.result, ...await binding() }, null, 2) + '\n');
        return json(res, { saved: data.name });
      }
      return json(res, { error: '未定義驗收控制' }, 403);
    }
    if (url.pathname === '/api/yahoo/chart') {
      const symbol = url.searchParams.get('symbol');
      if (url.searchParams.get('range') !== '5d') return json(res, chart(symbol, 150));
      const attempt = (counts.get(symbol) || 0) + 1;
      counts.set(symbol, attempt);
      const group = `${symbol}:${attempt}`;
      const record = { group, symbol, status: 'pending' };
      requests.push(record);
      const finish = ({ price = 100, date = '2026-09-18', fail = false }) => {
        Object.assign(record, { status: fail ? 503 : 200, price, date });
        json(res, fail ? { message: '驗收故障注入' } : chart(symbol, price, date), fail ? 503 : 200, group);
      };
      // 只扣住美股及匯率兩筆，讓重疊兩輪仍低於 HTTP/1.1 的六連線上限。
      if (symbol === '2330.TW') finish({ price: 110 });
      else pending.set(group, finish);
      return;
    }
    if (url.pathname === '/api/finmind') return json(res, { msg: 'success', data: url.searchParams.get('dataset') === 'TaiwanStockInfo' ? [{ stock_id: '2330', stock_name: '驗收台股', type: 'twse' }] : [] });
    if (url.pathname === '/api/yahoo/search') return json(res, { quotes: [] });
    if (url.pathname.startsWith('/api')) return json(res, { error: '未定義 API 或 AI，禁止轉送' }, 403);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let content;
    let type = 'text/javascript';
    if (url.pathname === '/harness') {
      type = 'text/html; charset=utf-8';
      content = '<html lang="zh-TW"><head><meta charset="utf-8"><script src="/__fixture/bootstrap.js"></script></head><body><div id="root"></div><script type="module" src="/__fixture/holdings.js"></script></body></html>';
    } else if (url.pathname === '/__fixture/holdings.js') {
      const sourceHash = (await binding()).hookSha256 + sha(await readFile(path.join(evidence, 'holdings.jsx')));
      if (bundleHash !== sourceHash) {
        const built = await build({ entryPoints: [path.join(evidence, 'holdings.jsx')], bundle: true, write: false, format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
        bundle = built.outputFiles[0].contents;
        bundleHash = sourceHash;
      }
      content = bundle;
    } else if (['/__fixture/bootstrap.js', '/__fixture/browser-cases.mjs'].includes(url.pathname)) {
      content = await readFile(path.join(evidence, path.basename(url.pathname)));
    } else {
      const file = path.resolve(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''));
      if (!file.startsWith(dist + path.sep)) return json(res, {}, 403);
      content = await readFile(file);
      const ext = path.extname(file);
      type = ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' })[ext] || 'application/octet-stream';
      if (ext === '.html') content = content.toString().replace(/<link\b[^>]*href="https:\/\/fonts\.googleapis\.com\/[^>]*>/g, '').replace('<head>', '<head><script src="/__fixture/bootstrap.js"></script>');
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" });
    res.end(content);
  } catch (error) { json(res, { error: error.code === 'ENOENT' ? '驗收檔案不存在' : error.message }, 400); }
});
server.listen(4178, '127.0.0.1', () => console.log(JSON.stringify({ origin, pid: process.pid })));
