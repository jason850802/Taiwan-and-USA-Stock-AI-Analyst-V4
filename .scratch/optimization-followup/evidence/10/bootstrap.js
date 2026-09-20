// 僅清理本票專屬origin；在產品載入前捕捉錯誤及原生鍵盤證據。
(() => {
  if (location.origin !== 'http://127.0.0.1:4183') throw new Error('非鍵盤驗收origin');
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('portfolio_items', JSON.stringify([{ id: 'a11y-fake', symbol: 'AAPL', totalShares: 10, avgCostPrice: 100, totalCost: 32000, totalCostUSD: 1000, purchaseCurrency: 'USD', exchangeRate: 32, cashDividends: 0, stockDividends: 0 }]));
  const OriginalDate = Date, now = OriginalDate.parse('2026-09-20T04:00:00Z');
  window.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  const label = element => element?.getAttribute('aria-label') || element?.innerText?.trim().slice(0, 120) || element?.getAttribute('placeholder') || element?.tagName || '';
  const visible = element => element.getClientRects().length > 0 && !element.closest('[hidden],[inert]') && getComputedStyle(element).visibility === 'visible';
  const controls = root => [...root.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(e => e.tabIndex >= 0 && !e.matches(':disabled') && visible(e));
  const fixture = window.keyboardFixture = { events: [], readings: [], errors: [], label, controls,
    reset() { this.events = []; this.readings = []; },
    record(step, expected = {}) {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible), dialog = dialogs.at(-1), active = document.activeElement;
      const row = { step, active: label(active), activeId: active?.id || '', activeTag: active?.tagName, dialogCount: dialogs.length,
        dialogNames: dialogs.map(label), inside: !!dialog?.contains(active), controls: dialog ? controls(dialog).map(label) : [],
        width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
        noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
        mainHeight: document.querySelector('main')?.getBoundingClientRect().height || 0,
        modalScrollTop: dialog?.firstElementChild?.scrollTop || 0, modalScrollHeight: dialog?.firstElementChild?.scrollHeight || 0,
        modalClientHeight: dialog?.firstElementChild?.clientHeight || 0, bodyOverflow: document.body.style.overflow, pageScrollY: scrollY,
        checks: { ...expected } };
      row.passed = Object.entries(expected).every(([key, value]) => row[key] === value);
      this.readings.push(row); return row;
    },
    async save(name, extra = {}) {
      const result = { name, browser: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
        readings: this.readings, events: this.events, errors: this.errors, ...extra };
      result.passed = result.readings.length > 0 && result.readings.every(row => row.passed) && !result.errors.length && extra.passed !== false;
      const response = await fetch('/__fixture/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, result }) });
      if (!response.ok) throw new Error('鍵盤證據保存失敗');
      document.title = `${name}: ${result.passed ? 'PASS' : 'FAIL'}`;
      return { passed: result.passed, readings: result.readings.length, nativeKeys: result.events.filter(e => e.kind === 'key' && e.trusted).length, errors: result.errors };
    },
  };
  addEventListener('error', event => fixture.errors.push(String(event.message)));
  addEventListener('unhandledrejection', event => fixture.errors.push(String(event.reason)));
  const originalError = console.error.bind(console);
  console.error = (...args) => { fixture.errors.push(args.map(String).join(' ')); originalError(...args); };
  document.addEventListener('keydown', event => fixture.events.push({ kind: 'key', key: event.key, shift: event.shiftKey, trusted: event.isTrusted, target: label(event.target) }), true);
  document.addEventListener('click', event => { if (event.isTrusted) fixture.events.push({ kind: 'click', trusted: true, target: label(event.target.closest('button') || event.target) }); }, true);
})();
