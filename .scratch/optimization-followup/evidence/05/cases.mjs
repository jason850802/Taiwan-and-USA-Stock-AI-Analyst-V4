const params = new URLSearchParams(location.search);
const control = async (name, data = {}) => { const r = await fetch(`/__fixture/${name}`, { method: 'POST', body: JSON.stringify(data) }); if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.json(); };
const net = async () => (await fetch('/__fixture/state')).json();
const state = () => JSON.parse(document.querySelector('#state')?.textContent || 'null');
const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const assert = (v, message) => { if (!v) throw new Error(message); };
const wait = async (test, name) => { const end = performance.now() + 20000; while (!await test()) { if (performance.now() > end) throw new Error(`逾時 ${name}`); await new Promise(r => setTimeout(r, 10)); } };
const button = label => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === label);
export async function run() {
  await window.fixtureReady;
  const suite = params.get('suite'), count = Number(params.get('n') || 30), sample = Number(params.get('sample') || 0), scenario = params.get('scenario') || 'load';
  const result = { suite, count, sample, scenario, browser: navigator.userAgent, fixedNow: new Date().toISOString(), passed: false, viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth } };
  const isApp = location.pathname === '/';
  const readyPrices = () => isApp ? [...document.querySelectorAll('tbody tr')].filter(r => /TEST/.test(r.innerText) && !r.querySelector('.animate-spin')) : Object.values(state()?.prices || {}).filter(p => !p.loading);
  try {
    if (isApp) { await wait(() => button('我的庫存'), '庫存入口'); button('我的庫存').click(); }
    else await wait(() => state(), 'hook');
    await wait(async () => (await net()).records.length > 0, '第一筆 HTTP');
    const start = performance.now();
    let firstVisibleMs;
    if (scenario === 'overlap') {
      await control('generation', { value: 1 }); (isApp ? button('更新報價') : document.getElementById('force')).click();
      await control('generation', { value: 2 }); (isApp ? button('更新報價') : document.getElementById('force')).click();
      if (!isApp) document.getElementById('normal').click();
    }
    if (scenario === 'remove') document.getElementById('remove').click();
    if (scenario === 'unmount') document.getElementById('unmount').click();
    const target = scenario === 'remove' ? count - 1 : count;
    if (scenario !== 'unmount') {
      await wait(() => { const n = readyPrices().length; if (n > 0 && firstVisibleMs === undefined) firstVisibleMs = performance.now() - start; return n === target && (isApp || state().usdTwdRate > 0); }, '所有股票完成');
    }
    if (scenario === 'cache') {
      document.getElementById('drop-first').click(); await frames();
      await control('generation', { value: 1 }); document.getElementById('force').click(); await frames();
      document.getElementById('restore').click(); await frames();
      result.cacheHit = state().prices.TEST000;
      assert(result.cacheHit.price === 100 && !result.cacheHit.loading, '快取命中被網路佇列阻擋');
      await wait(() => Object.entries(state().prices).every(([key, p]) => p.price === (key === 'TEST000' ? 100 : 200) && !p.loading), 'force 與快取同時完成');
      assert((await net()).records.filter(r => r.symbol === 'TEST000').length === 1, '快取命中重抓了行情');
    }
    if (scenario === 'retry') {
      assert(state().prices.TEST005.error, '未看見單檔故障');
      await control('generation', { value: 1 }); document.getElementById('normal').click();
      await wait(() => state().prices.TEST005.price === 200 && !state().prices.TEST005.error, '單檔重新讀取');
      assert((await net()).records.length === count + 2, '重試未沿用其他股票快取');
    }
    await wait(async () => (await net()).active === 0, '網路結束'); await frames();
    const network = await net();
    const timing = window.fixtureTiming;
    Object.assign(result, { firstVisibleMs: isApp ? firstVisibleMs : timing.firstVisible - timing.start,
      allCompleteMs: isApp ? performance.now() - start : timing.allVisible - timing.start,
      measurement: '從第一筆 fetch 發起到 MutationObserver 觀察公開輸出，不把診斷 HTTP 排程等待當起點',
      network, observed: isApp ? document.querySelector('main')?.innerText : state() });
    if (suite !== 'before') {
      assert(network.peak <= 3, `實際 HTTP 峰值 ${network.peak} 超過3`);
      assert(network.records.slice(0, Math.min(3, network.records.length)).some(r => r.symbol === 'USDTWD=X'), '匯率未在首批取得機會');
      if (scenario === 'overlap' && !isApp) assert(Object.values(state().prices).every(p => p.price === 300 && !p.loading && !p.error) && state().usdTwdRate === 32, '最後 force 未取得新資料');
      if (scenario === 'overlap' && isApp) {
        const rows = [...document.querySelectorAll('tbody tr')].filter(r => r.innerText.includes('TEST'));
        assert(rows.every(r => r.cells[6]?.innerText === '$300.00'), '正式 App 未完成最新價格');
        assert(document.querySelector('main').innerText.includes('1 USD ≈ 32.00 TWD'), '正式 App 匯率不正確');
      }
      if (scenario === 'remove') assert(!('TEST029' in state().prices) && !network.records.some(r => r.symbol === 'TEST029'), '移除排隊工作仍啟動');
      if (scenario === 'unmount') assert(!state() && network.records.length <= 3, '卸載後仍啟動排隊工作');
      if (scenario === 'duplicate') assert(network.records.length === count + 1, '重複代碼造成多餘網路');
    }
    assert(window.fixtureErrors.length === 0, '未捕捉例外');
    assert(!window.fixtureConsole.some(row => row.level === 'error'), '非預期 console.error');
    assert(window.fixtureHttpErrors.every(row => row.expected), '非預期 HTTP 失敗');
    result.passed = true;
  } catch (error) { result.error = error.message; result.network = await net(); result.observed = state(); }
  result.uncaught = window.fixtureErrors;
  result.console = window.fixtureConsole;
  result.httpErrors = window.fixtureHttpErrors;
  await control('result', { name: `${suite}-${isApp ? 'app' : scenario}-${count}-${sample}`, result });
  document.title = `05 ${suite} ${scenario} ${count}/${sample}: ${result.passed ? 'PASS' : 'FAIL'}`;
  if (params.has('behaviors') && result.passed) {
    const cases = ['overlap', 'remove', 'unmount', 'cache', 'duplicate', 'retry'];
    const next = cases[cases.indexOf(scenario) + 1];
    if (next) { params.set('scenario', next); if (next === 'duplicate') params.set('duplicate', '1'); else params.delete('duplicate'); location.search = params.toString(); }
  }
  if (params.has('matrix') && result.passed) {
    if (sample < 6) params.set('sample', String(sample + 1));
    else if (count < 30) { params.set('n', count === 1 ? '10' : '30'); params.set('sample', '0'); }
    else return result;
    location.search = params.toString();
  }
  return result;
}
