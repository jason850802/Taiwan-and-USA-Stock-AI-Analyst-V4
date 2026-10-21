import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};

const port = Number(valueOf('--port', '4176'));
const headersDelayMs = Number(valueOf('--headers-ms', '35'));
const bodyDelayMs = Number(valueOf('--body-ms', '45'));
const runId = valueOf('--run-id', 'fixed-three-slot-20260923-v1');
const toolDir = path.dirname(fileURLToPath(import.meta.url));
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error('run-id 無效');
const evidenceRoot = path.resolve(toolDir, `../evidence/05/${runId}`);
if (!Number.isInteger(port) || port <= 0 || !Number.isFinite(headersDelayMs) || !Number.isFinite(bodyDelayMs)) {
  throw new Error('固定 upstream 參數無效');
}

const yahooPayload = (symbol, price) => ({
  chart: {
    error: null,
    result: [{
      meta: {
        symbol,
        regularMarketPrice: price,
        longName: symbol,
        shortName: symbol,
        exchangeTimezoneName: symbol.endsWith('.TW') ? 'Asia/Taipei' : 'America/New_York',
      },
      timestamp: [1780000000],
      indicators: { quote: [{ close: [price] }] },
    }],
  },
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/capture') {
    const name = url.searchParams.get('name') ?? '';
    if (!/^[a-z0-9][a-z0-9._-]*\.json$/i.test(name)) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid capture name' }));
      return;
    }
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        rejected = true;
        res.writeHead(413);
        res.end(JSON.stringify({ error: 'capture too large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        fs.mkdirSync(evidenceRoot, { recursive: true });
        const target = path.join(evidenceRoot, name);
        fs.writeFileSync(target, Buffer.concat(chunks), { flag: 'wx' });
        res.writeHead(201);
        res.end(JSON.stringify({ saved: path.relative(toolDir, target).replaceAll('\\', '/'), bytes: size }));
      } catch (error) {
        const exists = error && typeof error === 'object' && error.code === 'EEXIST';
        res.writeHead(exists ? 409 : 500);
        res.end(JSON.stringify({ error: exists ? 'capture exists' : String(error) }));
      }
    });
    return;
  }

  let payload;
  if (url.pathname === '/yahoo') {
    const symbol = url.searchParams.get('symbol') ?? '';
    const price = Number(url.searchParams.get('price'));
    payload = yahooPayload(symbol, price);
  } else if (url.pathname === '/finmind') {
    const stockId = url.searchParams.get('stockId') ?? '';
    payload = { msg: 'success', data: [{ stock_id: stockId, stock_name: `測試名稱 ${stockId}` }] };
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  setTimeout(() => {
    res.writeHead(200);
    res.flushHeaders();
    setTimeout(() => res.end(JSON.stringify(payload)), bodyDelayMs);
  }, headersDelayMs);
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ port, headersDelayMs, bodyDelayMs, runId, pid: process.pid }));
});

const close = () => server.close(() => process.exit(0));
process.on('SIGINT', close);
process.on('SIGTERM', close);
