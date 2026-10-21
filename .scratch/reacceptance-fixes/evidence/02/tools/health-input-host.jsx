import React, { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useHealthCheck } from '../../../../../components/portfolio/useHealthCheck';

const lot = (symbol, id, cost = 100) => ({
  id,
  symbol,
  totalShares: 10,
  avgCostPrice: cost / 10,
  totalCost: cost * 32,
  totalCostUSD: cost,
  purchaseCurrency: symbol === '2330' ? 'TWD' : 'USD',
  exchangeRate: 32,
  cashDividends: 0,
  stockDividends: 0,
  buyDate: '2026-01-01',
});

function App({ autoStart = false }) {
  const [items, setItems] = useState([lot('AAPL', 'aapl-1'), lot('MSFT', 'msft-1'), lot('2330', 'tw-1')]);
  const [prices, setPrices] = useState({
    AAPL: { price: 150, name: '合成 AAPL', loading: false, error: false },
    MSFT: { price: 160, name: '合成 MSFT', loading: false, error: false },
    2330: { price: 900, name: '合成台積電', loading: false, error: false },
  });
  const [rate, setRate] = useState(32);
  const [draft, setDraft] = useState('100');
  const [strictStarts, setStrictStarts] = useState(0);
  const health = useHealthCheck(items, prices, rate);
  useLayoutEffect(() => {
    if (autoStart) {
      setStrictStarts(value => value + 1);
      health.handleSingleHealthCheck('AAPL');
    }
  }, [autoStart, health.handleSingleHealthCheck]);
  const update = (symbol, patch) => setItems(current => current.map(item => item.symbol === symbol ? { ...item, ...patch } : item));
  return <>
    <h1>S1 持股輸入失效公開宿主</h1>
    <button id="single-a" onClick={() => health.handleSingleHealthCheck('AAPL')}>A 單檔</button>
    <button id="single-tw" onClick={() => health.handleSingleHealthCheck('2330')}>台股單檔</button>
    <button id="batch" onClick={() => health.handleBatchHealthCheck()}>全部健檢</button>
    <button id="save-cost" onClick={() => update('AAPL', { totalCostUSD: 200 })}>A 成本 200</button>
    <button id="save-cost-300" onClick={() => update('AAPL', { totalCostUSD: 300 })}>A 成本 300</button>
    <button id="restore-cost" onClick={() => update('AAPL', { totalCostUSD: 100 })}>A 成本 100</button>
    <button id="change-shares" onClick={() => update('AAPL', { totalShares: 20 })}>A 股數 20</button>
    <button id="switch-branch" onClick={() => update('AAPL', { purchaseCurrency: 'TWD', totalCost: 6400 })}>A 改台幣成本分支</button>
    <button id="missing-usd-cost" onClick={() => update('AAPL', { totalCostUSD: undefined })}>A 缺美元成本</button>
    <button id="fallback-cost" onClick={() => update('AAPL', { totalCost: 9600 })}>A 台幣來源成本</button>
    <button id="unused-cost" onClick={() => update('AAPL', { totalCost: 12345 })}>A 未採用成本欄</button>
    <button id="change-tw-cost" onClick={() => update('2330', { totalCost: 6400 })}>台股成本</button>
    <button id="add-lot" onClick={() => setItems(current => [...current, lot('AAPL', 'aapl-2', 50)])}>新增 A lot</button>
    <button id="remove-lot" onClick={() => setItems(current => current.filter(item => item.id !== 'aapl-2'))}>刪除 A lot</button>
    <button id="replace-lot" onClick={() => setItems(current => current.map(item => item.id === 'aapl-1' ? { ...item, id: 'aapl-imported' } : item))}>替換 A lot</button>
    <button id="remove-a" onClick={() => setItems(current => current.filter(item => item.symbol !== 'AAPL'))}>移除 A</button>
    <button id="restore-a" onClick={() => setItems(current => [...current, lot('AAPL', 'aapl-restored', 200)])}>新成本重加 A</button>
    <button id="remove-msft" onClick={() => setItems(current => current.filter(item => item.symbol !== 'MSFT'))}>移除 MSFT</button>
    <button id="reorder" onClick={() => setItems(current => [...current].reverse())}>重新排序</button>
    <button id="clone" onClick={() => setItems(current => current.map(item => ({ ...item })))}>相同值新物件</button>
    <button id="unrelated" onClick={() => update('AAPL', { buyDate: '2026-02-02', cashDividends: 99 })}>無關欄位</button>
    <button id="change-price" onClick={() => setPrices(current => ({ ...current, AAPL: { ...current.AAPL, price: 155 } }))}>更新報價</button>
    <button id="change-rate" onClick={() => setRate(35)}>更新即時匯率</button>
    <button id="change-all" onClick={() => setItems(current => current.map(item => ({ ...item, totalShares: item.totalShares + 1 })))}>全部相關輸入變更</button>
    <button id="close-modal" onClick={() => health.setHealthModalSymbol(null)}>關閉視窗</button>
    <button id="open-a" onClick={() => health.setHealthModalSymbol('AAPL')}>開啟 A 視窗</button>
    <button id="draft-different" onClick={() => setDraft('200')}>只改草稿</button>
    <button id="save-draft" onClick={() => update('AAPL', { totalCostUSD: Number(draft) })}>保存草稿</button>
    <button id="retry-failed" onClick={() => health.handleBatchHealthCheck(health.failedHealthSymbols)}>重試失敗子集</button>
    <pre id="state">{JSON.stringify({ items, prices, rate, draft, strictStarts, healthResults: health.healthResults, healthModalSymbol: health.healthModalSymbol, batchChecking: health.batchChecking, batchFailedCount: health.batchFailedCount, failedHealthSymbols: health.failedHealthSymbols })}</pre>
  </>;
}

function Host() {
  const autoStart = new URLSearchParams(location.search).get('strict') === '1';
  const [mounted, setMounted] = useState(!autoStart);
  return <><button id="unmount" onClick={() => setMounted(false)}>卸載宿主</button>
    <button id="mount" onClick={() => setMounted(true)}>重新掛載</button>{mounted && <App autoStart={autoStart} />}</>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Host /></React.StrictMode>);
