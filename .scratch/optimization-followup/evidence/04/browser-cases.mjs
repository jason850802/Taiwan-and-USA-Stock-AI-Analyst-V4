// 控制真 HTTP 回應順序，讀公開 hook 輸出；另以真實 App 驗收整合。
const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const assert = (value, text) => { if (!value) throw new Error(text); };
const observed = () => JSON.parse(document.querySelector('#state')?.textContent || 'null');
const network = async () => (await fetch('/__fixture/state')).json();
const control = async (action, data) => {
  const response = await fetch(`/__fixture/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(`驗收控制 ${action}: ${response.status}`);
  return response.json();
};
const waitFor = async (test, label) => {
  const deadline = performance.now() + 8000;
  while (!await test()) {
    if (performance.now() > deadline) throw new Error(`等待逾時：${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
const click = async id => { document.getElementById(id).click(); await frames(); };
const ready = group => waitFor(async () => (await network()).pending.includes(group), group);
const release = async (group, price, fail = false, time = '2026-09-20T04:01:00Z', date = '2026-09-18') => {
  await ready(group);
  window.fixtureSetTime(time);
  await control('release', { group, price, fail, date });
  await waitFor(() => window.fixtureResponses.some(r => r.group === group), `${group} 消費`);
  await frames();
};
async function batch(attempt, newer, fail = false, time = newer ? '2026-09-20T04:02:00Z' : '2026-09-20T04:01:00Z') {
  for (const [symbol, price] of [['AAPL', newer ? 200 : 100], ['USDTWD=X', newer ? 32 : 30]]) {
    await release(`${symbol}:${attempt}`, price, fail, time, newer ? '2026-09-18' : '2026-09-17');
  }
}
const assertLatest = () => {
  const current = observed();
  assert(current.prices.AAPL.price === 200 && !current.prices.AAPL.error && !current.prices.AAPL.loading, '最新價格或狀態不符');
  assert(current.prices.AAPL.date === '2026-09-18', '舊報價日期覆蓋新日期');
  assert(current.prices.AAPL.fetchedAt === Date.parse('2026-09-20T04:02:00Z'), '取得時間被舊請求改寫');
  assert(current.usdTwdRate === 32, '舊匯率覆蓋新匯率');
};
const debounce = async () => { await new Promise(resolve => setTimeout(resolve, 900)); await frames(); };
export const caseNames = [
  'normal-force', 'normal-force-old-first', 'old-success-new-failure',
  'old-failure-new-success', 'old-failure-before-success', 'cached-during-force',
  'force-force', 'remove-us', 'remove-tw', 'clear', 'unmount', 'remove-readd',
  'fx-failure-preserve', 'missing-fx-snapshot', 'form-without-us', 'snapshot-refresh',
  'force-general-old-first', 'force-general-new-first',
];
export async function runCase(name, stage = 'green') {
  const result = { name, stage, passed: false, browser: navigator.userAgent };
  try {
    await waitFor(() => observed(), 'hook 掛載');
    await ready('USDTWD=X:1');
    if (['normal-force', 'normal-force-old-first', 'old-success-new-failure', 'old-failure-new-success', 'old-failure-before-success', 'force-general-old-first', 'force-general-new-first'].includes(name)) {
      await click('force');
      if (name.startsWith('force-general')) {
        await click('normal');
        assert(observed().prices.AAPL.loading, 'force 後的一般讀取改變等待狀態');
      }
      const oldFirst = name.endsWith('old-first') || name === 'old-failure-before-success';
      const oldFails = name.includes('old-failure');
      const newFails = name === 'old-success-new-failure';
      if (oldFirst) {
        await batch(1, false, oldFails);
        result.whileNewPending = observed();
        assert(observed().prices.AAPL.loading && !observed().prices.AAPL.error, '舊結果結束新請求的 loading');
        assert(observed().usdTwdRate === 0, '舊匯率在新請求等待時發布');
      }
      await batch(2, true, newFails);
      result.afterNew = observed();
      if (!oldFirst) await batch(1, false, oldFails, '2026-09-20T04:03:00Z');
      result.afterOld = observed();
      if (newFails) {
        assert(observed().prices.AAPL.error && observed().prices.AAPL.price === 0 && !observed().prices.AAPL.loading, '舊成功清除了新失敗狀態');
        assert(observed().usdTwdRate === 0, '新匯率失敗後套用了舊結果');
      } else assertLatest();
    } else if (name === 'cached-during-force') {
      await batch(1, false);
      await click('force');
      await ready('AAPL:2');
      await click('normal');
      await click('remove-tw');
      result.pending = observed();
      assert(observed().prices.AAPL.loading, '一般快取回填讓 force 提前結束');
      assert(observed().usdTwdRate === 30, '等待期間改變原有匯率');
      await batch(2, true);
      assertLatest();
      await click('normal');
      assertLatest();
      assert((await network()).requests.filter(r => r.symbol === 'AAPL').length === 2, '一般讀取產生多餘請求');
    } else if (name === 'force-force') {
      await batch(1, false);
      await click('force');
      await ready('AAPL:2');
      await click('force');
      await batch(3, true);
      await batch(2, false, true, '2026-09-20T04:03:00Z');
      assertLatest();
    } else if (['remove-us', 'remove-tw', 'clear'].includes(name)) {
      await click(name);
      result.removed = observed();
      await batch(1, false);
      if (name !== 'remove-tw') {
        assert(!('AAPL' in observed().prices), '移除後出現幽靈報價');
        assert(observed().usdTwdRate === 0, '移除最後美股後舊匯率仍寫回');
      } else {
        assert(observed().prices.AAPL.price === 100 && observed().usdTwdRate === 30, '無關持股移除使有效請求失效');
      }
      if (name !== 'remove-us') assert(!('2330.TW' in observed().prices), '移除後台股報價仍殘留');
    } else if (name === 'unmount') {
      await click('unmount');
      await batch(1, false);
      assert(observed() === null, '卸載後仍有 hook 輸出');
      await click('mount');
      await click('force');
      await batch(2, true);
      assertLatest();
    } else if (name === 'remove-readd') {
      await click('remove-us');
      assert(!('AAPL' in observed().prices), '移除後仍有 A');
      await click('restore');
      await click('force');
      await batch(2, true);
      await batch(1, false, false, '2026-09-20T04:03:00Z');
      assertLatest();
    } else if (name === 'fx-failure-preserve') {
      await batch(1, false);
      await click('force');
      await release('AAPL:2', 200);
      await release('USDTWD=X:2', 0, true);
      assert(observed().prices.AAPL.price === 200 && observed().usdTwdRate === 30, '最新匯率失敗時沒有沿用原值');
    } else if (name === 'missing-fx-snapshot') {
      await release('AAPL:1', 100);
      await release('USDTWD=X:1', 0, true);
      await debounce();
      result.withoutRate = observed();
      assert(observed().usdTwdRate === 0 && !observed().snapshots.some(row => row.market === 'US'), '缺匯率時把顯示用預設值寫進快照');
      await click('fx');
      await release('USDTWD=X:2', 32);
      await waitFor(() => observed().snapshots.some(row => row.market === 'US' && row.fxRate === 32), '匯率到貨後快照');
    } else if (name === 'form-without-us') {
      await click('clear');
      await batch(1, false, true);
      await click('fx');
      await release('USDTWD=X:2', 32);
      assert(observed().usdTwdRate === 32 && Object.keys(observed().prices).length === 0, '空庫存表單不能主動取得匯率');
    } else if (name === 'snapshot-refresh') {
      await batch(1, false);
      await waitFor(() => observed().snapshots.some(row => row.market === 'US'), '首次快照');
      result.initialSnapshot = observed().snapshots;
      await click('force');
      await batch(2, true);
      await waitFor(() => observed().snapshots.some(row => row.market === 'US' && row.date === '2026-09-18'), '更新快照');
      const snapshot = observed().snapshots.find(row => row.market === 'US' && row.date === '2026-09-18');
      assert(snapshot.marketValue === 2000 && snapshot.totalCost === 100 && snapshot.estSellCosts === 1.6 && snapshot.fxRate === 32, '快照輸入未採用有效價格與匯率');
      assert(snapshot.totalCostTwd === 3200 && snapshot.symbolCount === 1, '快照既有金額口徑改變');
    } else throw new Error(`未定義案例 ${name}`);
    result.final = observed();
    assert(window.fixtureErrors.length === 0, '出現非預期未捕捉例外');
    result.passed = true;
  } catch (error) { result.error = error.message; result.observed = observed(); }
  result.requests = (await network()).requests;
  result.uncaught = window.fixtureErrors;
  await control('result', { name: `${stage}-${name}`, result });
  return result;
}

export function appObserved() {
  const main = document.querySelector('main');
  const row = [...(main?.querySelectorAll('tbody tr') || [])].find(element => element.cells[1]?.innerText.includes('AAPL'));
  return {
    text: main?.innerText || '',
    cells: row ? [...row.cells].map(cell => cell.innerText) : [],
    snapshots: JSON.parse(localStorage.getItem('portfolio_snapshots_v1') || '{"rows":[]}').rows,
    lots: JSON.parse(localStorage.getItem('portfolio_items') || '[]'),
  };
}
const appButton = async label => {
  const button = [...document.querySelectorAll('button')].find(element => element.textContent.trim() === label);
  assert(button && !button.disabled, `找不到 ${label}`);
  button.click(); await frames();
};
export async function runAppCase(name = 'app-overlap', stage = 'green') {
  const result = { name, stage, passed: false, browser: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth } };
  try {
    await waitFor(() => [...document.querySelectorAll('button')].some(element => element.textContent.trim() === '我的庫存'), 'App 載入');
    await appButton('我的庫存');
    await ready('USDTWD=X:1');
    await appButton('更新報價');
    await batch(2, true);
    await waitFor(() => appObserved().snapshots.some(row => row.market === 'US' && row.fxRate === 32), 'App 新快照');
    result.afterNew = appObserved();
    await batch(1, false, false, '2026-09-20T04:03:00Z');
    await debounce();
    result.afterOld = appObserved();
    assert(result.afterOld.cells[6] === '$200.00', 'App 被舊報價覆蓋');
    assert(result.afterOld.text.includes('1 USD ≈ 32.00 TWD'), 'App 被舊匯率覆蓋');
    assert(JSON.stringify(result.afterOld.snapshots) === JSON.stringify(result.afterNew.snapshots), '舊回應觸發過期快照');
    // 歷史圖也有 TWD；指定持股表前的最後一組幣別切換。
    const tableToggle = [...document.querySelectorAll('button')].filter(element => element.textContent.trim() === 'TWD').at(-1);
    assert(tableToggle, '找不到持股表幣別切換');
    tableToggle.click(); await frames();
    result.inTwd = appObserved();
    assert(result.inTwd.cells[7] === '64,000', 'App 台幣市值未使用有效匯率');
    assert(window.fixtureErrors.length === 0, 'App 有未捕捉例外');
    result.passed = true;
  } catch (error) { result.error = error.message; result.observed = appObserved(); }
  result.requests = (await network()).requests;
  result.uncaught = window.fixtureErrors;
  await control('result', { name: `${stage}-${name}`, result });
  return result;
}
