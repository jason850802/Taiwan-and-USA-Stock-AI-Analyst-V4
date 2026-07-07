import React from 'react';
import { Activity, BarChart2, FileBarChart, TrendingUp, Wallet } from 'lucide-react';

type AppView = 'dashboard' | 'portfolio';

interface SidebarProps {
  currentView: AppView;
  setView: (view: AppView) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, setView }) => (
  <div className="w-full md:w-56 bg-surface border-r border-surface-line p-6 flex flex-col h-full shrink-0 overflow-y-auto">
    <div className="flex items-center gap-2 mb-8 text-accent">
      <TrendingUp size={28} />
      <h1 className="text-xl font-bold tracking-tight text-white">Stock AI</h1>
    </div>

    <div className="mb-8">
      <div className="flex items-center gap-2 text-slate-400 mb-3 uppercase text-xs font-bold tracking-wider">
        <BarChart2 size={14} />
        <span>導覽</span>
      </div>
      <button
        onClick={() => setView('dashboard')}
        className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-ctl text-sm font-medium border transition-colors mb-2 ${
          currentView === 'dashboard'
            ? 'bg-accent/15 border-accent text-accent'
            : 'bg-surface-card border-surface-line text-slate-400 hover:text-white hover:bg-surface-inset'
        }`}
      >
        <BarChart2 size={15} /> 市場分析
      </button>
      <button
        onClick={() => setView('portfolio')}
        className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-ctl text-sm font-medium border transition-colors mb-2 ${
          currentView === 'portfolio'
            ? 'bg-accent/15 border-accent text-accent'
            : 'bg-surface-card border-surface-line text-slate-400 hover:text-white hover:bg-surface-inset'
        }`}
      >
        <Wallet size={15} /> 我的庫存
      </button>
      <button
        type="button"
        disabled
        title="即將推出：台股基本面分頁"
        className="flex items-center gap-2 w-full px-3 py-2.5 rounded-ctl text-sm font-medium border border-surface-line bg-surface-card text-slate-400 opacity-50 cursor-not-allowed"
      >
        <FileBarChart size={15} />
        <span>基本面</span>
        <span className="ml-auto text-[10px] bg-surface-inset px-1.5 py-0.5 rounded-ctl">預留</span>
      </button>
    </div>

    <div className="mt-auto pt-6 border-t border-surface-line">
      <div className="flex items-center gap-2 text-ok text-xs font-medium bg-ok-muted p-3 rounded-ctl border border-ok/20">
        <Activity size={14} />
        <span>系統運作中</span>
      </div>
    </div>
  </div>
);

export default Sidebar;
