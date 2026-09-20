// 真實 hook 的公開回傳值測試宿主；不替換服務、不讀 React 私有狀態。
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useHoldingPrices } from '../../../../components/portfolio/useHoldingPrices';
import { useDailySnapshot } from '../../../../components/portfolio/useDailySnapshot';
import { loadSnapshots } from '../../../../utils/portfolioHistoryStore';

const seed = window.fixtureLots;
function Holdings({ items }) {
  const { prices, usdTwdRate, fetchAllPrices, fetchExchangeRate } = useHoldingPrices(items);
  const { historyTick } = useDailySnapshot(items, prices, usdTwdRate);
  return <section>
    <button id="normal" onClick={() => fetchAllPrices()}>一般讀取</button>
    <button id="force" onClick={() => fetchAllPrices({ force: true })}>強制更新</button>
    <button id="fx" onClick={() => fetchExchangeRate()}>表單要求匯率</button>
    <output id="state">{JSON.stringify({ items, prices, usdTwdRate, historyTick, snapshots: loadSnapshots() })}</output>
  </section>;
}
function Harness() {
  const [items, setItems] = useState(seed);
  const [mounted, setMounted] = useState(true);
  return <main>
    <h1>04 公開 hook 行為驗收</h1>
    <button id="remove-us" onClick={() => setItems(prev => prev.filter(i => i.symbol !== 'AAPL'))}>移除美股</button>
    <button id="remove-tw" onClick={() => setItems(prev => prev.filter(i => i.symbol !== '2330.TW'))}>移除台股</button>
    <button id="clear" onClick={() => setItems([])}>清空假持股</button>
    <button id="restore" onClick={() => setItems(seed)}>重新加入假持股</button>
    <button id="unmount" onClick={() => setMounted(false)}>卸載</button>
    <button id="mount" onClick={() => setMounted(true)}>掛載</button>
    {mounted && <Holdings items={items} />}
  </main>;
}
await window.fixtureReady;
createRoot(document.getElementById('root')).render(<Harness />);
