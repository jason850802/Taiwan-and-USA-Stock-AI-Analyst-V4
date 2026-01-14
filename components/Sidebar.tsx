import React from 'react';
import { TimeRange } from '../types';
import { Activity, Settings, TrendingUp } from 'lucide-react';

interface SidebarProps {
  range: TimeRange;
  setRange: (range: TimeRange) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ range, setRange }) => {
  const ranges: TimeRange[] = ['1mo', '3mo', '6mo', '1y', '2y'];

  return (
    <div className="w-full md:w-64 bg-slate-900 border-r border-slate-800 p-6 flex flex-col h-full shrink-0">
      <div className="flex items-center gap-2 mb-10 text-blue-400">
        <TrendingUp size={28} />
        <h1 className="text-xl font-bold tracking-tight text-white">AI Stock Analyst</h1>
      </div>

      <div className="mb-8">
        <div className="flex items-center gap-2 text-slate-400 mb-4 uppercase text-xs font-bold tracking-wider">
          <Settings size={14} />
          <span>Analysis Settings</span>
        </div>
        
        <div className="space-y-2">
            <label className="text-sm text-slate-300 block mb-2">Data Range</label>
            <div className="grid grid-cols-2 gap-2">
                {ranges.map((r) => (
                    <button
                        key={r}
                        onClick={() => setRange(r)}
                        className={`px-3 py-2 text-sm rounded-lg transition-colors border ${
                            range === r 
                            ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20' 
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-white'
                        }`}
                    >
                        {r.toUpperCase()}
                    </button>
                ))}
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
