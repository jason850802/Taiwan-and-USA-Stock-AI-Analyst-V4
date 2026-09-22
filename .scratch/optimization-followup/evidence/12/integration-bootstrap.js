// 僅在隔離假站收集尺寸、原生輸入及錯誤；所有應用請求仍走原有假HTTP邊界。
(() => {
  if (!/^http:\/\/127\.0\.0\.1:417[6-9]$/.test(location.origin)) throw new Error('整合觀察只能在專屬origin執行');
  const element = document.getElementById('p1-replay-binding');
  if (!element) throw new Error('缺本頁初載執行身分，禁止退回metadata認領新輪');
  const binding = JSON.parse(element.textContent);
  const bootstrapHash = binding.toolHashes?.['.scratch/optimization-followup/evidence/12/integration-bootstrap.js'];
  const expectedPath = `/__integration/${binding.runId}/${bootstrapHash}.js`;
  if (binding.schema !== 'p1-replay-v1' || new URL(document.currentScript.src).pathname !== expectedPath) throw new Error('頁面／bootstrap版本不符');
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(binding);
  const errors = [], warnings = [], failures = [], keys = [];
  const capture = (kind, value) => kind.push(String(value?.stack || value));
  addEventListener('error', event => { if (event.error) capture(errors, event.error); });
  addEventListener('unhandledrejection', event => capture(errors, event.reason));
  const originalError = console.error.bind(console), originalWarn = console.warn.bind(console);
  console.error = (...args) => { capture(errors, args.join(' ')); originalError(...args); };
  console.warn = (...args) => { capture(warnings, args.join(' ')); originalWarn(...args); };
  addEventListener('keydown', event => keys.push({ key: event.key, trusted: event.isTrusted,
    tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.slice(0, 80) }), true);
  const snapshot = () => ({ pathname: location.pathname, search: location.search, browser: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
    errors: [...errors], warnings: [...warnings], failures: [...failures], nativeKeys: [...keys] });
  const oldFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
    if (url.origin !== location.origin) throw new Error('驗收禁止外部fetch');
    if (url.pathname === '/__fixture/result') {
      if (typeof options?.body !== 'string') throw new Error('結果必須提供明確JSON本文');
      const payload = JSON.parse(options.body);
      if (!payload.result || payload.result.integration || payload.result.replayCase || payload.result.integrationBrowser) throw new Error('拒絕替既有raw重貼本輪身分');
      payload.result.integration = binding;
      payload.result.integrationBrowser = snapshot();
      const headers = new Headers(options.headers);
      headers.set('X-Replay-Run', binding.runId);
      options = { ...options, headers, body: JSON.stringify(payload) };
    }
    const response = await oldFetch(input, options);
    if (!response.ok) failures.push({ path: url.pathname, query: url.search, status: response.status });
    return response;
  };
  window.integrationAudit = { snapshot, resetKeys: () => { keys.length = 0; } };
})();
