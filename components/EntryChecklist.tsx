import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Target, ShieldAlert, Filter } from 'lucide-react';
import { EntryFilterResult, StepStatus, Decision } from '../utils/entryFilter';

const statusMeta: Record<StepStatus, { icon: React.ReactNode; ring: string; text: string; chip: string }> = {
  pass: { icon: <CheckCircle2 size={18} />, ring: 'border-ok/40 bg-ok-muted', text: 'text-ok', chip: 'bg-ok-muted text-ok' },
  warn: { icon: <AlertTriangle size={18} />, ring: 'border-warn/40 bg-warn/5', text: 'text-warn', chip: 'bg-warn/15 text-warn' },
  fail: { icon: <XCircle size={18} />, ring: 'border-danger/40 bg-danger-muted', text: 'text-danger', chip: 'bg-danger-muted text-danger' },
};

const decisionMeta: Record<Decision, { label: string; cls: string; sub: string }> = {
  GO:    { label: '進場 GO',  cls: 'bg-ok-muted border-ok/40 text-ok', sub: '符合做多進場條件' },
  WAIT:  { label: '等待',     cls: 'bg-warn/15 border-warn/40 text-warn', sub: '條件尚未到位' },
  NO_GO: { label: 'NO-GO',    cls: 'bg-danger-muted border-danger/40 text-danger', sub: '不符合做多前提' },
};

const EntryChecklist: React.FC<{ result: EntryFilterResult }> = ({ result }) => {
  const dm = decisionMeta[result.decision];
  return (
    <div className="bg-surface-card rounded-card border border-surface-line overflow-hidden">
      <div className="bg-surface-inset px-6 py-4 flex items-center gap-3 border-b border-surface-line">
        <Filter className="text-accent" size={22} />
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
                <span className={c.ok ? 'text-ok' : 'text-danger'}>{c.ok ? '✓' : '✗'}</span>
                <span className="text-slate-300">{c.label}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 進場口訣 + 戒律 */}
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4">
          <h3 className="text-sm font-bold text-slate-200 mb-2">進場口訣 / 戒律</h3>
          <p className="text-xs text-slate-300 mb-2">
            口訣：<span className={result.entryPattern === '皆不符' ? 'text-slate-400' : 'text-ok font-bold'}>{result.entryPattern}</span>
          </p>
          {result.preceptHits.length === 0 ? (
            <p className="text-xs text-ok">✓ 未觸犯做多 10 大戒律</p>
          ) : (
            <ul className="space-y-1">
              {result.preceptHits.map(p => (
                <li key={p.no} className="text-xs flex items-start gap-1.5 text-danger">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                  <span>戒律{p.no}：{p.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 決策卡 */}
        <div className={`rounded-card border ${dm.cls} p-4 flex flex-col`}>
          <div className="flex items-center gap-2">
            <Target size={20} />
            <span className="text-2xl font-extrabold tracking-wide">{dm.label}</span>
          </div>
          <p className="text-xs opacity-90 mt-0.5">{dm.sub}</p>
          <div className="mt-3 text-sm space-y-1">
            <div>信心評分：<span className="font-bold">{result.confidence}</span>/100</div>
            <div>建議進場：<span className="font-bold">{result.entryPrice}</span></div>
            <div>停損①固定：<span className="font-bold">{result.stopPrice}</span>（−5%）</div>
            <div>停損②均線：<span className="font-bold">{result.maGuardPrice ?? '—'}</span>（{result.guardMaLabel ?? '中長線MA20'}，擇一為主防守）</div>
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
