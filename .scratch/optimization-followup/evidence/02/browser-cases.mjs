// 在正式 build 的真實頁面執行；只操作 DOM 與假 HTTP 邊界，無 React 私有狀態存取。
const text = () => document.querySelector('main')?.innerText || '';
const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
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
const state = async () => (await fetch('/__fixture/state')).json();
const waitGroup = (group, count = 7) => waitFor(async () => (await state()).requests.filter(r => r.group === group).length === count, group);
function button(label) {
  const element = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label);
  assert(element && !element.disabled, `找不到可用按鈕：${label}`);
  element.click();
}
async function select(code) {
  const input = document.querySelector('input[role="combobox"]');
  assert(input, '找不到股票搜尋');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, code);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await frames();
  input.closest('form').requestSubmit();
  await frames();
}
async function release(group, fail = false, count = 7) {
  await control('release', { group, fail });
  await waitFor(() => window.fixtureResponses.filter(r => r.group === group).length === count, `${group} 回應消費`);
  await frames();
}
const observed = () => ({ text: text(), query: document.querySelector('input[role="combobox"]')?.value });

async function aiSwitch(failA) {
  await control('reset', { plans: { 'ai:2330:1': 'hold', 'ai:6488:1': 'hold' } });
  button('基本面');
  await waitFor(() => text().includes('11.11'), 'A 初始資料');
  const beforeAi = performance.getEntriesByType('resource').filter(r => /\/gemini-[^/]+\.js/.test(r.name));
  assert(beforeAi.length === 0, '尚未點 AI 就下載 AI 模組');
  button('AI 基本面解讀');
  await waitGroup('ai:2330:1', 1);
  await select('6488');
  await waitFor(() => text().includes('22.22'), 'B 基本面完成');
  const bCanGenerate = [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'AI 基本面解讀');
  if (bCanGenerate) { button('AI 基本面解讀'); await waitGroup('ai:6488:1', 1); }
  await release('ai:2330:1', failA, 1);
  const afterA = observed();
  if (!bCanGenerate) throw new Error('B 繼承了 A 的 AI loading，無法生成自己的報告');
  const bStillLoading = text().includes('6488') && text().includes('生成') && !text().includes('驗收 2330 請求失敗') && !text().includes('合成報告 2330');
  await release('ai:6488:1', false, 1);
  assert(bStillLoading, 'A 完成／錯誤／finally 改變了 B 的 AI 狀態');
  assert(text().includes('合成報告 6488') && !text().includes('合成報告 2330'), 'B 的報告錯股');
  await select('2330');
  await waitFor(() => text().includes('11.11'), '切回 A');
  if (failA) {
    assert(!text().includes('合成報告 6488'), 'A 顯示 B 的報告');
    const retryLabel = [...document.querySelectorAll('button')].find(b => /^(重試 )?AI 基本面解讀$/.test(b.textContent.trim()))?.textContent.trim();
    assert(retryLabel, 'A 失敗後不能再次生成');
    button(retryLabel);
    await waitFor(() => text().includes('合成報告 2330'), 'A 的 AI 重試');
  } else {
    assert(text().includes('合成報告 2330'), '切回 A 沒有沿用已完成報告');
    assert((await state()).requests.filter(r => r.group.startsWith('ai:2330:')).length === 1, '切回 A 不應重複請求 AI');
  }
  return { afterA, returnedA: observed() };
}

async function sameSymbol(oldFailsFirst) {
  await control('reset', { plans: { 'fund:2330:1': 'hold', 'fund:2330:2': 'hold', 'fund:6488:1': 'hold' } });
  button('基本面');
  await waitGroup('fund:2330:1');
  await select('6488');
  await waitGroup('fund:6488:1');
  await select('2330');
  await waitGroup('fund:2330:2');
  let whilePending;
  if (oldFailsFirst) {
    await release('fund:2330:1', true);
    whilePending = observed();
  }
  await release('fund:2330:2');
  if (!oldFailsFirst) await release('fund:2330:1');
  await release('fund:6488:1', !oldFailsFirst);
  assert(text().includes('驗收甲公司') && text().includes('21.11') && text().includes('2026-09-17'), 'A 第二次請求被舊一輪完成覆蓋');
  assert(!text().includes('11.11') && !text().includes('22.22') && !document.querySelector('main [role="alert"]'), '舊請求數值／錯誤洩漏到目前 A');
  if (whilePending) assert(whilePending.text.includes('正在載入 2330') && !whilePending.text.includes('失敗'), '舊 A 錯誤／finally 結束新 A 的 loading');
  return { whilePending, final: observed() };
}

const cases = {
  async race() {
    await control('reset', { plans: { 'fund:2330:1': 'hold', 'fund:6488:1': 'hold' } });
    button('基本面');
    await waitGroup('fund:2330:1');
    await select('6488');
    await waitGroup('fund:6488:1');
    await release('fund:6488:1');
    assert(text().includes('22.22') && text().includes('2026-09-18'), 'B 應先成功顯示自己的日期與數值');
    await release('fund:2330:1');
    const result = observed();
    assert(text().includes('驗收乙公司') && text().includes('22.22') && !text().includes('11.11'), 'A 的晚回應覆蓋了目前 B 的基本面');
    return result;
  },
  async retry() {
    await control('reset', { plans: { 'fund:6488:1': 'hold', 'fund:6488:2': 'hold' } });
    button('基本面');
    await waitFor(() => text().includes('11.11'), 'A 初始資料');
    await select('6488');
    await waitGroup('fund:6488:1');
    const waiting = observed();
    await release('fund:6488:1', true);
    const failed = observed();
    button('重試');
    await waitFor(async () => (await state()).requests.some(r => r.group.endsWith(':2')), '重試實際代碼');
    const retriedB = (await state()).requests.some(r => r.group === 'fund:6488:2');
    if (retriedB) { await waitGroup('fund:6488:2'); await release('fund:6488:2'); }
    assert(retriedB, 'B 失敗後重試送成前一個成功代碼 A');
    assert(waiting.text.includes('6488') && waiting.text.includes('載入') && !waiting.text.includes('11.11'), 'B 等待時仍把 A 數值當成目前資料');
    assert(failed.text.includes('6488'), '錯誤未標示目前失敗的 B');
    assert(text().includes('32.22') && text().includes('2026-09-18'), '重試未顯示 B 第二次資料');
    return { waiting, failed, recovered: observed() };
  },
  'ai-success': () => aiSwitch(false),
  'ai-failure': () => aiSwitch(true),
  'same-symbol-early-error': () => sameSymbol(true),
  'same-symbol-late-success': () => sameSymbol(false),
  async 'cache-return'() {
    await sameSymbol(false);
    const beforeReturn = observed();
    await select('6488');
    await waitFor(() => text().includes('32.22'), '切離 A 到 B');
    await select('2330');
    await waitFor(() => text().includes('驗收甲公司'), '再次查閱 A');
    const afterReturn = observed();
    assert(text().includes('21.11') && !text().includes('11.11'), '舊 A1 回應覆寫快取，再次查閱 A 讀回舊值');
    return { beforeReturn, afterReturn };
  },
  async 'old-success-pending'() {
    await control('reset', { plans: { 'fund:2330:1': 'hold', 'fund:6488:1': 'hold' } });
    button('基本面');
    await waitGroup('fund:2330:1');
    await select('6488');
    await waitGroup('fund:6488:1');
    await release('fund:2330:1');
    const pendingB = observed();
    await release('fund:6488:1');
    assert(pendingB.text.includes('正在載入 6488') && !pendingB.text.includes('11.11'), '舊 A 成功／finally 改變 B 等待狀態');
    assert(text().includes('22.22'), 'B 最終資料不正確');
    return { pendingB, final: observed() };
  },
  async unmount() {
    await control('reset', { plans: { 'fund:2330:1': 'hold', 'fund:2330:2': 'hold' } });
    button('基本面');
    await waitGroup('fund:2330:1');
    button('市場分析');
    await frames();
    button('基本面');
    await waitGroup('fund:2330:2');
    await release('fund:2330:1', true);
    const remounted = observed();
    await release('fund:2330:2');
    assert(remounted.text.includes('正在載入 2330') && !remounted.text.includes('失敗'), '卸載前請求改變重掛載面板');
    assert(text().includes('21.11'), '重掛載請求未完成');
    return { remounted, final: observed() };
  },
  async 'ai-return-pending'() {
    await control('reset', { plans: { 'ai:2330:1': 'hold' } });
    button('基本面');
    await waitFor(() => text().includes('11.11'), 'A 基本面');
    button('AI 基本面解讀');
    await waitGroup('ai:2330:1', 1);
    await select('6488');
    await waitFor(() => text().includes('22.22'), 'B 基本面');
    await select('2330');
    await waitFor(() => text().includes('11.11'), '回到 A 基本面');
    const pendingA = observed();
    await release('ai:2330:1', false, 1);
    assert(pendingA.text.includes('正在生成 2330') && !pendingA.text.includes('正在生成 6488'), '切回 A 沒有顯示 A 的進行中狀態');
    assert(text().includes('合成報告 2330'), 'A 報告沒有完成');
    assert((await state()).requests.filter(r => r.group.startsWith('ai:2330:')).length === 1, 'A 的進行中工作被重複請求');
    return { pendingA, final: observed() };
  },
  async 'ai-unmount'() {
    await control('reset', { plans: { 'ai:2330:1': 'hold', 'ai:6488:1': 'hold' } });
    button('基本面');
    await waitFor(() => text().includes('11.11'), 'A 基本面');
    button('AI 基本面解讀');
    await waitGroup('ai:2330:1', 1);
    button('市場分析');
    await frames();
    button('基本面');
    await waitFor(() => text().includes('11.11'), '重掛載基本面');
    await select('6488');
    await waitFor(() => text().includes('22.22'), 'B 基本面');
    button('AI 基本面解讀');
    await waitGroup('ai:6488:1', 1);
    await release('ai:2330:1', true, 1);
    const pendingB = observed();
    await release('ai:6488:1', false, 1);
    assert(pendingB.text.includes('正在生成 6488') && !pendingB.text.includes('驗收 2330 請求失敗'), '卸載前 AI 改變目前面板');
    assert(text().includes('合成報告 6488'), '目前 B 的 AI 未完成');
    return { pendingB, final: observed() };
  },
};

export const caseNames = Object.keys(cases);

export async function runCase(name, stage = 'green') {
  assert(location.origin === 'http://127.0.0.1:4176', '只能執行於 02 假站');
  assert(cases[name], `未知案例：${name}`);
  await waitFor(() => document.querySelector('main input'), '正式 App 掛載');
  const result = { name, stage, passed: false, browser: navigator.userAgent, fixedNow: new Date().toISOString() };
  try { result.observed = await cases[name](); result.passed = true; }
  catch (error) { result.error = error.message; result.observed = observed(); }
  result.requests = (await state()).requests;
  result.scripts = performance.getEntriesByType('resource').filter(r => /\.js(?:\?|$)/.test(r.name)).map(r => r.name.replace(location.origin, ''));
  await control('result', { name: `${stage}-${name}`, result });
  return result;
}
