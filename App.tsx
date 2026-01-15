import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import StockChart from './components/StockChart';
import AnalysisResult from './components/AnalysisResult';
import { getStockData } from './services/yahoo';
import { analyzeStockWithGemini } from './services/gemini';
import { StockDataPoint, TimeInterval, StockInfo, IndicatorSettings } from './types';
import { Search, AlertCircle, Loader2, X, Wallet, DollarSign, Zap, BrainCircuit } from 'lucide-react';

const App: React.FC = () => {
  const [symbol, setSymbol] = useState<string>('2330'); // Default TSMC
  const [interval, setInterval] = useState<TimeInterval>('1d'); // Typed Interval
  const [data, setData] = useState<StockDataPoint[]>([]);
  const [info, setInfo] = useState<StockInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string>('');

  // Indicator Settings State
  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSettings>({
    showMA5: true,
    showMA10: true,
    showMA20: true,
    showMA60: true,
    showRSI: true,
    showK: true,
    showD: true,
    showJ: true,
    useAdjusted: true, 
  });

  // Modal State
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [hasHolding, setHasHolding] = useState<boolean | null>(null);
  const [costPrice, setCostPrice] = useState<string>('');
  const [analysisMode, setAnalysisMode] = useState<'fast' | 'thinking'>('fast');

  const fetchData = async (sym: string, intvl: TimeInterval) => {
    setLoading(true);
    setError(null);
    try {
      // Pass interval directly
      const { info, data } = await getStockData(sym, intvl);
      setData(data);
      setInfo(info);
      setAnalysis(''); 
    } catch (err: any) {
      setError(err.message || 'Failed to fetch stock data. Please check the symbol.');
      setData([]);
      setInfo(null);
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchData(symbol, interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval]); 

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData(symbol, interval);
  };

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
    
    const userPosition = {
        hasHolding: hasHolding === true,
        costPrice: hasHolding && costPrice ? parseFloat(costPrice) : undefined
    };

    try {
      const result = await analyzeStockWithGemini(info?.symbol || symbol, data, userPosition, analysisMode);
      setAnalysis(result);
      
      setTimeout(() => {
          const element = document.getElementById('ai-analysis-section');
          if (element) element.scrollIntoView({ behavior: 'smooth' });
      }, 100);

    } catch (err: any) {
        if(err.message.includes("API Key is missing")) {
            setAnalysis("### System Error \n\n **API Key Missing.** \nPlease set `REACT_APP_GEMINI_API_KEY` in your environment to enable AI analysis.");
        } else {
            setAnalysis("### Analysis Failed \n\n Unable to generate report at this time. Please try again later.");
        }
    } finally {
      setAnalyzing(false);
    }
  };

  // Determine if it is a Taiwan stock based on symbol info, not just chip data
  const isTaiwanStock = info 
      ? (info.symbol.endsWith('.TW') || info.symbol.endsWith('.TWO')) 
      : (symbol.endsWith('.TW') || symbol.endsWith('.TWO') || /^\d{4}$/.test(symbol));

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-900 text-slate-100 relative">
      
      {/* Analysis Modal */}
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
                                    ? 'bg-blue-600/20 border-blue-500 text-blue-400 font-bold shadow-[0_0_15px_rgba(59,130,246,0.2)]'
                                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500 hover:bg-slate-800'
                                }`}
                            >
                                <Zap size={18} /> 快捷 (Flash)
                            </button>
                            <button
                                onClick={() => setAnalysisMode('thinking')}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                                    analysisMode === 'thinking'
                                    ? 'bg-purple-600/20 border-purple-500 text-purple-400 font-bold shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500 hover:bg-slate-800'
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
                                    hasHolding === true 
                                    ? 'bg-blue-600/20 border-blue-500 text-blue-400 font-bold shadow-[0_0_15px_rgba(59,130,246,0.2)]' 
                                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500 hover:bg-slate-800'
                                }`}
                            >
                                <Wallet size={18} /> 是，我已持有
                            </button>
                            <button 
                                onClick={() => setHasHolding(false)}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                                    hasHolding === false 
                                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400 font-bold shadow-[0_0_15px_rgba(16,185,129,0.2)]' 
                                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500 hover:bg-slate-800'
                                }`}
                            >
                                <Search size={18} /> 否，空手想買進
                            </button>
                        </div>
                    </div>

                    {hasHolding === true && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                            <label className="text-slate-300 font-medium text-sm block">您的平均成本價位 (元/美元)</label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                                <input 
                                    type="number" 
                                    value={costPrice}
                                    onChange={(e) => setCostPrice(e.target.value)}
                                    placeholder="例如：500.5"
                                    className="w-full bg-slate-900 border border-slate-700 text-white pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-slate-600"
                                />
                            </div>
                            <p className="text-xs text-slate-500">AI 將根據此成本提供客製化的加碼、停利與停損建議。</p>
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

      {/* Updated Sidebar with new props */}
      <Sidebar 
        interval={interval} 
        setInterval={setInterval} 
        settings={indicatorSettings}
        setSettings={setIndicatorSettings}
      />
      
      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        <div className="max-w-7xl mx-auto space-y-6">
            
            {/* Header / Search */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 backdrop-blur-sm">
                <div>
                    <h2 className="text-2xl font-bold text-white mb-1">Market Dashboard</h2>
                    <p className="text-slate-400 text-sm">Real-time technical indicators for Taiwan & US Stocks</p>
                </div>
                
                <form onSubmit={handleSearch} className="flex gap-2 w-full md:w-auto">
                    <div className="relative group w-full md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={18} />
                        <input
                            type="text"
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value)}
                            placeholder="Code (e.g. 2330, AAPL)"
                            className="w-full bg-slate-900 border border-slate-700 text-white pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-slate-600"
                        />
                    </div>
                    <button 
                        type="submit" 
                        disabled={loading}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-medium transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[100px]"
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : 'Search'}
                    </button>
                </form>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-200 p-4 rounded-xl flex items-center gap-3">
                    <AlertCircle size={20} />
                    <span>{error}</span>
                </div>
            )}

            {info && (
                 <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                        <p className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-1">股票代號</p>
                        <div className="flex flex-col">
                            <p className="text-2xl font-bold text-white leading-none">{info.symbol}</p>
                            <p className="text-sm text-slate-400 mt-1 font-medium truncate">{info.name}</p>
                        </div>
                    </div>
                     <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                        <p className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-1">Latest Close</p>
                        <p className={`text-2xl font-bold ${data.length > 1 && data[data.length-1].close > data[data.length-2].close ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {data.length > 0 ? data[data.length-1].close.toFixed(2) : '-'}
                        </p>
                    </div>
                     <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                        <p className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-1">成交量</p>
                        <p className="text-2xl font-bold text-white">
                             {data.length > 0 
                                ? isTaiwanStock 
                                    ? Math.round(data[data.length-1].volume / 1000).toLocaleString() + ' 張' 
                                    : data[data.length-1].volume.toLocaleString()
                                : '-'}
                        </p>
                    </div>
                    <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                         <button 
                            onClick={handleOpenAnalysisModal}
                            disabled={analyzing || loading || data.length === 0}
                            className="w-full h-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg font-bold transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                         >
                            {analyzing ? <Loader2 className="animate-spin" /> : <BotIcon />}
                            AI分析
                         </button>
                    </div>
                 </div>
            )}

            {data.length > 0 && (
                <div className="flex flex-col gap-6">
                    {/* Pass settings and isTaiwanStock to Chart */}
                    <StockChart data={data} settings={indicatorSettings} isTaiwanStock={isTaiwanStock} />

                    <div id="ai-analysis-section" className="pt-4">
                        {analysis || analyzing ? (
                             <AnalysisResult content={analysis} loading={analyzing} />
                        ) : (
                             <div className="bg-slate-800/50 border border-slate-700 border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center">
                                <div className="p-4 bg-slate-800 rounded-full mb-4">
                                    <BotIcon className="text-slate-500 w-8 h-8" />
                                </div>
                                <h3 className="text-slate-300 font-medium mb-2 text-lg">AI Analyst Ready</h3>
                                <p className="text-slate-500 max-w-md">
                                    Click the "AI分析" button above to generate a comprehensive professional report covering Trend, Momentum, and Risk for {info?.symbol}.
                                </p>
                             </div>
                        )}
                    </div>
                </div>
            )}
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