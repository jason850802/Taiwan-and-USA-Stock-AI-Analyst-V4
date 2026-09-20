// 專屬 origin 的合成持股、時鐘與外部 HTTP 邊界觀測。
(() => {
  if (location.origin !== 'http://127.0.0.1:4179') throw new Error('非 05 假站');
  localStorage.clear(); sessionStorage.clear();
  const BaseDate = Date;
  window.Date = class extends BaseDate { constructor(...args) { super(...(args.length ? args : [BaseDate.parse('2026-09-20T04:00:00Z')])); } static now() { return BaseDate.parse('2026-09-20T04:00:00Z'); } };
  const params = new URLSearchParams(location.search);
  window.fixtureLots = Array.from({ length: Number(params.get('n') || 30) }, (_, i) => ({ id: `fake-${i}`, symbol: `TEST${String(i).padStart(3, '0')}`, totalShares: 1, avgCostPrice: 50, totalCost: 1600, cashDividends: 0, stockDividends: 0, purchaseCurrency: 'USD', totalCostUSD: 50, exchangeRate: 32 }));
  if (params.has('duplicate')) window.fixtureLots.push({ ...window.fixtureLots[0], id: 'fake-duplicate' });
  if (location.pathname === '/') localStorage.setItem('portfolio_items', JSON.stringify(window.fixtureLots));
  window.fixtureErrors = []; window.addEventListener('error', e => window.fixtureErrors.push(e.message)); window.addEventListener('unhandledrejection', e => window.fixtureErrors.push(String(e.reason)));
  window.fixtureConsole = [];
  window.fixtureHttpErrors = [];
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      window.fixtureConsole.push({ level, message: args.map(value => value instanceof Error ? value.message : String(value)).join(' ') });
      original(...args);
    };
  }
  const nativeFetch = fetch.bind(window);
  window.fixtureReady = nativeFetch('/__fixture/reset', { method: 'POST', body: JSON.stringify({ delay: Number(params.get('delay') || 80) }) }).then(r => { if (!r.ok) throw new Error('前案未結束'); });
  let seq = 0;
  window.fixtureRequests = [];
  window.fixtureTiming = {};
  const observe = () => {
    const output = document.getElementById('state');
    if (!output) return;
    const value = JSON.parse(output.textContent);
    const settled = Object.values(value.prices).filter(p => !p.loading);
    if (settled.length && window.fixtureTiming.firstVisible === undefined) window.fixtureTiming.firstVisible = performance.now();
    if (settled.length === new Set(value.items.map(i => i.symbol)).size && value.usdTwdRate > 0 && window.fixtureTiming.allVisible === undefined) window.fixtureTiming.allVisible = performance.now();
  };
  new MutationObserver(observe).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.fetch = async (...args) => {
    const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.origin);
    if (url.origin !== location.origin) throw new Error('禁止外連');
    if (url.pathname === '/api/yahoo/chart') { url.searchParams.set('__fixtureRequest', String(++seq)); args[0] = url.href; }
    if (url.pathname.startsWith('/api')) await window.fixtureReady;
    if (url.pathname === '/api/yahoo/chart' && url.searchParams.get('range') === '5d' && window.fixtureTiming.start === undefined) window.fixtureTiming.start = performance.now();
    const response = await nativeFetch(...args);
    if (!response.ok && url.pathname.startsWith('/api')) window.fixtureHttpErrors.push({ url: url.pathname + url.search, status: response.status,
      expected: url.pathname === '/api/yahoo/chart' && url.searchParams.get('symbol') === 'TEST005' && response.status === 503 });
    return response;
  };
  if (params.has('suite')) import('/__fixture/cases.mjs').then(({ run }) => run()).catch(e => { document.title = `05 ERROR ${e.message}`; });
})();
