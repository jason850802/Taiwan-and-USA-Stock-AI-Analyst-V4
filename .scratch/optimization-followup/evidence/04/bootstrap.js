// 僅清理 04 專屬 origin；固定時鐘並在 HTTP 邊界觀察回應。
(() => {
  if (location.origin !== 'http://127.0.0.1:4178') throw new Error('非 04 驗收站');
  localStorage.clear();
  sessionStorage.clear();
  const OriginalDate = Date;
  let now = OriginalDate.parse('2026-09-20T04:00:00Z');
  window.fixtureSetTime = value => { now = OriginalDate.parse(value); };
  window.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  window.fixtureLots = [
    { id: 'fixture-us', symbol: 'AAPL', totalShares: 10, avgCostPrice: 320, totalCost: 3200, cashDividends: 0, stockDividends: 0, purchaseCurrency: 'TWD', exchangeRate: 32 },
    { id: 'fixture-tw', symbol: '2330.TW', totalShares: 1, avgCostPrice: 100, totalCost: 100, cashDividends: 0, stockDividends: 0 },
  ];
  if (new URLSearchParams(location.search).get('lots') === 'us') window.fixtureLots = window.fixtureLots.slice(0, 1);
  if (location.pathname === '/') localStorage.setItem('portfolio_items', JSON.stringify(window.fixtureLots));
  const nativeFetch = fetch.bind(window);
  window.fixtureReady = nativeFetch('/__fixture/reset', { method: 'POST', body: '{}' }).then(response => {
    if (!response.ok) throw new Error('上一案例尚有未釋放請求');
  });
  let sequence = 0;
  window.fixtureResponses = [];
  window.fixtureErrors = [];
  window.addEventListener('error', event => window.fixtureErrors.push(String(event.message)));
  window.addEventListener('unhandledrejection', event => window.fixtureErrors.push(String(event.reason)));
  window.fetch = async (...args) => {
    const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.origin);
    if (url.origin !== location.origin) throw new Error('禁止外部驗收請求');
    if (url.pathname === '/api/yahoo/chart') {
      url.searchParams.set('__fixtureRequest', String(++sequence));
      args[0] = url.href;
    }
    const response = await nativeFetch(...args);
    const group = response.headers.get('X-Fixture-Group');
    if (group) {
      const json = response.json.bind(response);
      response.json = async () => {
        try { return await json(); }
        finally { window.fixtureResponses.push({ group, status: response.status }); }
      };
    }
    return response;
  };
  const params = new URLSearchParams(location.search);
  if (params.has('appcase')) import('/__fixture/browser-cases.mjs').then(async ({ runAppCase }) => {
    await window.fixtureReady;
    const result = await runAppCase(params.get('appcase'));
    document.title = `04 ${result.name}: ${result.passed ? 'PASS' : 'FAIL'}`;
  }).catch(error => { document.title = `04 App 驗收錯誤：${error.message}`; });
  if (params.has('suite')) import('/__fixture/browser-cases.mjs').then(async ({ runCase, caseNames }) => {
    await window.fixtureReady;
    const stage = params.get('suite');
    const index = Number(params.get('case') || 0);
    const result = await runCase(caseNames[index], stage);
    document.title = `04 ${result.name}: ${result.passed ? 'PASS' : 'FAIL'}`;
    if (result.passed && stage === 'green' && index + 1 < caseNames.length) location.search = `?suite=green&case=${index + 1}`;
  }).catch(error => { document.title = `04 驗收工具錯誤：${error.message}`; });
})();
