export const names = [
  's01-completed-change', 's02-inflight-change', 's03-relevant-fields', 's03-cost-fallback',
  's04-lot-composition', 's05-irrelevant-changes', 's06-draft-and-same-value', 's07-market-updates',
  's08-batch-partial-invalidation', 's09-quote-invalidation', 's09-import-invalidation',
  's09-partial-preparation', 's10-aba-generation', 's11-manual-rerun',
  's11-batch-then-single', 's11-single-then-batch', 's12-ui-state', 's12-error-stale',
  's13-batch-readd-before', 's13-batch-readd-after', 's13-batch-error-readd',
  's13-single-readd', 's13-finished-readd', 's13-remaining-stock',
  's13-retry-failed-subset', 's13-strict-active-replay', 's13-unmount-remount',
];
const staleMessage = '持股資料已變更，請重新健檢';
const state = () => JSON.parse(document.querySelector('#state')?.textContent || 'null');
const assert = (value, message) => { if (!value) throw Error(message); };
const post = async (path, data = {}) => {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw Error(`${path}/${response.status}`);
  return response.json();
};
const wait = async (test, label) => {
  const end = performance.now() + 12000;
  while (!await test()) {
    if (performance.now() > end) throw Error(`等待${label}逾時`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
const turn = () => new Promise(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
  channel.port2.postMessage(null);
});
const service = async () => (await fetch('/state')).json();
let activeResult;
const reading = async label => {
  activeResult.readings.push({ label, state: state(), service: await service(), at: performance.now() });
};
const click = async id => {
  const element = document.getElementById(id);
  assert(element, `找不到操作：${id}`);
  element.click();
  await turn();
  await reading(`click:${id}`);
};
const pending = async id => {
  await wait(async () => (await service()).pending.includes(id), `AI ${id}`);
  await reading(`pending:${id}`);
};
const pendingStage = async stage => {
  await wait(async () => (await service()).stages.some(value => value.stage === stage), `${stage} 階段`);
  await reading(`pending-stage:${stage}`);
};
const partial = async id => { await post('/partial', { id }); await turn(); await reading(`partial:${id}`); };
const release = async (id, fail = false) => {
  await post('/release', { id, fail });
  await turn();
  await turn();
  await reading(`release:${id}:${fail ? 'error' : 'success'}`);
};
const releaseStage = async (stage, fail = false) => {
  await post('/release-stage', { stage, fail });
  await turn();
  await reading(`release-stage:${stage}`);
};
const control = async value => { await post('/control', value); await reading(`control:${JSON.stringify(value)}`); };
const expectStale = symbol => {
  const health = state()?.healthResults[symbol];
  assert(health?.status === 'stale', `${symbol} 沒有進入 stale`);
  assert(health.decision === '', `${symbol} stale 仍有舊決策`);
  assert(health.fullResult === staleMessage, `${symbol} stale 提示錯誤`);
};
const runSingle = async (symbol = 'AAPL', id = 1) => {
  await click(symbol === '2330' ? 'single-tw' : 'single-a');
  await pending(id);
  await release(id);
  await wait(() => state()?.healthResults[symbol]?.status === 'done', `${symbol} 報告完成`);
  await reading(`done:${symbol}:${id}`);
};
const prompt = (server, id) => server.requests.find(request => request.id === id)?.payload?.prompt || '';

export async function run() {
  const params = new URLSearchParams(location.search);
  const stage = params.get('stage') || 'green';
  const index = Number(params.get('case') || 0);
  const name = names[index];
  const result = { name, stage, passed: false, readings: [], browser: navigator.userAgent };
  activeResult = result;
  try {
    assert(name, '未知案例');
    if (name === 's13-strict-active-replay') {
      await post('/reset');
      await reading('strict-before-mount');
      await click('mount');
      await wait(() => state(), 'StrictMode 宿主');
    } else {
      await wait(() => state(), '宿主');
      await post('/reset');
      await reading('initial');
    }
    if (name === 's01-completed-change') {
      await runSingle();
      await click('save-cost');
      expectStale('AAPL');
    } else if (name === 's02-inflight-change') {
      await click('single-a');
      await pending(1);
      await partial(1);
      await wait(() => state().healthResults.AAPL?.fullResult.includes('OLD-PARTIAL'), '舊片段呈現');
      assert(state().healthResults.AAPL.fullResult.includes('OLD-PARTIAL'), '舊片段未先呈現');
      await click('save-cost');
      expectStale('AAPL');
      await release(1, true);
      expectStale('AAPL');
    } else if (name === 's03-relevant-fields') {
      await runSingle('AAPL', 1);
      await click('change-shares');
      expectStale('AAPL');
      await runSingle('AAPL', 2);
      await click('switch-branch');
      expectStale('AAPL');
      await runSingle('2330', 3);
      await click('change-tw-cost');
      expectStale('2330');
      const server = await service();
      assert(prompt(server, 2).includes('持有股數：20'), '新提示詞未使用新股數');
    } else if (name === 's03-cost-fallback') {
      await runSingle('AAPL', 1);
      await click('missing-usd-cost');
      expectStale('AAPL');
      await click('fallback-cost');
      await runSingle('AAPL', 2);
      await click('save-cost');
      expectStale('AAPL');
      await runSingle('AAPL', 3);
      await click('unused-cost');
      assert(state().healthResults.AAPL.status === 'done', 'USD 分支未採用欄位使報告誤失效');
      const server = await service();
      assert(prompt(server, 2).includes('買入均價：30.00 USD'), 'fallback 成本沒有進入新提示詞');
      assert(prompt(server, 3).includes('買入均價：20.00 USD'), '補回 USD 成本沒有進入新提示詞');
    } else if (name === 's04-lot-composition') {
      await runSingle('AAPL', 1);
      await click('add-lot');
      expectStale('AAPL');
      await runSingle('AAPL', 2);
      await click('remove-lot');
      expectStale('AAPL');
      await click('single-a');
      await wait(() => state().healthResults.AAPL?.status === 'done', '原輸入快取報告完成');
      await click('replace-lot');
      expectStale('AAPL');
    } else if (name === 's05-irrelevant-changes') {
      await runSingle();
      await click('reorder');
      await click('clone');
      await click('unrelated');
      assert(state().healthResults.AAPL?.status === 'done', '無關更新誤使報告失效');
    } else if (name === 's06-draft-and-same-value') {
      await runSingle();
      await click('draft-different');
      assert(state().healthResults.AAPL?.status === 'done', '未保存草稿使報告失效');
      await click('restore-cost');
      assert(state().healthResults.AAPL?.status === 'done', '保存原值使報告失效');
    } else if (name === 's07-market-updates') {
      await runSingle('AAPL', 1);
      await click('switch-branch');
      expectStale('AAPL');
      await runSingle('AAPL', 2);
      await click('change-price');
      await click('change-rate');
      assert(state().healthResults.AAPL.status === 'done', '行情或匯率更新使報告失效');
      await click('single-a');
      await pending(3);
      const server = await service();
      assert(prompt(server, 3).includes('目前市價：155.00 USD'), '重跑沒有使用新行情');
      assert(prompt(server, 3).includes('買入均價：18.29 USD'), '重跑沒有使用新即時匯率');
      await release(3);
    } else if (name === 's08-batch-partial-invalidation') {
      await click('batch');
      await pending(1);
      await click('save-cost');
      await release(1);
      await wait(() => !state().batchChecking, '批次結束');
      expectStale('AAPL');
      assert(state().healthResults.MSFT?.status === 'done' && state().healthResults['2330']?.status === 'done', '未修改股票沒有正常完成');
      assert(state().batchFailedCount === 0, '失效被計成服務失敗');
    } else if (name === 's09-quote-invalidation') {
      await control({ holdQuotes: ['AAPL'] });
      await click('batch');
      await pendingStage('quote');
      await click('change-all');
      await releaseStage('quote');
      await wait(() => !state().batchChecking, '準備期全失效批次結束');
      assert((await service()).requests.length === 0, '行情準備期已失效仍送出 AI');
      ['AAPL', 'MSFT', '2330'].forEach(expectStale);
    } else if (name === 's09-import-invalidation') {
      await control({ holdImport: true });
      await click('batch');
      await pendingStage('import');
      await click('change-all');
      await releaseStage('import');
      await wait(() => !state().batchChecking, 'import 期全失效批次結束');
      assert((await service()).requests.length === 0, '動態 import 後全失效仍送出 AI');
      ['AAPL', 'MSFT', '2330'].forEach(expectStale);
    } else if (name === 's09-partial-preparation') {
      await control({ holdQuotes: ['AAPL'] });
      await click('batch');
      await pendingStage('quote');
      await click('save-cost');
      await releaseStage('quote');
      await pending(1);
      const server = await service();
      assert(!prompt(server, 1).includes('（AAPL）') && prompt(server, 1).includes('（MSFT）'), '失效股票未在送 AI 前剔除');
      await release(1);
      await wait(() => !state().batchChecking, '部分有效批次結束');
      expectStale('AAPL');
      assert(state().healthResults.MSFT.status === 'done' && state().healthResults['2330'].status === 'done', '有效股票未完成');
    } else if (name === 's10-aba-generation') {
      await click('single-a');
      await pending(1);
      await partial(1);
      await click('save-cost');
      await click('restore-cost');
      await release(1);
      expectStale('AAPL');
      assert(!state().healthResults.AAPL.fullResult.includes('OLD'), 'A→B→A 復活舊片段');
    } else if (name === 's11-manual-rerun') {
      await click('single-a');
      await pending(1);
      await click('save-cost');
      expectStale('AAPL');
      await click('single-a');
      await pending(2);
      await partial(2);
      await wait(() => state().healthResults.AAPL?.fullResult.includes('NEW-PARTIAL'), '新片段呈現');
      await release(1, true);
      assert(state().healthResults.AAPL.status === 'loading' && state().healthResults.AAPL.fullResult.includes('NEW-PARTIAL'), '舊 error/finally 清除新 loading');
      await release(2);
      await wait(() => state().healthResults.AAPL?.status === 'done', '新世代完成');
      assert(state().healthResults.AAPL.fullResult.includes('NEW') && !state().healthResults.AAPL.fullResult.includes('OLD'), '舊世代覆蓋新報告');
    } else if (name === 's11-batch-then-single') {
      await click('batch');
      await pending(1);
      await click('single-a');
      await pending(2);
      await release(1);
      await wait(() => !state().batchChecking, '舊批次結束');
      assert(state().healthResults.AAPL.status === 'loading', '舊批次覆蓋新單檔 loading');
      assert(state().healthResults.MSFT.status === 'done', '舊批次未完成其他股票');
      await release(2);
      assert(state().healthResults.AAPL.fullResult.includes('NEW'), '新單檔沒有完成');
    } else if (name === 's11-single-then-batch') {
      await click('single-a');
      await pending(1);
      await click('batch');
      await pending(2);
      await release(1, true);
      assert(state().batchChecking && state().healthResults.AAPL.status === 'loading', '舊單檔 error/finally 清除新批次');
      await release(2);
      await wait(() => !state().batchChecking, '新批次結束');
      assert(state().healthResults.AAPL.status === 'done', '新批次沒有完成');
    } else if (name === 's12-ui-state') {
      await runSingle();
      await click('close-modal');
      await click('save-cost');
      expectStale('AAPL');
      assert(state().healthModalSymbol === null, '關閉視窗因失效自行彈出');
      await click('change-shares');
      assert(!state().healthResults.MSFT, '未健檢股票被造出 stale');
      assert(state().batchFailedCount === 0 && state().failedHealthSymbols.length === 0, 'stale 被納入失敗重試');
      await click('open-a');
      assert(state().healthModalSymbol === 'AAPL', 'stale 視窗不能手動開啟');
    } else if (name === 's12-error-stale') {
      await control({ failQuotes: ['AAPL'] });
      await click('single-a');
      await wait(() => state().healthResults.AAPL?.status === 'error', '行情錯誤');
      assert(state().failedHealthSymbols.includes('AAPL'), '錯誤未列入失敗子集');
      await control({});
      await click('save-cost');
      expectStale('AAPL');
      assert(!state().failedHealthSymbols.includes('AAPL') && state().batchFailedCount === 0, 'error 轉 stale 後仍列失敗');
      await click('retry-failed');
      assert((await service()).requests.length === 0, 'stale 被失敗子集重試送出');
    } else if (name.startsWith('s13-') && ['s13-batch-readd-before', 's13-batch-readd-after', 's13-batch-error-readd', 's13-single-readd', 's13-finished-readd', 's13-remaining-stock'].includes(name)) {
      const single = name === 's13-single-readd';
      await click(single ? 'single-a' : 'batch');
      await pending(1);
      if (name === 's13-remaining-stock') {
        await click('remove-msft');
        await release(1);
        await wait(() => !state().batchChecking, '移除他股批次結束');
        assert(state().healthResults.AAPL?.status === 'done', '移除他股取消有效 AAPL');
        assert(!state().healthResults.MSFT, '移除他股仍回填 MSFT');
      } else {
        if (name === 's13-finished-readd') {
          await release(1);
          await wait(() => !state().batchChecking, '原批次完成');
          assert(state().healthResults.AAPL?.status === 'done', '原報告沒有完成');
        }
        await click('remove-a');
        if (name === 's13-batch-readd-after') {
          await release(1);
          await wait(() => !state().batchChecking, '移除後批次完成');
        }
        await click('restore-a');
        if (single) {
          await click('single-a');
          await pending(2);
          await release(2);
          await release(1);
          assert(state().healthResults.AAPL?.fullResult.includes('NEW'), '舊單檔覆蓋重加後新結果');
        } else {
          if (!['s13-batch-readd-after', 's13-finished-readd'].includes(name)) {
            await release(1, name === 's13-batch-error-readd');
            await wait(() => !state().batchChecking, '舊批次結束');
          }
          assert(!state().healthResults.AAPL, '重加股票收到舊輸入結果');
        }
      }
    } else if (name === 's13-retry-failed-subset') {
      await control({ failQuotes: ['MSFT'] });
      await click('batch');
      await pending(1);
      await release(1);
      await wait(() => !state().batchChecking, '含行情錯誤批次結束');
      assert(state().failedHealthSymbols.length === 1 && state().failedHealthSymbols[0] === 'MSFT', '失敗子集不正確');
      await control({});
      await click('retry-failed');
      await pending(2);
      const server = await service();
      assert(prompt(server, 2).includes('（MSFT）') && !prompt(server, 2).includes('（AAPL）'), '失敗子集重試送錯股票');
      await release(2);
      await wait(() => !state().batchChecking, '失敗子集重試完成');
      assert(state().healthResults.MSFT.status === 'done', '失敗子集沒有恢復');
    } else if (name === 's13-strict-active-replay') {
      await pending(1);
      const server = await service();
      assert(state().strictStarts === 2, 'development StrictMode 沒有重播 active request');
      assert(server.quotes.filter(value => value.symbol === 'AAPL').length >= 1, 'StrictMode 工作沒有進入真行情準備');
      assert(server.requests.length === 1, 'StrictMode 舊工作穿過世代守衛送出 AI');
      await release(1);
      await wait(() => state().healthResults.AAPL?.status === 'done', 'StrictMode 新工作完成');
    } else if (name === 's13-unmount-remount') {
      await click('single-a');
      await pending(1);
      await click('unmount');
      await release(1);
      await click('mount');
      await wait(() => state(), '重新掛載宿主');
      assert(!state().healthResults.AAPL, '卸載後舊結果寫入新宿主');
      await click('save-cost');
      await click('single-a');
      await pending(2);
      await release(2);
      assert(state().healthResults.AAPL.fullResult.includes('NEW'), '重新掛載後新工作未完成');
    } else throw Error(`案例未實作：${name}`);

    const currentService = await service();
    result.final = state();
    result.requests = currentService.requests;
    result.stages = currentService.stages;
    result.quotes = currentService.quotes;
    assert(result.readings.length > 1, '缺少逐步公開讀值');
    assert(currentService.pending.length === 0 && currentService.stages.length === 0, '案例結束仍有未完成假請求');
    assert(window.fixtureErrors.length === 0, '瀏覽器有未捕捉例外');
    result.passed = true;
  } catch (error) {
    result.error = String(error.stack || error);
    result.final = state();
    const currentService = await service().catch(() => null);
    result.requests = currentService?.requests || [];
    result.stages = currentService?.stages || [];
    result.quotes = currentService?.quotes || [];
  }
  result.errors = window.fixtureErrors;
  await post('/result', { name, result, binding: window.__s1Binding });
  document.title = `S1 ${name}: ${result.passed ? 'PASS' : 'FAIL'}`;
  if (params.has('auto') && index + 1 < names.length) {
    const next = names[index + 1];
    location.search = `?stage=${stage}&case=${index + 1}&auto=1${next === 's13-strict-active-replay' ? '&strict=1' : ''}`;
  }
}
