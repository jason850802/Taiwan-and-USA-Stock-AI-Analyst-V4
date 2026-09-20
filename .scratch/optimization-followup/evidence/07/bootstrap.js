// 只在專屬量測 origin 安裝時鐘、儲存計時與唯讀聚合探針；正式 bundle 不包含本檔。
(() => {
  if (location.origin !== 'http://127.0.0.1:4180') throw new Error('非量測 origin');
  const nativeFetch = window.fetch.bind(window);
  const stringify = JSON.stringify.bind(JSON);
  const get = Storage.prototype.getItem;
  const set = Storage.prototype.setItem;
  const remove = Storage.prototype.removeItem;
  const ss = sessionStorage;
  localStorage.clear(); ss.clear();
  const sentinelKeys = ['portfolio_items', 'portfolio_transactions_v1', 'portfolio_import_log_v1',
    'portfolio_realized_trades_v1', 'portfolio_snapshots_v1', 'settings', 'unrelated'];
  const sentinel = Object.fromEntries(sentinelKeys.map(key => [key, `fixture-sentinel:${key}`]));
  for (const [key, value] of Object.entries(sentinel)) { set.call(ss, key, value); localStorage.setItem(key, value); }
  const OriginalDate = Date;
  let now = OriginalDate.parse('2026-09-20T04:00:00Z');
  window.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const maps = new Map();
  const sizesByValue = new WeakMap();
  const metrics = { conversion: [], serialization: [], storage: [], requests: [], longTasks: [], errors: [] };
  let storageMode = 'normal';
  let observing = true;
  const kindOf = key => key.startsWith('quote_cache_v1:') ? 'quote' : key.startsWith('tw_fund_') ? 'fundamentals' : null;
  JSON.stringify = function(value, ...args) {
    const kind = value && typeof value === 'object' && typeof value.cachedAt === 'number' ? 'quote'
      : value && typeof value.stockId === 'string' && Array.isArray(value.incomeQuarters) ? 'fundamentals' : null;
    const start = performance.now();
    try {
      const result = stringify(value, ...args);
      if (kind) sizesByValue.set(value, result.length * 2);
      if (observing && kind) metrics.serialization.push({ kind, ms: performance.now() - start, bytes: result.length * 2, ok: true });
      return result;
    } catch (error) {
      if (observing && kind) metrics.serialization.push({ kind, ms: performance.now() - start, ok: false });
      throw error;
    }
  };
  Storage.prototype.getItem = function(key) {
    if (this === ss && storageMode === 'denied') throw new DOMException('合成儲存拒絕', 'SecurityError');
    return get.call(this, key);
  };
  Storage.prototype.removeItem = function(key) {
    if (this === ss && storageMode === 'denied') throw new DOMException('合成儲存拒絕', 'SecurityError');
    return remove.call(this, key);
  };
  Storage.prototype.setItem = function(key, value) {
    const kind = this === ss ? kindOf(String(key)) : null;
    const start = performance.now();
    try {
      if (this === ss && storageMode === 'denied') throw new DOMException('合成儲存拒絕', 'SecurityError');
      if (this === ss && storageMode === 'quota' && kind) throw new DOMException('合成儲存額滿', 'QuotaExceededError');
      const result = set.call(this, key, value);
      if (observing && kind) metrics.storage.push({ kind, ms: performance.now() - start, bytes: String(value).length * 2, ok: true });
      return result;
    } catch (error) {
      if (observing && kind) metrics.storage.push({ kind, ms: performance.now() - start, ok: false, error: error.name });
      throw error;
    }
  };
  const snapshot = () => {
    const result = {};
    for (const [kind, map] of maps) {
      const unique = [...new Set(map.values())];
      let payloadBytes = 0, unmeasurable = 0;
      const sizes = [];
      for (const value of unique) {
        try { const bytes = sizesByValue.get(value) ?? stringify(value).length * 2; payloadBytes += bytes; sizes.push(bytes); }
        catch { unmeasurable++; }
      }
      result[kind] = { keys: map.size, uniquePayloads: unique.length, aliases: map.size - unique.length,
        estimatedPayloadBytes: payloadBytes, estimatedKeyBytes: [...map.keys()].reduce((sum, key) => sum + String(key).length * 2, 0),
        largestPayloadBytes: Math.max(0, ...sizes), unmeasurable,
        dates: kind === 'fundamentals' ? [...new Set([...map.keys()].map(key => String(key).slice(-10)))].sort() : undefined };
    }
    const persisted = { quote: { keys: 0, bytes: 0 }, fundamentals: { keys: 0, bytes: 0 } };
    for (let i = 0; i < ss.length; i++) {
      const key = ss.key(i), kind = kindOf(key || '');
      if (kind) { persisted[kind].keys++; persisted[kind].bytes += (get.call(ss, key) || '').length * 2; }
    }
    result.persisted = persisted;
    return result;
  };
  window.__cacheProbe = {
    register(kind, map) { maps.set(kind, map); },
    time(name, run) {
      const start = performance.now();
      try { return run(); } finally { if (observing) metrics.conversion.push({ name, ms: performance.now() - start }); }
    },
    metrics, snapshot, stringify, nativeFetch,
    setNow(value) { now = OriginalDate.parse(value); },
    setStorageMode(mode) { storageMode = mode; },
    seed(key, value) { set.call(ss, key, value); },
    sentinelsIntact() { return Object.entries(sentinel).every(([key, value]) => get.call(ss, key) === value && localStorage.getItem(key) === value); },
    stop() { observing = false; },
  };
  addEventListener('error', event => metrics.errors.push(String(event.message)));
  addEventListener('unhandledrejection', event => metrics.errors.push(String(event.reason)));
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    new PerformanceObserver(list => { for (const entry of list.getEntries()) metrics.longTasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: 'longtask', buffered: true });
  }
})();
