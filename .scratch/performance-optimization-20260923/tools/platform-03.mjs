#!/usr/bin/env node
// Vercel Preview 固定資料平台探針：先 prepare，精確部署該 run 的 output，最後 probe 具名網址。
// 不改正式網域、不上傳 .env、不啟動瀏覽器，不觸碰真帳本；五支原 handler 經 esbuild 打包。
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claimRun, fileSha, sha256 } from './service-kit.mjs';
import { ROOT, scanSecrets } from './verify-b1-breakdown.mjs';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const tools = path.dirname(fileURLToPath(import.meta.url));
const [mode, runId, url] = process.argv.slice(2);
const evidence = path.join(ROOT, '.scratch/performance-optimization-20260923/evidence/03', runId ?? '');
const routes = ['yahoo/chart', 'yahoo/search', 'finmind', 'gemini', 'gemini-stream'];
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const git = args => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
if (!/^platform03-[a-z0-9-]+$/.test(runId ?? '')) throw new Error('需要新的 platform03 run-id');
if (mode === 'prepare') {
  const head = git(['rev-parse', 'HEAD']).toString().trim();
  const toolFiles = ['platform-03.mjs', 'platform-fixture-03.cjs', 'trace-preload.cjs', 'service-kit.mjs', 'verify-b1-breakdown.mjs'];
  for (const file of toolFiles) {
    const relative = '.scratch/performance-optimization-20260923/tools/' + file;
    if (!git(['show', `${head}:${relative}`]).equals(fs.readFileSync(path.join(tools, file)))) throw new Error(`工具未提交：${file}`);
  }
  const { evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId });
  const deployment = path.join(runtimeDir, 'preview');
  const output = path.join(deployment, '.vercel/output');
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.vercel/project.json'), path.join(deployment, '.vercel/project.json'));
  json(path.join(output, 'config.json'), { version: 3 });
  const staticDir = path.join(output, 'static');
  fs.mkdirSync(staticDir);
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>03 平台固定資料驗收</title><p>03 平台固定資料探針；不是日常 App。</p>');
  const sources = new Map();
  const artifacts = [];
  for (const route of routes) {
    const folder = path.join(output, 'functions/api', route + '.func');
    fs.mkdirSync(folder, { recursive: true });
    const result = await build({ stdin: { contents: `const fixture = require(${JSON.stringify(path.join(tools, 'platform-fixture-03.cjs'))}); const handler = require(${JSON.stringify(path.join(ROOT, 'api', route + '.ts'))}).default; module.exports = fixture.wrap(handler);`, resolveDir: ROOT },
      bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: path.join(folder, 'index.cjs'), metafile: true, logLevel: 'silent' });
    for (const file of Object.keys(result.metafile.inputs)) {
      if (file === '<stdin>' || file.includes('node_modules')) continue;
      const absolute = path.resolve(ROOT, file);
      const relative = path.relative(ROOT, absolute).replaceAll('\\', '/');
      const committed = git(['show', `${head}:${relative}`]);
      const actual = fs.readFileSync(absolute);
      const exact = committed.equals(actual);
      const lineEndingsOnly = !exact && committed.toString('utf8').replaceAll('\r\n', '\n') === actual.toString('utf8').replaceAll('\r\n', '\n');
      if (!exact && !lineEndingsOnly) throw new Error(`來源未提交：${relative}`);
      sources.set(relative, { sha256: sha256(actual), committedSha256: sha256(committed), exact, lineEndingsOnly });
    }
    json(path.join(folder, '.vc-config.json'), { runtime: 'nodejs22.x', handler: 'index.cjs', launcherType: 'Nodejs',
      shouldAddHelpers: true, supportsResponseStreaming: true, maxDuration: 30 });
    artifacts.push({ route: '/api/' + route, sha256: fileSha(path.join(folder, 'index.cjs')) });
    // 程式碼內的 cookie／token 字面欄位不是值洩漏；實際環境秘密值仍逐一檢查。
    const leaked = scanSecrets(folder).filter(({key}) => !['LLM_PROVIDER', 'query-credential', 'cookie-field'].includes(key));
    if (leaked.length) throw new Error(`打包內容含環境值：${leaked.map(item => item.key).join(',')}`);
  }
  json(path.join(evidenceDir, 'prepare.json'), { runId, head, createdAt: new Date().toISOString(), deployment,
    tools: Object.fromEntries(toolFiles.map(file => [file, fileSha(path.join(tools, file))])),
    sources: Object.fromEntries(sources), artifacts, runtime: 'nodejs22.x', kind: 'Preview 原 handler＋固定上游／假 CLI 注入',
    limits: ['不是正式網域部署', '無真上游、無真 AI', '測試注入另列，不能宣稱原部署包完全等價',
      '清除 Upstash 與 shared secret：未驗真限流服務或正式密鑰配置', '本探針 maxDuration=30，原串流 handler 宣告 200，非設定等價驗收'] });
  console.log(JSON.stringify({ runId, deployment, artifacts: artifacts.length }));
} else if (mode === 'probe') {
  const origin = new URL(url);
  if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.vercel.app') || origin.pathname !== '/') throw new Error('需要具名 Vercel Preview HTTPS origin');
  const prepared = JSON.parse(fs.readFileSync(path.join(evidence, 'prepare.json')));
  if (prepared.tools['platform-03.mjs'] !== fileSha(fileURLToPath(import.meta.url))) throw new Error('工具雜湊不符');
  if (fs.existsSync(path.join(evidence, 'raw.json'))) throw new Error('證據不可覆寫');
  const results = [];
  const request = (route, method = 'GET', body = null, cancel = false) => new Promise(resolve => {
    const trace = `${runId}-${results.length}`;
    const startedAt = new Date().toISOString();
    let response = null, text = '', settled = false;
    const finish = extra => { if (settled) return; settled = true; resolve({ route, method, trace, startedAt,
      status: response?.statusCode ?? null, text: text.slice(0,10000), ...extra }); };
    const req = https.request(new URL(route, origin), { method, headers: { 'x-perf03-trace': trace,
      'content-type': 'application/json', origin: origin.origin }, timeout: 30000 }, res => {
      response = res;
      res.setEncoding('utf8');
      res.on('data', chunk => {
        text += chunk;
        if (cancel && text.includes('"t":"delta"')) {
          req.destroy();
          finish({ canceledAfterFirstDelta: true });
        }
      });
      res.on('end', () => finish({ completed: true }));
      res.on('error', error => finish({ error: error.message }));
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', error => finish({ error: error.message }));
    req.end(body ? JSON.stringify(body) : undefined);
  });
  for (const route of routes) results.push(await request('/api/' + route, 'OPTIONS'));
  // 若 Preview 保護或平台失敗擋住 OPTIONS，停止，不繞過存取控制。
  if (results.every(item => item.status === 204)) {
    results.push(await request('/api/yahoo/chart?symbol=AAPL&interval=1d&range=2y'));
    results.push(await request('/api/yahoo/search?q=2330'));
    results.push(await request('/api/finmind?dataset=TaiwanStockInfo'));
    results.push(await request('/api/gemini-stream', 'POST', {}));
    const body = { prompt: '固定測試', systemInstruction: '固定測試', mode: 'fast' };
    results.push(await request('/api/gemini', 'POST', body));
    results.push(await request('/api/gemini-stream', 'POST', body));
    results.push(await request('/api/gemini-stream', 'POST', body, true));
  }
  json(path.join(evidence, 'raw.json'), { runId, url: origin.origin, createdAt: new Date().toISOString(),
    tools: prepared.tools, results, serverCancellation: '須另對帳平台 logs 的同 trace fakeCli.kill／response-close，不能由客戶端取消推定' });
  console.log(JSON.stringify({ runId, results: results.map(({route,status,canceledAfterFirstDelta,error}) => ({route,status,canceledAfterFirstDelta,error})) }, null, 2));
} else throw new Error('用法：platform-03.mjs prepare|probe platform03-新代號 [Preview網址]');
