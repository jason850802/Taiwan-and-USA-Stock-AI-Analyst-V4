import React from 'react';
import { TwBalanceSheetSummary, TwCashFlowSummary } from '../../types';
import Card from '../ui/Card';
import StatCard from '../ui/StatCard';

interface FinancialHealthCardsProps {
  balanceSheet: TwBalanceSheetSummary | null;
  cashFlow: TwCashFlowSummary | null;
}

const fmtYi = (v: number | null): string => (v == null ? '—' : `${v.toFixed(2)} 億`);

const cfTone = (v: number | null): 'up' | 'down' | 'neutral' =>
  (v == null ? 'neutral' : (v >= 0 ? 'up' : 'down'));

const FinancialHealthCards: React.FC<FinancialHealthCardsProps> = ({ balanceSheet, cashFlow }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        title="財務體質"
        actions={balanceSheet && <span className="text-xs text-slate-500">資料日期：{balanceSheet.date}</span>}
      >
        {balanceSheet ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard
              label="負債比"
              value={balanceSheet.debtRatioPct != null ? `${balanceSheet.debtRatioPct.toFixed(2)}%` : '—'}
              tone={balanceSheet.debtRatioPct != null && balanceSheet.debtRatioPct > 60 ? 'warn' : 'neutral'}
            />
            <StatCard label="現金" value={fmtYi(balanceSheet.cashYi)} />
            <StatCard label="流動資產" value={fmtYi(balanceSheet.currentAssetsYi)} />
            <StatCard label="總資產" value={fmtYi(balanceSheet.totalAssetsYi)} />
            <StatCard label="股東權益" value={fmtYi(balanceSheet.equityYi)} />
          </div>
        ) : (
          <p className="text-sm text-slate-500 text-center py-8">本區資料暫時無法取得</p>
        )}
      </Card>

      <Card
        title="現金流量"
        actions={cashFlow && <span className="text-xs text-slate-500">年度累計至 {cashFlow.date}</span>}
      >
        {cashFlow ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="營業CF" value={fmtYi(cashFlow.operatingCfYi)} tone={cfTone(cashFlow.operatingCfYi)} />
            <StatCard label="投資CF" value={fmtYi(cashFlow.investingCfYi)} tone={cfTone(cashFlow.investingCfYi)} />
            <StatCard label="籌資CF" value={fmtYi(cashFlow.financingCfYi)} tone={cfTone(cashFlow.financingCfYi)} />
            <StatCard label="資本支出" value={fmtYi(cashFlow.capexYi)} tone={cfTone(cashFlow.capexYi)} />
            <StatCard label="自由現金流 FCF" value={fmtYi(cashFlow.freeCashFlowYi)} tone={cfTone(cashFlow.freeCashFlowYi)} />
          </div>
        ) : (
          <p className="text-sm text-slate-500 text-center py-8">本區資料暫時無法取得</p>
        )}
      </Card>
    </div>
  );
};

export default FinancialHealthCards;
