import React from 'react';
import { TwFundamentals } from '../../types';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import StatCard from '../ui/StatCard';

interface ValuationHeaderProps {
  fundamentals: TwFundamentals;
}

const fmt = (v: number | null | undefined, digits = 2): string =>
  (v === null || v === undefined) ? '—' : v.toFixed(digits);

const ValuationHeader: React.FC<ValuationHeaderProps> = ({ fundamentals }) => {
  const { name, industry, stockId, valuation, asOf } = fundamentals;
  const dateLabel = valuation?.date || asOf;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <p className="text-lg font-medium text-white truncate">{name || stockId}</p>
          <p className="text-xs text-slate-400 font-mono">{stockId}</p>
          {industry && <Badge variant="neutral">{industry}</Badge>}
        </div>
        <p className="text-xs text-slate-500">資料日期：{dateLabel}</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="本益比 PER" value={fmt(valuation?.per)} />
        <StatCard label="股價淨值比 PBR" value={fmt(valuation?.pbr)} />
        <StatCard
          label="現金殖利率"
          value={valuation?.dividendYieldPct != null ? `${valuation.dividendYieldPct.toFixed(2)}%` : '—'}
        />
      </div>
    </Card>
  );
};

export default ValuationHeader;
