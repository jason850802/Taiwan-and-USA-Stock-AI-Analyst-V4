// 公開hook宿主：只顯示useHealthCheck的回傳值，不讀React私有狀態。
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useHealthCheck } from '../../../../components/portfolio/useHealthCheck';
const lot = (symbol, cost = 100) => ({ id: `health-${symbol}-${cost}`, symbol, totalShares: 10, avgCostPrice: cost / 10,
  totalCost: cost * 32, totalCostUSD: cost, purchaseCurrency: 'USD', exchangeRate: 32, cashDividends: 0, stockDividends: 0 });
function App() {
  const [items, setItems] = useState([lot('AAPL'), lot('MSFT')]);
  const health = useHealthCheck(items, { AAPL: { price: 150, name: '合成A', loading: false, error: false }, MSFT: { price: 160, name: '合成M', loading: false, error: false } }, 32);
  return <><h1>批次健檢移除／重加的公開介面</h1>
    <button id="batch" onClick={() => health.handleBatchHealthCheck()}>全部健檢</button>
    <button id="single" onClick={() => health.handleSingleHealthCheck('AAPL')}>A單檔健檢</button>
    <button id="remove" onClick={() => setItems(items => items.filter(i => i.symbol !== 'AAPL'))}>移除A</button>
    <button id="restore" onClick={() => setItems(items => [...items, lot('AAPL', 200)])}>以新成本重加A</button>
    <button id="remove-other" onClick={() => setItems(items => items.filter(i => i.symbol !== 'MSFT'))}>移除另一檔</button>
    <pre id="state">{JSON.stringify({ items, healthResults: health.healthResults, batchChecking: health.batchChecking, healthModalSymbol: health.healthModalSymbol })}</pre>
  </>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
