// utils/txnStore.ts — 完整買賣流水（Phase 11 追加）
//
// 為什麼需要：歷史損益回推原本從「現存持股」逆推，完全清倉的部位其 lot 已被移除，
// 無法還原買進日期與成本，於是那些股票整段歷史都消失在曲線上
// （使用者實例：交易過 124 檔、在庫僅 15 檔 → 109 檔的歷史全缺）。
// 保存流水後，回推可逐日重播買賣，重建每一天的真實持倉。
import { ParsedTxn, PortfolioItem, RealizedTrade, TxnKind } from '../types';
import { isTwStock } from './portfolioFees';

const KEY = 'portfolio_transactions_v1';

/** 精簡版交易紀錄（不存 rawLine 等大欄位，控制 localStorage 用量） */
export interface StoredTxn {
  date: string;            // 'YYYY-MM-DD'
  symbol: string;
  name: string;
  market: 'TW' | 'US';
  kind: TxnKind;
  shares: number;
  price: number;
  gross: number;           // 市場幣別成交金額
  fee: number;
  tax: number;
  netTwd?: number;         // 美股配息用（TWD）
  source: 'import' | 'manual';
  key: string;             // 去重鍵（匯入來源用 dedupeKey；手動用生成鍵）
}

export const fromParsedTxn = (t: ParsedTxn): StoredTxn => ({
  date: t.date, symbol: t.symbol, name: t.name, market: t.market, kind: t.kind,
  shares: t.shares, price: t.price, gross: t.gross, fee: t.fee, tax: t.tax,
  ...(t.netTwd !== undefined ? { netTwd: t.netTwd } : {}),
  source: 'import', key: t.dedupeKey,
});

/** 手動新增持股 → 一筆買進流水（無 buyDate 者不入流水，回推本就無法定位） */
export const fromManualLot = (lot: PortfolioItem): StoredTxn | null => {
  if (!lot.buyDate) return null;
  const market: 'TW' | 'US' = isTwStock(lot.symbol) ? 'TW' : 'US';
  const isUsd = market === 'US' && lot.purchaseCurrency === 'USD';
  const cost = isUsd ? (lot.totalCostUSD ?? 0) : lot.totalCost;
  const fee = lot.buyFee ?? 0;
  return {
    date: lot.buyDate, symbol: lot.symbol, name: lot.symbol, market, kind: 'buy',
    shares: lot.totalShares, price: lot.totalShares > 0 ? (cost - fee) / lot.totalShares : 0,
    gross: cost - fee, fee, tax: 0, source: 'manual', key: `manual|lot|${lot.id}`,
  };
};

/** 手動賣出 → 一筆賣出流水 */
export const fromManualTrade = (t: RealizedTrade): StoredTxn => ({
  date: t.sellDate, symbol: t.symbol, name: t.symbol, market: t.market, kind: 'sell',
  shares: t.sharesSold, price: t.sellPrice, gross: t.grossProceeds,
  fee: t.sellFee, tax: t.sellTax, source: 'manual', key: `manual|trade|${t.id}`,
});

export const loadTxns = (): StoredTxn[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.txns)) {
      console.warn('[txnStore] 未知版本的交易流水（原樣保留，以空流水啟動）:', parsed?.version);
      return [];
    }
    return parsed.txns as StoredTxn[];
  } catch {
    return [];
  }
};

export const saveTxns = (txns: StoredTxn[]): boolean => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, txns }));
    return true;
  } catch {
    console.warn('[txnStore] 交易流水寫入失敗（storage 已滿）');
    return false;
  }
};

/** 併入新交易，依 key 去重（同一筆不重複累積） */
export const appendTxns = (prev: StoredTxn[], incoming: StoredTxn[]): StoredTxn[] => {
  const seen = new Set(prev.map(t => t.key));
  const out = [...prev];
  for (const t of incoming) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    out.push(t);
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
};

/** 移除某筆手動紀錄的流水（刪除持股／刪除帳本紀錄時同步） */
export const removeTxnByKey = (prev: StoredTxn[], key: string): StoredTxn[] =>
  prev.filter(t => t.key !== key);
