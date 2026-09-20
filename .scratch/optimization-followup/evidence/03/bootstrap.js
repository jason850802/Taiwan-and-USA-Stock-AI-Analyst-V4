// 只在第 03 票專屬假站隔離儲存／時鐘，產品 build 不含此檔。
(() => {
  if (location.origin !== 'http://127.0.0.1:4177') throw new Error('非驗收 origin');
  localStorage.clear(); sessionStorage.clear();
  const OriginalDate = Date;
  let now = OriginalDate.parse('2026-09-20T04:00:00Z');
  window.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  window.fixtureAdvance = ms => { now += ms; };
  window.fixtureResponses = [];
  const nativeFetch = window.fetch.bind(window);
  let requestId = 0;
  window.fetch = async (input, init) => {
    if (typeof input === 'string') {
      const url = new URL(input, location.origin);
      // 避免瀏覽器同 URL 排程合併，讓新舊 force 回應可獨立釋放。
      if (url.origin === location.origin && url.pathname === '/api/yahoo/chart') {
        url.searchParams.set('__fixtureRequest', String(++requestId));
        input = url.toString();
      }
    }
    const response = await nativeFetch(input, init);
    const group = response.headers.get('X-Fixture-Group');
    if (group) {
      const read = response.json.bind(response);
      response.json = async () => {
        try { return await read(); }
        finally { window.fixtureResponses.push({ group, status: response.status }); }
      };
    }
    return response;
  };
  const params = new URL(location.href).searchParams;
  if (params.get('suite') === 'green') {
    import('/__fixture/browser-cases.mjs').then(async ({ caseNames, runCase }) => {
      const index = Number(params.get('case') || 0);
      if (!Number.isInteger(index) || !caseNames[index]) throw new Error('驗收索引無效');
      const result = await runCase(caseNames[index]);
      document.title = `03 ${result.name}: ${result.passed ? 'PASS' : 'FAIL'}`;
      if (result.passed && index + 1 < caseNames.length) location.search = `?suite=green&case=${index + 1}`;
    }).catch(error => { document.title = `03 驗收工具錯誤：${error.message}`; });
  }
})();
