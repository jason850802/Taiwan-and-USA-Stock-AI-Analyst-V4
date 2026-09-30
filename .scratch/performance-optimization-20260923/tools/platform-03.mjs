#!/usr/bin/env node
// 03 平台受控驗收：提交後 prepare → Preview 部署 → probe → logs；每步證據不可覆寫。
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claimRun, fileSha, sha256, sleep } from './service-kit.mjs';
import { ROOT, scanSecrets } from './verify-b1-breakdown.mjs';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const ts = require('typescript');
const fixture = require('./trace-preload.cjs');
const tools = path.dirname(fileURLToPath(import.meta.url));
const routes = ['yahoo/chart', 'yahoo/search', 'finmind', 'gemini', 'gemini-stream'];
const toolFiles = ['platform-03.mjs', 'platform-fixture-03.cjs', 'trace-preload.cjs', 'service-kit.mjs', 'verify-b1-breakdown.mjs'];
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const git = args => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

export function deploymentSettings(configuration, source) {
  const fn = configuration.functions?.['api/**/*.ts'];
  if (!fn || fn.supportsCancellation !== true || Object.keys(fn).some(key => key !== 'supportsCancellation')) {
    throw new Error('部署設定超出已核准 supportsCancellation 範圍');
  }
  const ast = ts.createSourceFile('handler.ts', source, ts.ScriptTarget.Latest, true);
  const durations = ast.statements.filter(ts.isVariableStatement)
    .filter(node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap(node => node.declarationList.declarations).filter(node => node.name.getText(ast) === 'maxDuration');
  if (durations.length > 1 || (durations.length && (!durations[0].initializer || !ts.isNumericLiteral(durations[0].initializer)))) {
    throw new Error('handler maxDuration 必須是唯一的數字常數');
  }
  return { supportsCancellation: true, ...(durations.length ? { maxDuration: Number(durations[0].initializer.text) } : {}) };
}

// 依同部署及明綁 trace 去重；沒有 trace 的平台事件不推定歸屬。
export function platformEvents(rows, deploymentId, prefix) {
  const events = new Map();
  for (const row of rows) {
    if (row.deploymentId !== deploymentId) continue;
    for (const message of [row.message, ...(row.logs ?? []).map(item => item.message)]) {
      let event;
      try { event = JSON.parse(message); } catch { continue; }
      if (event.marker !== 'perf03-platform' || !event.trace?.startsWith(prefix + '-')) continue;
      events.set(`${event.trace}|${event.event}|${event.atMs}|${event.index ?? ''}`, event);
    }
  }
  return [...events.values()];
}

export function canceledWorkStopped(client, events) {
  const own = events.filter(event => event.trace === client.trace);
  return client.canceled === true && own.some(event => event.event === 'child.fakeCli.spawn')
    && own.some(event => event.event === 'child.fakeCli.kill')
    && own.some(event => event.event === 'request-aborted' || (event.event === 'response-close' && event.finished === false))
    && !own.some(event => ['child.fakeCli.done', 'response-finish'].includes(event.event));
}

export function verifiedDeployment(deployed, preparedSha256, origin) {
  if (deployed.prepareSha256 !== preparedSha256 || deployed.deployment?.url !== origin
    || !/^dpl_[A-Za-z0-9]+$/.test(deployed.deployment?.id ?? '') || deployed.deployment?.target !== null) {
    throw new Error('需要與本 run 固定包綁定的 Preview 部署身分');
  }
  return deployed.deployment.id;
}

export function validPayload(client) {
  if (client.status === 204) return client.text === '';
  let body;
  try { body = JSON.parse(client.text); } catch { return false; }
  if (client.status !== 200) return body.code === (client.status === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST') && typeof body.message === 'string';
  if (client.route.startsWith('/api/yahoo/chart?')) return JSON.stringify(body) === JSON.stringify(fixture.fixtureChartBody('AAPL'));
  if (client.route.startsWith('/api/yahoo/search?')) return body.quotes?.length === 1 && body.quotes[0].symbol === '2330.TW' && body.quotes[0].shortname === 'FIXTURE 2330';
  if (client.route.startsWith('/api/finmind?')) return JSON.stringify(body) === JSON.stringify({ msg: 'success', status: 200, data: [
    { stock_id: '2330', stock_name: '固定資料台積電', industry_category: '半導體業', type: 'twse' },
    { stock_id: '0050', stock_name: '固定資料元大台灣50', industry_category: 'ETF', type: 'twse' },
    { stock_id: '2317', stock_name: '固定資料鴻海', industry_category: '其他電子業', type: 'twse' },
  ] });
  if (client.route === '/api/gemini') return body.text === Array.from({ length: 5 }, (_, i) => `假片段${i + 1}`).join('');
  return false;
}

function exactTools(expected = null) {
  const head = git(['rev-parse', 'HEAD']).toString().trim();
  for (const file of toolFiles) {
    if (!git(['show', `${head}:.scratch/performance-optimization-20260923/tools/${file}`]).equals(fs.readFileSync(path.join(tools, file)))) {
      throw new Error(`工具未提交：${file}`);
    }
    if (expected && expected[file] !== fileSha(path.join(tools, file))) throw new Error(`工具漂移：${file}`);
  }
  return head;
}

async function main() {
  const [mode, runId, url] = process.argv.slice(2);
  if (!/^platform03-[a-z0-9-]+$/.test(runId ?? '')) throw new Error('需要新的 platform03 run-id');
  const evidence = path.join(ROOT, '.scratch/performance-optimization-20260923/evidence/03', runId);
  if (mode === 'prepare') {
    const head = exactTools();
    const sources = new Map();
    const sourceIdentity = relative => {
      const committed = git(['show', `${head}:${relative}`]);
      const actual = fs.readFileSync(path.join(ROOT, relative));
      const exact = committed.equals(actual);
      const lineEndingsOnly = !exact && committed.toString('utf8').replaceAll('\r\n', '\n') === actual.toString('utf8').replaceAll('\r\n', '\n');
      if (!exact && !lineEndingsOnly) throw new Error(`來源未提交：${relative}`);
      sources.set(relative, { sha256: sha256(actual), committedSha256: sha256(committed), exact, lineEndingsOnly });
      return actual;
    };
    const configuration = JSON.parse(sourceIdentity('vercel.json'));
    const { evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId });
    const deployment = path.join(runtimeDir, 'preview');
    const output = path.join(deployment, '.vercel/output');
    fs.mkdirSync(path.join(output, 'static'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.vercel/project.json'), path.join(deployment, '.vercel/project.json'));
    json(path.join(output, 'config.json'), { version: 3 });
    fs.writeFileSync(path.join(output, 'static/index.html'), '<!doctype html><meta charset="utf-8"><title>03 平台固定資料驗收</title><p>03 受控 API 驗收</p>');
    const artifacts = [];
    for (const route of routes) {
      const settings = deploymentSettings(configuration, sourceIdentity(`api/${route}.ts`).toString('utf8'));
      const folder = path.join(output, 'functions/api', route + '.func');
      fs.mkdirSync(folder, { recursive: true });
      const result = await build({ stdin: { contents: `const fixture = require(${JSON.stringify(path.join(tools, 'platform-fixture-03.cjs'))}); const handler = require(${JSON.stringify(path.join(ROOT, 'api', route + '.ts'))}).default; module.exports = fixture.wrap(handler);`, resolveDir: ROOT },
        bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: path.join(folder, 'index.cjs'), metafile: true, logLevel: 'silent' });
      for (const file of Object.keys(result.metafile.inputs)) {
        if (file === '<stdin>' || file.includes('node_modules')) continue;
        sourceIdentity(path.relative(ROOT, path.resolve(ROOT, file)).replaceAll('\\', '/'));
      }
      const vcConfig = { runtime: 'nodejs22.x', handler: 'index.cjs', launcherType: 'Nodejs', shouldAddHelpers: true,
        supportsResponseStreaming: true, ...settings };
      json(path.join(folder, '.vc-config.json'), vcConfig);
      artifacts.push({ route: '/api/' + route, sha256: fileSha(path.join(folder, 'index.cjs')),
        configurationSha256: fileSha(path.join(folder, '.vc-config.json')), configuration: vcConfig });
      const leaked = scanSecrets(folder).filter(({key}) => !['LLM_PROVIDER', 'GEMINI_MODEL_FAST', 'GEMINI_MODEL_THINKING', 'query-credential', 'cookie-field'].includes(key));
      if (leaked.length) throw new Error(`打包內容含環境值：${leaked.map(item => item.key).join(',')}`);
    }
    json(path.join(evidenceDir, 'prepare.json'), { runId, head, createdAt: new Date().toISOString(), deployment,
      tools: Object.fromEntries(toolFiles.map(file => [file, fileSha(path.join(tools, file))])),
      sources: Object.fromEntries(sources), artifacts, runtime: 'nodejs22.x', kind: '原 handler／部署旗標及時限＋固定上游與假 CLI',
      limits: ['Preview，非正式網域', '無真 AI／真行情；Node22 與測試注入明列',
        'origin／secret／Redis 使用固定後端測試值，真服務配置與可用性未驗', '取消通知可能延後至下次寫出；延遲逐筆觀察，非 SLA'] });
    console.log(JSON.stringify({ runId, deployment, artifacts: artifacts.length }));
    return;
  }
  const origin = new URL(url);
  if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.vercel.app') || origin.pathname !== '/') throw new Error('需要具名 Vercel Preview HTTPS origin');
  const prepared = JSON.parse(fs.readFileSync(path.join(evidence, 'prepare.json')));
  exactTools(prepared.tools);
  const deployed = JSON.parse(fs.readFileSync(path.join(evidence, 'deployment.json')));
  verifiedDeployment(deployed, fileSha(path.join(evidence, 'prepare.json')), origin.origin);
  for (const artifact of prepared.artifacts) {
    const folder = path.join(prepared.deployment, '.vercel/output/functions', artifact.route.slice(1) + '.func');
    if (fileSha(path.join(folder, 'index.cjs')) !== artifact.sha256 || fileSha(path.join(folder, '.vc-config.json')) !== artifact.configurationSha256) {
      throw new Error('固定部署包漂移');
    }
  }
  if (mode === 'probe') {
    if (fs.existsSync(path.join(evidence, 'raw.json'))) throw new Error('證據不可覆寫');
    const results = [];
    const request = (route, method = 'GET', body = null, options = {}) => new Promise(resolve => {
      const trace = `${runId}-${results.length}`;
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      let response = null, text = '', settled = false, timer;
      const finish = extra => { if (settled) return; settled = true; clearTimeout(timer); resolve({ route, method, trace, startedAt,
        scenario: options.scenario ?? 'normal', expectedStatus: options.expectedStatus ?? 200,
        status: response?.statusCode ?? null, text: text.slice(0, 10000), elapsedMs: Date.now() - startedMs, ...extra }); };
      const req = https.request(new URL(route, origin), { method, agent: false, headers: { 'x-perf03-trace': trace,
        'x-perf03-case': options.scenario ?? 'normal', 'x-proxy-secret': 'perf03-fixed-secret',
        'content-type': 'application/json', origin: origin.origin, ...options.headers }, timeout: 30000 }, res => {
        response = res;
        res.setEncoding('utf8');
        res.on('data', chunk => {
          text += chunk;
          if (options.cancelFirstDelta && text.includes('"t":"delta"')) {
            req.destroy();
            finish({ canceled: true, canceledAfterFirstDelta: true });
          }
        });
        res.on('end', () => finish({ completed: true }));
        res.on('error', error => finish({ error: error.message }));
      });
      req.on('timeout', () => req.destroy(new Error('request timeout')));
      req.on('error', error => finish({ error: error.message }));
      if (options.cancelAfterMs) timer = setTimeout(() => { req.destroy(); finish({ canceled: true, canceledBeforeAnyByte: text === '' }); }, options.cancelAfterMs);
      req.end(body ? JSON.stringify(body) : undefined);
    });
    for (const route of routes) results.push(await request('/api/' + route, 'OPTIONS', null, { expectedStatus: 204 }));
    // 存取保護或平台錯誤擋住 OPTIONS 時停止，不繞過。
    if (results.every(item => item.status === 204)) {
      results.push(await request('/api/yahoo/chart?symbol=AAPL&interval=1d&range=2y'));
      results.push(await request('/api/yahoo/search?q=2330'));
      results.push(await request('/api/finmind?dataset=TaiwanStockInfo'));
      results.push(await request('/api/gemini-stream', 'POST', {}, { expectedStatus: 400 }));
      results.push(await request('/api/gemini', 'GET', null, { expectedStatus: 405 }));
      results.push(await request('/api/yahoo/chart?symbol=AAPL', 'GET', null, { expectedStatus: 403, headers: { origin: 'https://untrusted.invalid' } }));
      results.push(await request('/api/yahoo/chart?symbol=AAPL', 'GET', null, { expectedStatus: 403, headers: { 'x-proxy-secret': 'invalid' } }));
      const body = { prompt: '固定測試', systemInstruction: '固定測試', mode: 'fast' };
      results.push(await request('/api/gemini', 'POST', body));
      results.push(await request('/api/gemini-stream', 'POST', body));
      await sleep(15000);
      results.push(await request('/api/gemini-stream', 'POST', body, { scenario: 'cancel-first-delta', cancelFirstDelta: true }));
      await sleep(15000);
      results.push(await request('/api/gemini-stream', 'POST', body, { scenario: 'cancel-early', cancelAfterMs: 400 }));
      await sleep(15000);
      results.push(await request('/api/gemini-stream', 'POST', body, { scenario: 'after-cancel' }));
      results.push(await request('/api/yahoo/chart?symbol=AAPL', 'GET', null, { expectedStatus: 429, scenario: 'rate-limit' }));
    }
    json(path.join(evidence, 'raw.json'), { runId, url: origin.origin, createdAt: new Date().toISOString(), tools: prepared.tools, results });
    console.log(JSON.stringify({ runId, results: results.map(({ scenario, status, canceled, expectedStatus }) => ({ scenario, status, canceled, expectedStatus })) }));
    return;
  }
  if (mode !== 'logs') throw new Error('用法：platform-03.mjs prepare|probe|logs platform03-新代號 [Preview網址]');
  const raw = JSON.parse(fs.readFileSync(path.join(evidence, 'raw.json')));
  const vc = path.join(process.env.APPDATA, 'npm/node_modules/vercel/dist/vc.js');
  const text = execFileSync(process.execPath, [vc, 'logs', '--deployment', deployed.deployment.id, '--json', '--expand', '--no-follow',
    '--no-branch', '--since', prepared.createdAt, '--limit', '100', '--cwd', prepared.deployment], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const rows = text.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  json(path.join(evidence, 'platform-logs.json'), rows);
  const events = platformEvents(rows, deployed.deployment.id, runId);
  const expectedText = Array.from({ length: 5 }, (_, i) => `假片段${i + 1}`).join('');
  const checks = raw.results.map(client => {
    const own = events.filter(event => event.trace === client.trace);
    let pass;
    if (client.scenario.startsWith('cancel-')) pass = canceledWorkStopped(client, events);
    else {
      pass = client.completed === true && client.status === client.expectedStatus;
      if (!(client.route === '/api/gemini-stream' && client.status === 200)) pass &&= validPayload(client);
      if (client.status >= 400) pass &&= !own.some(event => event.event === 'child.fakeCli.spawn'
        || (event.event === 'fixture-fetch' && event.kind !== 'ratelimit'));
      if (client.route === '/api/gemini-stream' && client.status === 200) {
        let chunks = [];
        try { chunks = client.text.trim().split('\n').map(line => JSON.parse(line)); } catch { pass = false; }
        pass &&= chunks.length === 6 && chunks.slice(0, 5).every((chunk, i) => chunk.t === 'delta' && chunk.text === `假片段${i + 1}`)
          && chunks[5]?.t === 'done' && chunks[5]?.text === expectedText
          && own.some(event => event.event === 'child.fakeCli.done') && !own.some(event => event.event === 'child.fakeCli.kill');
      }
    }
    return { trace: client.trace, scenario: client.scenario, route: client.route, pass, events: own.sort((a, b) => a.atMs - b.atMs) };
  });
  const pass = checks.length === 18 && checks.every(item => item.pass) && !events.some(event => event.event === 'blocked-fetch');
  json(path.join(evidence, 'summary.json'), { runId, deploymentId: deployed.deployment.id, url: origin.origin,
    rawSha256: fileSha(path.join(evidence, 'raw.json')), logsSha256: fileSha(path.join(evidence, 'platform-logs.json')),
    pass, checks, limits: prepared.limits });
  console.log(JSON.stringify({ runId, pass, checks: checks.map(({ scenario, pass }) => ({ scenario, pass })) }));
  process.exitCode = pass ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
