import React, { useState, useEffect, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import ChartToolbar from './components/ChartToolbar';
import QuoteHeader from './components/QuoteHeader';
import StockChart from './components/StockChart';
import AnalysisResult from './components/AnalysisResult';
import Banner from './components/ui/Banner';
import Button from './components/ui/Button';
import Card from './components/ui/Card';
import EntryChecklist from './components/EntryChecklist';
import StockSearch from './components/StockSearch';
import Portfolio from './components/Portfolio';
import { getStockData } from './services/yahoo';
import { analyzeEntryWithGemini } from './services/gemini';
import { runEntryFilter, EntryFilterResult } from './utils/entryFilter';
import { StockDataPoint, TimeInterval, StockInfo, IndicatorSettings, PortfolioItem } from './types';
import { Search, Bot, X, Wallet, DollarSign, Zap, BrainCircuit } from 'lucide-react';
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
    fetchData(info?.symbol || symbol, interval);
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
      const filter = runEntryFilter(sym, data, weeklyData, volumeProj);
      setEntryResult(filter);
      setTimeout(() => {
          document.getElementById('ai-analysis-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

      // ── AI 解讀層（依濾網客觀結論寫報告，單次呼叫）──
      const report = await analyzeEntryWithGemini(filter, userPosition, analysisMode);
      setAnalysis(report);
    } catch (err: any) {
      setAnalysis(err.message || '分析失敗，請稍後再試。');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRefreshQuote = async () => {
    if (data.length === 0 || refreshing || loading) return;
    setRefreshing(true);
    try {
      const result = await getStockData(info?.symbol || symbol, interval);
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
  const latestPoint = data.length > 0 ? data[data.length - 1] : null;
  const previousPoint = data.length > 1 ? data[data.length - 2] : null;
  const latestPrice = latestPoint?.close ?? 0;
  const changeAbs = latestPoint?.priceChange ?? (previousPoint ? latestPrice - previousPoint.close : 0);
  const changePct = latestPoint?.priceChangePercent
    ?? (previousPoint?.close ? (changeAbs / previousPoint.close) * 100 : 0);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-900 text-slate-100 relative">
      
      {showAnalysisModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex justify-between items-center p-4 border-b border-slate-700 bg-slate-800/50">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Bot className="text-blue-400" /> AI 分析參數設定
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
                        <Bot className="w-6 h-6" /> 開始 AI 智能分析
                    </button>
                </div>
            </div>
        </div>
      )}

      <Sidebar
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
              <Banner
                variant="error"
                onDismiss={() => setError(null)}
                onRetry={() => fetchData(info?.symbol || symbol, interval)}
              >
                {error}
              </Banner>
            )}

            {info && (
              <QuoteHeader
                info={info}
                price={latestPrice}
                changeAbs={changeAbs}
                changePct={changePct}
                volume={latestPoint?.volume ?? 0}
                volumeProjection={volumeProj}
                loading={loading}
                refreshing={refreshing}
                analyzing={analyzing}
                hasData={data.length > 0}
                onRefresh={handleRefreshQuote}
                onAnalyze={handleOpenAnalysisModal}
              />
            )}

            {!info && !loading && data.length === 0 && (
              <Card className="py-12 flex flex-col items-center text-center gap-4">
                <Search size={48} className="text-slate-600" />
                <div>
                  <h2 className="text-lg font-medium text-white">搜尋一檔台股或美股開始分析</h2>
                  <p className="text-sm text-slate-400 mt-1">輸入股票代號，查看行情、技術指標與 AI 分析。</p>
                </div>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {[
                    { symbol: '2330', label: '2330 台積電' },
                    { symbol: '0050', label: '0050 元大台灣50' },
                    { symbol: 'AAPL', label: 'AAPL Apple' },
                  ].map(item => (
                    <Button
                      key={item.symbol}
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSymbol(item.symbol);
                        fetchData(item.symbol, interval);
                      }}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </Card>
            )}

            {data.length > 0 && (
                <div className="flex flex-col gap-6">
                    <Card className="p-0 overflow-hidden">
                      <ChartToolbar
                        interval={interval}
                        setInterval={setInterval}
                        settings={indicatorSettings}
                        setSettings={setIndicatorSettings}
                      />
                      <StockChart data={data} settings={indicatorSettings} isTaiwanStock={isTaiwanStock} onToggleSetting={(key: keyof IndicatorSettings) => {
                        if (key === 'maLines') return;
                        setIndicatorSettings(prev => ({ ...prev, [key]: !prev[key] }));
                      }} />
                    </Card>
                    <div id="ai-analysis-section" className="pt-4 flex flex-col gap-6">
                        {entryResult && <EntryChecklist result={entryResult} />}
                        {analysis || analyzing ? (
                             <AnalysisResult content={analysis} loading={analyzing} />
                        ) : !entryResult ? (
                             <div className="bg-slate-800/50 border border-slate-700 border-dashed rounded-xl p-5 flex items-center justify-center gap-3 text-center">
                                <Bot className="text-slate-500 w-5 h-5 shrink-0" />
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

export default App;
