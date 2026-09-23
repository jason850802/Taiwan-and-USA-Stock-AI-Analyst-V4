import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};

const port = Number(valueOf('--port', '4193'));
const runId = valueOf('--run-id', 'true-market-paired-20260923-v1');
if (!Number.isInteger(port) || port <= 0) throw new Error('port 無效');
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error('run-id 無效');

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const evidenceRoot = path.resolve(toolDir, `../evidence/05/${runId}`);

const respond = (res, status, body) => {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  if (req.method === 'OPTIONS') {
    respond(res, 204, {});
    return;
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    respond(res, 200, { runId, pid: process.pid, port });
    return;
  }
  if (req.method !== 'POST' || url.pathname !== '/capture') {
    respond(res, 404, { error: 'not found' });
    return;
  }

  const name = url.searchParams.get('name') ?? '';
  if (!/^(before|after)-pair-[123]\.json$/.test(name)) {
    respond(res, 400, { error: 'invalid capture name' });
    return;
  }
  const chunks = [];
  let bytes = 0;
  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) {
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
  console.log(JSON.stringify({ runId, port, pid: process.pid }));
});

const close = () => server.close(() => process.exit(0));
process.on('SIGINT', close);
process.on('SIGTERM', close);
