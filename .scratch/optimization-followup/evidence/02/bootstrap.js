// 僅在 02 專屬 loopback origin 清空假資料儲存並固定時鐘。
(() => {
  if (location.origin !== 'http://127.0.0.1:4176') throw new Error('非驗收 origin');
  localStorage.clear();
  sessionStorage.clear();
  const OriginalDate = Date;
  const fixedNow = OriginalDate.parse('2026-09-20T04:00:00Z');
  window.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [fixedNow])); }
    static now() { return fixedNow; }
  };
  // 只觀察 HTTP 回應完成，不讀 React 私有狀態；讓測試等待真實 json 消費完成。
  window.fixtureResponses = [];
  const nativeFetch = window.fetch.bind(window);
  let requestNumber = 0;
  window.fetch = async (...args) => {
    // 假站中讓同代碼的兩次 HTTP 回應可獨立釋放，不被瀏覽器相同 URL 排程合併。
    if (typeof args[0] === 'string') {
      const url = new URL(args[0], location.origin);
      if (url.origin === location.origin && url.pathname === '/api/finmind') {
        url.searchParams.set('__fixtureRequest', String(++requestNumber));
        args[0] = url.toString();
      }
    }
    const response = await nativeFetch(...args);
    const group = response.headers.get('X-Fixture-Group');
    if (group) {
      const originalJson = response.json.bind(response);
      response.json = async () => {
        try { return await originalJson(); }
        finally { window.fixtureResponses.push({ group, status: response.status }); }
      };
    }
    return response;
  };
  // 每個案例重新載入整個正式 App，避免上個案例的元件或服務快取留在記憶體。
  const params = new URL(location.href).searchParams;
  if (params.get('suite') === 'green') {
    import('/__fixture/browser-cases.mjs').then(async ({ caseNames, runCase }) => {
      const index = Number(params.get('case') || 0);
      if (!Number.isInteger(index) || !caseNames[index]) throw new Error('驗收案例索引無效');
      const result = await runCase(caseNames[index]);
      document.title = `02 ${result.name}: ${result.passed ? 'PASS' : 'FAIL'}`;
      if (result.passed && index + 1 < caseNames.length) location.search = `?suite=green&case=${index + 1}`;
    }).catch(error => { document.title = `02 驗收工具錯誤：${error.message}`; });
  }
})();
