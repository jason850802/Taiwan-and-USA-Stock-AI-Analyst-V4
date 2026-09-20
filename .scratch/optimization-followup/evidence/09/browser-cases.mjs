import { reportFor, partialWarning } from '/__fixture/report.mjs';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(value => value.toString(16).padStart(2, '0')).join('');
const normalized = text => text.replace(/\s+/g, ' ').trim();
async function waitFor(test, label, timeout = 120000) {
  const until = performance.now() + timeout;
  while (!test()) { if (performance.now() > until) throw new Error(`逾時：${label}`); await new Promise(resolve => setTimeout(resolve, 10)); }
}
function button(text, within = document) {
  const element = [...within.querySelectorAll('button')].find(item => item.textContent.trim() === text || item.title === text || item.getAttribute('aria-label') === text);
  assert(element && !element.disabled, `找不到可用按鈕：${text}`); element.click();
}
async function select(symbol) {
  const input = document.querySelector('input[role=combobox]'); assert(input, '找不到股票搜尋');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, symbol);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await window.streamFixture.turn(); input.closest('form').requestSubmit();
  await waitFor(() => document.querySelector('main')?.innerText.includes(`合成行情 ${symbol}`), `載入${symbol}`);
}
async function startMarket(plan) {
  window.streamFixture.plans.push(plan);
  button('AI 分析');
  await waitFor(() => document.querySelector('[role=dialog]'), '分析參數');
  button('空手', document.querySelector('[role=dialog]'));
  await waitFor(() => [...document.querySelectorAll('[role=dialog] button')].some(item => item.textContent.trim() === '開始 AI 智能分析' && !item.disabled), '持股狀態已套用');
  button('開始 AI 智能分析', document.querySelector('[role=dialog]'));
}
function reportElement() {
  const heading = [...document.querySelectorAll('h1')].find(element => element.textContent.startsWith('合成串流'));
  return heading?.parentElement;
}
const cacheTexts = () => Object.keys(localStorage).filter(key => key.startsWith('gemini_cache_v1|')).map(key => JSON.parse(localStorage.getItem(key)).text);

export async function run() {
  const params = new URL(location.href).searchParams;
  const profile = location.pathname === '/profile';
  const version = profile ? params.get('version') || 'after' : 'app';
  const name = params.get('case') || 'market';
  const sample = Number(params.get('sample') || 0);
  const fixture = window.streamFixture;
  const result = { name, version, profile, sample, passed: false, browser: navigator.userAgent, fixedNow: new Date().toISOString(),
    viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth } };
  try {
    await waitFor(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'AI 分析' && !button.disabled), '市場就緒');
    result.initialModuleReadyMs = performance.now();
    await fetch('/__fixture/reset', { method: 'POST' });
    const report = reportFor('PRIMARY');
    assert(report.bytes === 102400 && report.chunks.length === 1000 && report.chunks.join('') === report.text, '固定輸入錯誤');
    fixture.resetMetrics();
    const startedAt = performance.now();
    await startMarket({ tag: 'PRIMARY' });
    await waitFor(() => fixture.streams[0]?.doneAt && reportElement()?.textContent.includes('報告結束 PRIMARY'), '完整報告');
    await fixture.turn();
    const completedAt = performance.now();
    const element = reportElement();
    assert(normalized(element.innerText) === normalized(report.visible), '可讀文字與完整輸入不一致');
    assert(element.querySelectorAll('table tbody tr').length === 2 && element.querySelectorAll('li').length === 2, 'Markdown結構缺失');
    assert(fixture.streams[0].deltas === 1000 && fixture.streams[0].delivered === report.text, '服務收到的片段不一致');
    assert(cacheTexts().includes(report.text), 'AI快取未保存完整原始文字');
    if (profile) assert(fixture.lastContent === report.text, '最終React可見props不是完整報告');
    assert(fixture.errors.length === 0, '非預期例外');
    result.passed = true;
    Object.assign(result, { inputBytes: report.bytes, inputChunks: fixture.streams[0].deltas, inputSha256: await hash(report.text),
      cachedSha256: await hash(cacheTexts().find(text => text === report.text)), visibleSha256: await hash(normalized(element.innerText)),
      stateSha256: profile ? await hash(fixture.lastContent) : null, wallMs: completedAt - startedAt,
      completionLagMs: completedAt - fixture.streams[0].doneAt,
      commits: fixture.commits, renders: fixture.renders, renderMs: fixture.renders.reduce((sum, render) => sum + render.duration, 0),
      regularCommitCount: fixture.commits.filter(commit => commit.time < fixture.streams[0].doneAt).length,
      tables: 1, rows: 2, lists: 2 });
  } catch (error) { result.error = String(error.stack || error); }
  result.errors = fixture.errors;
  const saved = await fetch('/__fixture/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${version}-${name}-${sample}`, result }) });
  if (!saved.ok) throw new Error('結果保存失敗');
  document.title = `09 ${version}/${name}/${sample}: ${result.passed ? 'PASS' : 'FAIL'}`;
  if (result.passed && profile && params.get('auto') === '1') {
    const pipeline = params.get('pipeline') === '1' ? '&pipeline=1' : '';
    if (sample < 6) location.search = `?version=${version}&case=${name}&sample=${sample + 1}&auto=1${pipeline}`;
    else if (pipeline && version === 'before') location.search = '?version=after&case=market&sample=0&auto=1&pipeline=1';
    else if (pipeline) location.href = '/?edge=empty&auto=1&pipeline=1';
  }
  return result;
}
