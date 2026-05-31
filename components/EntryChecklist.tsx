import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Target, ShieldAlert, Filter } from 'lucide-react';
import { EntryFilterResult, StepStatus, Decision } from '../utils/entryFilter';

const statusMeta: Record<StepStatus, { icon: React.ReactNode; ring: string; text: string; chip: string }> = {
  pass: { icon: <CheckCircle2 size={18} />, ring: 'border-emerald-500/40 bg-emerald-500/5', text: 'text-emerald-400', chip: 'bg-emerald-500/15 text-emerald-300' },
  warn: { icon: <AlertTriangle size={18} />, ring: 'border-amber-500/40 bg-amber-500/5', text: 'text-amber-400', chip: 'bg-amber-500/15 text-amber-300' },
  fail: { icon: <XCircle size={18} />, ring: 'border-red-500/40 bg-red-500/5', text: 'text-red-400', chip: 'bg-red-500/15 text-red-300' },
};

const decisionMeta: Record<Decision, { label: string; cls: string; sub: string }> = {
  GO:    { label: '進場 GO',  cls: 'from-emerald-600 to-green-600', sub: '符合做多進場條件' },
  WAIT:  { label: '等待',     cls: 'from-amber-600 to-yellow-600',  sub: '條件尚未到位' },
  NO_GO: { label: 'NO-GO',    cls: 'from-red-600 to-rose-600',      sub: '不符合做多前提' },
};

const EntryChecklist: React.FC<{ result: EntryFilterResult }> = ({ result }) => {
  const dm = decisionMeta[result.decision];
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl">
      <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4 flex items-center gap-3 border-b border-slate-700">
        <Filter className="text-blue-400" size={22} />
        <h2 className="text-lg font-bold text-white tracking-wide">
          六六大順進場濾網 · {result.symbol}
        </h2>
        <span className="ml-auto text-xs text-slate-400">{result.asof}　收 {result.price}</span>
      </div>

      <div className="p-5 grid gap-3 md:grid-cols-2">
        {result.steps.map(s => {
          const m = statusMeta[s.status];
          return (
            <div key={s.id} className={`rounded-lg border px-4 py-3 ${m.ring}`}>
              <div className="flex items-center gap-2">
                <span className={m.text}>{m.icon}</span>
                <span className="font-bold text-slate-100">{s.id}. {s.name}</span>
                <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full font-medium ${m.chip}`}>
                  {s.status === 'pass' ? '通過' : s.status === 'warn' ? '警示' : '不符'}
                </span>
              </div>
              <p className={`mt-1 text-sm font-medium ${m.text}`}>{s.verdict}</p>
              <ul className="mt-1 space-y-0.5">
                {s.details.map((d, i) => (
                  <li key={i} className="text-xs text-slate-400 leading-relaxed">{d}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* SOP + 戒律 + 決策 */}
      <div className="px-5 pb-5 grid gap-4 lg:grid-cols-3">
        {/* SOP */}
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4">
          <h3 className="text-sm font-bold text-slate-200 mb-2">選股 SOP 6 必要條件</h3>
          <ul className="space-y-1">
            {result.sop.map((c, i) => (
              <li key={i} className="text-xs flex items-start gap-1.5">
                <span className={c.ok ? 'text-emerald-400' : 'text-red-400'}>{c.ok ? '✓' : '✗'}</span>
                <span className="text-slate-300">{c.label}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 進場口訣 + 戒律 */}
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4">
          <h3 className="text-sm font-bold text-slate-200 mb-2">進場口訣 / 戒律</h3>
          <p className="text-xs text-slate-300 mb-2">
            口訣：<span className={result.entryPattern === '皆不符' ? 'text-slate-400' : 'text-emerald-300 font-bold'}>{result.entryPattern}</span>
          </p>
          {result.preceptHits.length === 0 ? (
            <p className="text-xs text-emerald-400">✓ 未觸犯做多 10 大戒律</p>
          ) : (
            <ul className="space-y-1">
              {result.preceptHits.map(p => (
                <li key={p.no} className="text-xs flex items-start gap-1.5 text-red-300">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                  <span>戒律{p.no}：{p.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 決策卡 */}
        <div className={`rounded-lg bg-gradient-to-br ${dm.cls} p-4 text-white flex flex-col`}>
          <div className="flex items-center gap-2">
            <Target size={20} />
            <span className="text-2xl font-extrabold tracking-wide">{dm.label}</span>
          </div>
          <p className="text-xs opacity-90 mt-0.5">{dm.sub}</p>
          <div className="mt-3 text-sm space-y-1">
            <div>信心評分：<span className="font-bold">{result.confidence}</span>/100</div>
            <div>建議進場：<span className="font-bold">{result.entryPrice}</span></div>
            <div>停損價：<span className="font-bold">{result.stopPrice}</span>（−5%）</div>
          </div>
          <p className="text-[11px] opacity-90 mt-2 leading-relaxed">{result.takeProfitRule}</p>
        </div>
      </div>

      <div className="px-5 pb-4">
        <p className="text-xs text-slate-400">{result.summary}</p>
        <p className="text-[10px] text-slate-600 mt-1">※ 技術面教學框架推演，非投資建議；實際進出由使用者自負。</p>
      </div>
    </div>
  );
};

export default EntryChecklist;
