// 獨立假資料驗收站：僅綁本機，所有 /api 都在此攔截，不連外、不呼叫 AI。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const directory = [
  { stock_id: '2330', stock_name: '台積電（驗收假資料）', type: 'twse', industry_category: '半導體業' },
  { stock_id: '6488', stock_name: '環球晶（驗收假資料）', type: 'tpex', industry_category: '半導體業' },
];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4175');
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  if (url.pathname.startsWith('/api/')) {
    console.log(req.method, url.pathname, url.search);
    if (url.pathname.includes('gemini')) return json({ message: '驗收站不呼叫 AI' }, 403);
    if (url.pathname === '/api/yahoo/search') {
      const query = url.searchParams.get('q').toUpperCase();
      if (query === 'SLOW') await new Promise(resolve => setTimeout(resolve, 1500));
      return json({ quotes: query.includes('AAP') || query === 'SLOW' ? [{ symbol: 'AAPL', shortname: 'Apple（驗收假資料）', quoteType: 'EQUITY', exchange: 'NMS' }] : [] });
    }
    if (url.pathname === '/api/finmind') {
      const dataset = url.searchParams.get('dataset');
      const data = dataset === 'TaiwanStockInfo' ? directory
        : dataset === 'TaiwanStockPER' ? [{ date: '2026-09-18', PER: 20, PBR: 5, dividend_yield: 2 }]
        : dataset === 'TaiwanStockMonthRevenue' ? Array.from({ length: 13 }, (_, i) => ({ date: `2025-${String((i % 12) + 1).padStart(2, '0')}-10`, revenue_year: 2025 + Math.floor(i / 12), revenue_month: i % 12 + 1, revenue: 100000000000 + i * 1000000000 })) : [];
      return json({ msg: 'success', status: 200, data });
    }
    if (url.pathname === '/api/yahoo/chart') {
      const symbol = url.searchParams.get('symbol');
      if (symbol === 'FAIL') return json({ message: '模擬行情暫時無法取得' }, 503);
      const interval = url.searchParams.get('interval');
      const count = url.searchParams.get('range') === '5d' ? 5 : 500;
      const step = interval === '1wk' ? 7 * 86400 : interval === '1mo' ? 30 * 86400 : interval === '60m' ? 3600 : interval === '15m' ? 900 : 86400;
      const end = Date.parse('2026-09-18T04:00:00Z') / 1000;
      const timestamp = Array.from({ length: count }, (_, i) => end - (count - i - 1) * step);
      const close = timestamp.map((_, i) => 100 + i / 10 + Math.sin(i));
      return json({ chart: { error: null, result: [{
        meta: { symbol, longName: `${symbol}（驗收假資料）`, currency: symbol.includes('.TW') ? 'TWD' : 'USD', exchangeTimezoneName: symbol.includes('.TW') ? 'Asia/Taipei' : 'America/New_York', regularMarketPrice: close.at(-1) }, timestamp,
        indicators: { quote: [{ close, open: close.map(n => n - 1), high: close.map(n => n + 2), low: close.map(n => n - 2), volume: close.map(() => 1000000) }] },
      }] } });
    }
    return json({ message: '未定義驗收端點' }, 404);
  }
  try {
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(dist, relative);
    if (!file.startsWith(path.resolve(dist) + path.sep)) { res.writeHead(403); res.end(); return; }
    const ext = path.extname(file);
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream' });
    res.end(ext === '.html' ? content.toString().replace(/<title>.*?<\/title>/, '<title>專案最佳化驗收（假資料）</title>') : content);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(4175, '127.0.0.1', () => console.log('假資料驗收站：http://127.0.0.1:4175'));
