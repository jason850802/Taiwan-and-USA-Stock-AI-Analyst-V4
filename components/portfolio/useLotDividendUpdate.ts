// components/portfolio/useLotDividendUpdate.ts — 在庫持股股利自動更新（N1）
//
// 為什麼需要：使用者已有各批「買進日期」，但 cashDividends/stockDividends 欄位要靠
// 手動輸入才會反映在頁首「總損益」的含息/不含息切換上。此 hook 依公開除權息公告
// （FinMind TaiwanStockDividend）自動算出各批應得股利、透過 onUpdate 寫回欄位。
//
// 與既有「估算歷史配息」（PnlHistorySection.runDividendEstimate）的分工：
// 那顆寫**交易流水**（kind='dividend'，餵歷史曲線的已實現側，多批次 FIFO 重播）；
// 這顆寫**在庫 lot 欄位**（餵頁首即時總損益），用 utils/dividendEstimator 的
// estimateLotDividends（單一批次固定股數，比 FIFO 重播簡單，因為 lot 本身就代表定額股數）。
//
// 限台股：美股複委託帳單本身含息，已在對帳單匯入時記入，不需估算（與既有按鈕一致）。
// 覆蓋語意：本函式是「重新計算並寫入目前值」，不是累加——重複執行是冪等的（同樣輸入
// 得同樣輸出）；若使用者曾手動輸入與公告不同的實際金額（例如已扣稅後淨額），按下
// 此按鈕會覆蓋回稅前估算值，這是預期行為（詳見呼叫端按鈕文案）。
import { useState } from 'react';
import { PortfolioItem } from '../../types';
import { isTwStock } from '../../utils/portfolioFees';
import { fetchFinMindRows } from '../../services/finmind';
import { estimateLotDividends, type DividendAnnouncement } from '../../utils/dividendEstimator';
import { runWithConcurrency } from '../../utils/workerPool';

export interface LotDividendState {
  running: boolean;
  msg: string | null;
}

export const useLotDividendUpdate = (
  items: PortfolioItem[],
  onUpdate: (id: string, field: keyof Omit<PortfolioItem, 'id'>, value: number) => void,
) => {
  const [state, setState] = useState<LotDividendState>({ running: false, msg: null });

  const runLotDividendUpdate = async () => {
    if (state.running) return;
    const lots = items.filter(i => isTwStock(i.symbol) && !!i.buyDate);
    if (lots.length === 0) {
      setState({ running: false, msg: '沒有已填買進日期的台股持股可估算（美股帳單本身含息，不需估算）' });
      return;
    }

    setState({ running: true, msg: null });
    const symbols = [...new Set(lots.map(l => l.symbol))];
    const firstDate = lots.reduce((m, l) => (l.buyDate! < m ? l.buyDate! : m), lots[0].buyDate!);
    const annsBySymbol: Record<string, DividendAnnouncement[]> = {};
    const failedSymbols: string[] = [];

    await runWithConcurrency(symbols, 3, async (sym) => {
      const rows = await fetchFinMindRows('TaiwanStockDividend', { data_id: sym, start_date: firstDate });
      annsBySymbol[sym] = rows as DividendAnnouncement[];
    }, {
      onSettled: (sym, result) => { if (!result.ok) failedSymbols.push(sym); },
    });

    let updatedLots = 0;
    let totalCash = 0;
    let totalStock = 0;
    for (const lot of lots) {
      const anns = annsBySymbol[lot.symbol];
      if (!anns || anns.length === 0) continue;
      const est = estimateLotDividends(lot.buyDate!, lot.totalShares, anns);
      totalCash += est.cashDividends;
      totalStock += est.stockDividends;
      if (est.cashDividends !== lot.cashDividends) onUpdate(lot.id, 'cashDividends', est.cashDividends);
      if (est.stockDividends !== lot.stockDividends) onUpdate(lot.id, 'stockDividends', est.stockDividends);
      if (est.cashDividends !== lot.cashDividends || est.stockDividends !== lot.stockDividends) updatedLots++;
    }

    const parts = [`已更新 ${updatedLots}／${lots.length} 批持股`, `現金股利合計 ${totalCash.toLocaleString('zh-TW')} 元（稅前）`];
    if (totalStock > 0) parts.push(`股票股利合計 ${totalStock.toLocaleString('zh-TW')} 股（未併入股數，請自行確認）`);
    if (failedSymbols.length > 0) parts.push(`${failedSymbols.length} 檔查詢失敗`);
    setState({ running: false, msg: parts.join('；') });
  };

  return { lotDividendState: state, runLotDividendUpdate };
};
