// components/portfolio/useHoldingPrices.ts — 庫存報價抓取（Phase 12 T6a 自 Portfolio.tsx 平移）
// 持有 prices 與 usdTwdRate 兩個 state：同步讀取沿用窗內的報價快取，未命中才抓最新價；
// items 的 symbol 集合一變就自動檢查，有美股時順帶處理匯率。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PortfolioItem } from '../../types';
import { getLatestPrice, peekLatestPrice } from '../../services/yahoo';
import type { GetLatestPriceOpts } from '../../services/yahoo';
import { isTwStock } from '../../utils/portfolioFees';
import { createHoldingPriceQueue } from './holdingPriceQueue';

export interface PriceData { price: number; name: string; loading: boolean; error: boolean; date?: string; fetchedAt?: number }

const USD_TWD_SYMBOL = 'USDTWD=X';

// 物件身分代表最新有效意圖；pending 結束後仍保留身分供已排入的 state 更新核對。
interface PriceRequest { pending?: Promise<void> }

export const useHoldingPrices = (items: PortfolioItem[]) => {
  const [prices, setPrices] = useState<Record<string, PriceData>>(() => {
    const initial: Record<string, PriceData> = {};
    Array.from(new Set(items.map(i => i.symbol))).forEach(symbol => {
      const cached = peekLatestPrice(symbol);
      if (cached) initial[symbol] = { ...cached, loading: false, error: false };
    });
    return initial;
  });
  const [usdTwdRate, setUsdTwdRate] = useState<number>(() => peekLatestPrice(USD_TWD_SYMBOL)?.price ?? 0);
  const mountedRef = useRef(false);
  const symbolsRef = useRef(new Set(items.map(i => i.symbol)));
  const priceRequestsRef = useRef(new Map<string, PriceRequest>());
  const rateRequestRef = useRef<PriceRequest | null>(null);
  const hasUsRef = useRef(items.some(i => !isTwStock(i.symbol)));
  const queueRef = useRef<ReturnType<typeof createHoldingPriceQueue> | null>(null);
  if (!queueRef.current) queueRef.current = createHoldingPriceQueue();
  const symbolsKey = items.map(i => i.symbol).join(',');

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      priceRequestsRef.current.clear();
      rateRequestRef.current = null;
      queueRef.current!.clear();
    };
  }, []);

  // 在 commit 時失效，避免移除後、一般 effect 執行前的舊回應補回幽靈項目。
  useLayoutEffect(() => {
    const symbols = new Set(items.map(i => i.symbol));
    symbolsRef.current = symbols;
    for (const symbol of priceRequestsRef.current.keys()) {
      if (!symbols.has(symbol)) {
        priceRequestsRef.current.delete(symbol);
        queueRef.current!.cancel(`quote:${symbol}`);
      }
    }
    const hasUs = items.some(i => !isTwStock(i.symbol));
    if (hasUsRef.current && !hasUs) {
      rateRequestRef.current = null;
      queueRef.current!.cancel('exchange-rate');
    }
    hasUsRef.current = hasUs;
    setPrices(prev => {
      const entries = Object.entries(prev).filter(([symbol]) => symbolsRef.current.has(symbol));
      return entries.length === Object.keys(prev).length ? prev : Object.fromEntries(entries);
    });
  }, [symbolsKey]);

  // ── 報價抓取 ───────────────────────────────────────────────────────────
  const fetchPrice = useCallback(async (symbol: string, opts?: GetLatestPriceOpts) => {
    if (!mountedRef.current || !symbolsRef.current.has(symbol)) return;
    const previous = priceRequestsRef.current.get(symbol);
    // 一般讀取沿用進行中的有效意圖；尤其不可拿舊快取取消尚待完成的 force。
    if (!opts?.force && previous?.pending) return previous.pending;
    const request: PriceRequest = {};
    priceRequestsRef.current.set(symbol, request);
    const isCurrent = () => mountedRef.current && symbolsRef.current.has(symbol)
      && priceRequestsRef.current.get(symbol) === request;
    const publish = (data: PriceData) => {
      if (isCurrent()) setPrices(prev => isCurrent() ? { ...prev, [symbol]: data } : prev);
    };
    if (!opts?.force) {
      const cached = peekLatestPrice(symbol);
      if (cached) {
        publish({ ...cached, loading: false, error: false });
        return;
      }
    }

    publish({ price: 0, name: symbol, loading: true, error: false });
    request.pending = queueRef.current!.enqueue(`quote:${symbol}`, async () => {
      if (!isCurrent()) return;
      try {
        const r = await getLatestPrice(symbol, opts);
        publish({ ...r, loading: false, error: false });
      } catch {
        publish({ price: 0, name: symbol, loading: false, error: true });
      }
    }).finally(() => { request.pending = undefined; });
    return request.pending;
  }, []);

  const fetchExchangeRate = useCallback(async (opts?: GetLatestPriceOpts) => {
    if (!mountedRef.current) return;
    if (!opts?.force && rateRequestRef.current?.pending) return rateRequestRef.current.pending;
    const request: PriceRequest = {};
    rateRequestRef.current = request;
    const isCurrent = () => mountedRef.current && rateRequestRef.current === request;
    const publish = (rate: number) => {
      if (isCurrent()) setUsdTwdRate(prev => isCurrent() ? rate : prev);
    };
    if (!opts?.force) {
      const cached = peekLatestPrice(USD_TWD_SYMBOL);
      if (cached) {
        publish(cached.price);
        return;
      }
    }

    // 空庫存新增第一檔美股時，表單仍可主動要求匯率；不以現有美股數量禁止此入口。
    request.pending = queueRef.current!.enqueue('exchange-rate', async () => {
      if (!isCurrent()) return;
      try {
        const r = await getLatestPrice(USD_TWD_SYMBOL, opts);
        if (r.price > 0) publish(r.price);
      } catch { /* 保留原本失敗時沿用匯率的語意 */ }
    }, true).finally(() => { request.pending = undefined; });
    return request.pending;
  }, []);

  const fetchAllPrices = useCallback((opts?: GetLatestPriceOpts) => {
    if (!mountedRef.current) return;
    Array.from(symbolsRef.current).forEach(symbol => fetchPrice(symbol, opts));
    // Fetch exchange rate if any US stock exists
    if (hasUsRef.current) fetchExchangeRate(opts);
  }, [fetchPrice, fetchExchangeRate]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (symbolsRef.current.size > 0) fetchAllPrices();
  }, [symbolsKey, fetchAllPrices]);

  return { prices, usdTwdRate, fetchAllPrices, fetchExchangeRate };
};
