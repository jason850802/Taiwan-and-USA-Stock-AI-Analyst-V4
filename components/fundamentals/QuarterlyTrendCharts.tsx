import React from 'react';
import {
  Bar, Line, ComposedChart, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import { TwQuarterIncome } from '../../types';
import Card from '../ui/Card';

interface QuarterlyTrendChartsProps {
  data: TwQuarterIncome[];
}

// 共用季度 X 軸格式化：'2026-03-31' → '26Q1'
const formatQuarterLabel = (dateStr: string): string => {
  const [y, m] = dateStr.split('-');
  const month = Number(m);
  const q = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `${y.slice(2)}Q${q}`;
};

const MarginTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload as TwQuarterIncome;
    return (
      <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs backdrop-blur-md bg-opacity-90 z-50">
        <p className="text-slate-400 mb-2 font-medium border-b border-slate-700 pb-1">{formatQuarterLabel(d.quarter)}</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span className="text-slate-300 font-bold">營收</span>
          <span className="text-slate-200">{d.revenueYi != null ? `${d.revenueYi.toFixed(2)} 億` : '—'}</span>
          <span className="font-bold" style={{ color: '#fbbf24' }}>毛利率</span>
          <span className="text-slate-200">{d.grossMarginPct != null ? `${d.grossMarginPct.toFixed(2)}%` : '—'}</span>
          <span className="font-bold" style={{ color: '#38bdf8' }}>營益率</span>
          <span className="text-slate-200">{d.operatingMarginPct != null ? `${d.operatingMarginPct.toFixed(2)}%` : '—'}</span>
          <span className="font-bold" style={{ color: '#a78bfa' }}>淨利率</span>
          <span className="text-slate-200">{d.netMarginPct != null ? `${d.netMarginPct.toFixed(2)}%` : '—'}</span>
        </div>
      </div>
    );
  }
  return null;
};

const EpsTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload as TwQuarterIncome;
    return (
      <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs backdrop-blur-md bg-opacity-90 z-50">
        <p className="text-slate-400 mb-2 font-medium border-b border-slate-700 pb-1">{formatQuarterLabel(d.quarter)}</p>
        <div className="flex justify-between gap-4">
          <span className="text-slate-300 font-bold">EPS</span>
          <span className="text-slate-200">{d.eps != null ? `${d.eps.toFixed(2)} 元` : '—'}</span>
        </div>
      </div>
    );
  }
  return null;
};

const QuarterlyTrendCharts: React.FC<QuarterlyTrendChartsProps> = ({ data }) => {
  if (data.length === 0) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="近 8 季營收與三率">
          <p className="text-sm text-slate-500 text-center py-8">本區資料暫時無法取得</p>
        </Card>
        <Card title="EPS 趨勢（近 8 季）">
          <p className="text-sm text-slate-500 text-center py-8">本區資料暫時無法取得</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card title="近 8 季營收與三率">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="quarter" tickFormatter={formatQuarterLabel} stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="revenue" stroke="#94a3b8" tick={{ fontSize: 11 }} domain={[0, 'auto']} />
              <YAxis yAxisId="margin" orientation="right" stroke="#94a3b8" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<MarginTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
              <Bar yAxisId="revenue" dataKey="revenueYi" name="營收(億)" fill="#64748b" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line yAxisId="margin" type="monotone" dataKey="grossMarginPct" name="毛利率" stroke="#fbbf24" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
              <Line yAxisId="margin" type="monotone" dataKey="operatingMarginPct" name="營益率" stroke="#38bdf8" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
              <Line yAxisId="margin" type="monotone" dataKey="netMarginPct" name="淨利率" stroke="#a78bfa" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="EPS 趨勢（近 8 季）">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="quarter" tickFormatter={formatQuarterLabel} stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <Tooltip content={<EpsTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
              <Bar dataKey="eps" name="EPS" fill="#38bdf8" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                <LabelList
                  dataKey="eps"
                  position="top"
                  formatter={(v: number | null) => (v != null ? v.toFixed(2) : '')}
                  style={{ fill: '#cbd5e1', fontSize: 11 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
};

export default QuarterlyTrendCharts;
