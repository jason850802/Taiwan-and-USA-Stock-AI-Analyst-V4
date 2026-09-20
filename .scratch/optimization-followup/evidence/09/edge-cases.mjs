// 正式App與固定before版本的行為邊界；只透過DOM、HTTP、時鐘與公開動畫影格介面。
import { reportFor, partialWarning } from '/__fixture/report.mjs';
const assert = (value, message) => { if (!value) throw new Error(message); };
const normalize = text => String(text).replace(/\s+/g, ' ').trim();
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
const text = () => document.querySelector('main')?.innerText || '';
const dialog = () => document.querySelector('[role=dialog]');
const fixture = () => window.streamFixture;
const reports = () => [...document.querySelectorAll('h1')].filter(node => node.textContent.startsWith('合成串流'));
const reportNode = tag => reports().find(node => node.textContent === `合成串流 ${tag}`)?.parentElement;
const cache = () => Object.keys(localStorage).filter(key => key.startsWith('gemini_cache_v1|')).map(key => JSON.parse(localStorage.getItem(key)).text);
async function wait(test, label, timeout = 60000) {
  const deadline = performance.now() + timeout;
  while (!test()) { if (performance.now() > deadline) throw new Error(`逾時：${label}`); await new Promise(resolve => setTimeout(resolve, 10)); }
}
function click(label, root = document) {
  const target = [...root.querySelectorAll('button')].find(button => button.textContent.trim() === label || button.getAttribute('aria-label') === label || button.title === label);
  assert(target && !target.disabled, `無可用按鈕：${label}`); target.click();
}
const readyMarket = () => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'AI 分析' && !button.disabled);
async function market(plan, thinking = false) {
  await wait(readyMarket, '分析按鈕可用');
  fixture().plans.push(plan);
  click('AI 分析'); await wait(dialog, '分析視窗');
  if (thinking) {
    const button = [...dialog().querySelectorAll('button')].find(node => node.textContent.includes('思考 (Pro)'));
    assert(button, '思考模式按鈕不存在'); button.click();
    await fixture().turn();
  }
  click('空手', dialog());
  await wait(() => [...dialog().querySelectorAll('button')].some(node => node.textContent.trim() === '開始 AI 智能分析' && !node.disabled), '持股選擇生效');
  click('開始 AI 智能分析', dialog());
}
async function select(symbol) {
  const input = document.querySelector('input[role=combobox]'); assert(input, '搜尋輸入不存在');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, symbol);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await fixture().turn(); input.closest('form').requestSubmit();
  const expectedSymbol = /^\d+$/.test(symbol) ? `${symbol}.TW` : symbol;
  await wait(() => text().split('\n').some(line => line.trim() === expectedSymbol) && readyMarket(), `換股${symbol}`);
  await fixture().turn();
}
async function done(index, tag, full = true) {
  await wait(() => fixture().streams[index]?.doneAt, `串流${index}完成`);
  if (full) await wait(() => reportNode(tag)?.innerText.includes(`報告結束 ${tag}`), `${tag}完整顯示`);
  await fixture().turn();
}
async function release(index) {
  await wait(() => fixture().streams[index]?.held, `串流${index}被扣住`);
  fixture().streams[index].release();
  await wait(() => fixture().streams[index].doneAt, `舊串流${index}完成`);
  await new Promise(resolve => setTimeout(resolve, 50));
}
function row(symbol) {
  return [...document.querySelectorAll('tbody tr')].find(element => [...element.querySelectorAll('p')].some(p => p.textContent === symbol));
}
async function portfolio() { click('我的庫存'); await wait(() => row('AAPL') && row('MSFT'), '假持股表格'); }
async function health(symbol, plan) {
  fixture().plans.push(plan);
  const control = row(symbol)?.querySelector('button[title=健檢]');
  assert(control, `缺少${symbol}單檔健檢`); control.click();
  await wait(() => dialog()?.textContent.includes(`持股健檢：${symbol}`), `${symbol}健檢視窗`);
}
async function closeDialog() { click('關閉', dialog()); await wait(() => !dialog(), '關閉視窗'); }
async function fullEquality(tag) {
  const expected = reportFor(tag);
  const visible = reportNode(tag)?.innerText;
  assert(visible && normalize(visible) === normalize(expected.visible), `${tag}可讀全文不符`);
  assert(cache().includes(expected.text), `${tag}原始AI快取全文不符`);
  return { rawSha256: await hash(expected.text), visibleSha256: await hash(normalize(visible)), bytes: expected.bytes };
}

export const names = ['empty', 'single', 'slow', 'partial-error', 'empty-error', 'paused-frame', 'cache-hit', 'switch', 'restart', 'view-cancel', 'health', 'health-switch', 'health-unmount', 'batch-supersede'];

export async function run() {
  const params = new URL(location.href).searchParams;
  const name = params.get('edge') || names[0];
  const profile = location.pathname === '/profile';
  const version = profile ? params.get('version') || 'after' : 'app';
  const result = { name, kind: 'edge', profile, version, sample: 0, passed: false, browser: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }, readings: [] };
  try {
    await wait(readyMarket, '市場就緒');
    await fetch('/__fixture/reset', { method: 'POST' });
    fixture().resetMetrics();
    if (['empty', 'single', 'slow', 'partial-error', 'empty-error'].includes(name)) {
      const mode = name === 'empty-error' ? 'error' : name;
      await market({ tag: 'EDGE', mode, slow: name === 'slow' });
      await done(0, 'EDGE', name === 'single');
      await wait(readyMarket, '分析loading結束');
      if (name === 'empty') assert(!reports().length, '空報告不應有殘留全文');
      else if (name === 'empty-error') assert(text().includes('合成串流中斷') && !reports().length, '空錯誤未呈現原錯誤');
      else if (name === 'single') result.equality = await fullEquality('EDGE');
      else {
        const delivered = fixture().streams[0].delivered;
        const warning = name === 'partial-error' ? partialWarning : '';
        const expected = delivered + warning;
        await wait(() => reportNode('EDGE') && (name !== 'partial-error' || reportNode('EDGE').textContent.includes('報告生成中斷')), '部分文字及錯誤政策');
        assert(reportNode('EDGE').textContent.includes(delivered.slice(-100).trim()), '有效部分內容被截斷');
        if (profile) assert(fixture().lastContent === expected, '部分最終props不符原政策');
        if (name === 'partial-error') assert(cache().length === 0, '部分錯誤不應寫成功快取');
        else assert(cache().includes(expected), '慢片段最終全文不符');
        result.expectedFinalSha256 = await hash(expected);
      }
      result.readings.push({ step: name, text: (reportNode('EDGE')?.innerText || text()).slice(-2000) });
    } else if (name === 'paused-frame') {
      fixture().holdFrames = true;
      await market({ tag: 'BACKGROUND' }); await done(0, 'BACKGROUND');
      result.equality = await fullEquality('BACKGROUND');
      result.completedWhileFramesHeld = fixture().holdFrames;
      assert(result.completedWhileFramesHeld, '沒有真正扣住動畫影格');
      const before = reportNode('BACKGROUND').innerText;
      fixture().releaseFrames(); await fixture().turn();
      assert(reportNode('BACKGROUND').innerText === before, '恢復影格覆蓋最終內容');
    } else if (name === 'cache-hit') {
      await market({ tag: 'CACHE', mode: 'single' }); await done(0, 'CACHE');
      await wait(readyMarket, '第一次完成');
      await market({ tag: 'UNUSED', mode: 'single' });
      await wait(() => readyMarket() && reportNode('CACHE'), '快取回填');
      assert(fixture().streams.length === 1, '快取命中仍有新HTTP');
      result.equality = await fullEquality('CACHE');
    } else if (['switch', 'restart', 'view-cancel'].includes(name)) {
      await market({ tag: 'OLD', holdAt: 40 });
      await wait(() => fixture().streams[0]?.held && reportNode('OLD'), '舊報告部分顯示');
      result.readings.push({ step: 'before-cancel', text: reportNode('OLD').innerText.slice(0, 500) });
      if (name === 'view-cancel') {
        await portfolio(); await release(0); click('市場分析');
        await wait(() => document.querySelector('input[role=combobox]'), '回市場');
        await fixture().turn();
        assert(!text().includes('報告結束 OLD'), '離開顯示後晚報告仍更新');
        assert(readyMarket(), '取消後loading沒有終結');
      } else {
        await select('MSFT');
        if (name === 'restart') {
          await select('2330');
          await market({ tag: 'NEW', mode: 'single' }, true);
          await done(1, 'NEW'); result.equality = await fullEquality('NEW');
        }
        await release(0);
        if (name === 'restart') assert(reportNode('NEW') && !reportNode('OLD'), '舊請求覆蓋重新分析');
        else assert(!reportNode('OLD') && readyMarket(), '換股後舊報告或finally仍污染新畫面');
      }
      result.readings.push({ step: 'after-cancel', text: text().slice(-1500) });
    } else if (name === 'health') {
      await portfolio(); await health('AAPL', { tag: 'HEALTH', mode: 'single' });
      await done(0, 'HEALTH');
      await wait(() => [...dialog().querySelectorAll('button')].some(node => node.textContent.trim() === '重新健檢' && !node.disabled), '健檢完成');
      result.equality = await fullEquality('HEALTH');
    } else if (name === 'health-switch') {
      await portfolio(); await health('AAPL', { tag: 'HEALTHA', holdAt: 40 });
      await wait(() => fixture().streams[0]?.held && reportNode('HEALTHA'), 'A部分健檢');
      await closeDialog(); await health('MSFT', { tag: 'HEALTHB', mode: 'single' });
      await done(1, 'HEALTHB'); await release(0);
      assert(dialog().textContent.includes('持股健檢：MSFT') && reportNode('HEALTHB') && !reportNode('HEALTHA'), '健檢串流混股');
      result.equality = await fullEquality('HEALTHB');
      await closeDialog(); row('AAPL').querySelector('button').click();
      await wait(() => reportNode('HEALTHA')?.innerText.includes('報告結束 HEALTHA'), '回A沿用自己的結果');
      result.returnedEquality = await fullEquality('HEALTHA');
    } else if (name === 'health-unmount') {
      await portfolio(); await health('AAPL', { tag: 'UNMOUNT', holdAt: 40 });
      await wait(() => fixture().streams[0]?.held && reportNode('UNMOUNT'), '卸載前部分報告');
      await closeDialog(); click('市場分析'); await wait(readyMarket, '市場頁');
      await release(0); await portfolio();
      assert(!reportNode('UNMOUNT') && row('AAPL').querySelector('button[title=健檢]'), '卸載後舊狀態回填新hook');
    } else if (name === 'batch-supersede') {
      await portfolio(); await health('AAPL', { tag: 'SINGLE', holdAt: 40 });
      await wait(() => fixture().streams[0]?.held && reportNode('SINGLE'), '單檔部分報告');
      await closeDialog();
      fixture().plans.push({ tag: 'BATCH', mode: 'single' }); click('全部健檢');
      await wait(() => fixture().streams[1]?.doneAt, '批次串流完成');
      await wait(() => row('AAPL')?.querySelector('button') && !row('AAPL').querySelector('button[title=健檢]'), '批次結果分配');
      await release(0); row('AAPL').querySelector('button').click();
      await wait(() => reportNode('BATCH'), '批次結果優先');
      assert(!reportNode('SINGLE'), '被批次取代的單檔排程復活');
      result.equality = await fullEquality('BATCH');
    } else throw new Error(`未知案例${name}`);
    assert(fixture().errors.length === 0, '有非預期例外');
    result.passed = true;
  } catch (error) { result.error = String(error.stack || error); }
  Object.assign(result, { errors: fixture().errors, commits: fixture().commits, renders: fixture().renders,
    streams: fixture().streams.map(stream => ({ tag: stream.tag, deltas: stream.deltas, doneAt: stream.doneAt, startedAt: stream.startedAt, held: stream.held })) });
  const saved = await fetch('/__fixture/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${version}-${name}-0`, result }) });
  if (!saved.ok) throw new Error('保存邊界證據失敗');
  document.title = `09 ${version}/${name}: ${result.passed ? 'PASS' : 'FAIL'}`;
  if (result.passed && !profile && params.get('auto') === '1') {
    const pipeline = params.get('pipeline') === '1' ? '&pipeline=1' : '';
    if (names.indexOf(name) < names.length - 1) location.search = `?edge=${names[names.indexOf(name) + 1]}&auto=1${pipeline}`;
    else if (pipeline) location.href = '/?case=market&auto=1';
  }
  return result;
}
