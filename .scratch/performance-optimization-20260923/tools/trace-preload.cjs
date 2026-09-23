'use strict';
// 01 票計時探針：只由 b1-breakdown.mjs 以 NODE_OPTIONS=--require 注入 vercel dev；
// 未設 PERF01_TRACE_DIR 時完全不作用（被 require 也只輸出純函式供自測）。
// 原則：
// - 每個程序只用自己的 performance.now()（單調時鐘）算區間；跨程序只用 trace ID 連結，不相減時間戳。
// - 不記完整上游 URL、cookie、crumb、token、header 值或秘密環境變數；只記分類、symbol、公開查詢參數，
//   以及 vercel dev 傳給子程序的 VERCEL_DEV_ENTRYPOINT（函式路由路徑，例如 api/yahoo/chart.ts）。
// - 固定上游（PERF01_FIXTURE=1）只在 vercel dev 的函式子程序生效，並擋下所有非預期 outbound。

const ROUTE_PARAMS = ['symbol', 'interval', 'range', 'dataset', 'data_id'];

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
  if (host.includes('upstash')) return { kind: 'ratelimit' };
  return { kind: 'other', host };
}

// 固定上游 payload：同 symbol 永遠同一份內容，讓 before／after 可逐字比對。
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

function install(traceDir) {
  const fs = require('fs');
  const path = require('path');
  const http = require('http');
  const childProcess = require('child_process');
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
  const fixtureDelayMs = Number(process.env.PERF01_FIXTURE_DELAY_MS || 50);
  const file = path.join(traceDir, `${role}-${process.pid}.jsonl`);
  const als = new AsyncLocalStorage();
  const now = () => Math.round(performance.now() * 1000) / 1000;
  const record = (ev, data) => {
    fs.appendFileSync(file, `${JSON.stringify({ ev, t: now(), pid: process.pid, ...data })}\n`);
  };

  if (isChild) {
    record('child.boot', {
      entry: process.env.VERCEL_DEV_ENTRYPOINT,
      fixture: fixtureOn,
      fixtureDelayMs: fixtureOn ? fixtureDelayMs : null,
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
    record(`${role}.recv`, { trace, layer, method: req.method, route: routeOf(req.url) });
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
        const known = ['yahoo-cookie', 'yahoo-crumb', 'yahoo-chart', 'finmind'].includes(cls.kind);
        if (!known) {
          record('child.fetchBlocked', base);
          throw new Error(`perf01 固定上游拒絕非預期 outbound：${cls.kind}`);
        }
        const waitStart = now();
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, fixtureDelayMs);
          init?.signal?.addEventListener?.('abort', () => {
            clearTimeout(timer);
            reject(init.signal.reason);
          }, { once: true });
        });
        const fixtureWaitMs = Math.round((now() - waitStart) * 1000) / 1000;
        let response;
        if (cls.kind === 'yahoo-cookie') {
          response = new Response('', { status: 200, headers: [['set-cookie', 'A1=perf01-fixture; Path=/']] });
        } else if (cls.kind === 'yahoo-crumb') {
          response = new Response('perf01-fixture-crumb', { status: 200 });
        } else if (cls.kind === 'yahoo-chart') {
          response = Response.json(fixtureChartBody(cls.symbol));
        } else {
          response = Response.json(fixtureFinMindBody(cls.dataset, cls.dataId));
        }
        record('child.fetchHeaders', { ...base, status: response.status, fixture: true, fixtureWaitMs });
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

module.exports = { classifyUrl, routeOf, fixtureChartBody, fixtureFinMindBody };
