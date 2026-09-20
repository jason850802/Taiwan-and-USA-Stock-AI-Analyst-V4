// 第12票在三槽排程下驗證04的公開hook語意；只扣住本案例需要交錯的資源。
// 假HTTP手動釋放次序，不更改產品服務、金融算法或04的歷史測試。
const assert = (value, message) => { if (!value) throw new Error(message); };
const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const observed = () => JSON.parse(document.getElementById('state')?.textContent || 'null');
const network = async () => (await fetch('/__fixture/state')).json();
const control = async (action, data = {}) => {
  const res = await fetch(`/__fixture/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error(`驗收控制失敗 ${action}/${res.status}`);
  return res.json();
};
async function waitFor(test, label) {
  const until = performance.now() + 12000;
  while (!await test()) {
    if (performance.now() > until) throw new Error(`等待逾時：${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
const ready = group => waitFor(async () => (await network()).pending.includes(group), group);
async function release(group, price, { fail = false, minute = 2, date = '2026-09-18' } = {}) {
  await ready(group);
  window.fixtureSetTime(`2026-09-20T04:0${minute}:00Z`);
  await control('release', { group, price, date, fail });
  await waitFor(() => window.fixtureResponses.some(r => r.group === group), `${group} 消費`);
  await frames();
}
const click = async id => { const e = document.getElementById(id); assert(e, `找不到${id}`); e.click(); await frames(); };
const seed = async () => { await release('AAPL:1', 100, { minute: 1, date: '2026-09-17' }); await release('USDTWD=X:1', 30, { minute: 1 }); };
const latest = (price = 200, rate = 32) => {
  const s = observed();
  assert(s.prices.AAPL.price === price && !s.prices.AAPL.loading && !s.prices.AAPL.error, '最新價格或狀態不符');
  assert(s.prices.AAPL.date === '2026-09-18' && s.prices.AAPL.fetchedAt === Date.parse('2026-09-20T04:02:00Z'), '日期或取得時間倒退');
  assert(s.usdTwdRate === rate, '最新匯率不符');
};
export const caseNames = [
  'price-new-first', 'price-old-first', 'price-new-failure', 'price-old-failure', 'price-old-failure-first',
  'force-general-old-first', 'force-general-new-first',
  'fx-new-first', 'fx-old-first', 'fx-new-failure', 'fx-old-failure', 'fx-old-failure-first',
  'cached-during-force', 'force-force', 'remove-us', 'remove-tw', 'clear', 'unmount', 'remove-readd',
  'fx-failure-preserve', 'missing-fx-snapshot', 'form-without-us', 'snapshot-refresh',
];
export async function runCase(name, stage = 'green') {
  const result = { name, stage, passed: false, browser: navigator.userAgent, readings: [] };
  try {
    assert(caseNames.includes(name), '未知整合案例');
    await waitFor(() => observed(), 'hook宿主');
    await ready('USDTWD=X:1'); await ready('AAPL:1');
    if (name.startsWith('price-') || name.startsWith('force-general')) {
      // 先完成初次FX，留下A1；三槽足以容納A1、force A2及force FX2。
      await release('USDTWD=X:1', 30, { minute: 1 });
      await click('force');
      if (name.startsWith('force-general')) { await click('normal'); assert(observed().prices.AAPL.loading, '一般讀取終止force等待'); }
      await release('USDTWD=X:2', 32);
      const oldFirst = name.endsWith('old-first') || name.endsWith('failure-first');
      const oldFails = name.includes('old-failure'), newFails = name.endsWith('new-failure');
      if (oldFirst) {
        await release('AAPL:1', 100, { fail: oldFails, minute: 1, date: '2026-09-17' });
        result.readings.push({ step: '舊先到，新仍等待', value: observed() });
        assert(observed().prices.AAPL.loading && !observed().prices.AAPL.error, '舊結果熄滅新loading');
      }
      await release('AAPL:2', 200, { fail: newFails });
      result.readings.push({ step: '新結果', value: observed() });
      if (!oldFirst) await release('AAPL:1', 100, { fail: oldFails, minute: 3, date: '2026-09-17' });
      if (newFails) assert(observed().prices.AAPL.price === 0 && observed().prices.AAPL.error && !observed().prices.AAPL.loading, '舊成功掩蓋新失敗');
      else latest();
    } else if (/^fx-(new|old)-/.test(name)) {
      // 價格先完成，保留FX1，獨立驗證匯率兩種順序及失敗歸屬。
      await release('AAPL:1', 100, { minute: 1 });
      await click('force'); await release('AAPL:2', 200);
      const oldFirst = name.endsWith('old-first') || name.endsWith('failure-first');
      const oldFails = name.includes('old-failure'), newFails = name.endsWith('new-failure');
      if (oldFirst) {
        await release('USDTWD=X:1', 30, { fail: oldFails, minute: 1 });
        assert(observed().usdTwdRate === 0, '舊匯率在新意圖等待時發布');
      }
      await release('USDTWD=X:2', 32, { fail: newFails });
      result.readings.push({ step: '新匯率結束', value: observed() });
      if (!oldFirst) await release('USDTWD=X:1', 30, { fail: oldFails, minute: 3 });
      assert(observed().usdTwdRate === (newFails ? 0 : 32), '匯率的舊成功／失敗污染新意圖');
      if (!newFails) latest();
    } else if (name === 'cached-during-force') {
      await seed(); await click('force'); await ready('AAPL:2');
      await click('normal'); await click('remove-tw');
      assert(observed().prices.AAPL.loading && observed().usdTwdRate === 30, '快取／清單變動取代pending force');
      await release('AAPL:2', 200); await release('USDTWD=X:2', 32); latest();
      await click('normal'); latest();
      assert((await network()).requests.filter(r => r.symbol === 'AAPL').length === 2, '快取命中卻重抓');
    } else if (name === 'force-force') {
      await seed(); await click('force'); await ready('AAPL:2'); await ready('USDTWD=X:2');
      await click('force'); await release('USDTWD=X:2', 30, { fail: true, minute: 1 });
      await release('USDTWD=X:3', 34); await release('AAPL:3', 300);
      await release('AAPL:2', 100, { fail: true, minute: 3 }); latest(300, 34);
    } else if (['remove-us', 'remove-tw', 'clear'].includes(name)) {
      await click(name); result.readings.push({ step: '已移除', value: observed() });
      await seed();
      if (name !== 'remove-tw') assert(!observed().prices.AAPL && observed().usdTwdRate === 0, '移除後舊報價／FX回填');
      else assert(observed().prices.AAPL.price === 100 && observed().usdTwdRate === 30, '無關股票移除取消有效意圖');
      if (name !== 'remove-us') assert(!observed().prices['2330.TW'], '台股幽靈項目');
    } else if (name === 'unmount') {
      await click('unmount'); await seed(); assert(observed() === null, '卸載後仍有輸出');
      await click('mount'); await click('force');
      await release('AAPL:2', 200); await release('USDTWD=X:2', 32); latest();
    } else if (name === 'remove-readd') {
      await click('remove-us'); assert(!observed().prices.AAPL, '移除後仍有A');
      await click('restore'); await click('force');
      // 結束共用中的舊FX以釋放槽位，但保留A1至新A2發布之後。
      await release('USDTWD=X:1', 30, { minute: 1 });
      await release('USDTWD=X:2', 32); await release('AAPL:2', 200);
      await release('AAPL:1', 100, { minute: 3, date: '2026-09-17' }); latest();
    } else if (name === 'fx-failure-preserve') {
      await seed(); await click('force'); await release('AAPL:2', 200); await release('USDTWD=X:2', 0, { fail: true }); latest(200, 30);
    } else if (name === 'missing-fx-snapshot') {
      await release('AAPL:1', 100); await release('USDTWD=X:1', 0, { fail: true });
      await new Promise(resolve => setTimeout(resolve, 900)); await frames();
      assert(!observed().snapshots.some(s => s.market === 'US'), '缺匯率卻寫入顯示備援快照');
      result.readings.push({ step: '缺匯率', value: observed() });
      await click('fx'); await release('USDTWD=X:2', 32);
      await waitFor(() => observed().snapshots.some(s => s.market === 'US' && s.fxRate === 32), '匯率到貨快照');
    } else if (name === 'form-without-us') {
      await click('clear');
      await release('AAPL:1', 0, { fail: true, minute: 1 });
      await release('USDTWD=X:1', 0, { fail: true, minute: 1 });
      await click('fx');
      await release('USDTWD=X:2', 32); assert(observed().usdTwdRate === 32 && !Object.keys(observed().prices).length, '空庫存表單匯率入口失效');
    } else if (name === 'snapshot-refresh') {
      await seed(); await waitFor(() => observed().snapshots.some(s => s.market === 'US'), '原快照');
      result.readings.push({ step: '原快照', value: observed() });
      await click('force'); await release('AAPL:2', 200); await release('USDTWD=X:2', 32);
      await waitFor(() => observed().snapshots.some(s => s.market === 'US' && s.date === '2026-09-18'), '新快照');
      const s = observed().snapshots.find(s => s.market === 'US' && s.date === '2026-09-18');
      assert(s.marketValue === 2000 && s.totalCost === 100 && s.estSellCosts === 1.6 && s.fxRate === 32 && s.totalCostTwd === 3200, '快照既有口徑或有效輸入不符');
    }
    assert((await network()).pending.length === 0, '案例仍有未終結HTTP');
    assert(window.fixtureErrors.length === 0, '未捕捉例外');
    result.final = observed(); result.passed = true;
  } catch (error) { result.error = String(error.stack || error); result.observed = observed(); }
  result.requests = (await network()).requests;
  result.uncaught = window.fixtureErrors;
  await control('result', { name: `${stage}-${name}`, result });
  return result;
}

const mainText = () => document.querySelector('main')?.innerText || '';
const appState = () => ({ text: mainText(), lots: JSON.parse(localStorage.getItem('portfolio_items') || '[]'),
  snapshots: JSON.parse(localStorage.getItem('portfolio_snapshots_v1') || '{"rows":[]}').rows });
const button = async label => {
  await waitFor(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === label && !b.disabled), label);
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label && !b.disabled).click(); await frames();
};
export async function runAppCase(name) {
  const result = { name, passed: false, readings: [], browser: navigator.userAgent };
  try {
    await button('我的庫存'); await ready('AAPL:1'); await release('USDTWD=X:1', 30, { minute: 1 });
    await button('更新報價'); await release('USDTWD=X:2', 32); await release('AAPL:2', 200);
    await waitFor(() => appState().snapshots.some(s => s.market === 'US' && s.fxRate === 32), '正式App快照');
    result.readings.push({ step: '新報價', ...appState() });
    await release('AAPL:1', 100, { minute: 3, date: '2026-09-17' });
    assert(mainText().includes('$200.00') && mainText().includes('64,000') && mainText().includes('12:02'), '舊回應改變正式價格／時間／市值');
    assert(!appState().snapshots.some(s => s.market === 'US' && s.date === '2026-09-17'), '舊日期寫入快照');
    assert(document.documentElement.scrollWidth <= innerWidth + 1, '正式庫存整頁水平溢出');
    result.readings.push({ step: '舊回應後仍為新值', ...appState() });
    await button('更新報價'); await ready('AAPL:3'); await ready('USDTWD=X:3');
    const row = [...document.querySelectorAll('tbody tr')].find(r => r.cells[1]?.innerText.includes('AAPL'));
    assert(row, '找不到真實庫存列'); row.click(); await frames();
    const remove = document.querySelector('svg.lucide-trash-2')?.closest('button') || document.querySelector('svg.lucide-trash2')?.closest('button');
    assert(remove, '找不到真實移除控制'); remove.click(); await frames(); await button('確認');
    await release('AAPL:3', 250, { minute: 4 }); await release('USDTWD=X:3', 34, { minute: 4 });
    assert(appState().lots.length === 0 && mainText().includes('尚無持股紀錄'), '移除最後持股後出現幽靈');
    assert(document.documentElement.scrollWidth <= innerWidth + 1, '空庫存整頁溢出');
    result.readings.push({ step: '移除後空庫存', ...appState() });
    result.passed = true;
  } catch (error) { result.error = String(error.stack || error); result.observed = appState(); }
  result.requests = (await network()).requests;
  result.uncaught = window.fixtureErrors;
  await control('result', { name: 'green-app-overlap', result });
  return result;
}
