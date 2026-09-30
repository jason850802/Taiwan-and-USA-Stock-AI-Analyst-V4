'use strict';
// 03 平台取消診斷用注入（非正式證據）：與 tools/platform-fixture-03.cjs 同形，只改兩處——
//   1. 假 CLI 改 20 段 × 600ms（約 12 秒），讓訊號延遲也看得出來
//   2. 打包時 define __DIAG_EXTRA_EVENTS__=true 的路由，多記 req error/close、res error（事件名前綴 DEBUG-c4n1）
//      其餘路由不加監聽：對 'error' 加監聽本身會改變行為（沒監聽時 error 會變成未處理例外）。
const { AsyncLocalStorage } = require('node:async_hooks');
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const { performance } = require('node:perf_hooks');
const fixture = require('E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.scratch/performance-optimization-20260923/tools/trace-preload.cjs');
const context = new AsyncLocalStorage();
const record = (event, detail = {}) => console.log(JSON.stringify({ marker: 'perf03-platform',
  ...detail, trace: context.getStore()?.trace ?? detail.trace ?? null, event, atMs: performance.now() }));
for (const key of ['GEMINI_API_KEY', 'FINMIND_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'PROXY_SHARED_SECRET', 'ALLOWED_ORIGIN']) delete process.env[key];
process.env.LLM_PROVIDER = 'claude-cli';
process.env.CLAUDE_CLI_PATH = process.execPath;
process.env.PERF03_TEST_APP = '1';
childProcess.spawn = (command, args) => {
  if (!fixture.looksLikeClaude(command, args)) throw new Error('平台固定資料禁止啟動非假 CLI');
  return fixture.createFakeCli({ args, ai: { intervalMs: 600, deltas: 20 }, record, trace: context.getStore()?.trace ?? null });
};
syncBuiltinESMExports();
globalThis.fetch = async (input, init) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  const kind = fixture.classifyUrl(String(raw));
  if (!['yahoo-cookie', 'yahoo-crumb', 'yahoo-chart', 'yahoo-search', 'finmind', 'ratelimit'].includes(kind.kind)) {
    record('blocked-fetch');
    throw new Error('平台固定資料禁止未知上游');
  }
  record('fixture-fetch', { kind: kind.kind });
  if (init?.signal?.aborted) throw init.signal.reason;
  return fixture.fixtureResponse(kind, null, { commands: kind.kind === 'ratelimit' ? fixture.countRedisCommands(init?.body) : null });
};
// eslint-disable-next-line no-undef
const EXTRA_EVENTS = typeof __DIAG_EXTRA_EVENTS__ !== 'undefined' && __DIAG_EXTRA_EVENTS__ === true;
module.exports.wrap = handler => async (req, res) => {
  const header = req.headers['x-perf03-trace'];
  const trace = typeof header === 'string' && /^[a-z0-9-]{1,90}$/.test(header) ? header : 'unlabelled';
  return context.run({ trace }, async () => {
    record('handler-start', { extraEvents: EXTRA_EVENTS });
    req.once('aborted', () => record('request-aborted'));
    res.once('close', () => record('response-close', { finished: res.writableFinished }));
    res.once('finish', () => record('response-finish'));
    if (EXTRA_EVENTS) {
      req.on('error', error => record('DEBUG-c4n1 request-error', { message: String(error?.message ?? error), code: error?.code ?? null }));
      req.once('close', () => record('DEBUG-c4n1 request-close', { destroyed: req.destroyed, complete: req.complete }));
      res.on('error', error => record('DEBUG-c4n1 response-error', { message: String(error?.message ?? error), code: error?.code ?? null }));
    }
    try { await handler(req, res); }
    finally { record('handler-return'); }
  });
};
