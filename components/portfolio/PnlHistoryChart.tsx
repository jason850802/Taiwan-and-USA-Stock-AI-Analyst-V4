// components/portfolio/PnlHistoryChart.tsx — 歷史損益折線圖（Phase 10 T6）
// 範本：fundamentals/MonthlyRevenueChart（深色硬編、自訂 Tooltip、isAnimationActive=false）。
// 三線可勾選（預設總損益＋未實現，D-03）；回推區間以 ReferenceArea 底色標示（D-15）。
import React, { useMemo, useState } from 'react';
import {
  Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea,
} from 'recharts';
import { ChartPoint } from '../../utils/portfolioHistory';

interface PnlHistoryChartProps {
  currency: 'TWD' | 'USD';
  points: ChartPoint[];
}

type RangeKey = '1M' | '3M' | '6M' | '1Y' | 'ALL';
const RANGES: { key: RangeKey; label: string; months: number }[] = [
  { key: '1M', label: '1月', months: 1 },
  { key: '3M', label: '3月', months: 3 },
  { key: '6M', label: '6月', months: 6 },
  { key: '1Y', label: '1年', months: 12 },
  { key: 'ALL', label: '全部', months: 0 },
];

const SERIES = [
  { key: 'total' as const, label: '總損益', color: '#38bdf8' },
  { key: 'unrealized' as const, label: '未實現', color: '#fbbf24' },
  { key: 'realizedCum' as const, label: '已實現(累計)', color: '#a78bfa' },
];

// 本地日期減月（禁 toISOString）
const minusMonths = (dateStr: string, months: number): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1 - months, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

const fmtVal = (v: number, currency: 'TWD' | 'USD') =>
  currency === 'USD'
    ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : `${v.toLocaleString('zh-TW', { maximumFractionDigits: 0 })} 元`;

const fmtTick = (v: number, currency: 'TWD' | 'USD'): string => {
  const a = Math.abs(v);
  if (currency === 'USD') return a >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}億`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(0)}萬`;
  return String(v);
};

const PnlTooltip = ({ active, payload, currency }: any) => {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload as ChartPoint;
  return (
    <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs backdrop-blur-md bg-opacity-90 z-50">
      <p className="text-slate-400 mb-2 font-medium border-b border-slate-700 pb-1">
        {p.date}
        {p.source === 'backfill' && <span className="ml-1.5 text-slate-500">（回推）</span>}
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {payload.map((entry: any) => {
          const s = SERIES.find(x => x.key === entry.dataKey);
          const v = entry.value as number;
          return (
            <React.Fragment key={entry.dataKey}>
              <span className="text-slate-300 font-bold" style={{ color: s?.color }}>{s?.label ?? entry.dataKey}</span>
              <span className={v >= 0 ? 'text-up' : 'text-down'}>{v >= 0 ? '+' : ''}{fmtVal(v, currency)}</span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

const PnlHistoryChart: React.FC<PnlHistoryChartProps> = ({ currency, points }) => {
  const [range, setRange] = useState<RangeKey>('3M');
  const [visible, setVisible] = useState<Record<string, boolean>>({ total: true, unrealized: true, realizedCum: false });

  const realizedAllZero = useMemo(() => points.every(p => p.realizedCum === 0), [points]);

  const sliced = useMemo(() => {
    if (points.length === 0) return points;
    const def = RANGES.find(r => r.key === range)!;
    if (def.months === 0) return points;
    const cutoff = minusMonths(points[points.length - 1].date, def.months);
    return points.filter(p => p.date >= cutoff);
  }, [points, range]);

  // 回推區間（在目前視窗內的部分）：x1/x2 必須取自實際資料點（category 軸）
  const backfillSpan = useMemo(() => {
    const bf = sliced.filter(p => p.source === 'backfill');
    return bf.length > 0 ? { x1: bf[0].date, x2: bf[bf.length - 1].date } : null;
  }, [sliced]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        {/* 三線勾選 */}
        <div className="flex items-center gap-1.5">
          {SERIES.map(s => {
            const disabled = s.key === 'realizedCum' && realizedAllZero;
            const on = visible[s.key] && !disabled;
            return (
              <button key={s.key} disabled={disabled}
                onClick={() => setVisible(v => ({ ...v, [s.key]: !v[s.key] }))}
                title={disabled ? '尚無已實現紀錄（賣出或股利移轉後啟用）' : undefined}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1.5
                  ${on ? 'border-slate-500 text-slate-200 bg-surface-inset' : 'border-surface-line text-slate-500'}
                  ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-slate-400'}`}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: on ? s.color : '#475569' }} />
                {s.label}
              </button>
            );
          })}
        </div>
        {/* 範圍切換 */}
        <div className="flex items-center gap-1">
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`text-xs px-2 py-1 rounded-ctl transition-colors
                ${range === r.key ? 'bg-surface-inset text-white border border-slate-500' : 'text-slate-500 hover:text-slate-300'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sliced} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} minTickGap={28}
              tickFormatter={(d: string) => d.slice(5)} />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} width={52}
              tickFormatter={(v: number) => fmtTick(v, currency)} domain={['auto', 'auto']} />
            <Tooltip content={<PnlTooltip currency={currency} />} cursor={{ stroke: '#475569' }} />
            {backfillSpan && (
              <ReferenceArea x1={backfillSpan.x1} x2={backfillSpan.x2} fill="#334155" fillOpacity={0.25}
                label={{ value: '回推區間', position: 'insideTopLeft', fill: '#64748b', fontSize: 10 }} />
            )}
            <ReferenceLine y={0} stroke="#64748b" strokeWidth={1} />
            {SERIES.map(s => (visible[s.key] && !(s.key === 'realizedCum' && realizedAllZero)) && (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                stroke={s.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default PnlHistoryChart;
