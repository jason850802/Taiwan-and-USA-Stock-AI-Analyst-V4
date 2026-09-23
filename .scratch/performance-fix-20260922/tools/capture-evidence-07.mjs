// 07 證據收集服務：瀏覽器探針以 POST 回傳原始 JSON，只寫入 evidence/07/<run-id>/，拒絕覆寫。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};

const port = Number(valueOf('--port', '4196'));
const runId = valueOf('--run-id', null);
if (!Number.isInteger(port) || port <= 0) throw new Error('port 無效');
if (!runId || !/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error('run-id 無效');

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const evidenceRoot = path.resolve(toolDir, `../evidence/07/${runId}`);

const respond = (res, status, body) => {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  if (req.method === 'OPTIONS') return respond(res, 204, {});
  if (req.method === 'GET' && url.pathname === '/health') return respond(res, 200, { runId, pid: process.pid, port });
  if (req.method !== 'POST' || url.pathname !== '/capture') return respond(res, 404, { error: 'not found' });

  const name = url.searchParams.get('name') ?? '';
  if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(name)) return respond(res, 400, { error: 'invalid capture name' });
  const chunks = [];
  let bytes = 0;
  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) {
      respond(res, 413, { error: 'capture too large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    try {
      fs.mkdirSync(evidenceRoot, { recursive: true });
      const target = path.join(evidenceRoot, name);
      fs.writeFileSync(target, Buffer.concat(chunks), { flag: 'wx' });
      respond(res, 201, { saved: path.relative(toolDir, target).replaceAll('\\', '/'), bytes });
    } catch (error) {
      const exists = error && typeof error === 'object' && error.code === 'EEXIST';
      respond(res, exists ? 409 : 500, { error: exists ? 'capture exists' : String(error) });
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ runId, port, pid: process.pid, evidenceRoot }));
});

const close = () => server.close(() => process.exit(0));
process.on('SIGINT', close);
process.on('SIGTERM', close);
