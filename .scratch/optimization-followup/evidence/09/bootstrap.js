// 09/12專屬測試站；所有合成串流仍經真正服務的NDJSON解碼與AI快取路徑。
(() => {
  if (location.origin !== 'http://127.0.0.1:4182') throw new Error('非串流驗收origin');
  const params = new URL(location.href).searchParams;
  const NativeDate = Date;
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [NativeDate.parse('2026-09-20T04:00:00Z')])); }
    static now() { return NativeDate.parse('2026-09-20T04:00:00Z'); }
  };
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('portfolio_items', JSON.stringify(['AAPL', 'MSFT'].map((symbol, index) => ({ id: `stream-fixture-${index}`, symbol, totalShares: 10,
    totalCost: 3200, avgCostPrice: 10, totalCostUSD: 100, purchaseCurrency: 'USD', exchangeRate: 32, cashDividends: 0, stockDividends: 0 }))));
  localStorage.setItem('portfolio_realized_trades_v1', '{"version":1,"trades":[]}');
  const messages = new MessageChannel();
  const waiting = [];
  messages.port1.onmessage = () => waiting.shift()?.();
  const turn = () => new Promise(resolve => { waiting.push(resolve); messages.port2.postMessage(null); });
  const nativeRaf = requestAnimationFrame.bind(window);
  const nativeCancel = cancelAnimationFrame.bind(window);
  let frame = 0, heldFrame = -1;
  function countFrame() { frame++; nativeRaf(countFrame); }
  nativeRaf(countFrame);
  const fixture = window.streamFixture = {
    plans: [], streams: [], errors: [], commits: [], renders: [], currentFrame: () => frame,
    holdFrames: false, heldFrames: new Map(), lastContent: null, turn,
    releaseFrames() {
      const queued = [...this.heldFrames.values()]; this.heldFrames.clear(); this.holdFrames = false;
      queued.forEach(callback => callback(performance.now()));
    },
    render(content, duration, phase) {
      if (this.observing) {
        this.renders.push({ duration, phase, frame, time: performance.now() });
        if (content !== this.lastContent) {
          this.lastContent = content;
          this.commits.push({ chars: content.length, frame, time: performance.now() });
        }
      }
    },
    resetMetrics() { this.observing = true; this.lastContent = null; this.commits = []; this.renders = []; },
  };
  // 只在明確故障場景扣住動畫影格；完成仍須以一般React提交顯示全文。
  window.requestAnimationFrame = callback => {
    if (!fixture.holdFrames) return nativeRaf(callback);
    const id = heldFrame--; fixture.heldFrames.set(id, callback); return id;
  };
  window.cancelAnimationFrame = id => { if (id < 0) fixture.heldFrames.delete(id); else nativeCancel(id); };
  addEventListener('error', event => fixture.errors.push(String(event.message)));
  addEventListener('unhandledrejection', event => fixture.errors.push(String(event.reason)));
  const nativeError = console.error.bind(console);
  console.error = (...args) => {
    fixture.errors.push(`console.error: ${args.map(String).join(' ')}`);
    nativeError(...args);
  };
  const nativeFetch = fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.origin !== location.origin) throw new Error('禁止外部請求');
    if (url.pathname !== '/api/gemini-stream') return nativeFetch(input, init);
    const plan = fixture.plans.shift() || {};
    const state = { id: fixture.streams.length, tag: plan.tag || 'PRIMARY', deltas: 0, startedAt: performance.now(), delivered: '', doneAt: null, held: false };
    fixture.streams.push(state);
    url.searchParams.set('tag', state.tag);
    url.searchParams.set('mode', plan.mode || 'full');
    const response = await nativeFetch(url, init);
    if (!response.ok) return response;
    const lines = (await response.text()).split('\n').filter(Boolean);
    let index = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async pull(controller) {
        if (index >= lines.length) { state.doneAt = performance.now(); controller.close(); return; }
        if (Number.isInteger(plan.holdAt) && state.deltas === plan.holdAt && !state.released) {
          state.held = true;
          await new Promise(resolve => { state.release = () => { state.released = true; state.held = false; resolve(); }; });
        }
        if (plan.slow) await new Promise(resolve => setTimeout(resolve, 25));
        else await turn();
        const line = lines[index++];
        const event = JSON.parse(line);
        if (event.t === 'delta') { state.deltas++; state.delivered += event.text; }
        controller.enqueue(encoder.encode(line + '\n'));
      },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  };
  if (params.has('auto')) import(params.has('edge') ? '/__fixture/edge-cases.mjs' : '/__fixture/cases.mjs').then(({ run }) => run()).catch(error => { document.title = `09工具錯誤：${error.message}`; });
})();
