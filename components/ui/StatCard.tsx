import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  tone?: 'up' | 'down' | 'neutral' | 'warn';
  sub?: string;
}

const toneClasses: Record<NonNullable<StatCardProps['tone']>, string> = {
  up: 'text-up',
  down: 'text-down',
  neutral: 'text-white',
  warn: 'text-warn',
};

const StatCard: React.FC<StatCardProps> = ({ label, value, tone = 'neutral', sub }) => (
  <div className="bg-surface-inset rounded-ctl p-3">
    <p className="text-xs text-slate-400 mb-1">{label}</p>
    <p className={`font-mono tabular-nums text-xl font-medium ${toneClasses[tone]}`}>{value}</p>
    {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
  </div>
);

export default StatCard;
