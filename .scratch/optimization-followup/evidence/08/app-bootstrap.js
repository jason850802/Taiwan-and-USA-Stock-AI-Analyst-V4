// 本檔只在隔離origin執行；正式 App 仍使用自己的服務、狀態與儲存程式。
(() => {
  if (location.origin !== 'http://127.0.0.1:4181') throw new Error('非08驗收站');
  const OriginalDate = Date;
  window.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [OriginalDate.parse('2026-09-20T04:00:00Z')])); } static now() { return OriginalDate.parse('2026-09-20T04:00:00Z'); } };
  const ss = sessionStorage;
  localStorage.clear(); ss.clear();
  const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
  const protectedKeys = ['portfolio_items', 'portfolio_transactions_v1', 'portfolio_import_log_v1', 'portfolio_realized_trades_v1', 'portfolio_snapshots_v1', 'settings', 'unrelated'];
  const appInitialData = { portfolio_items: '[]', portfolio_realized_trades_v1: '{"version":1,"trades":[]}', portfolio_snapshots_v1: '{"version":1,"rows":[]}' };
  const sentinels = Object.fromEntries(protectedKeys.map(key => [key, appInitialData[key] || `fixture:${key}`]));
  for (const [key, value] of Object.entries(sentinels)) { set.call(ss, key, value); set.call(localStorage, key, value); }
  const own = key => String(key).startsWith('quote_cache_v1:') || String(key).startsWith('tw_fund_');
  const mode = new URL(location.href).searchParams.get('case') || 'pressure';
  window.cacheApp = { errors: [], warnings: 0, faults: [], mode,
    sentinelsIntact: () => Object.entries(sentinels).every(([key, value]) => get.call(ss, key) === value && get.call(localStorage, key) === value) };
  for (const method of ['getItem', 'setItem', 'removeItem']) {
    const original = ({ getItem: get, setItem: set, removeItem: remove })[method];
    Storage.prototype[method] = function(key, ...args) {
      if (this === ss && own(key) && (mode === 'denied' || mode === 'quota' && method === 'setItem')) {
        window.cacheApp.faults.push({ method, key, kind: mode });
        throw new DOMException('合成快取儲存故障', mode === 'denied' ? 'SecurityError' : 'QuotaExceededError');
      }
      return original.call(this, key, ...args);
    };
  }
  if (mode === 'corrupt') {
    set.call(ss, 'quote_cache_v1:RECOVER|1d', '{broken');
    set.call(ss, 'tw_fund_2330_2026-09-20', '{broken');
  }
  addEventListener('error', event => window.cacheApp.errors.push(String(event.message)));
  addEventListener('unhandledrejection', event => window.cacheApp.errors.push(String(event.reason)));
  const error = console.error.bind(console), warn = console.warn.bind(console);
  console.error = (...args) => { window.cacheApp.errors.push(args.map(String).join(' ')); error(...args); };
  console.warn = (...args) => { window.cacheApp.warnings++; warn(...args); };
  if (new URL(location.href).searchParams.has('auto')) {
    import('/__fixture/cases.mjs').then(({ run }) => run(mode)).catch(error => { document.title = `08 錯誤：${error.message}`; });
  }
})();
