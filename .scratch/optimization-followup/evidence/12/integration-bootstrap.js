// 僅在隔離假站收集尺寸、原生輸入及錯誤；所有應用請求仍走原有假HTTP邊界。
(() => {
  if (!/^http:\/\/127\.0\.0\.1:417[6-9]$/.test(location.origin)) throw new Error('整合觀察只能在專屬origin執行');
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
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.origin !== location.origin) throw new Error('驗收禁止外部fetch');
    if (url.pathname === '/__fixture/result' && options?.body) {
      const payload = JSON.parse(options.body);
      payload.result.integrationBrowser = snapshot();
      options = { ...options, body: JSON.stringify(payload) };
    }
    const response = await oldFetch(input, options);
    if (!response.ok) failures.push({ path: url.pathname, query: url.search, status: response.status });
    return response;
  };
  window.integrationAudit = { snapshot, resetKeys: () => { keys.length = 0; } };
})();
