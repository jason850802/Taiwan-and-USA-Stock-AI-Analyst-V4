import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Eye, EyeOff, RefreshCcw, SlidersHorizontal } from 'lucide-react';
import { IndicatorSettings, MALineConfig, TimeInterval } from '../types';

interface ChartToolbarProps {
  interval: TimeInterval;
  setInterval: (i: TimeInterval) => void;
  settings: IndicatorSettings;
  setSettings: (s: IndicatorSettings) => void;
}

const intervals: { label: string; value: TimeInterval }[] = [
  { label: '15分', value: '15m' },
  { label: '1時', value: '60m' },
  { label: '日', value: '1d' },
  { label: '週', value: '1wk' },
  { label: '月', value: '1mo' },
];

const ChartToolbar: React.FC<ChartToolbarProps> = ({ interval, setInterval, settings, setSettings }) => {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const toggleSetting = (key: keyof IndicatorSettings) => {
    if (key === 'maLines') return;
    setSettings({
        ...settings,
        [key]: !settings[key]
    });
  };

  const updateMALine = (index: number, updates: Partial<MALineConfig>) => {
    const newLines = settings.maLines.map((line, i) =>
      i === index ? { ...line, ...updates } : line
    );
    setSettings({ ...settings, maLines: newLines });
  };

  const ToggleItem = ({ label, sKey, color }: { label: string, sKey: keyof IndicatorSettings, color: string }) => (
      <button
        onClick={() => toggleSetting(sKey)}
        className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-xs font-medium border transition-all mb-1 ${
            settings[sKey]
            ? 'bg-slate-800 border-slate-700 text-slate-200'
            : 'bg-slate-900/50 border-slate-800 text-slate-500'
        }`}
      >
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full`} style={{ backgroundColor: settings[sKey] ? color : '#334155' }}></div>
            <span>{label}</span>
          </div>
          {settings[sKey] ? <Eye size={14} className="text-slate-400" /> : <EyeOff size={14} />}
      </button>
  );

  const MALineItem = ({ line, index }: { line: MALineConfig, index: number }) => (
    <div
      className={`flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs font-medium border transition-all mb-1 ${
        line.enabled
          ? 'bg-slate-800 border-slate-700 text-slate-200'
          : 'bg-slate-900/50 border-slate-800 text-slate-500'
      }`}
    >
      <button
        onClick={() => updateMALine(index, { enabled: !line.enabled })}
        className="shrink-0"
      >
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: line.enabled ? line.color : '#334155' }}></div>
      </button>
      <span className="shrink-0">MA</span>
      <input
        type="number"
        min={1}
        max={999}
        value={line.period}
        onChange={(e) => {
          const val = parseInt(e.target.value);
          if (!isNaN(val) && val >= 1 && val <= 999) {
            updateMALine(index, { period: val });
          }
        }}
        className="w-12 bg-slate-900 border border-slate-700 text-white text-center text-xs py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
      />
      <div className="ml-auto flex items-center gap-1.5">
        <input
          type="color"
          value={line.color}
          onChange={(e) => updateMALine(index, { color: e.target.value })}
          className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
          title="選擇顏色"
        />
        <button onClick={() => updateMALine(index, { enabled: !line.enabled })}>
          {line.enabled ? <Eye size={14} className="text-slate-400" /> : <EyeOff size={14} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-3 flex-wrap px-3 py-2 border-b border-surface-line">
      <div className="flex border border-surface-line rounded-ctl overflow-hidden">
        {intervals.map(item => (
          <button
            key={item.value}
            type="button"
            onClick={() => setInterval(item.value)}
            className={`px-3 py-1 text-xs transition-colors ${
              interval === item.value
                ? 'bg-accent/15 text-accent font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => toggleSetting('useAdjusted')}
        title="若均線數值與券商/Yahoo 網頁不同，可切換此選項。日線/週線通常使用還原權值。"
        className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 rounded-ctl hover:bg-surface-inset transition-colors"
      >
        <RefreshCcw size={14} className={settings.useAdjusted ? 'text-accent' : 'text-slate-500'} />
        <span>還原權值</span>
        <span className={`w-7 h-4 rounded-full p-0.5 transition-colors ${settings.useAdjusted ? 'bg-accent' : 'bg-slate-700'}`}>
          <span className={`block w-3 h-3 rounded-full bg-white transition-transform ${settings.useAdjusted ? 'translate-x-3' : 'translate-x-0'}`} />
        </span>
      </button>

      <div ref={popoverRef} className="relative ml-auto">
        <button
          type="button"
          onClick={() => setOpen(current => !current)}
          aria-expanded={open}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 border border-surface-line rounded-ctl hover:bg-surface-inset transition-colors"
        >
          <SlidersHorizontal size={14} />
          指標
          <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 z-40 w-72 bg-surface-card border border-surface-line rounded-card p-3 max-h-[60vh] overflow-y-auto">
            <div className="space-y-4">
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase mb-2 ml-1">均線（可自訂天數）</p>
                {settings.maLines.map((line, index) => (
                  <MALineItem key={index} line={line} index={index} />
                ))}
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase mb-2 ml-1">技術指標</p>
                <ToggleItem label="MACD" sKey="showMACD" color="#fb923c" />
                <ToggleItem label="RSI (14)" sKey="showRSI" color="#38bdf8" />
                <ToggleItem label="KD - K" sKey="showK" color="#facc15" />
                <ToggleItem label="KD - D" sKey="showD" color="#f472b6" />
                <ToggleItem label="KD - J" sKey="showJ" color="#c084fc" />
                <ToggleItem label="布林通道" sKey="showBB" color="#8b5cf6" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChartToolbar;
