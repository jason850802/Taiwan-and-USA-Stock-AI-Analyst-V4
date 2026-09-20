const assert = (value, message) => { if (!value) throw new Error(message); };
const yieldTurn = () => new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); }; channel.port2.postMessage(null); });
async function waitFor(test, label) {
  const until = performance.now() + 20000;
  while (!test()) { if (performance.now() > until) throw new Error(`逾時：${label}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}
const text = () => document.querySelector('main')?.innerText || '';
const quote = () => document.querySelector('main p.text-3xl')?.textContent;
const expected = bars => (100 + (bars - 1) / 10 + Math.sin(bars - 1)).toFixed(2);
function click(label) {
  const control = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label || button.title === label);
  assert(control && !control.disabled, `無可操作按鈕：${label}`); control.click();
}
async function select(symbol, bars = 2500) {
  const input = document.querySelector('input[role=combobox]');
  assert(input, '找不到股票搜尋');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, symbol);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await yieldTurn(); input.closest('form').requestSubmit();
  await waitFor(() => text().includes(`合成行情 ${symbol}`) && quote() === expected(bars), `${symbol} 完整行情`);
  return { symbol, quote: quote(), expected: expected(bars), displayed: text().slice(0, 1300) };
}
export async function run(name) {
  const result = { name, passed: false, browser: navigator.userAgent, fixedNow: new Date().toISOString(),
    viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }, readings: [] };
  try {
    await waitFor(() => quote() === expected(2500), '初始行情');
    await fetch('/__fixture/reset', { method: 'POST' });
    if (name === 'pressure') {
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 30; i++) result.readings.push({ round, ...await select(`PRESSURE${i}`) });
      }
      result.readings.push(await select('PRESSURE29'));
    } else result.readings.push(await select(name === 'oversize' ? 'OVERSIZE' : 'RECOVER', name === 'oversize' ? 20000 : 2500));
    click('週'); await waitFor(() => quote() === expected(520), '週線');
    click('1時'); await waitFor(() => quote() === expected(1600), '小時線');
    click('日'); await waitFor(() => quote() === expected(name === 'oversize' ? 20000 : 2500), '回日線');
    click('放大 (+)');
    result.readings.push({ step: '週/小時/日/縮放後', quote: quote(), displayed: text().slice(0, 1600) });
    click('基本面'); await waitFor(() => text().includes('AI 基本面解讀'), '基本面可操作');
    result.readings.push({ step: '基本面', displayed: text().slice(0, 1600) });
    assert(window.cacheApp.sentinelsIntact(), '非快取sentinel被修改');
    assert(window.cacheApp.errors.length === 0, '非預期例外/console.error');
    if (['quota', 'denied'].includes(name)) assert(window.cacheApp.faults.length > 0, '故障注入沒有觸發');
    result.passed = true;
  } catch (error) { result.error = String(error.stack || error); }
  Object.assign(result, { errors: window.cacheApp.errors, warnings: window.cacheApp.warnings, faults: window.cacheApp.faults, sentinelsIntact: window.cacheApp.sentinelsIntact() });
  const saved = await fetch('/__fixture/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `app-${name}`, result }) });
  if (!saved.ok) throw new Error('結果保存失敗');
  document.title = `08 App ${name}: ${result.passed ? 'PASS' : 'FAIL'}`;
  const names = ['pressure', 'quota', 'denied', 'corrupt', 'oversize'];
  if (result.passed && new URL(location.href).searchParams.get('auto') === '1' && names.indexOf(name) < names.length - 1) location.search = `?case=${names[names.indexOf(name) + 1]}&auto=1`;
  return result;
}
