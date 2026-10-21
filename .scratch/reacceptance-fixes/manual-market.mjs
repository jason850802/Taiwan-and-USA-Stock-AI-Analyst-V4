// 03 正式頁面的原生操作讀值；本模組不輸入文字、不點按控制、不產生合成鍵盤事件。
const assert = (value, message) => { if (!value) throw new Error(message); };
const input = () => document.querySelector('input[role="combobox"]');
const quote = () => document.querySelector('main p.text-3xl')?.textContent;
const candles = () => [...(document.querySelector('main .recharts-wrapper')?.querySelectorAll('.recharts-bar-rectangle') || [])]
  .filter(element => element.querySelector('line')).length;
const readings = [];
let before;
let begun = false;
const bindingElement = document.getElementById('p1-replay-binding');
const binding = bindingElement && JSON.parse(bindingElement.textContent);
const manualHash = binding?.toolHashes?.['.scratch/reacceptance-fixes/manual-market.mjs'];
assert(binding?.group === '03' && new URL(import.meta.url).pathname
  === `/__integration/${binding.runId}/${manualHash}/manual-market.mjs`, '手動觀測模組版本／頁面身分不符');

export function begin() {
  assert(location.origin === 'http://127.0.0.1:4177' && location.pathname === '/', '只允許03專屬正式頁面');
  assert(window.integrationAudit && input(), '頁面尚未準備完成');
  assert(!begun, '這個頁面的原生操作已開始');
  assert(window.integrationAudit.snapshot().errors.length === 0, '開始前已有非預期錯誤');
  window.integrationAudit.resetKeys();
  begun = true;
  return { query: input().value, quote: quote(), candles: candles(), viewport: { width: innerWidth, height: innerHeight } };
}

export async function record(step) {
  assert(begun && readings.length < 7, '先begin，且每項讀值只能保存一次');
  const expected = ['原生清空', '搜尋選項', '原生方向鍵選股', '原生輸入美股', '週期 1wk', '週期 60m', '週期 1d'];
  assert(expected[readings.length] === step, '原生步驟順序不符');
  let row;
  if (step === '原生清空') {
    row = { step, value: input().value, quote: quote() };
    assert(row.value === '', '原生清空沒有清除搜尋欄');
  } else if (step === '搜尋選項') {
    row = { step, text: [...document.querySelectorAll('[role="option"]')].map(element => element.textContent).join('\n') };
    assert(row.text.includes('2330'), '沒有2330的搜尋選項');
  } else if (step === '原生方向鍵選股') {
    row = { step, value: input().value, quote: quote() };
    assert(row.value.includes('2330') && row.quote === '150.00', '方向鍵／Enter未選中台股');
  } else if (step === '原生輸入美股') {
    row = { step, query: input().value, quote: quote() };
    assert(row.query === 'AAPL' && row.quote === '222.00', '美股搜尋未完成');
  } else {
    const interval = step.slice(3);
    const network = await (await fetch('/__fixture/state')).json();
    row = { step, quote: quote(), text: document.querySelector('main')?.innerText,
      requests: network.requests.filter(request => request.symbol === 'AAPL' && request.interval === interval) };
    assert(row.quote === '222.00' && row.requests.some(request => request.status === 200), '週期切換缺少成功行情與畫面');
  }
  readings.push(row);
  return row;
}

export function beforeZoom() {
  assert(begun && readings.length === 7 && before === undefined, '先完成七個讀值');
  before = candles();
  assert(before === 64, `縮放前應有64根K棒，實際${before}`);
  return { before };
}

export async function finish() {
  assert(begun && before === 64 && readings.length === 7, '原生操作未完成');
  const audit = window.integrationAudit.snapshot();
  const zoomed = candles();
  const checks = [
    { name: 'native-keys', passed: audit.nativeKeys.length === 17 && audit.nativeKeys.every(key => key.trusted) },
    { name: 'zoom', passed: zoomed === 51 },
    { name: 'errors', passed: audit.errors.length === 0 },
    { name: 'viewport', passed: (innerWidth === 1440 && innerHeight === 900) || (innerWidth === 390 && innerHeight === 844) },
    { name: 'overflow', passed: document.documentElement.scrollWidth <= innerWidth + 1 },
  ];
  const result = { name: 'market', stage: 'manual', readings, checks, before, zoomed,
    passed: checks.every(check => check.passed), browser: navigator.userAgent,
    viewport: audit.viewport, requests: (await (await fetch('/__fixture/state')).json()).requests };
  const response = await fetch('/__fixture/result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'manual-market', result }) });
  assert(response.ok, `原生結果保存遭拒：${response.status} ${await response.text()}`);
  return { saved: true, passed: result.passed, checks, before, zoomed, nativeKeys: audit.nativeKeys.length };
}

Object.defineProperty(window, 'p1ManualMarket', {
  value: Object.freeze({ begin, record, beforeZoom, finish }),
  configurable: false,
  enumerable: false,
  writable: false,
});
