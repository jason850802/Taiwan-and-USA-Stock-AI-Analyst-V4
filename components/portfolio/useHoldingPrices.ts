// components/portfolio/useHoldingPrices.ts — 庫存報價抓取（Phase 12 T6a 自 Portfolio.tsx 平移）
// 持有 prices 與 usdTwdRate 兩個 state：同步讀取沿用窗內的報價快取，未命中才抓最新價；
// items 的 symbol 集合一變就自動檢查，有美股時順帶處理匯率。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PortfolioItem } from '../../types';
import { getLatestPrice, getLatestPriceName, patchLatestPriceName, peekLatestPrice } from '../../services/yahoo';
import type { GetLatestPriceOpts } from '../../services/yahoo';
import { isTwStock } from '../../utils/portfolioFees';
import { createHoldingPriceQueue } from './holdingPriceQueue';

export interface PriceData { price: number; name: string; loading: boolean; error: boolean; date?: string; fetchedAt?: number }

const USD_TWD_SYMBOL = 'USDTWD=X';

// 報價與名稱是兩條獨立生命週期：一般 cache hit 可以替換報價意圖，但不能順手使仍在途的名稱失效。
interface PriceRequest { pending?: Promise<void> }
interface PriceNameRequest { fetchedAt: number; pending?: Promise<void> }

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
  const nameRequestsRef = useRef(new Map<string, PriceNameRequest>());
  const enrichedNameAtRef = useRef(new Map<string, number>());
  const nameNeedsEnrichRef = useRef(new Map<string, number>());
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
      nameRequestsRef.current.clear();
      enrichedNameAtRef.current.clear();
      nameNeedsEnrichRef.current.clear();
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
        const nameRequest = nameRequestsRef.current.get(symbol);
        if (nameRequest && enrichedNameAtRef.current.get(symbol) !== nameRequest.fetchedAt) {
          nameNeedsEnrichRef.current.set(symbol, nameRequest.fetchedAt);
        }
        priceRequestsRef.current.delete(symbol);
        nameRequestsRef.current.delete(symbol);
        queueRef.current!.cancel(`quote:${symbol}`);
        queueRef.current!.cancel(`name:${symbol}`);
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
  const enrichPriceName = useCallback((symbol: string, data: PriceData, allowStart: boolean) => {
    if (!isTwStock(symbol) || data.fetchedAt === undefined) return;
    const fetchedAt = data.fetchedAt;
    const previous = nameRequestsRef.current.get(symbol);
    if (previous?.fetchedAt === fetchedAt) return previous.pending;
    if (enrichedNameAtRef.current.get(symbol) === fetchedAt) {
      nameNeedsEnrichRef.current.delete(symbol);
      return;
    }
    if (!allowStart && nameNeedsEnrichRef.current.get(symbol) !== fetchedAt) return;

    const request: PriceNameRequest = { fetchedAt };
    nameRequestsRef.current.set(symbol, request);
    const isCurrent = () => mountedRef.current && symbolsRef.current.has(symbol)
      && nameRequestsRef.current.get(symbol) === request;
    const publishName = (name: string) => {
      if (!isCurrent()) return;
      setPrices(prev => {
        if (!isCurrent()) return prev;
        const current = prev[symbol];
        if (!current || current.fetchedAt !== fetchedAt || current.name === name) return prev;
        return { ...prev, [symbol]: { ...current, name } };
      });
    };

    request.pending = queueRef.current!.enqueue(`name:${symbol}`, async () => {
      if (!isCurrent()) return;
      // 移除期間舊的 in-flight 名稱可能已把同代快取補好；重加後直接接回，不再重打服務。
      if (enrichedNameAtRef.current.get(symbol) === fetchedAt) {
        const cached = peekLatestPrice(symbol);
        if (cached?.fetchedAt === fetchedAt) publishName(cached.name);
        return;
      }
      const name = await getLatestPriceName(symbol);
      if (!name) return;
      if (patchLatestPriceName(symbol, fetchedAt, name)) {
        enrichedNameAtRef.current.set(symbol, fetchedAt);
        if (nameNeedsEnrichRef.current.get(symbol) === fetchedAt) nameNeedsEnrichRef.current.delete(symbol);
      }
      publishName(name);
    }, true).finally(() => {
      if (nameRequestsRef.current.get(symbol) === request) request.pending = undefined;
    });
    return request.pending;
  }, []);

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
        const data = { ...cached, loading: false, error: false };
        publish(data);
        enrichPriceName(symbol, data, false);
        return;
      }
    }

    publish({ price: 0, name: symbol, loading: true, error: false });
    request.pending = queueRef.current!.enqueue(`quote:${symbol}`, async () => {
      if (!isCurrent()) return;
      try {
        const r = await getLatestPrice(symbol, opts);
        const data = { ...r, loading: false, error: false };
        publish(data);
        enrichPriceName(symbol, data, true);
      } catch {
        publish({ price: 0, name: symbol, loading: false, error: true });
      }
    }, true).finally(() => { request.pending = undefined; });
    return request.pending;
  }, [enrichPriceName]);

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
