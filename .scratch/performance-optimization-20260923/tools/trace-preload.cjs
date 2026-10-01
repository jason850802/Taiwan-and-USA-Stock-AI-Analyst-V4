'use strict';
// 01／02 票計時探針：只由本案 runner／比對工具以 NODE_OPTIONS=--require 注入 vercel dev；
// 未設 PERF01_TRACE_DIR 時完全不作用（被 require 也只輸出純函式供自測）。
// 原則：
// - 每個程序只用自己的 performance.now()（單調時鐘）算區間；跨程序只用 trace ID 連結，不相減時間戳。
// - 不記完整上游 URL、cookie、crumb、token、秘密 header 值或秘密環境變數；只記分類、symbol、公開查詢參數、
//   handler 實際收到的非秘密 header，以及 vercel dev 傳給子程序的 VERCEL_DEV_ENTRYPOINT（函式路由路徑）。
// - 固定上游（PERF01_FIXTURE=1）只在函式子程序生效：Yahoo／FinMind／Upstash 限流改回固定 payload（可由控制檔
//   腳本化狀態、延遲與時鐘位移），其他 outbound 一律拒絕，並在網路層封鎖非本機連線。
// - 真 AI 紅線：函式子程序內任何「看起來像 claude CLI」的 spawn 都不會啟動真程序——固定上游模式改回假 CLI，
//   真上游量測模式直接拒絕。

const ROUTE_PARAMS = ['symbol', 'interval', 'range', 'dataset', 'data_id'];
// handler 端 header 快照：這些值會被 guard／限流讀取，兩個入口必須一致；都不是秘密。
const SNAPSHOT_HEADERS = [
  'host', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-forwarded-for', 'x-real-ip',
  'x-vercel-forwarded-for', 'x-vercel-deployment-url', 'origin', 'referer', 'content-type', 'content-length',
  'transfer-encoding', 'connection', 'accept', 'user-agent',
];
// 只記「有沒有」，絕不記值。
const PRESENCE_ONLY_HEADERS = ['x-proxy-secret', 'cookie', 'authorization'];

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

// 瀏覽器端路由只留路徑與公開參數，避免把未來可能出現的敏感 query 寫進證據。
function routeOf(rawUrl) {
  try {
    const url = new URL(rawUrl || '/', 'http://local');
    const kept = ROUTE_PARAMS
      .filter(key => url.searchParams.has(key))
      .map(key => `${key}=${url.searchParams.get(key)}`);
    return kept.length ? `${url.pathname}?${kept.join('&')}` : url.pathname;
  } catch {
    return 'unparsable';
  }
}

// 上游 outbound 分類：crumb 與 FinMind token 都在 query，因此一律不回傳原始 URL。
function classifyUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'unparsable' };
  }
  const host = url.hostname.toLowerCase();
  if (host === 'fc.yahoo.com') return { kind: 'yahoo-cookie' };
  if (host.endsWith('finance.yahoo.com')) {
    if (url.pathname === '/v1/test/getcrumb') return { kind: 'yahoo-crumb' };
    const chart = url.pathname.match(/^\/v8\/finance\/chart\/([^/]+)$/);
    if (chart) {
      return {
        kind: 'yahoo-chart',
        symbol: decodeURIComponent(chart[1]),
        interval: url.searchParams.get('interval'),
        range: url.searchParams.get('range'),
      };
    }
    if (url.pathname.startsWith('/v1/finance/search')) return { kind: 'yahoo-search' };
    return { kind: 'yahoo-other' };
  }
  if (host === 'api.finmindtrade.com') {
    return {
      kind: 'finmind',
      dataset: url.searchParams.get('dataset'),
      dataId: url.searchParams.get('data_id'),
    };
  }
  // Upstash REST：auto-pipelining 把同一輪的指令合併送到 /pipeline（回應是陣列）。
  if (host.includes('upstash')) return { kind: 'ratelimit', pipeline: /\/(pipeline|multi-exec)$/.test(url.pathname) };
  return { kind: 'other', host };
}

// Upstash REST body：pipeline 是「指令陣列的陣列」，單一指令是字串陣列；只數指令數，不記內容（含 IP）。
function countRedisCommands(body) {
  try {
    const parsed = JSON.parse(typeof body === 'string' ? body : '');
    return Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed.length : 1;
  } catch {
    return 1;
  }
}

// handler 收到的 header：白名單記值、秘密類只列出「存在的名稱」、全部 header 名稱排序後另存。
function snapshotHeaders(headers) {
  const values = {};
  for (const name of SNAPSHOT_HEADERS) {
    if (headers[name] !== undefined) values[name] = Array.isArray(headers[name]) ? headers[name].join(',') : String(headers[name]);
  }
  const sensitivePresent = PRESENCE_ONLY_HEADERS.filter(name => headers[name] !== undefined);
  return { names: Object.keys(headers).map(name => name.toLowerCase()).sort(), values, sensitivePresent };
}

// 看起來像 claude CLI 的 spawn：執行檔名是 claude，或參數是 CLI 的 -p／--output-format 組合。
function looksLikeClaude(command, args) {
  const base = String(command ?? '').split(/[\\/]/).pop().toLowerCase();
  if (base === 'claude' || base === 'claude.exe' || base === 'claude.cmd') return true;
  const list = Array.isArray(args) ? args.map(String) : [];
  return list[0] === '-p' && list.includes('--output-format');
}

function isLoopbackHost(host) {
  if (host === undefined || host === null || host === '') return true;
  const value = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost' || value === '::1' || value === '::ffff:127.0.0.1' || /^127\./.test(value);
}

// 控制檔腳本：同一 version 的每種 outbound 依序消耗 steps；換 version 即重新計數。
// 有 `<kind>:<symbol>` 腳本時該 symbol 只吃自己的步驟：每請求一程序（B1）與共用程序（候選）
// 才會對同一支請求給出同一串回應，併發案例可以直接比對。
function pickScriptStep(control, consumed, kind, symbol = null) {
  const scoped = symbol ? `${kind}:${symbol}` : null;
  const name = scoped && control?.script?.[scoped] ? scoped : kind;
  const steps = control?.script?.[name] ?? [];
  const key = `${control?.version ?? ''}:${name}`;
  const used = consumed.get(key) ?? 0;
  if (used >= steps.length) return null;
  consumed.set(key, used + 1);
  return steps[used];
}

// 固定上游 payload：同 symbol 永遠同一份內容，讓兩個入口可逐字比對。
function fixtureChartBody(symbol) {
  let seed = 0;
  for (const ch of symbol) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
  const base = 50 + (seed % 900);
  const timestamps = [1789803000, 1789889400, 1789975800, 1790062200, 1790148600];
  const close = timestamps.map((_, i) => Number((base + i * 0.5).toFixed(2)));
  const isTw = /\.TWO?$/.test(symbol);
  return {
    chart: {
      result: [{
        meta: {
          currency: symbol.endsWith('=X') ? 'TWD' : (isTw ? 'TWD' : 'USD'),
          symbol,
          exchangeTimezoneName: isTw ? 'Asia/Taipei' : 'America/New_York',
          regularMarketPrice: close[close.length - 1],
          longName: `FIXTURE ${symbol}`,
          shortName: `FIXTURE ${symbol}`,
        },
        timestamp: timestamps,
        indicators: {
          quote: [{
            open: close.map(v => v - 0.25),
            high: close.map(v => v + 1),
            low: close.map(v => v - 1),
            close,
            volume: close.map((_, i) => 1000 + i),
          }],
          adjclose: [{ adjclose: close }],
        },
      }],
      error: null,
    },
  };
}

function fixtureFinMindBody(dataset, dataId) {
  // 03 票正式 App 固定資料：名錄請求不帶 data_id，需回可搜尋的台股代號。
  // 原 01／02 探針與產品邏輯不受影響；每頁仍用全新 origin 避免快取污染。
  if (process.env.PERF03_TEST_APP === '1' && dataset === 'TaiwanStockInfo' && !dataId) {
    return {
      msg: 'success', status: 200,
      data: [
        { stock_id: '2330', stock_name: '固定資料台積電', industry_category: '半導體業', type: 'twse' },
        { stock_id: '0050', stock_name: '固定資料元大台灣50', industry_category: 'ETF', type: 'twse' },
        { stock_id: '2317', stock_name: '固定資料鴻海', industry_category: '其他電子業', type: 'twse' },
      ],
    };
  }
  return {
    msg: 'success',
    status: 200,
    data: [{
      dataset,
      stock_id: dataId || '0000',
      stock_name: `FIXTURE ${dataId || ''}`.trim(),
      industry_category: 'FIXTURE',
      type: 'twse',
      date: '2026-09-19',
    }],
  };
}

function fixtureSearchBody() {
  return { quotes: [{ symbol: '2330.TW', shortname: 'FIXTURE 2330', exchange: 'TAI', quoteType: 'EQUITY' }], news: [] };
}

// 依 outbound 種類與腳本步驟組出固定回應；step 可指定 status／body 變體。
// request.commands：Upstash pipeline 這一批有幾個指令（每個指令回一筆結果）。
function fixtureResponse(cls, step, request = {}) {
  const status = step?.status ?? 200;
  switch (cls.kind) {
    case 'ratelimit': {
      // 假 Upstash：sliding window 腳本回 [剩餘額度, 上限]，剩餘 < 0 即超限；status ≥ 400 模擬服務故障
      // （Upstash client 對 HTTP 錯誤不重試，直接拋錯，限流器 fail-open）。
      if (status >= 400) return Response.json({ error: 'ERR perf02 fixture unavailable' }, { status });
      const result = [step?.remaining ?? 59, 60];
      return cls.pipeline
        ? Response.json(Array.from({ length: request.commands ?? 1 }, () => ({ result })), { status })
        : Response.json({ result }, { status });
    }
    case 'yahoo-cookie':
      return step?.body === 'noCookie'
        ? new Response('', { status })
        : new Response('', { status, headers: [['set-cookie', 'A1=perf01-fixture; Path=/']] });
    case 'yahoo-crumb':
      return new Response(step?.body === 'empty' ? '' : 'perf01-fixture-crumb', { status });
    case 'yahoo-chart':
      if (step?.body === 'notFound') {
        return Response.json({ chart: { result: null, error: { code: 'Not Found', description: 'FIXTURE' } } }, { status: 404 });
      }
      if (status >= 400) return Response.json({ chart: { result: null, error: { code: 'FIXTURE Error' } } }, { status });
      return Response.json(fixtureChartBody(cls.symbol), { status });
    case 'yahoo-search':
      return Response.json(fixtureSearchBody(), { status });
    default:
      if (step?.body === 'limit') return Response.json({ msg: 'Requests reach the upper limit.', status }, { status });
      if (status >= 400) return Response.json({ msg: 'FIXTURE error', status }, { status });
      return Response.json(fixtureFinMindBody(cls.dataset, cls.dataId), { status });
  }
}

// 假 CLI 的出口：success 正常；isError／authError 的 result 帶 is_error（後者是登入過期訊息）；
// noResult 吐完片段就異常結束、沒有 result；spawnError 啟動即失敗（先 error 再 close）。
const FAKE_CLI_MODES = ['success', 'isError', 'authError', 'noResult', 'spawnError'];

// 假 claude CLI：依 stream-json／json 兩種模式吐出 CLI 格式；kill() 記錄當下已吐幾段並立刻結束。
function createFakeCli({ args, ai = {}, record = () => {}, trace = null }) {
  const { EventEmitter } = require('events');
  const { PassThrough, Writable } = require('stream');
  const mode = FAKE_CLI_MODES.includes(ai.mode) ? ai.mode : 'success';
  const streaming = Array.isArray(args) && args.includes('stream-json');
  const deltas = Number.isInteger(ai.deltas) ? ai.deltas : 5;
  const intervalMs = Number.isFinite(ai.intervalMs) ? ai.intervalMs : 200;
  const pieces = Array.from({ length: deltas }, (_, i) => `假片段${i + 1}`);
  const cli = new EventEmitter();
  cli.pid = undefined;
  cli.stdout = new PassThrough();
  cli.stderr = new PassThrough();
  let promptBytes = 0;
  cli.stdin = new Writable({
    write(chunk, _encoding, callback) {
      promptBytes += chunk.length;
      callback();
    },
    final(callback) {
      record('child.fakeCli.stdin', { trace, promptBytes });
      callback();
    },
  });
  let emitted = 0;
  let finished = false;
  let killed = false;
  let timer = null;
  const finish = code => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    cli.stdout.end();
    cli.stderr.end();
    setImmediate(() => {
      cli.emit('exit', code, killed ? 'SIGTERM' : null);
      cli.emit('close', code, killed ? 'SIGTERM' : null);
    });
  };
  const writeOutcome = () => {
    if (mode === 'noResult') {
      cli.stderr.write('perf02 假 CLI 異常結束');
      record('child.fakeCli.done', { trace, emitted, mode });
      finish(1);
      return;
    }
    const failed = mode === 'isError' || mode === 'authError';
    const result = mode === 'authError' ? 'Failed to authenticate（perf02 假登入過期）' : (failed ? 'perf02 假上游錯誤' : pieces.join(''));
    const line = JSON.stringify({ type: 'result', subtype: failed ? 'error_during_execution' : 'success', is_error: failed, result });
    cli.stdout.write(streaming ? `${line}\n` : line);
    record('child.fakeCli.done', { trace, emitted, mode });
    finish(failed ? 1 : 0);
  };
  const step = () => {
    if (killed || finished) return;
    if (streaming && emitted < deltas) {
      cli.stdout.write(`${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text: pieces[emitted] } } })}\n`);
      emitted += 1;
      record('child.fakeCli.delta', { trace, index: emitted });
      timer = setTimeout(step, intervalMs);
      return;
    }
    writeOutcome();
  };
  cli.kill = () => {
    if (finished || killed) return false;
    killed = true;
    record('child.fakeCli.kill', { trace, emitted });
    finish(null);
    return true;
  };
  record('child.fakeCli.spawn', { trace, streaming, deltas, intervalMs, mode });
  if (mode === 'spawnError') {
    // 對應 Node 非同步的 spawn 失敗（例如執行檔不存在）：不吐任何輸出，先 error 再 close。
    setImmediate(() => {
      finished = true;
      const error = Object.assign(new Error('spawn perf02-fake-claude ENOENT'), { code: 'ENOENT', errno: -4058, syscall: 'spawn perf02-fake-claude' });
      record('child.fakeCli.error', { trace, code: error.code });
      cli.emit('error', error);
      cli.stdout.end();
      cli.stderr.end();
      setImmediate(() => cli.emit('close', -4058, null));
    });
    return cli;
  }
  timer = setTimeout(step, streaming ? intervalMs : intervalMs * Math.max(1, deltas));
  return cli;
}

function install(traceDir) {
  const fs = require('fs');
  const path = require('path');
  const http = require('http');
  const net = require('net');
  const tls = require('tls');
  const childProcess = require('child_process');
  const Module = require('module');
  const { AsyncLocalStorage } = require('async_hooks');
  const { performance } = require('perf_hooks');
  const { isMainThread } = require('worker_threads');

  // tsx 的 loader hooks 在獨立 worker thread 執行，NODE_OPTIONS 的 --require 也會在那裡再跑一次；
  // 該 thread 不收請求也不發 outbound，只在主執行緒安裝，避免重複的 boot 事件。
  if (!isMainThread) return;
  const isChild = Boolean(process.env.VERCEL_DEV_ENTRYPOINT);
  const isParent = !isChild
    && /[\\/]vercel[\\/]dist[\\/]vc\.js$/i.test(process.argv[1] || '')
    && process.argv.includes('dev');
  if (!isChild && !isParent) return;

  const role = isChild ? 'child' : 'parent';
  const fixtureOn = isChild && process.env.PERF01_FIXTURE === '1';
  // 03 票取消探針只用假 CLI；給原 handler 一個存在的檔案路徑通過前置檢查，
  // 實際 spawn 仍由下方 perf01Spawn 攔截，絕不執行此路徑。
  if (fixtureOn && process.env.PERF03_TEST_CLI === '1') {
    process.env.CLAUDE_CLI_PATH = process.execPath;
    process.env.LLM_PROVIDER = 'claude-cli';
  }
  const fixtureDelayMs = Number(process.env.PERF01_FIXTURE_DELAY_MS || 50);
  const controlPath = process.env.PERF01_FIXTURE_CONTROL || '';
  const file = path.join(traceDir, `${role}-${process.pid}.jsonl`);
  const als = new AsyncLocalStorage();
  const now = () => Math.round(performance.now() * 1000) / 1000;
  const record = (ev, data) => {
    fs.appendFileSync(file, `${JSON.stringify({ ev, t: now(), pid: process.pid, ...data })}\n`);
  };

  // 控制檔：每支 handler 請求開始前重讀一次；讀不到就維持上一份。
  let control = { version: null };
  const consumed = new Map();
  const refreshControl = () => {
    if (!fixtureOn || !controlPath) return;
    try {
      control = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
    } catch {
      // 控制檔不存在或寫到一半：沿用上一份。
    }
  };
  refreshControl();

  if (isChild) {
    record('child.boot', {
      entry: process.env.VERCEL_DEV_ENTRYPOINT,
      fixture: fixtureOn,
      fixtureDelayMs: fixtureOn ? fixtureDelayMs : null,
      control: Boolean(controlPath),
      ipc: typeof process.send === 'function',
    });
  } else {
    record('parent.boot', {});
  }

  // 請求入口：父程序是 vercel dev 對外埠；子程序第 1 個 listen 是 dev-server 代理埠、第 2 個是 handler 埠。
  let listenSeq = 0;
  const origListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function perf01Listen(...args) {
    listenSeq += 1;
    const seq = listenSeq;
    this.__perf01Seq = seq;
    record(`${role}.listenCall`, { seq });
    this.once('listening', () => record(`${role}.listening`, { seq }));
    return origListen.apply(this, args);
  };

  const origEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function perf01Emit(type, req, res) {
    if (type !== 'request' || !req || !req.headers || !res) return origEmit.apply(this, arguments);
    const trace = firstHeader(req.headers['x-perf01-trace']);
    if (!trace) return origEmit.apply(this, arguments);
    const layer = isParent ? 'entry' : (this.__perf01Seq === 1 ? 'devProxy' : 'handler');
    const ctx = { trace, layer };
    if (layer === 'handler') refreshControl();
    record(`${role}.recv`, { trace, layer, method: req.method, route: routeOf(req.url) });
    if (layer === 'handler') record('child.reqHeaders', { trace, ...snapshotHeaders(req.headers) });
    const origWriteHead = res.writeHead;
    let headSent = false;
    res.writeHead = function perf01WriteHead(...headArgs) {
      if (!headSent) {
        headSent = true;
        record(`${role}.writeHead`, {
          trace,
          layer,
          status: typeof headArgs[0] === 'number' ? headArgs[0] : res.statusCode,
        });
      }
      return origWriteHead.apply(this, headArgs);
    };
    res.once('finish', () => record(`${role}.finish`, { trace, layer }));
    res.once('close', () => {
      if (!res.writableFinished) record(`${role}.aborted`, { trace, layer });
    });
    return als.run(ctx, () => origEmit.apply(this, arguments));
  };

  if (isParent) {
    // 每請求 fork 的函式子程序：記 fork 呼叫、子程序回報就緒、結束。
    const origFork = childProcess.fork;
    childProcess.fork = function perf01Fork(...args) {
      const ctx = als.getStore();
      const startedAt = now();
      const child = origFork.apply(this, args);
      record('parent.fork', {
        trace: ctx?.trace ?? null,
        childPid: child.pid,
        forkCallMs: Math.round((now() - startedAt) * 1000) / 1000,
      });
      child.once('message', () => record('parent.childReady', { trace: ctx?.trace ?? null, childPid: child.pid }));
      child.once('exit', (code, signal) => record('parent.childExit', {
        trace: ctx?.trace ?? null,
        childPid: child.pid,
        code,
        signal,
      }));
      return child;
    };

    // vercel dev 以 http-proxy 把請求轉進子程序；只記在追蹤中的請求。
    const origRequest = http.request;
    http.request = function perf01Request(...args) {
      const ctx = als.getStore();
      const req = origRequest.apply(this, args);
      if (ctx) {
        const options = args.find(arg => arg && typeof arg === 'object' && !(arg instanceof URL));
        record('parent.proxyReq', { trace: ctx.trace, port: options?.port ?? null });
        req.once('response', () => record('parent.proxyRes', { trace: ctx.trace }));
      }
      return req;
    };
  }

  if (isChild) {
    if (typeof process.send === 'function') {
      const origSend = process.send;
      let sent = false;
      process.send = function perf01Send(...args) {
        if (!sent) {
          sent = true;
          record('child.ready', {});
        }
        return origSend.apply(this, args);
      };
    }

    // 真 AI 紅線：claude CLI 的 spawn 永遠不啟動真程序。
    const origSpawn = childProcess.spawn;
    childProcess.spawn = function perf01Spawn(command, args, options) {
      if (!looksLikeClaude(command, args)) return origSpawn.apply(this, arguments);
      const trace = als.getStore()?.trace ?? null;
      if (!fixtureOn) {
        record('child.aiBlocked', { trace });
        throw new Error('perf01 量測模式禁止啟動 claude CLI');
      }
      return createFakeCli({ args, ai: control.ai ?? {}, record, trace });
    };
    // 讓 ESM 的 `import { spawn } from 'node:child_process'` 也拿到包裝後的函式。
    Module.syncBuiltinESMExports();

    if (fixtureOn) {
      // 時鐘位移：讓對等比對不必真的等待，就能驗 Yahoo 握手的 10 分鐘 TTL，並把限流案例對齊到新的限流窗。
      const realDateNow = Date.now;
      Date.now = () => realDateNow() + (Number(control.clockOffsetMs) || 0);

      // 網路層防線：固定上游模式下，非本機的 TCP／TLS 連線一律拒絕（即使有程式繞過 fetch）。
      const guard = (original, kind) => function perf01NetGuard(...args) {
        const first = args[0];
        const host = first && typeof first === 'object' ? (first.host ?? first.hostname) : (typeof args[1] === 'string' ? args[1] : undefined);
        const isPipe = first && typeof first === 'object' ? Boolean(first.path) : typeof first === 'string' && Number.isNaN(Number(first));
        if (!isPipe && !isLoopbackHost(host)) {
          record('child.netBlocked', { kind, host: String(host) });
          throw new Error(`perf01 固定上游模式拒絕非本機連線：${host}`);
        }
        return original.apply(this, args);
      };
      net.connect = guard(net.connect, 'net');
      net.createConnection = guard(net.createConnection, 'net');
      tls.connect = guard(tls.connect, 'tls');
      Module.syncBuiltinESMExports();
    }

    const origFetch = globalThis.fetch;
    let fetchSeq = 0;
    const wrapBody = (response, base) => {
      for (const method of ['json', 'text', 'arrayBuffer']) {
        const original = response[method].bind(response);
        response[method] = async () => {
          const value = await original();
          record('child.fetchBody', base);
          return value;
        };
      }
      return response;
    };
    globalThis.fetch = async function perf01Fetch(input, init) {
      const rawUrl = typeof input === 'string' ? input : (input instanceof URL ? input.href : input?.url);
      const cls = classifyUrl(String(rawUrl));
      const ctx = als.getStore();
      fetchSeq += 1;
      const base = { trace: ctx?.trace ?? null, seq: fetchSeq, ...cls };
      record('child.fetchStart', base);
      if (fixtureOn) {
        const known = ['yahoo-cookie', 'yahoo-crumb', 'yahoo-chart', 'yahoo-search', 'finmind', 'ratelimit'].includes(cls.kind);
        if (!known) {
          record('child.fetchBlocked', base);
          throw new Error(`perf01 固定上游拒絕非預期 outbound：${cls.kind}`);
        }
        const step = pickScriptStep(control, consumed, cls.kind, cls.symbol ?? null);
        const delay = step?.delayMs ?? control.delayMs?.[cls.kind] ?? fixtureDelayMs;
        const waitStart = now();
        try {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, delay);
            init?.signal?.addEventListener?.('abort', () => {
              clearTimeout(timer);
              reject(init.signal.reason);
            }, { once: true });
          });
        } catch (error) {
          record('child.fetchError', { ...base, name: error?.name ?? 'Error', fixture: true });
          throw error;
        }
        const fixtureWaitMs = Math.round((now() - waitStart) * 1000) / 1000;
        const response = fixtureResponse(cls, step, { commands: cls.kind === 'ratelimit' ? countRedisCommands(init?.body) : null });
        record('child.fetchHeaders', { ...base, status: response.status, fixture: true, fixtureWaitMs, scripted: Boolean(step) });
        return wrapBody(response, base);
      }
      try {
        const response = await origFetch.call(this, input, init);
        record('child.fetchHeaders', { ...base, status: response.status, fixture: false });
        return wrapBody(response, base);
      } catch (error) {
        record('child.fetchError', { ...base, name: error?.name ?? 'Error' });
        throw error;
      }
    };
  }
}

if (process.env.PERF01_TRACE_DIR) install(process.env.PERF01_TRACE_DIR);

module.exports = {
  classifyUrl,
  routeOf,
  snapshotHeaders,
  looksLikeClaude,
  isLoopbackHost,
  pickScriptStep,
  countRedisCommands,
  fixtureChartBody,
  fixtureFinMindBody,
  fixtureResponse,
  createFakeCli,
};
