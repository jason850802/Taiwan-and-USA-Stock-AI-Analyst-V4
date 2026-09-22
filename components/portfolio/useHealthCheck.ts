// components/portfolio/useHealthCheck.ts — 庫存健檢
// 管理逐檔與批次健檢狀態，支援單檔重跑、全量檢查與失敗子集重試。
//
// healthSeqRef 世代守衛（改前先想）：單檔與批次對同一 symbol 重疊在飛行時，
// 較早起跑者的落地結果不得覆蓋較晚起跑者——兩個 handler 必須共用同一個 ref，
// 拆開這個 hook 前先確認守衛仍然橫跨兩者。
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PortfolioItem, StockDataPoint } from '../../types';
import { getStockData } from '../../services/yahoo';
import { classifyCaught, type FetchErrorKind } from '../../services/fetchError';
import type { PortfolioHealthItem } from '../../services/gemini';
import { parseHealthDecisions, extractDecisionByRegex, splitHealthReport, DECISION_EMOJI } from '../../services/_shared/healthDecision';
import { estimateVolumeTrend } from '../../utils/volume';
import { isTwStock } from '../../utils/portfolioFees';
import { runWithConcurrency } from '../../utils/workerPool';
import type { PriceData } from './useHoldingPrices';
import { createFramePublisher } from '../../utils/framePublisher';

export interface HealthResult { status: 'loading' | 'done' | 'error' | 'stale'; decision: string; fullResult: string }

export const STALE_HEALTH_MESSAGE = '持股資料已變更，請重新健檢';

interface PreparedHealthItem { item: PortfolioHealthItem; fetchKind: FetchErrorKind | null }

const healthInputSignatures = (items: PortfolioItem[]): Map<string, string> => {
  const grouped = new Map<string, string[]>();
  items.forEach(item => {
    const isTW = isTwStock(item.symbol);
    const usesUsdCost = !isTW && item.purchaseCurrency === 'USD' && item.totalCostUSD != null;
    const entry = JSON.stringify({
      id: item.id,
      totalShares: item.totalShares,
      costBranch: isTW ? 'TWD' : (usesUsdCost ? 'USD' : 'TWD'),
      totalCost: usesUsdCost ? item.totalCostUSD : item.totalCost,
    });
    const entries = grouped.get(item.symbol) ?? [];
    entries.push(entry);
    grouped.set(item.symbol, entries);
  });
  return new Map(Array.from(grouped, ([symbol, entries]) => [symbol, JSON.stringify(entries.sort())]));
};

/**
 * 行情抓取失敗的健檢文案（T3）：依錯誤 kind 分流，不再無條件寫「可能限流中」。
 * 後端沒開跟被限流的處置完全不同，猜錯會把使用者指去做錯的事。
 * tail 是各呼叫點的尾句（單檔＝句號；批次＝「，或單獨對此檔重跑健檢。」）。
 */
const quoteFailMarkdown = (kind: FetchErrorKind | null | undefined, tail: string): string => {
  const lead = kind === 'RATE_LIMIT' ? '（Yahoo／FinMind 可能限流中）請'
    : (kind === 'BACKEND_DOWN' || kind === 'NETWORK') ? '行情後端目前無回應，請確認網路或'
    : '請';
  return `**行情資料暫時無法取得**\n\n${lead}稍後再試${tail}`;
};

/**
 * AI 分析（Gemini）呼叫失敗的文案（T7 B3）：行情已就緒、卡在 LLM 呼叫本身時適用。
 * 與 quoteFailMarkdown 是不同的失敗點（行情抓取 vs AI 分析），故分開一支、措辭也不同。
 */
const analysisFailMarkdown = (kind: FetchErrorKind): string => {
  const lead = kind === 'RATE_LIMIT' ? '（AI 服務可能限流中）請'
    : kind === 'BACKEND_DOWN' ? '（AI 服務後端目前無回應）請確認網路或'
    : '請';
  return `**庫存健檢分析失敗**\n\n${lead}稍後再試。`;
};

export const useHealthCheck = (
  items: PortfolioItem[],
  prices: Record<string, PriceData>,
  usdTwdRate: number,
) => {
  // 庫存健檢 狀態（per-stock）
  const [healthResults, setHealthResults] = useState<Record<string, HealthResult>>({});
  const [healthModalSymbol, setHealthModalSymbol] = useState<string | null>(null);
  const [batchChecking, setBatchChecking] = useState(false);
  const [batchFailedCount, setBatchFailedCount] = useState(0);
  const failedHealthSymbols = useMemo(
    () => Array.from(new Set(items.map(item => item.symbol)))
      .filter(symbol => healthResults[symbol]?.status === 'error'),
    [healthResults, items],
  );
  // 健檢寫回世代守衛（per-symbol 單調遞增，比照 App.tsx fetchSeqRef 模式）：
  // 單檔與批次對同一 symbol 重疊在飛行時，較早起跑者的落地結果不得覆蓋較晚起跑者
  const healthSeqRef = useRef<Record<string, number>>({});
  const batchSeqRef = useRef(0);
  const mountedRef = useRef(false);
  const displaysRef = useRef(new Map<string, ReturnType<typeof createFramePublisher<HealthResult>>>());
  const symbolsRef = useRef(new Set(items.map(item => item.symbol)));
  const inputSignaturesRef = useRef(healthInputSignatures(items));
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      displaysRef.current.forEach(display => display.cancel());
      displaysRef.current.clear();
      batchSeqRef.current++;
      // StrictMode 重掛載也不可讓舊請求重新取得相同世代。
      Object.keys(healthSeqRef.current).forEach(symbol => { healthSeqRef.current[symbol]++; });
    };
  }, []);
  useLayoutEffect(() => {
    const symbols = new Set(items.map(item => item.symbol));
    const nextSignatures = healthInputSignatures(items);
    const changedSymbols = new Set<string>();
    nextSignatures.forEach((signature, symbol) => {
      const previous = inputSignaturesRef.current.get(symbol);
      if (previous !== undefined && previous !== signature) changedSymbols.add(symbol);
    });
    inputSignaturesRef.current = nextSignatures;
    symbolsRef.current = symbols;
    // 批次沒有單檔影格排程，也必須失效；保留遞增世代，避免重加同代碼讓舊請求復活。
    for (const symbol of Object.keys(healthSeqRef.current)) {
      if (!symbols.has(symbol)) {
        displaysRef.current.get(symbol)?.cancel();
        displaysRef.current.delete(symbol);
        healthSeqRef.current[symbol]++;
      }
    }
    changedSymbols.forEach(symbol => {
      displaysRef.current.get(symbol)?.cancel();
      displaysRef.current.delete(symbol);
      healthSeqRef.current[symbol] = (healthSeqRef.current[symbol] ?? 0) + 1;
    });
    setHealthResults(prev => {
      let changed = false;
      const next = Object.fromEntries(Object.entries(prev).filter(([symbol]) => {
        const keep = symbolsRef.current.has(symbol);
        if (!keep) changed = true;
        return keep;
      }));
      changedSymbols.forEach(symbol => {
        if (!next[symbol]) return;
        changed = true;
        next[symbol] = { status: 'stale', decision: '', fullResult: STALE_HEALTH_MESSAGE };
      });
      return changed ? next : prev;
    });
    setHealthModalSymbol(prev => prev && !symbolsRef.current.has(prev) ? null : prev);
  }, [items]);
  // ── 庫存健檢：組單檔 PortfolioHealthItem（單檔/批次共用）──────────────
  const buildHealthItem = useCallback(async (symbol: string): Promise<PreparedHealthItem | null> => {
    const lots = items.filter(item => item.symbol === symbol);
    if (lots.length === 0) return null;

    const p = prices[symbol];
    const currentPrice = p && !p.loading && !p.error ? p.price : 0;

    // 美股：currentPrice 永遠是 USD；avgCostPrice 若以 TWD 購入需先換算成 USD
    const isUS = !isTwStock(symbol);
    const rate = usdTwdRate > 0 ? usdTwdRate : 32;
    const totalShares = lots.reduce((sum, lot) => sum + lot.totalShares, 0);
    const totalCostInCurrentCurrency = lots.reduce((sum, lot) => {
      if (!isUS) return sum + lot.totalCost;
      if (lot.purchaseCurrency === 'USD' && lot.totalCostUSD != null) return sum + lot.totalCostUSD;
      return sum + lot.totalCost / rate;
    }, 0);
    const avgCostPriceInCurrentCurrency = totalShares > 0
      ? totalCostInCurrentCurrency / totalShares
      : 0;

    const profitPct = avgCostPriceInCurrentCurrency > 0 && currentPrice > 0
      ? ((currentPrice - avgCostPriceInCurrentCurrency) / avgCostPriceInCurrentCurrency) * 100 : 0;

    let recentData: StockDataPoint[] = [];
    let volProj = null;
    let fetchKind: FetchErrorKind | null = null;
    try {
      const { data } = await getStockData(symbol, '1d');
      recentData = data;
      volProj = estimateVolumeTrend(data, isTwStock(symbol), '1d');
    } catch (e) {
      fetchKind = classifyCaught(e); // 錯誤種類隨本次輸入返回，不讓舊工作改寫新工作的錯誤文案。
    }

    return {
      item: { symbol, name: p?.name || symbol, avgCostPrice: avgCostPriceInCurrentCurrency,
        currentPrice, totalShares, profitPct, recentData, volumeProjection: volProj },
      fetchKind,
    };
  }, [items, prices, usdTwdRate]);

  // ── 單檔庫存健檢 ──────────────────────────────────────────────────────
  const handleSingleHealthCheck = useCallback(async (symbol: string) => {
    if (!mountedRef.current || !items.some(i => i.symbol === symbol)) return;

    const gen = healthSeqRef.current[symbol] = (healthSeqRef.current[symbol] ?? 0) + 1;
    displaysRef.current.get(symbol)?.cancel();
    const isCurrent = () => mountedRef.current && healthSeqRef.current[symbol] === gen;
    const display = createFramePublisher<HealthResult>(value => {
      if (isCurrent()) setHealthResults(prev => isCurrent() ? { ...prev, [symbol]: value } : prev);
    });
    displaysRef.current.set(symbol, display);
    setHealthModalSymbol(symbol);
    setHealthResults(prev => ({ ...prev, [symbol]: { status: 'loading', decision: '', fullResult: '' } }));

    try {
      const prepared = await buildHealthItem(symbol);
      if (!prepared || !isCurrent()) return;
      const healthItem = prepared.item;
      if (healthItem.recentData.length === 0) {
        // 行情抓取失敗：空資料送 LLM 只會在 formatHealthCheckData 拋錯，直接誠實標記可重試
        display.finish({ status: 'error', decision: '資料取得失敗', fullResult: quoteFailMarkdown(prepared.fetchKind, '。') });
        return;
      }

      const { analyzePortfolioHealth } = await import('../../services/gemini');
      if (!isCurrent()) return;
      const result = await analyzePortfolioHealth([healthItem], (partial) => {
        if (isCurrent()) display.push({ status: 'loading', decision: '', fullResult: partial });
      });

      // 決策：優先 json 機器區，失敗 fallback regex（舊行為是下限）
      const parsed = parseHealthDecisions(result);
      const entry = parsed?.decisions.find(d => d.symbol === symbol) ?? parsed?.decisions[0] ?? null;
      const decision = entry
        ? DECISION_EMOJI[entry.decision] + entry.decision
        : (extractDecisionByRegex(result) ?? '分析完成');
      const fullResult = parsed ? parsed.cleanedMarkdown : result;

      if (isCurrent()) display.finish({ status: 'done', decision, fullResult });
    } catch (e) {
      if (isCurrent()) display.finish({ status: 'error', decision: '分析失敗', fullResult: analysisFailMarkdown(classifyCaught(e)) });
    } finally {
      display.cancel();
      if (displaysRef.current.get(symbol) === display) displaysRef.current.delete(symbol);
    }
  }, [items, buildHealthItem]);

  // ── 一鍵批次健檢（全部持股一次 LLM 呼叫）──────────────────────────────
  const handleBatchHealthCheck = useCallback(async (targetSymbols?: readonly string[]) => {
    const allSymbols = Array.from(new Set(items.map(i => i.symbol)));
    const targetSet = targetSymbols === undefined ? null : new Set(targetSymbols);
    const symbols = targetSet === null
      ? allSymbols
      : allSymbols.filter(symbol => targetSet.has(symbol));
    if (!mountedRef.current || symbols.length === 0 || batchChecking) return;

    setBatchFailedCount(failedHealthSymbols.filter(symbol => symbols.includes(symbol)).length);
    setBatchChecking(true);
    const batchGen = ++batchSeqRef.current;
    const gens: Record<string, number> = {};
    symbols.forEach(s => {
      displaysRef.current.get(s)?.cancel();
      displaysRef.current.delete(s);
      gens[s] = healthSeqRef.current[s] = (healthSeqRef.current[s] ?? 0) + 1;
    });
    setHealthResults(prev => {
      const next = { ...prev };
      symbols.forEach(s => { next[s] = { status: 'loading', decision: '', fullResult: '' }; });
      return next;
    });

    // 本輪實際送 LLM 的檔位（資料失敗者剔除後個別標記；catch 只回收這份名單）
    let attemptedSymbols: string[] = symbols;

    try {
      // 資料準備：併發上限 3（getLatestPrice 不暖 getStockData 快取，冷抓打真網路，429 是常態）。
      // 游標池實作已收斂到 utils/workerPool；buildHealthItem 內部吞錯不 throw 的語意不變。
      const results: (PreparedHealthItem | null)[] = new Array(symbols.length).fill(null);
      await runWithConcurrency(symbols.map((_, i) => i), 3, async (idx) => {
        const it = await buildHealthItem(symbols[idx]);
        if (it) results[idx] = it;
      });
      if (!mountedRef.current) return;

      // 行情抓取失敗（recentData 空）的檔位個別標記為可重試錯誤，不混進送 LLM 的陣列——
      // 空資料會讓 formatHealthCheckData 拋錯，把整批（含正常檔位）一起拖垮
      const healthItems: PortfolioHealthItem[] = [];
      const failedSymbols: string[] = [];
      symbols.forEach((symbol, idx) => {
        if (healthSeqRef.current[symbol] !== gens[symbol]) return;
        const it = results[idx]?.item;
        if (it && it.recentData.length > 0) healthItems.push(it);
        else failedSymbols.push(symbol);
      });
      if (failedSymbols.length > 0) {
        setHealthResults(prev => {
          const next = { ...prev };
          failedSymbols.forEach(symbol => {
            if (healthSeqRef.current[symbol] !== gens[symbol]) return;
            next[symbol] = { status: 'error', decision: '資料取得失敗', fullResult: quoteFailMarkdown(results[symbols.indexOf(symbol)]?.fetchKind, '，或單獨對此檔重跑健檢。') };
          });
          return next;
        });
      }
      let readyItems = healthItems;
      let okSymbols = readyItems.map(it => it.symbol);
      attemptedSymbols = okSymbols;
      if (healthItems.length === 0) return; // 全部失敗：已逐檔標記，本輪不打 LLM

      // 批次仍只打一筆串流請求；部分文本尚不能安全切成 per-symbol 段落，故不寫回。
      const { analyzePortfolioHealth } = await import('../../services/gemini');
      if (!mountedRef.current) return;
      readyItems = readyItems.filter(item => healthSeqRef.current[item.symbol] === gens[item.symbol]);
      okSymbols = readyItems.map(item => item.symbol);
      attemptedSymbols = okSymbols;
      if (readyItems.length === 0) return;
      const result = await analyzePortfolioHealth(readyItems, () => {});

      // fallback 階梯：json 機器區 → 切段 → regex → 全文兜底
      // 切段只對實際送 LLM 的 okSymbols 做（splitHealthReport 要求每個 symbol 都認領到段落）
      const parsed = parseHealthDecisions(result);
      const displayText = parsed ? parsed.cleanedMarkdown : result;
      const split = splitHealthReport(displayText, okSymbols);
      const decisionMap = new Map((parsed?.decisions ?? []).map(d => [d.symbol, d.decision]));

      setHealthResults(prev => {
        if (!mountedRef.current) return prev;
        const next = { ...prev };
        okSymbols.forEach(symbol => {
          if (healthSeqRef.current[symbol] !== gens[symbol]) return;
          const fullResult = split
            ? split.perSymbol[symbol] + (split.overview ? '\n\n---\n\n' + split.overview : '')
            : displayText;
          const d = decisionMap.get(symbol);
          const decision = d
            ? DECISION_EMOJI[d] + d
            : (extractDecisionByRegex(split ? split.perSymbol[symbol] : displayText) ?? '分析完成');
          next[symbol] = { status: 'done', decision, fullResult };
        });
        return next;
      });
    } catch (e) {
      if (!mountedRef.current) return;
      const kind = classifyCaught(e);
      setHealthResults(prev => {
        const next = { ...prev };
        attemptedSymbols.forEach(symbol => {
          if (healthSeqRef.current[symbol] !== gens[symbol]) return;
          next[symbol] = { status: 'error', decision: '分析失敗', fullResult: analysisFailMarkdown(kind) };
        });
        return next;
      });
    } finally {
      if (mountedRef.current && batchSeqRef.current === batchGen) {
        setBatchFailedCount(0);
        setBatchChecking(false);
      }
    }
  }, [items, batchChecking, buildHealthItem, failedHealthSymbols]);

  return {
    healthResults,
    healthModalSymbol, setHealthModalSymbol,
    batchChecking, batchFailedCount, failedHealthSymbols,
    handleSingleHealthCheck, handleBatchHealthCheck,
  };
};
