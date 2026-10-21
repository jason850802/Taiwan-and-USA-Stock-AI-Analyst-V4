import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chart, finmind } from '../../../../optimization-followup/evidence/07/fixtures.mjs';
import { createRun } from './s1-run.mjs';
import { names } from './health-input-cases.mjs';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const origin = 'http://127.0.0.1:4184';
const hash = value => createHash('sha256').update(value).digest('hex');
const buildResult = await build({
  absWorkingDir: root,
  entryPoints: { host: path.join(dir, 'health-input-host.jsx') },
  bundle: true,
  splitting: true,
  write: false,
  outdir: path.join(dir, 'bundle'),
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  target: 'es2022',
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' },
});
const artifacts = Object.fromEntries(buildResult.outputFiles.map(file => [path.basename(file.path), file.contents]));
const entryName = Object.keys(artifacts).find(name => name.startsWith('host-'));
if (!entryName) throw new Error('找不到公開 hook 宿主入口');
const run = createRun('hook', names, artifacts);

let requests = [];
let quotes = [];
let sequence = 0;
const pendingAi = new Map();
const pendingStages = new Map();
const controls = { holdImport: false, holdQuotes: new Set(), failQuotes: new Set() };
const json = (res, data, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};
async function body(req) {
  let text = '';
  for await (const block of req) {
    text += block;
    if (text.length > 1024 * 1024) throw Error('body 太大');
  }
  return JSON.parse(text || '{}');
}
const setControls = value => {
  controls.holdImport = value.holdImport === true;
  controls.holdQuotes = new Set(value.holdQuotes || []);
  controls.failQuotes = new Set(value.failQuotes || []);
};
const stageState = () => [...pendingStages].map(([id, value]) => ({ id, stage: value.stage, symbol: value.symbol ?? null }));
const aiState = () => [...pendingAi.keys()];
const bootstrap = `if(location.origin!==${JSON.stringify(origin)})throw Error('非隔離 origin');localStorage.clear();sessionStorage.clear();window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));import(${JSON.stringify(run.versionUrl('health-input-cases.mjs'))}).then(m=>m.run());`;
const artifactPath = name => `/__run/${run.binding.runId}/${name}`;
const sendArtifact = (res, name) => {
  const content = artifacts[name];
  if (!content || run.binding.artifactHashes[name] !== hash(content)) return json(res, {}, 404);
  run.verifyInputs();
  res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
  res.end(content);
};
const report = (id, partial = false) => {
  const tag = id === 1 ? 'OLD' : 'NEW';
  const lead = partial ? `合成 ${tag}-PARTIAL` : `合成 ${tag}`;
  return `## AAPL\n\n${lead} AAPL 報告\n\n續抱\n\n## MSFT\n\n${lead} MSFT 報告\n\n續抱\n\n## 2330\n\n${lead} 台股報告\n\n續抱`;
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return json(res, {}, 403);
    if (url.pathname === '/state') return json(res, { requests, quotes, pending: aiState(), stages: stageState(), controls: {
      holdImport: controls.holdImport, holdQuotes: [...controls.holdQuotes], failQuotes: [...controls.failQuotes],
    } });
    if (url.pathname === '/reset' && req.method === 'POST') {
      if (pendingAi.size || pendingStages.size) return json(res, {}, 409);
      requests = [];
      quotes = [];
      sequence = 0;
      setControls({});
      return json(res, { ok: true });
    }
    if (url.pathname === '/control' && req.method === 'POST') {
      if (pendingAi.size || pendingStages.size) return json(res, {}, 409);
      setControls(await body(req));
      return json(res, { ok: true });
    }
    if (url.pathname === '/release-stage' && req.method === 'POST') {
      const value = await body(req);
      const matches = [...pendingStages].filter(([id, pending]) => value.id === id || value.stage === pending.stage);
      if (matches.length === 0) return json(res, {}, 404);
      matches.forEach(([id, pending]) => { pendingStages.delete(id); pending.release(value.fail === true); });
      return json(res, { ok: true, released: matches.map(([id]) => id) });
    }
    if (url.pathname === '/partial' && req.method === 'POST') {
      const value = await body(req);
      const pending = pendingAi.get(value.id);
      if (!pending || pending.partialSent) return json(res, {}, 404);
      pending.partialSent = true;
      pending.response.write(JSON.stringify({ t: 'delta', text: report(value.id, true) }) + '\n');
      requests[value.id - 1].status = 'partial';
      return json(res, { ok: true });
    }
    if (url.pathname === '/release' && req.method === 'POST') {
      const value = await body(req);
      const pending = pendingAi.get(value.id);
      if (!pending) return json(res, {}, 404);
      pendingAi.delete(value.id);
      requests[value.id - 1].status = value.fail === true ? 'error' : 'done';
      if (value.fail === true) pending.response.end(JSON.stringify({ t: 'error', message: '合成批次失敗' }) + '\n');
      else {
        const text = report(value.id);
        if (!pending.partialSent) pending.response.write(JSON.stringify({ t: 'delta', text }) + '\n');
        pending.response.end(JSON.stringify({ t: 'done', text }) + '\n');
      }
      return json(res, { ok: true });
    }
    if (url.pathname === '/result' && req.method === 'POST') return json(res, run.accept(await body(req)));

    if (url.pathname === '/api/yahoo/chart') {
      const symbol = url.searchParams.get('symbol');
      quotes.push({ symbol, interval: url.searchParams.get('interval'), at: Date.now() });
      const send = fail => fail
        ? json(res, { message: '合成行情失敗' }, 503)
        : json(res, chart(symbol, url.searchParams.get('interval'), 80));
      if (controls.holdQuotes.has(symbol)) {
        const id = `quote-${++sequence}-${symbol}`;
        pendingStages.set(id, { stage: 'quote', symbol, release: send });
        return;
      }
      return send(controls.failQuotes.has(symbol));
    }
    if (url.pathname === '/api/finmind') return json(res, { msg: 'success', data: finmind(url.searchParams.get('dataset'), url.searchParams.get('data_id')) });
    if (url.pathname === '/api/gemini-stream' && req.method === 'POST') {
      const payload = await body(req);
      const id = requests.length + 1;
      requests.push({ id, payloadSha256: hash(JSON.stringify(payload)), payload, status: 'pending' });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      pendingAi.set(id, { response: res, partialSent: false });
      return;
    }
    if (url.pathname.startsWith('/api')) return json(res, { message: '拒絕真實 AI 或未知 API' }, 403);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (url.pathname === '/') {
      const content = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><script>${run.bindingScript}</script><script src="${run.versionUrl('health-input-server.mjs')}"></script></head><body><div id="root"></div><script type="module" src="${artifactPath(entryName)}"></script></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'" });
      return res.end(content);
    }
    if (url.pathname === run.versionUrl('health-input-server.mjs')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end(bootstrap);
    }
    if (url.pathname === run.versionUrl('health-input-cases.mjs')) {
      run.verifyInputs();
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end(await readFile(path.join(dir, 'health-input-cases.mjs')));
    }
    const artifactPrefix = `/__run/${run.binding.runId}/`;
    if (url.pathname.startsWith(artifactPrefix)) {
      const name = path.basename(url.pathname);
      if (name.startsWith('chunk-') && controls.holdImport) {
        const id = `import-${++sequence}-${name}`;
        pendingStages.set(id, { stage: 'import', release: () => sendArtifact(res, name) });
        controls.holdImport = false;
        return;
      }
      return sendArtifact(res, name);
    }
    if (url.pathname.startsWith('/__s1/') || url.pathname.startsWith('/__run/')) return json(res, { error: '過期工具 URL' }, 410);
    return json(res, {}, 404);
  } catch (error) {
    json(res, { message: error.message }, error.status || 400);
  }
}).listen(4184, '127.0.0.1', () => {
  run.saveStartup(origin);
  console.log(JSON.stringify({ origin, pid: process.pid, manifest: path.join(run.directory, 'manifest.json') }));
});
