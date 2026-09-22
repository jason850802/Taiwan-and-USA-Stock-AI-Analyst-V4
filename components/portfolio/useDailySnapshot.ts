// components/portfolio/useDailySnapshot.ts — 每日損益快照 effect（Phase 12 T6a 自 Portfolio.tsx 平移）
// Phase 10 S3/D-12：單一 debounced effect 涵蓋所有時點（首抓完成、手動更新報價、
// 增刪改/賣出、匯率到貨）。快照落地後 bump historyTick 通知歷史圖表重讀 localStorage。
// 邏輯零改寫，只是搬家。
import { useEffect, useState } from 'react';
import { PortfolioItem } from '../../types';
import { computeLiveSnapshot, upsertSnapshots } from '../../utils/portfolioHistory';
import { loadSnapshots, saveSnapshots } from '../../utils/portfolioHistoryStore';
import { isTwStock } from '../../utils/portfolioFees';
import type { PriceData } from './useHoldingPrices';

export const useDailySnapshot = (
  items: PortfolioItem[],
  prices: Record<string, PriceData>,
  usdTwdRate: number,
) => {
  const [historyTick, setHistoryTick] = useState(0);   // 快照落地 → 通知歷史圖表重讀 localStorage
  // 名稱只影響顯示；fetchedAt 仍代表一次有效刷新，必須保留原本觸發快照的語意。
  const snapshotPricesKey = JSON.stringify(items.map(item => {
    const price = prices[item.symbol];
    return price
      ? [item.symbol, price.price, price.date ?? null, price.fetchedAt ?? null, !!price.loading, !!price.error]
      : [item.symbol, null];
  }));

  // 守衛 A/B 內建於 computeLiveSnapshot（部分報價/缺匯率 → 該市場跳過，寧缺勿錯）。
  // fallback 32 只准表格顯示用——這裡把無效匯率轉 undefined，禁入持久化快照。
  useEffect(() => {
    if (items.length === 0) return;
    const timer = setTimeout(() => {
      const capturedAt = Date.now();
      const rate = usdTwdRate > 0 ? usdTwdRate : undefined;
      const twSnap = computeLiveSnapshot('TW', items.filter(i => isTwStock(i.symbol)), prices, rate, capturedAt);
      const usSnap = computeLiveSnapshot('US', items.filter(i => !isTwStock(i.symbol)), prices, rate, capturedAt);
      if (!twSnap && !usSnap) return;
      const incoming = [twSnap, usSnap].filter((s): s is NonNullable<typeof s> => s !== null);
      if (saveSnapshots(upsertSnapshots(loadSnapshots(), incoming))) {
        setHistoryTick(t => t + 1);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [items, snapshotPricesKey, usdTwdRate]);

  return { historyTick };
};
