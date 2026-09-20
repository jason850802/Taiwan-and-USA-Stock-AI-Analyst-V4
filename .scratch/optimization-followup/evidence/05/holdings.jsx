// 真實 hook 公開邊界；只有測試持股及可觀察輸出。
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useHoldingPrices } from '../../../../components/portfolio/useHoldingPrices';
function Holdings({ items }) {
  const state = useHoldingPrices(items);
  return <section><button id="normal" onClick={() => state.fetchAllPrices()}>一般讀取</button><button id="force" onClick={() => state.fetchAllPrices({ force: true })}>強制更新</button><output id="state">{JSON.stringify({ items, prices: state.prices, usdTwdRate: state.usdTwdRate })}</output></section>;
}
function Harness() {
  const [items, setItems] = useState(window.fixtureLots);
  const [mounted, setMounted] = useState(true);
  return <main><h1>05 批次載入驗收</h1><button id="remove" onClick={() => setItems(p => p.filter(i => !i.symbol.endsWith('029')))}>移除排隊標的</button><button id="drop-first" onClick={() => setItems(p => p.filter(i => !i.symbol.endsWith('000')))}>暫移首檔</button><button id="restore" onClick={() => setItems(window.fixtureLots)}>重加快取標的</button><button id="unmount" onClick={() => setMounted(false)}>卸載</button>{mounted && <Holdings items={items} />}</main>;
}
await window.fixtureReady;
createRoot(document.getElementById('root')).render(<Harness />);
