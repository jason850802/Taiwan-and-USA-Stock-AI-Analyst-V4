'use strict';
// 僅打包到本票 Preview 的後端測試注入；產品來源不 import，沒有真上游或真 CLI fallback。
const { AsyncLocalStorage } = require('node:async_hooks');
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const { performance } = require('node:perf_hooks');
const fixture = require('./trace-preload.cjs');
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
  return fixture.createFakeCli({ args, ai: { intervalMs: 600, deltas: 5 }, record, trace: context.getStore()?.trace ?? null });
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
module.exports.wrap = handler => async (req, res) => {
  const header = req.headers['x-perf03-trace'];
  const trace = typeof header === 'string' && /^[a-z0-9-]{1,90}$/.test(header) ? header : 'unlabelled';
  return context.run({ trace }, async () => {
    record('handler-start');
    req.once('aborted', () => record('request-aborted'));
    res.once('close', () => record('response-close', { finished: res.writableFinished }));
    res.once('finish', () => record('response-finish'));
    try { await handler(req, res); }
    finally { record('handler-return'); }
  });
};
