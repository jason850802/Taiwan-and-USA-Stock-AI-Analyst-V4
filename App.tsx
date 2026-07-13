import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import Sidebar from './components/Sidebar';
import ChartToolbar from './components/ChartToolbar';
import QuoteHeader from './components/QuoteHeader';
import StockChart from './components/StockChart';
import AnalysisResult from './components/AnalysisResult';
import Banner from './components/ui/Banner';
import Button from './components/ui/Button';
import Card from './components/ui/Card';
import Modal from './components/ui/Modal';
import EntryChecklist from './components/EntryChecklist';
import StockSearch from './components/StockSearch';
import { getStockData } from './services/yahoo';
import { analyzeEntryWithGemini } from './services/gemini';
import { runEntryFilter, EntryFilterResult } from './utils/entryFilter';
import { StockDataPoint, TimeInterval, StockInfo, IndicatorSettings, PortfolioItem } from './types';
import { Search, Bot, Wallet, DollarSign, Zap, BrainCircuit, Loader2 } from 'lucide-react';
import { estimateVolumeTrend, VolumeProjection } from './utils/volume';

// 非首屏分頁懶載（D-1d）：切頁時才下載對應 chunk，首屏不 modulepreload
const Portfolio = lazy(() => import('./components/Portfolio'));
const FundamentalsPanel = lazy(() => import('./components/FundamentalsPanel'));

// 懶載分頁切換時的 Suspense fallback（沿用專案 Loader2 載入覆蓋層 pattern，禁止空白）
const tabFallback = (
  <div className="flex flex-col items-center justify-center gap-2 py-24">
    <Loader2 className="animate-spin text-blue-400" size={32} />
    <span className="text-slate-300 text-sm">載入中…</span>
  </div>
);

type AppView = 'dashboard' | 'portfolio' | 'fundamentals';

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
      if (field === 'buyFee') {
        // totalCost 為既定事實，buyFee 僅供手續費記錄，不做交叉重算。
        return u;
      }
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

  // 防競態（B-1）：連點多檔股票時，reqId＋AbortController 保證畫面只反映最後一次請求。
  const fetchSeqRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const fetchData = async (sym: string, intvl: TimeInterval) => {
    const reqId = ++fetchSeqRef.current;
    fetchAbortRef.current?.abort(); // 中止前一請求（主要成本在 Yahoo chart 握手）
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const { info, data } = await getStockData(sym, intvl, {
        signal: controller.signal,
        // SWR 背景刷新到貨：過期 reqId 丟棄；不清 analysis/entryResult——
        // 背景刷新是同標的微幅更新，清掉是退化。
        onRevalidated: (r) => {
          if (fetchSeqRef.current !== reqId) return;
          setData(r.data);
          setInfo(r.info);
        },
      });
      if (fetchSeqRef.current !== reqId) return; // 過期請求的成功結果不落地
      setData(data);
      setInfo(info);
      setAnalysis('');
      setEntryResult(null);
    } catch (err: any) {
      // 舊請求的錯誤（含被 abort 拋出的 AbortError）不得污染新請求的狀態機
      if (fetchSeqRef.current !== reqId) return;
      setError(err.message || 'Failed to fetch stock data.');
      setData([]);
      setInfo(null);
    } finally {
      // loading 歸屬最新請求，舊請求不得提前熄燈
      if (fetchSeqRef.current === reqId) setLoading(false);
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
    // M-1：刷新納入 fetchSeqRef 同一防競態序列——刷新在飛行中若使用者切換標的/週期
    // （fetchData 會遞增序號），舊刷新結果不得回頭覆蓋新標的畫面
    const reqId = ++fetchSeqRef.current;
    try {
      // forceRefresh：否則「更新報價」在快取 TTL 內變 no-op（planner_rulings #5）
      const result = await getStockData(info?.symbol || symbol, interval, { forceRefresh: true });
      if (fetchSeqRef.current !== reqId) return; // 已被較新請求取代
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

  // 基本面分頁掛載時的起始代碼：dashboard 正在看台股就帶入（strip .TW/.TWO），否則預設 2330。
  const fundamentalsInitialSymbol = useMemo(() => {
    const stripped = (info?.symbol || symbol).toUpperCase().replace(/\.TWO?$/i, '');
    return /^\d{3,6}[A-Z]?$/.test(stripped) ? stripped : '2330';
  }, [info, symbol]);

  const volumeProj = useMemo(() => estimateVolumeTrend(data, isTaiwanStock, interval), [data, isTaiwanStock, interval]);
  const latestPoint = data.length > 0 ? data[data.length - 1] : null;
  const previousPoint = data.length > 1 ? data[data.length - 2] : null;
  const latestPrice = latestPoint?.close ?? 0;
  const changeAbs = latestPoint?.priceChange ?? (previousPoint ? latestPrice - previousPoint.close : 0);
  const changePct = latestPoint?.priceChangePercent
    ?? (previousPoint?.close ? (changeAbs / previousPoint.close) * 100 : 0);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-900 text-slate-100 relative">
      
      <Modal
        open={showAnalysisModal}
        onClose={() => setShowAnalysisModal(false)}
        title="AI 分析參數設定"
        maxWidth="max-w-md"
      >
        <div className="space-y-6">
          <section className="space-y-3">
            <p className="text-sm font-medium text-slate-300">分析模式</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAnalysisMode('fast')}
                className={`p-3 rounded-ctl border text-left transition-colors ${
                  analysisMode === 'fast'
                    ? 'border-accent bg-accent/10 text-white'
                    : 'border-surface-line bg-surface-inset text-slate-400'
                }`}
              >
                <span className="flex items-center gap-2 font-medium"><Zap size={18} /> 快捷 (Flash)</span>
                <span className="block text-xs text-slate-500 mt-1">快速完成重點分析</span>
              </button>
              <button
                type="button"
                onClick={() => setAnalysisMode('thinking')}
                className={`p-3 rounded-ctl border text-left transition-colors ${
                  analysisMode === 'thinking'
                    ? 'border-accent bg-accent/10 text-white'
                    : 'border-surface-line bg-surface-inset text-slate-400'
                }`}
              >
                <span className="flex items-center gap-2 font-medium"><BrainCircuit size={18} /> 思考 (Pro)</span>
                <span className="block text-xs text-slate-500 mt-1">進行更深入的推理</span>
              </button>
            </div>
          </section>

          <section className="space-y-3 border-t border-surface-line pt-5">
            <p className="text-sm font-medium text-slate-300">
              持股狀態 <span className="text-slate-500">{info?.symbol}</span>
            </p>
            <div className="grid grid-cols-2 border border-surface-line rounded-ctl overflow-hidden">
              <button
                type="button"
                onClick={() => setHasHolding(false)}
                className={`flex items-center justify-center gap-2 px-3 py-2 text-sm transition-colors ${
                  hasHolding === false ? 'bg-accent/15 text-accent font-medium' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Search size={16} /> 空手
              </button>
              <button
                type="button"
                onClick={() => setHasHolding(true)}
                className={`flex items-center justify-center gap-2 px-3 py-2 text-sm transition-colors ${
                  hasHolding === true ? 'bg-accent/15 text-accent font-medium' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Wallet size={16} /> 持有
              </button>
            </div>

            {hasHolding === true && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300 block">您的平均成本價位</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                  <input
                    type="number"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    placeholder="例如：500.5"
                    className="w-full bg-surface-inset border border-surface-line text-white pl-10 pr-4 py-2.5 rounded-ctl focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
                  />
                </div>
              </div>
            )}
          </section>

          <div>
            <Button
              variant="ai"
              onClick={handleRunAnalysis}
              disabled={hasHolding === null || (hasHolding === true && !costPrice)}
              className="w-full inline-flex items-center justify-center gap-2"
            >
              <Bot className="w-5 h-5" /> 開始 AI 智能分析
            </Button>
            {hasHolding === null && (
              <p className="text-xs text-slate-500 text-center mt-2">請先選擇持股狀態</p>
            )}
            {hasHolding === true && !costPrice && (
              <p className="text-xs text-slate-500 text-center mt-2">請輸入持有成本價</p>
            )}
          </div>
        </div>
      </Modal>

      <Sidebar
        currentView={currentView}
        setView={setCurrentView}
      />

      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        <div className="max-w-7xl mx-auto space-y-6">

        {currentView === 'portfolio' && (
          <Suspense fallback={tabFallback}>
            <Portfolio
              items={portfolioItems}
              onAdd={handlePortfolioAdd}
              onDelete={handlePortfolioDelete}
              onUpdate={handlePortfolioUpdate}
            />
          </Suspense>
        )}

        {currentView === 'fundamentals' && (
          <Suspense fallback={tabFallback}>
            <FundamentalsPanel initialSymbol={fundamentalsInitialSymbol} />
          </Suspense>
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
                      <div className="relative">
                        <StockChart data={data} settings={indicatorSettings} isTaiwanStock={isTaiwanStock} chipDataUnavailable={info?.chipDataUnavailable} onToggleSetting={(key: keyof IndicatorSettings) => {
                          if (key === 'maLines') return;
                          setIndicatorSettings(prev => ({ ...prev, [key]: !prev[key] }));
                        }} />
                        {/* 切週期時的區域載入覆蓋層：蓋住 K 線與其下所有副圖，不覆蓋 ChartToolbar
                            （z-20 > StockChart 內縮放鈕 z-10）；資料就緒 loading 轉 false 即移除 */}
                        {loading && (
                          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-slate-900/60 backdrop-blur-sm">
                            <Loader2 className="animate-spin text-blue-400" size={32} />
                            <span className="text-slate-300 text-sm">載入中…</span>
                          </div>
                        )}
                      </div>
                    </Card>
                    <div id="ai-analysis-section" className="pt-4 grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
                        {entryResult && (
                          <div className="xl:col-span-5">
                            <EntryChecklist result={entryResult} />
                          </div>
                        )}
                        <div className="xl:col-span-7">
                          {analysis || analyzing ? (
                               <AnalysisResult content={analysis} loading={analyzing} />
                          ) : !entryResult ? (
                               <div className="bg-surface-card border border-surface-line border-dashed rounded-card p-5 flex items-center justify-center gap-3 text-center">
                                  <Bot className="text-slate-500 w-5 h-5 shrink-0" />
                                  <p className="text-slate-500 text-sm">點擊上方「AI 分析」按鈕，逐步通過六六大順濾網並生成進場分析報告</p>
                               </div>
                          ) : null}
                        </div>
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
