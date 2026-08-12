// components/portfolio/useHoldingPrices.ts — 庫存報價抓取（Phase 12 T6a 自 Portfolio.tsx 平移）
// 持有 prices 與 usdTwdRate 兩個 state：同步偷看新鮮快取，miss 才抓最新價；
// items 的 symbol 集合一變就自動檢查，有美股時順帶處理匯率。
import { useCallback, useEffect, useState } from 'react';
import { PortfolioItem } from '../../types';
import { getLatestPrice, peekLatestPrice } from '../../services/yahoo';
import type { GetLatestPriceOpts } from '../../services/yahoo';
import { isTwStock } from '../../utils/portfolioFees';

export interface PriceData { price: number; name: string; loading: boolean; error: boolean; date?: string; fetchedAt?: number }

export const useHoldingPrices = (items: PortfolioItem[]) => {
  const [prices, setPrices] = useState<Record<string, PriceData>>(() => {
    const initial: Record<string, PriceData> = {};
    Array.from(new Set(items.map(i => i.symbol))).forEach(symbol => {
      const cached = peekLatestPrice(symbol);
      if (cached) initial[symbol] = { ...cached, loading: false, error: false };
    });
    return initial;
  });
  const [usdTwdRate, setUsdTwdRate] = useState<number>(() => peekLatestPrice('USDTWD=X')?.price ?? 0);

  // ── 報價抓取 ───────────────────────────────────────────────────────────
  const fetchPrice = useCallback(async (symbol: string, opts?: GetLatestPriceOpts) => {
    if (!opts?.force) {
      const cached = peekLatestPrice(symbol);
      if (cached) {
        setPrices(prev => ({ ...prev, [symbol]: { ...cached, loading: false, error: false } }));
        return;
      }
    }

    setPrices(prev => ({ ...prev, [symbol]: { price: 0, name: symbol, loading: true, error: false } }));
    try {
      const r = await getLatestPrice(symbol, opts);
      setPrices(prev => ({ ...prev, [symbol]: { ...r, loading: false, error: false } }));
    } catch {
      setPrices(prev => ({ ...prev, [symbol]: { price: 0, name: symbol, loading: false, error: true } }));
    }
  }, []);

  const fetchExchangeRate = useCallback(async (opts?: GetLatestPriceOpts) => {
    if (!opts?.force) {
      const cached = peekLatestPrice('USDTWD=X');
      if (cached) {
        setUsdTwdRate(cached.price);
        return;
      }
    }

    try {
      const r = await getLatestPrice('USDTWD=X', opts);
      if (r.price > 0) setUsdTwdRate(r.price);
    } catch { /* ignore */ }
  }, []);

  const fetchAllPrices = useCallback((opts?: GetLatestPriceOpts) => {
    Array.from(new Set(items.map(i => i.symbol))).forEach(symbol => fetchPrice(symbol, opts));
    // Fetch exchange rate if any US stock exists
    if (items.some(i => !isTwStock(i.symbol))) fetchExchangeRate(opts);
  }, [items, fetchPrice, fetchExchangeRate]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (items.length > 0) fetchAllPrices();
  }, [items.map(i => i.symbol).join(',')]);

  return { prices, usdTwdRate, fetchAllPrices, fetchExchangeRate };
};
