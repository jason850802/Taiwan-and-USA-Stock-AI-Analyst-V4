(() => {
  if (location.origin !== 'http://127.0.0.1:4185') throw new Error('非 S1 隔離 origin');
  const binding = window.__s1Binding;
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('portfolio_items', JSON.stringify(['AAPL', 'MSFT'].map((symbol, index) => ({
    id: `s1-formal-${index}`,
    symbol,
    totalShares: 10,
    totalCost: 3200,
    avgCostPrice: 10,
    totalCostUSD: 100,
    purchaseCurrency: 'USD',
    exchangeRate: 32,
    cashDividends: 0,
    stockDividends: 0,
  }))));
  localStorage.setItem('portfolio_realized_trades_v1', '{"version":1,"trades":[]}');

  const fixture = window.s1FormalFixture = { errors: [], events: [], streams: [], readings: [], saves: [] };
  const sample = reason => {
    const modal = document.querySelector('[role="dialog"]');
    const rows = [...document.querySelectorAll('tbody tr')].filter(row => row.querySelector('p'));
    const value = { reason, at: performance.now(), items: JSON.parse(localStorage.getItem('portfolio_items') || '[]'),
      modal: modal?.innerText || null, focus: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 100),
      rows: rows.map(row => row.innerText), requests: fixture.streams.length,
      batchBusy: [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '全部健檢')?.disabled,
      viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth } };
    const key = JSON.stringify({ ...value, at: 0, reason: '' });
    if (reason !== 'render' || key !== fixture.lastSample) { fixture.readings.push(value); fixture.lastSample = key; }
  };
  addEventListener('error', event => fixture.errors.push(String(event.message)));
  addEventListener('unhandledrejection', event => fixture.errors.push(String(event.reason)));
  for (const type of ['input', 'change', 'focusout', 'keydown', 'click']) {
    addEventListener(type, event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const value = target instanceof HTMLInputElement ? target.value : undefined;
      const label = target.getAttribute('title') || target.getAttribute('aria-label') || target.textContent?.trim().slice(0, 80) || target.tagName;
      fixture.events.push({ type, label, value, key: event.key, trusted: event.isTrusted, at: performance.now() });
      requestAnimationFrame(() => sample(type + ':' + (event.key || label)));
    }, true);
  }

  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    nativeSetItem.call(this, key, value);
    if (key === 'portfolio_items') {
      fixture.saves.push({ items: JSON.parse(value), requests: fixture.streams.length, at: performance.now() });
      fixture.streams.filter(stream => stream.held && stream.release).forEach(stream => stream.release());
    }
  };

  const plans = [
    { tag: 'OLD' },
    { tag: 'NEW' },
    { tag: 'SINGLE-OLD', hold: true },
    { tag: 'LATEST' },
    { tag: 'BATCH-OLD', hold: true },
    { tag: 'FINAL' },
  ];
  const nativeFetch = fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.origin !== location.origin) throw new Error('禁止外部請求');
    if (url.pathname !== '/api/gemini-stream') return nativeFetch(input, init);
    const plan = plans[fixture.streams.length] || { tag: `EXTRA-${fixture.streams.length + 1}` };
    const stream = { tag: plan.tag, held: Boolean(plan.hold), released: false, startedAt: performance.now(), doneAt: null };
    fixture.streams.push(stream);
    url.searchParams.set('tag', plan.tag);
    url.searchParams.set('page', `${innerWidth}x${innerHeight}`);
    const response = await nativeFetch(url, init);
    const text = await response.text();
    if (plan.hold) await new Promise(resolve => {
      stream.release = () => { stream.held = false; stream.released = true; resolve(); };
    });
    stream.doneAt = performance.now();
    return new Response(text, { status: response.status, headers: response.headers });
  };
  addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(() => sample('render'));
    observer.observe(document.getElementById('root'), { subtree: true, childList: true, characterData: true, attributes: true });
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;bottom:0;right:0;z-index:200000;background:#fff;color:#000;padding:4px;max-width:100vw';
    const save = document.createElement('button'); save.textContent = '保存 S1 原生觀測';
    const output = document.createElement('pre'); output.id = 's1-native-result'; output.style.whiteSpace = 'pre-wrap';
    save.onclick = async () => {
      sample('save-evidence');
      const serverState = await nativeFetch(`/__state?page=${innerWidth}x${innerHeight}`).then(response => response.json());
      const checks = {};
      const has = predicate => fixture.readings.some(predicate);
      const cost = row => row.items.find(item => item.symbol === 'AAPL')?.totalCostUSD;
      checks.completedOld = has(row => cost(row) === 100 && row.modal?.includes('合成 OLD AAPL 報告'));
      checks.saved200Stale = has(row => cost(row) === 200 && row.requests === 1 && row.rows.some(text => text.includes('需重檢')));
      checks.newReport = has(row => cost(row) === 200 && row.modal?.includes('合成 NEW AAPL 報告'));
      checks.singleStale = has(row => cost(row) === 300 && row.requests === 3 && row.rows.some(text => text.includes('需重檢')));
      checks.latestReport = has(row => cost(row) === 300 && row.modal?.includes('合成 LATEST AAPL 報告'));
      checks.batchIsolation = has(row => cost(row) === 400 && row.requests === 5 && row.batchBusy === false && row.rows.some(text => text.includes('AAPL') && text.includes('需重檢')) && row.rows.some(text => text.includes('MSFT') && text.includes('分析完成')));
      checks.finalReport = has(row => cost(row) === 400 && row.modal?.includes('合成 FINAL AAPL 報告'));
      checks.noLateOldReport = !has(row => (cost(row) >= 300 && row.modal?.includes('合成 SINGLE-OLD')) || (cost(row) >= 400 && row.modal?.includes('合成 BATCH-OLD')));
      checks.stalePrompt = has(row => row.modal?.includes('持股資料已變更，請重新健檢'));
      checks.escapeRestores = has(row => row.reason === 'keydown:Escape' && row.modal === null && row.focus === '需重檢');
      checks.tab = fixture.events.some(event => event.trusted && event.type === 'keydown' && event.key === 'Tab');
      checks.shift = fixture.events.some(event => event.trusted && event.type === 'keydown' && event.key === 'Shift');
      const trustedClicks = fixture.events.filter(event => event.trusted && event.type === 'click').map(event => event.label);
      checks.irrelevantUi = trustedClicks.filter(label => label === 'AAPL').length >= 2
        && trustedClicks.includes('TWD') && trustedClicks.includes('USD')
        && has(row => row.requests === 0 && cost(row) === 100 && !row.rows.some(text => text.includes('需重檢')));
      checks.nativeSaves = [200, 300, 400].every(value => fixture.events.some(event => event.trusted && event.type === 'input' && event.value === String(value)));
      checks.requests = fixture.streams.length === 6;
      const expectedPrompts = [
        ['OLD', '買入均價：10.00 USD'], ['NEW', '買入均價：20.00 USD'],
        ['SINGLE-OLD', '買入均價：25.00 USD'], ['LATEST', '買入均價：30.00 USD'],
        ['BATCH-OLD', '買入均價：30.00 USD'], ['FINAL', '買入均價：40.00 USD'],
      ];
      checks.savedRequestBodies = serverState.requests?.length === expectedPrompts.length
        && expectedPrompts.every(([tag, input], index) => serverState.requests[index]?.tag === tag
          && serverState.requests[index]?.payload?.prompt?.includes(input));
      checks.noErrors = fixture.errors.length === 0;
      checks.viewport = [[1440, 900], [390, 844]].some(([w, h]) => innerWidth === w && innerHeight === h) && document.documentElement.scrollWidth <= innerWidth;
      const result = { passed: Object.values(checks).every(Boolean), checks, browser: navigator.userAgent,
        events: fixture.events, saves: fixture.saves, readings: fixture.readings, errors: fixture.errors,
        serverRequests: serverState.requests,
        streams: fixture.streams.map(({ release, ...value }) => value), viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth } };
      const name = innerWidth === 390 ? 'narrow' : 'desktop';
      const response = await nativeFetch('/__result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ binding, name, result }) });
      output.textContent = JSON.stringify({ status: response.status, passed: result.passed, checks, receipt: await response.json() }, null, 2);
    };
    panel.append(save, output); document.body.append(panel);
  });
})();
