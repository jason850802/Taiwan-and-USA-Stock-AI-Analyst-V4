// 02 專屬假站：沿用 01 靜態站方式，加入可手動釋放的基本面／AI 回應。
// 僅服務正式 dist；所有 API 都在 loopback 終止，絕不轉送真實服務。
import { createServer } from 'node:http';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = fileURLToPath(new URL('./', import.meta.url));
const dist = path.resolve(fileURLToPath(new URL('../../../../dist/', import.meta.url)));
const origin = 'http://127.0.0.1:4176';
await access(path.join(dist, 'index.html'));
const directory = [
  { stock_id: '2330', stock_name: '驗收甲公司', type: 'twse', industry_category: '驗收產業' },
  { stock_id: '6488', stock_name: '驗收乙公司', type: 'tpex', industry_category: '驗收產業' },
];
let plans = {};
const counters = new Map();
const pending = new Map();
const requests = [];

function json(res, value, status = 200, group = '') {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Fixture-Group': group,
  });
  res.end(JSON.stringify(value));
}

async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 256000) throw new Error('驗收請求過大');
  }
  return JSON.parse(text || '{}');
}

function serveControlled(res, kind, stockId, dataset, payload) {
  const counterKey = `${kind}:${stockId}:${dataset}`;
  const attempt = (counters.get(counterKey) || 0) + 1;
  counters.set(counterKey, attempt);
  const group = `${kind}:${stockId}:${attempt}`;
  const record = { group, dataset, status: 'pending' };
  requests.push(record);
  const finish = fail => {
    record.status = fail ? 503 : 200;
    const value = fail ? { message: `驗收 ${stockId} 請求失敗` } : payload(attempt);
    json(res, value, fail ? 503 : 200, group);
  };
  // 每次基本面只扣住估值一筆，避免 HTTP/1.1 六連線上限把控制請求堵死。
  if (plans[group] === 'hold' && (kind === 'ai' || dataset === 'TaiwanStockPER')) {
    const waiting = pending.get(group) || [];
    waiting.push(finish);
    pending.set(group, waiting);
  } else finish(plans[group] === 'fail');
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.headers.origin && req.headers.origin !== origin) return json(res, { message: '驗收 origin 不符' }, 403);
    if (url.pathname === '/__fixture/state') return json(res, { requests });
    if (url.pathname.startsWith('/__fixture/') && req.method === 'POST') {
      const data = await body(req);
      if (url.pathname === '/__fixture/reset') {
        if (pending.size) return json(res, { message: '先釋放上一個案例' }, 409);
        plans = data.plans || {};
        counters.clear();
        requests.length = 0;
        return json(res, { ok: true });
      }
      if (url.pathname === '/__fixture/release') {
        plans[data.group] = data.fail ? 'fail' : 'success';
        const waiting = pending.get(data.group) || [];
        pending.delete(data.group);
        waiting.forEach(finish => finish(Boolean(data.fail)));
        return json(res, { released: waiting.length });
      }
      if (url.pathname === '/__fixture/result' && /^(red|green|manual)-[a-z-]+$/.test(data.name)) {
        await writeFile(path.join(evidence, `${data.name}.json`), JSON.stringify(data.result, null, 2) + '\n', 'utf8');
        return json(res, { saved: data.name });
      }
      return json(res, { message: '未定義驗收控制' }, 404);
    }
    if (url.pathname === '/api/finmind') {
      const dataset = url.searchParams.get('dataset');
      const stockId = url.searchParams.get('data_id') || '';
      const isFundamentals = dataset === 'TaiwanStockInfo'
        ? url.searchParams.get('start_date') === '2015-01-01'
        : ['TaiwanStockFinancialStatements', 'TaiwanStockBalanceSheet', 'TaiwanStockCashFlowsStatement', 'TaiwanStockPER', 'TaiwanStockMonthRevenue', 'TaiwanStockDividend'].includes(dataset);
      const payload = attempt => ({ msg: 'success', status: 200, data: dataset === 'TaiwanStockInfo'
        ? (stockId ? directory.filter(row => row.stock_id === stockId) : directory)
        : dataset === 'TaiwanStockPER' ? [{ date: stockId === '6488' ? '2026-09-18' : '2026-09-17', PER: (stockId === '6488' ? 22.22 : 11.11) + (attempt - 1) * 10, PBR: 2, dividend_yield: 3 }]
          : [] });
      if (isFundamentals) return serveControlled(res, 'fund', stockId, dataset, payload);
      return json(res, payload(1));
    }
    if (url.pathname === '/api/gemini' && req.method === 'POST') {
      const data = await body(req);
      const stockId = data.prompt?.match(/代碼：(\d{3,6}[A-Z]?)/)?.[1];
      if (!stockId) return json(res, { message: '驗收站只接受基本面合成回應' }, 403);
      return serveControlled(res, 'ai', stockId, 'report', () => ({ text: `### 合成報告 ${stockId}\n\n這是 ${stockId} 的驗收假資料，非真實 AI。` }));
    }
    if (url.pathname === '/api/yahoo/search') return json(res, { quotes: [] });
    if (url.pathname === '/api/yahoo/chart') {
      const symbol = url.searchParams.get('symbol') || '2330.TW';
      const close = [149, 150];
      return json(res, { chart: { error: null, result: [{
        meta: { symbol, longName: '驗收行情', currency: 'TWD', exchangeTimezoneName: 'Asia/Taipei', regularMarketPrice: 150 },
        timestamp: [1789617600, 1789704000],
        indicators: { quote: [{ open: close, high: [151, 152], low: [147, 148], close, volume: [1000000, 1000000] }] },
      }] } });
    }
    if (url.pathname.startsWith('/api')) return json(res, { message: '未定義 API，禁止轉送' }, 403);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const scripts = { '/__fixture/bootstrap.js': 'bootstrap.js', '/__fixture/browser-cases.mjs': 'browser-cases.mjs' };
    const file = scripts[url.pathname] ? path.join(evidence, scripts[url.pathname])
      : path.resolve(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (!scripts[url.pathname] && !file.startsWith(dist + path.sep)) return json(res, {}, 403);
    let content = await readFile(file);
    const ext = path.extname(file);
    if (ext === '.html') {
      // 假站使用系統字型，移除外部字型 link，避免隔離 CSP 產生無關錯誤。
      content = Buffer.from(content.toString()
        .replace(/<link\b[^>]*href="https:\/\/fonts\.googleapis\.com\/[^>]*>/g, '')
        .replace('<head>', '<head><script src="/__fixture/bootstrap.js"></script>'));
    }
    res.writeHead(200, {
      'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' })[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    });
    res.end(content);
  } catch (error) {
    json(res, { message: error.code === 'ENOENT' ? '驗收檔案不存在' : '驗收請求無效' }, 400);
  }
});
server.listen(4176, '127.0.0.1', () => console.log(JSON.stringify({ origin, pid: process.pid, dist })));
