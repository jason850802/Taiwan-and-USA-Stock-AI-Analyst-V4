// components/portfolio/useHoldingPrices.ts — 庫存報價抓取（Phase 12 T6a 自 Portfolio.tsx 平移）
// 持有 prices 與 usdTwdRate 兩個 state：逐檔抓最新價、有美股時順帶抓匯率；
// items 的 symbol 集合一變就自動重抓。邏輯零改寫，只是搬家。
import { useCallback, useEffect, useState } from 'react';
import { PortfolioItem } from '../../types';
import { getLatestPrice } from '../../services/yahoo';
import { isTwStock } from '../../utils/portfolioFees';

export interface PriceData { price: number; name: string; loading: boolean; error: boolean; date?: string }

export const useHoldingPrices = (items: PortfolioItem[]) => {
  const [prices,     setPrices]     = useState<Record<string, PriceData>>({});
  const [usdTwdRate, setUsdTwdRate] = useState<number>(0);

  // ── 報價抓取 ───────────────────────────────────────────────────────────
  const fetchPrice = useCallback(async (symbol: string) => {
    setPrices(prev => ({ ...prev, [symbol]: { price: 0, name: symbol, loading: true, error: false } }));
    try {
      const r = await getLatestPrice(symbol);
      setPrices(prev => ({ ...prev, [symbol]: { ...r, loading: false, error: false } }));
    } catch {
      setPrices(prev => ({ ...prev, [symbol]: { price: 0, name: symbol, loading: false, error: true } }));
    }
  }, []);

  const fetchExchangeRate = useCallback(async () => {
    try {
      const r = await getLatestPrice('USDTWD=X');
      if (r.price > 0) setUsdTwdRate(r.price);
    } catch { /* ignore */ }
  }, []);

  const fetchAllPrices = useCallback(() => {
    Array.from(new Set(items.map(i => i.symbol))).forEach(fetchPrice);
    // Fetch exchange rate if any US stock exists
    if (items.some(i => !isTwStock(i.symbol))) fetchExchangeRate();
  }, [items, fetchPrice, fetchExchangeRate]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (items.length > 0) fetchAllPrices();
  }, [items.map(i => i.symbol).join(',')]);

  return { prices, usdTwdRate, fetchAllPrices, fetchExchangeRate };
};
