import React from 'react';
import { TimeInterval, IndicatorSettings } from '../types';
import { Activity, Settings, TrendingUp, Clock, Eye, EyeOff, RefreshCcw } from 'lucide-react';

interface SidebarProps {
  interval: TimeInterval;
  setInterval: (interval: TimeInterval) => void;
  settings: IndicatorSettings;
  setSettings: (settings: IndicatorSettings) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ interval, setInterval, settings, setSettings }) => {
  const intervals: { label: string, value: TimeInterval }[] = [
    { label: '15m', value: '15m' },
    { label: '1H', value: '60m' },
    { label: 'Day', value: '1d' },
    { label: 'Week', value: '1wk' },
    { label: 'Month', value: '1mo' },
  ];

  const toggleSetting = (key: keyof IndicatorSettings) => {
    setSettings({
        ...settings,
        [key]: !settings[key]
    });
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

  return (
    <div className="w-full md:w-64 bg-slate-900 border-r border-slate-800 p-6 flex flex-col h-full shrink-0 overflow-y-auto">
      <div className="flex items-center gap-2 mb-8 text-blue-400">
        <TrendingUp size={28} />
        <h1 className="text-xl font-bold tracking-tight text-white">Stock AI</h1>
      </div>

      {/* Interval Selector */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-slate-400 mb-4 uppercase text-xs font-bold tracking-wider">
          <Clock size={14} />
          <span>Time Interval</span>
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
          <span>Config</span>
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
            Toggle this if Moving Averages don't match your broker/Yahoo web. Daily/Weekly usually use Adj.
        </p>
      </div>

      {/* Indicator Toggles */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-slate-400 mb-4 uppercase text-xs font-bold tracking-wider">
          <Eye size={14} />
          <span>Visibility</span>
        </div>
        
        <div className="space-y-4">
            <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase mb-2 ml-1">Moving Averages</p>
                <ToggleItem label="MA 5" sKey="showMA5" color="#fbbf24" />
                <ToggleItem label="MA 10" sKey="showMA10" color="#38bdf8" />
                <ToggleItem label="MA 20" sKey="showMA20" color="#a78bfa" />
                <ToggleItem label="MA 60" sKey="showMA60" color="#34d399" />
            </div>

            <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase mb-2 ml-1">Oscillators</p>
                <ToggleItem label="RSI (14)" sKey="showRSI" color="#38bdf8" />
                <ToggleItem label="KD - K" sKey="showK" color="#facc15" />
                <ToggleItem label="KD - D" sKey="showD" color="#f472b6" />
                <ToggleItem label="KD - J" sKey="showJ" color="#c084fc" />
            </div>
        </div>
      </div>

      <div className="mt-auto pt-6 border-t border-slate-800">
         <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/20">
             <Activity size={14} />
             <span>System Operational</span>
         </div>
      </div>
    </div>
  );
};

export default Sidebar;