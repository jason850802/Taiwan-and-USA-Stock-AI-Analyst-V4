import React from 'react';
import { TimeInterval, IndicatorSettings, MALineConfig } from '../types';
import { Activity, Settings, TrendingUp, Clock, Eye, EyeOff, RefreshCcw, BarChart2, Wallet } from 'lucide-react';

type AppView = 'dashboard' | 'portfolio';

interface SidebarProps {
  interval: TimeInterval;
  setInterval: (interval: TimeInterval) => void;
  settings: IndicatorSettings;
  setSettings: (settings: IndicatorSettings) => void;
  currentView: AppView;
  setView: (view: AppView) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ interval, setInterval, settings, setSettings, currentView, setView }) => {
  const intervals: { label: string, value: TimeInterval }[] = [
    { label: '15分', value: '15m' },
    { label: '1時', value: '60m' },
    { label: '日', value: '1d' },
    { label: '週', value: '1wk' },
    { label: '月', value: '1mo' },
  ];

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
          className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
          title="選擇顏色"
        />
        <button onClick={() => updateMALine(index, { enabled: !line.enabled })}>
          {line.enabled ? <Eye size={14} className="text-slate-400" /> : <EyeOff size={14} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="w-full md:w-64 bg-slate-900 border-r border-slate-800 p-6 flex flex-col h-full shrink-0 overflow-y-auto">
      <div className="flex items-center gap-2 mb-8 text-blue-400">
        <TrendingUp size={28} />
        <h1 className="text-xl font-bold tracking-tight text-white">Stock AI</h1>
      </div>

      {/* Navigation */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-slate-400 mb-3 uppercase text-xs font-bold tracking-wider">
          <BarChart2 size={14} />
          <span>導覽</span>
        </div>
        <button
          onClick={() => setView('dashboard')}
          className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-lg text-sm font-medium border transition-all mb-2 ${
            currentView === 'dashboard'
              ? 'bg-blue-600/20 border-blue-500 text-blue-300'
              : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700'
          }`}
        >
          <BarChart2 size={15} /> 市場分析
        </button>
        <button
          onClick={() => setView('portfolio')}
          className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-lg text-sm font-medium border transition-all ${
            currentView === 'portfolio'
              ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
              : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700'
          }`}
        >
          <Wallet size={15} /> 我的庫存
        </button>
      </div>

      {/* Interval Selector */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-slate-400 mb-4 uppercase text-xs font-bold tracking-wider">
          <Clock size={14} />
          <span>時間週期</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
            {intervals.map((item) => (
                <button
                    key={item.value}
                    onClick={() => setInterval(item.value)}
                    className={`px-1 py-2 text-xs font-medium rounded-lg transition-colors border ${
                        interval === item.value
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-white'
                    }`}
                >
                    {item.label}
                </button>
            ))}
        </div>
      </div>

      {/* Mode Settings */}
      <div className="mb-6">
         <div className="flex items-center gap-2 text-slate-400 mb-4 uppercase text-xs font-bold tracking-wider">
          <Settings size={14} />
          <span>設定</span>
        </div>
        <button
            onClick={() => toggleSetting('useAdjusted')}
            className={`flex items-center justify-between w-full px-3 py-3 rounded-lg text-xs font-medium border transition-all mb-1 ${
                settings.useAdjusted
                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                : 'bg-slate-900/50 border-slate-800 text-slate-400'
            }`}
        >
            <div className="flex items-center gap-2">
                <RefreshCcw size={14} className={settings.useAdjusted ? "text-indigo-400" : "text-slate-500"} />
                <span>還原權值 (Adj)</span>
            </div>
            <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${settings.useAdjusted ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                <div className={`w-3 h-3 rounded-full bg-white transition-transform ${settings.useAdjusted ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
        </button>
        <p className="text-[10px] text-slate-500 mt-2 px-1 leading-relaxed">
            若均線數值與券商/Yahoo 網頁不同，可切換此選項。日線/週線通常使用還原權值。
        </p>
      </div>

      {/* Indicator Toggles */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-slate-400 mb-4 uppercase text-xs font-bold tracking-wider">
          <Eye size={14} />
          <span>指標顯示</span>
        </div>

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

      <div className="mt-auto pt-6 border-t border-slate-800">
         <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/20">
             <Activity size={14} />
             <span>系統運作中</span>
         </div>
      </div>
    </div>
  );
};

export default Sidebar;
