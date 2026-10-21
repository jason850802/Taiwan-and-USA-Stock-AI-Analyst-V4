import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const port = Number(valueOf('--port', '4195'));
const runId = valueOf('--run-id', 'true-market-paired-20260923-v1');
if (!Number.isInteger(port) || port <= 0) throw new Error('port 無效');
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error('run-id 無效');
const toolDir = path.dirname(fileURLToPath(import.meta.url));
const evidenceRoot = path.resolve(toolDir, `../evidence/05/${runId}`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ runId, pid: process.pid }));
    return;
  }
  if (req.method !== 'POST' || url.pathname !== '/capture') {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  const name = url.searchParams.get('name') ?? '';
  if (!/^(before|after)-[123]\.json$/.test(name)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'invalid capture name' }));
    return;
  }
  const chunks = [];
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) req.destroy(new Error('capture too large'));
    else chunks.push(chunk);
  });
  req.on('end', () => {
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
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ runId, port, pid: process.pid, evidenceRoot }));
});

const close = () => server.close(() => process.exit(0));
process.on('SIGINT', close);
process.on('SIGTERM', close);
