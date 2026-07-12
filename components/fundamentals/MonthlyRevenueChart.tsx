import React from 'react';
import {
  Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { TwMonthlyRevenue } from '../../types';
import Card from '../ui/Card';

interface MonthlyRevenueChartProps {
  data: TwMonthlyRevenue[];
}

const RevenueTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload as TwMonthlyRevenue;
    return (
      <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs backdrop-blur-md bg-opacity-90 z-50">
        <p className="text-slate-400 mb-2 font-medium border-b border-slate-700 pb-1">{d.ym}</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span className="text-slate-300 font-bold">營收</span>
          <span className="text-slate-200">{d.revenueYi != null ? `${d.revenueYi.toFixed(2)} 億` : '—'}</span>
          <span className="text-slate-300 font-bold">YoY</span>
          <span className={d.yoyPct == null ? 'text-slate-400' : (d.yoyPct >= 0 ? 'text-up' : 'text-down')}>
            {d.yoyPct != null ? `${d.yoyPct >= 0 ? '+' : ''}${d.yoyPct.toFixed(2)}%` : '—'}
          </span>
        </div>
      </div>
    );
  }
  return null;
};

// 台股慣例：YoY 正紅負綠，以自訂圓點呈現（連接線本身維持單一顏色，避免雙色折線的可讀性問題）。
const YoyDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (payload.yoyPct == null || cx == null || cy == null) return null;
  const color = payload.yoyPct >= 0 ? '#f0405a' : '#22c55e';
  return <circle cx={cx} cy={cy} r={3} fill={color} stroke={color} />;
};

const MonthlyRevenueChart: React.FC<MonthlyRevenueChartProps> = ({ data }) => {
  if (data.length === 0) {
    return (
      <Card title="月營收趨勢（近 13 月）">
        <p className="text-sm text-slate-500 text-center py-8">本區資料暫時無法取得</p>
      </Card>
    );
  }

  return (
    <Card title="月營收趨勢（近 13 月）">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis dataKey="ym" stroke="#94a3b8" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="revenue" stroke="#94a3b8" tick={{ fontSize: 11 }} domain={[0, 'auto']} />
            <YAxis yAxisId="yoy" orientation="right" stroke="#94a3b8" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
            <Bar yAxisId="revenue" dataKey="revenueYi" name="營收(億)" fill="#38bdf8" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Line
              yAxisId="yoy"
              type="monotone"
              dataKey="yoyPct"
              name="YoY%"
              stroke="#fbbf24"
              strokeWidth={2}
              dot={<YoyDot />}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};

export default MonthlyRevenueChart;
