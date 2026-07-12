import React from 'react';
import { TwDividendRecord } from '../../types';
import Card from '../ui/Card';

interface DividendTableProps {
  data: TwDividendRecord[];
}

const fmtDividend = (v: number): string => (v === 0 ? '—' : String(v));

const DividendTable: React.FC<DividendTableProps> = ({ data }) => {
  if (data.length === 0) {
    return (
      <Card title="股利發放紀錄（近 5 期）">
        <p className="text-sm text-slate-500 text-center py-8">本區資料暫時無法取得</p>
      </Card>
    );
  }

  return (
    <Card title="股利發放紀錄（近 5 期）">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-surface-inset">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-bold text-slate-300 border border-surface-line">期別</th>
              <th className="px-3 py-2 text-left text-xs font-bold text-slate-300 border border-surface-line">現金股利(元)</th>
              <th className="px-3 py-2 text-left text-xs font-bold text-slate-300 border border-surface-line">股票股利(元)</th>
              <th className="px-3 py-2 text-left text-xs font-bold text-slate-300 border border-surface-line">除息日</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-line">
            {data.map((d, i) => (
              <tr key={i} className="hover:bg-surface-inset/60 transition-colors">
                <td className="px-3 py-2 text-sm text-slate-200 align-top border border-surface-line">{d.period}</td>
                <td className="px-3 py-2 text-sm text-slate-200 align-top border border-surface-line">{fmtDividend(d.cashDividend)}</td>
                <td className="px-3 py-2 text-sm text-slate-200 align-top border border-surface-line">{fmtDividend(d.stockDividend)}</td>
                <td className="px-3 py-2 text-sm text-slate-200 align-top border border-surface-line">{d.exDate || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

export default DividendTable;
