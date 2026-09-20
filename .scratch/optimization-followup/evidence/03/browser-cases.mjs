// 建置後真實 App 的 HTTP／可見 DOM 測試，不讀 React 私有資料。
const text = () => document.querySelector('main')?.innerText || '';
// 背景分頁可能暫停 requestAnimationFrame；用事件迴圈交棒，實際完成仍以 DOM／回應判斷。
const frames = () => new Promise(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
  channel.port2.postMessage(null);
});
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const state = async () => (await fetch('/__fixture/state')).json();
const control = async (action, data = {}) => {
  const res = await fetch(`/__fixture/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error(`驗收控制失敗：${action} ${res.status}`);
  return res.json();
};
async function waitFor(predicate, label) {
  const deadline = performance.now() + 8000;
  while (!(await predicate())) {
    if (performance.now() > deadline) throw new Error(`等待逾時：${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
const quote = () => document.querySelector('main p.text-3xl')?.textContent;
const waitQuote = value => waitFor(() => quote() === value.toFixed(2), `行情 ${value}`);
function click(label) {
  const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label || button.title === label);
  assert(button && !button.disabled, `找不到可用按鈕：${label}`);
  button.click();
}
async function select(symbol) {
  const input = document.querySelector('input[role="combobox"]');
  assert(input, '找不到股票搜尋');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, symbol);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await frames(); input.closest('form').requestSubmit(); await frames();
}
async function release(group, price, fail = false) {
  const result = await control('release', { group, price, fail });
  if (result.released) await waitFor(() => window.fixtureResponses.some(response => response.group === group), `${group} 回應消費`);
  await frames();
}
const candleCount = () => [...(document.querySelector('main .recharts-wrapper')?.querySelectorAll('.recharts-bar-rectangle') || [])].filter(element => element.querySelector('line')).length;
const observed = () => ({ quote: quote(), query: document.querySelector('input[role="combobox"]')?.value, candles: candleCount(), text: text() });
async function fullDepth() {
  for (let i = 0; i < 15 && candleCount() < 64; i += 1) {
    const previous = candleCount();
    click('縮小 (-)');
    await waitFor(() => candleCount() > previous, '縮小後的 K 棒數');
  }
  assert(candleCount() === 64, `完整歷史應畫出 64 根 K 棒，實際 ${candleCount()}`);
  return observed();
}
async function finishA(price = 222) {
  for (const group of (await state()).pending.filter(group => group.startsWith('AAPL|'))) await release(group, price);
}
export const caseNames = ['stale-return', 'switch-return', 'tab-return', 'force-pending', 'failure-retry'];
export async function runCase(name, stage = 'green') {
  window.fixtureCaseState = { name, stage, status: 'running' };
  const result = { name, stage, passed: false, browser: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }, fixedNow: new Date().toISOString() };
  try {
    assert(caseNames.includes(name), '未知驗收案例');
    await waitQuote(150);
    await control('reset');
    if (name === 'stale-return') {
      await select('AAPL'); await waitQuote(222);
      window.fixtureAdvance(96 * 3600000);
      await control('plan', { plans: { 'AAPL|1d|10y|2': 'hold', 'AAPL|1d|10y|3': 'hold' } });
      await select('AAPL');
      await waitFor(async () => (await state()).pending.includes('AAPL|1d|10y|2'), 'A 背景刷新');
      await select('MSFT'); await waitQuote(444);
      await select('AAPL'); await waitQuote(222);
      result.before = observed();
      await finishA(888);
      result.after = observed();
      assert(quote() === '888.00', '切回 A 後漏收共用背景刷新，仍顯示舊行情');
      result.depth = await fullDepth();
    } else if (name === 'switch-return') {
      await control('plan', { plans: { 'AAPL|1d|10y|1': 'hold', 'AAPL|1d|10y|2': 'hold' } });
      await select('AAPL'); await waitQuote(111); result.before = observed();
      await select('MSFT'); await waitQuote(444);
      await select('AAPL'); await waitQuote(111);
      await finishA(); await waitQuote(222); result.after = await fullDepth();
      assert(result.after.query === 'AAPL', '切回後股票身分錯誤');
    } else if (name === 'tab-return') {
      await control('plan', { plans: { 'AAPL|1d|10y|1': 'hold' } });
      await select('AAPL'); await waitQuote(111);
      click('我的庫存'); await frames();
      await finishA(); click('市場分析'); await waitQuote(222);
      result.after = await fullDepth();
    } else if (name === 'force-pending') {
      await control('plan', { plans: { 'AAPL|1d|10y|1': 'hold', 'AAPL|1d|10y|2': 'hold' } });
      await select('AAPL'); await waitQuote(111); click('更新');
      await waitFor(async () => (await state()).pending.includes('AAPL|1d|10y|2'), 'force 新工作');
      await release('AAPL|1d|10y|1', 222);
      result.before = observed();
      await release('AAPL|1d|10y|2', 999); await waitQuote(999);
      result.after = await fullDepth();
    } else {
      await control('plan', { plans: { 'AAPL|1d|2y|1': 'fail', 'AAPL|1d|10y|1': 'fail' } });
      await select('AAPL'); await waitFor(() => text().includes('驗收 AAPL 行情失敗'), '錯誤提示');
      result.before = observed(); click('重試'); await waitQuote(222);
      result.after = await fullDepth();
    }
    result.passed = true;
  } catch (error) { result.error = error.message; result.observed = observed(); }
  finally {
    result.requests = (await state()).requests;
    for (const group of (await state()).pending) await control('release', { group, fail: true });
    await control('result', { name: `${stage}-${name}`, result });
    window.fixtureCaseState = { name, stage, status: 'done', passed: result.passed };
  }
  return result;
}
