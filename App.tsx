import React, { useState, useEffect, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import StockChart from './components/StockChart';
import AnalysisResult from './components/AnalysisResult';
import EntryChecklist from './components/EntryChecklist';
import StockSearch from './components/StockSearch';
import Portfolio from './components/Portfolio';
import { getStockData } from './services/yahoo';
import { analyzeStockWithGemini, analyzeEntryWithGemini } from './services/gemini';
import { runEntryFilter, EntryFilterResult } from './utils/entryFilter';
import { StockDataPoint, TimeInterval, StockInfo, IndicatorSettings, PortfolioItem } from './types';
import { Search, AlertCircle, Loader2, X, Wallet, DollarSign, Zap, BrainCircuit, RefreshCw } from 'lucide-react';
import { estimateVolumeTrend, VolumeProjection } from './utils/volume';

type AppView = 'dashboard' | 'portfolio';

const App: React.FC = () => {
  const [symbol, setSymbol] = useState<string>('2330'); 
  const [interval, setInterval] = useState<TimeInterval>('1d'); 
  const [data, setData] = useState<StockDataPoint[]>([]);
  const [info, setInfo] = useState<StockInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string>('');
  const [entryResult, setEntryResult] = useState<EntryFilterResult | null>(null);

  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSettings>({
    maLines: [
      { period: 5, enabled: true, color: '#fbbf24' },
      { period: 10, enabled: true, color: '#38bdf8' },
      { period: 20, enabled: true, color: '#a78bfa' },
      { period: 60, enabled: true, color: '#34d399' },
      { period: 120, enabled: false, color: '#f472b6' },
      { period: 240, enabled: false, color: '#fb923c' },
    ],
    showRSI: true,
    showK: true,
    showD: true,
    showJ: true,
    showMACD: true,
    showBB: true,
    useAdjusted: true,
  });

  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [hasHolding, setHasHolding] = useState<boolean | null>(null);
  const [costPrice, setCostPrice] = useState<string>('');
  const [analysisMode, setAnalysisMode] = useState<'fast' | 'thinking'>('fast');

  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>(() => {
    try {
      const saved = localStorage.getItem('portfolio_items');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('portfolio_items', JSON.stringify(portfolioItems));
  }, [portfolioItems]);

  const handlePortfolioAdd = (item: Omit<PortfolioItem, 'id'>) => {
    setPortfolioItems(prev => [...prev, { ...item, id: Date.now().toString() }]);
  };

  const handlePortfolioDelete = (id: string) => {
    setPortfolioItems(prev => prev.filter(i => i.id !== id));
  };

  const handlePortfolioUpdate = (id: string, field: keyof Omit<PortfolioItem, 'id'>, value: number) => {
    setPortfolioItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const u = { ...item, [field]: value };
      // TW stocks: cross-field sync for TWD costs
      if (!u.purchaseCurrency || u.purchaseCurrency === 'TWD') {
        if (field === 'totalCost' && u.totalShares > 0)
          u.avgCostPrice = u.totalCost / u.totalShares;
        else if (field === 'avgCostPrice')
          u.totalCost = u.avgCostPrice * u.totalShares;
        else if (field === 'totalShares' && u.totalShares > 0)
          u.avgCostPrice = u.totalCost / u.totalShares;
      } else {
        // US stocks with USD purchase: cross-field sync for USD costs
        if (field === 'totalCostUSD' && u.totalShares > 0)
          u.avgCostPrice = (u.totalCostUSD ?? 0) / u.totalShares;
        else if (field === 'totalShares' && u.totalShares > 0 && u.totalCostUSD)
          u.avgCostPrice = u.totalCostUSD / u.totalShares;
      }
      return u;
    }));
  };

  const fetchData = async (sym: string, intvl: TimeInterval) => {
    setLoading(true);
    setError(null);
    try {
      const { info, data } = await getStockData(sym, intvl);
      setData(data);
      setInfo(info);
      setAnalysis('');
      setEntryResult(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch stock data.');
      setData([]);
      setInfo(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(symbol, interval);
  }, [interval]); 

  const handleOpenAnalysisModal = () => {
      if (data.length === 0) return;
      setHasHolding(null);
      setCostPrice('');
      setAnalysisMode('fast');
      setShowAnalysisModal(true);
  }

  const handleRunAnalysis = async () => {
    setShowAnalysisModal(false);
    setAnalyzing(true);
    setEntryResult(null);
    const userPosition = {
        hasHolding: hasHolding === true,
        costPrice: hasHolding && costPrice ? parseFloat(costPrice) : undefined
    };
    const sym = info?.symbol || symbol;
    try {
      // ── 方案C：先用程式跑「六六大順」逐步濾網（客觀層）──
      // 取週線做日/週趨勢交叉比對（失敗則略過，不阻斷流程）
      let weeklyData: StockDataPoint[] | undefined;
      if (interval === '1d') {
        try { weeklyData = (await getStockData(sym, '1wk')).data; } catch { /* ignore */ }
      }
      const filter = runEntryFilter(sym, data, weeklyData);
      setEntryResult(filter);
      setTimeout(() => {
          document.getElementById('ai-analysis-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

      // ── AI 解讀層（依濾網客觀結論寫報告，單次呼叫）──
      const report = await analyzeEntryWithGemini(filter, userPosition, analysisMode);
      setAnalysis(report);
    } catch (err: any) {
        if(err.message?.includes("API Key is missing")) {
            setAnalysis("### System Error \n\n **API Key Missing.** \nPlease set `REACT_APP_GEMINI_API_KEY` in your environment.");
        } else {
            setAnalysis("### Analysis Failed \n\n Unable to generate report.");
        }
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRefreshQuote = async () => {
    if (data.length === 0 || refreshing || loading) return;
    setRefreshing(true);
    try {
      const result = await getStockData(symbol, interval);
      setData(result.data);
      setInfo(result.info);
    } catch (err: any) {
      console.warn('Refresh failed:', err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const isTaiwanStock = useMemo(() => info 
      ? (info.symbol.endsWith('.TW') || info.symbol.endsWith('.TWO')) 
      : (symbol.endsWith('.TW') || symbol.endsWith('.TWO') || /^\d{4}$/.test(symbol)), [info, symbol]);

  const volumeProj = useMemo(() => estimateVolumeTrend(data, isTaiwanStock, interval), [data, isTaiwanStock, interval]);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-900 text-slate-100 relative">
      
      {showAnalysisModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex justify-between items-center p-4 border-b border-slate-700 bg-slate-800/50">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <BotIcon className="text-blue-400" /> AI 分析參數設定
                    </h3>
                    <button onClick={() => setShowAnalysisModal(false)} className="text-slate-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="p-6 space-y-6">
                    <div className="space-y-3">
                        <p className="text-slate-300 font-medium text-sm">選擇分析模式</p>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setAnalysisMode('fast')}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                                    analysisMode === 'fast'
                                    ? 'bg-blue-600/20 border-blue-500 text-blue-400 font-bold'
                                    : 'bg-slate-900 border-slate-700 text-slate-400'
                                }`}
                            >
                                <Zap size={18} /> 快捷 (Flash)
                            </button>
                            <button
                                onClick={() => setAnalysisMode('thinking')}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                                    analysisMode === 'thinking'
                                    ? 'bg-purple-600/20 border-purple-500 text-purple-400 font-bold'
                                    : 'bg-slate-900 border-slate-700 text-slate-400'
                                }`}
                            >
                                <BrainCircuit size={18} /> 思考 (Pro)
                            </button>
                        </div>
                    </div>
                    <div className="border-t border-slate-700/50" />
                    <div className="space-y-3">
                        <p className="text-slate-300 font-medium text-sm">您目前是否持有 <span className="text-white font-bold">{info?.symbol}</span> 這檔股票？</p>
                        <div className="grid grid-cols-2 gap-3">
                            <button 
                                onClick={() => setHasHolding(true)}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                                    hasHolding === true ? 'bg-blue-600/20 border-blue-500 text-blue-400 font-bold' : 'bg-slate-900 border-slate-700 text-slate-400'
                                }`}
                            >
                                <Wallet size={18} /> 是，我已持有
                            </button>
                            <button 
                                onClick={() => setHasHolding(false)}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                                    hasHolding === false ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400 font-bold' : 'bg-slate-900 border-slate-700 text-slate-400'
                                }`}
                            >
                                <Search size={18} /> 否，空手想買進
                            </button>
                        </div>
                    </div>
                    {hasHolding === true && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                            <label className="text-slate-300 font-medium text-sm block">您的平均成本價位</label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                                <input 
                                    type="number" 
                                    value={costPrice}
                                    onChange={(e) => setCostPrice(e.target.value)}
                                    placeholder="例如：500.5"
                                    className="w-full bg-slate-900 border border-slate-700 text-white pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                                />
                            </div>
                        </div>
                    )}
                    <button 
                        onClick={handleRunAnalysis}
                        disabled={hasHolding === null || (hasHolding === true && !costPrice)}
                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white py-4 rounded-xl font-bold text-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all mt-4 flex items-center justify-center gap-2"
                    >
                        <BotIcon className="w-6 h-6" /> 開始 AI 智能分析
                    </button>
                </div>
            </div>
        </div>
      )}

      <Sidebar
        interval={interval}
        setInterval={setInterval}
        settings={indicatorSettings}
        setSettings={setIndicatorSettings}
        currentView={currentView}
        setView={setCurrentView}
      />

      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        <div className="max-w-7xl mx-auto space-y-6">

        {currentView === 'portfolio' && (
          <Portfolio
            items={portfolioItems}
            onAdd={handlePortfolioAdd}
            onDelete={handlePortfolioDelete}
            onUpdate={handlePortfolioUpdate}
          />
        )}

        {currentView === 'dashboard' && (<>
            {/* Search Bar */}
            <StockSearch
                value={symbol}
                onValueChange={setSymbol}
                onSelect={(sym) => { setSymbol(sym); fetchData(sym, interval); }}
                loading={loading}
            />

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-200 p-4 rounded-xl flex items-center gap-3">
                    <AlertCircle size={20} />
                    <span>{error}</span>
                </div>
            )}

            {info && (
                 <div className="flex flex-wrap items-stretch gap-3">
                    {/* Symbol */}
                    <div className="bg-slate-800 px-5 py-3 rounded-xl border border-slate-700 flex items-center gap-3 min-w-0">
                        <div className="min-w-0">
                            <p className="text-xl font-bold text-white leading-tight truncate">{info.symbol}</p>
                            <p className="text-xs text-slate-400 font-medium truncate">{info.name}</p>
                        </div>
                    </div>

                    {/* Price */}
                    <div className="bg-slate-800 px-5 py-3 rounded-xl border border-slate-700 flex items-center gap-2">
                        <div>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">收盤</p>
                            <div className="flex items-baseline gap-1.5">
                                <p className={`text-xl font-bold ${data.length > 1 && data[data.length-1].close > data[data.length-2].close ? 'text-red-400' : 'text-emerald-400'}`}>
                                    {data.length > 0 ? data[data.length-1].close.toFixed(2) : '-'}
                                </p>
                                {data.length > 0 && data[data.length-1].priceChangePercent !== undefined && (
                                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${data[data.length-1].priceChangePercent! > 0 ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                        {data[data.length-1].priceChangePercent! > 0 ? '+' : ''}{data[data.length-1].priceChangePercent!.toFixed(2)}%
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Volume */}
                    <div className="bg-slate-800 px-5 py-3 rounded-xl border border-slate-700">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">成交量</p>
                        <p className="text-xl font-bold text-white leading-tight">
                            {data.length > 0
                                ? isTaiwanStock
                                    ? Math.round(data[data.length-1].volume / 1000).toLocaleString() + ' 張'
                                    : data[data.length-1].volume.toLocaleString()
                                : '-'}
                        </p>
                        {volumeProj && volumeProj.status !== 'Insufficient' && (
                            <p className={`text-[10px] font-medium ${volumeProj.changePercent >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                                {volumeProj.status === 'Intraday'
                                    ? `預估 ${isTaiwanStock
                                        ? Math.round(volumeProj.projectedVolume / 1000).toLocaleString()
                                        : volumeProj.projectedVolume.toLocaleString()
                                      } (${volumeProj.changePercent >= 0 ? '+' : ''}${volumeProj.changePercent.toFixed(1)}%)`
                                    : `量變化 ${volumeProj.changePercent >= 0 ? '+' : ''}${volumeProj.changePercent.toFixed(1)}%`}
                            </p>
                        )}
                    </div>

                    {/* Refresh Button */}
                    <button
                        onClick={handleRefreshQuote}
                        disabled={refreshing || loading || data.length === 0}
                        className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-3 rounded-xl font-medium transition-all border border-slate-600 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
                        title="更新最新報價、成交量與預估量"
                    >
                        <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
                        {refreshing ? '更新中...' : '更新報價'}
                    </button>

                    {/* AI Button */}
                    <button
                        onClick={handleOpenAnalysisModal}
                        disabled={analyzing || loading || data.length === 0}
                        className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                        {analyzing ? <Loader2 className="animate-spin" /> : <BotIcon className="group-hover:scale-110 transition-transform" />}
                        AI 分析
                    </button>
                 </div>
            )}

            {data.length > 0 && (
                <div className="flex flex-col gap-6">
                    <StockChart data={data} settings={indicatorSettings} isTaiwanStock={isTaiwanStock} onToggleSetting={(key: keyof IndicatorSettings) => {
                      if (key === 'maLines') return;
                      setIndicatorSettings(prev => ({ ...prev, [key]: !prev[key] }));
                    }} />
                    <div id="ai-analysis-section" className="pt-4 flex flex-col gap-6">
                        {entryResult && <EntryChecklist result={entryResult} />}
                        {analysis || analyzing ? (
                             <AnalysisResult content={analysis} loading={analyzing} />
                        ) : !entryResult ? (
                             <div className="bg-slate-800/50 border border-slate-700 border-dashed rounded-xl p-5 flex items-center justify-center gap-3 text-center">
                                <BotIcon className="text-slate-500 w-5 h-5 shrink-0" />
                                <p className="text-slate-500 text-sm">點擊上方「AI 分析」按鈕，逐步通過六六大順濾網並生成進場分析報告</p>
                             </div>
                        ) : null}
                    </div>
                </div>
            )}
        </>)}
        </div>
      </main>
    </div>
  );
};

const BotIcon = ({ className = "" }: { className?: string }) => (
    <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" 
    className={className}
    >
        <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/>
        <path d="M4 11h16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/>
        <path d="M9 16v1"/>
        <path d="M15 16v1"/>
    </svg>
)

export default App;