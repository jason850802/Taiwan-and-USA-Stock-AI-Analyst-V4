import React, { useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import { TwFundamentals } from '../types';
import { getTwFundamentals } from '../services/finmind';
import AnalysisResult from './AnalysisResult';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Card from './ui/Card';
import Skeleton from './ui/Skeleton';
import StockSearch from './StockSearch';
import ValuationHeader from './fundamentals/ValuationHeader';
import MonthlyRevenueChart from './fundamentals/MonthlyRevenueChart';
import QuarterlyTrendCharts from './fundamentals/QuarterlyTrendCharts';
import FinancialHealthCards from './fundamentals/FinancialHealthCards';
import DividendTable from './fundamentals/DividendTable';

interface FundamentalsPanelProps {
  initialSymbol: string; // 純代碼（呼叫端已 strip .TW/.TWO），面板掛載後自管內部搜尋狀態
}

const stripTwCode = (raw: string): string => raw.trim().toUpperCase().replace(/\.TWO?$/i, '');
const isTwCode = (code: string): boolean => /^\d{3,6}[A-Z]?$/.test(code);

const WARNING_LABELS: Record<string, string> = {
  info: '公司基本資料',
  income_statement: '損益表',
  balance_sheet: '資產負債表',
  cash_flow: '現金流量表',
  valuation: '估值指標',
  monthly_revenue: '月營收',
  dividends: '股利紀錄',
};

const FundamentalsPanel: React.FC<FundamentalsPanelProps> = ({ initialSymbol }) => {
  const [queryText, setQueryText] = useState(initialSymbol);
  const [requestedSymbol, setRequestedSymbol] = useState(initialSymbol);
  const [fundamentals, setFundamentals] = useState<TwFundamentals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonTwWarning, setNonTwWarning] = useState(false);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(false);

  // AI 解讀結果以 stockId 為 key 快取：切股票不污染、切回免重生成。
  const [aiResults, setAiResults] = useState<Map<string, string>>(new Map());
  const [aiStates, setAiStates] = useState<Map<string, { loading: boolean; error: string | null }>>(new Map());
  const aiRequestIdsRef = useRef(new Map<string, symbol>());

  const fetchFundamentals = async (code: string, force = false) => {
    const requestId = ++requestSeqRef.current;
    setRequestedSymbol(code);
    // 成功資料的 stockId 與目前請求分開；等待時移除舊數字，避免用舊股生成分析。
    setFundamentals(null);
    setLoading(true);
    setError(null);
    try {
      const data = await getTwFundamentals(code, { force });
      if (requestSeqRef.current !== requestId) return;
      setFundamentals(data);
    } catch (err: any) {
      if (requestSeqRef.current !== requestId) return;
      setError(err.message || '基本面資料載入失敗，請稍後再試。');
    } finally {
      if (requestSeqRef.current === requestId) setLoading(false);
    }
  };

  const handleGenerateAi = async () => {
    if (!fundamentals || loading || fundamentals.stockId !== requestedSymbol) return;
    const stockId = fundamentals.stockId;
    if (aiRequestIdsRef.current.has(stockId)) return;
    const requestId = Symbol(stockId);
    aiRequestIdsRef.current.set(stockId, requestId);
    const isCurrent = () => mountedRef.current && aiRequestIdsRef.current.get(stockId) === requestId;
    setAiStates(prev => new Map(prev).set(stockId, { loading: true, error: null }));
    let failure: string | null = null;
    try {
      const { analyzeFundamentals } = await import('../services/gemini');
      if (!isCurrent()) return;
      const report = await analyzeFundamentals(fundamentals);
      if (isCurrent()) setAiResults(prev => new Map(prev).set(stockId, report));
    } catch (err: unknown) {
      failure = err instanceof Error ? err.message : 'AI 解讀失敗，請稍後再試。';
    } finally {
      // A 在背景完成仍保存 A 的報告，但不會清除 B 的 loading／錯誤。
      if (isCurrent()) {
        aiRequestIdsRef.current.delete(stockId);
        setAiStates(prev => new Map(prev).set(stockId, { loading: false, error: failure }));
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchFundamentals(initialSymbol);
    // 卸載或 StrictMode 重掛載後，先前請求一律不得寫回這個面板。
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
      aiRequestIdsRef.current.clear();
    };
    // 僅在掛載時以 initialSymbol 起始一次；之後的股票切換由使用者在面板內搜尋自管。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (raw: string) => {
    const code = stripTwCode(raw);
    if (!isTwCode(code)) {
      setNonTwWarning(true);
      return;
    }
    setNonTwWarning(false);
    setQueryText(code);
    fetchFundamentals(code);
  };

  return (
    <div className="space-y-6">
      <StockSearch
        value={queryText}
        onValueChange={setQueryText}
        onSelect={handleSelect}
        loading={loading}
      />

      {nonTwWarning && (
        <Banner variant="info" onDismiss={() => setNonTwWarning(false)}>
          基本面分頁僅支援台股，請搜尋台股代碼（如 2330）。
        </Banner>
      )}

      {error && (
        <Banner
          variant="error"
          onDismiss={() => setError(null)}
          onRetry={() => fetchFundamentals(requestedSymbol, true)}
        >
          {requestedSymbol}：{error}
        </Banner>
      )}

      {!error && fundamentals && fundamentals.warnings.length > 0 && (
        <Banner
          variant="info"
          onDismiss={() => setFundamentals({ ...fundamentals, warnings: [] })}
          onRetry={() => fetchFundamentals(requestedSymbol, true)}
        >
          部分資料暫時無法取得：{fundamentals.warnings.map(w => WARNING_LABELS[w] || w).join('、')}
        </Banner>
      )}

      {loading && !fundamentals && (
        <Card>
          <p role="status" className="text-sm text-slate-300 mb-3">正在載入 {requestedSymbol} 的基本面資料…</p>
          <Skeleton variant="lines" lines={5} />
        </Card>
      )}

      {fundamentals && (
        <>
          <ValuationHeader fundamentals={fundamentals} />
          <MonthlyRevenueChart data={fundamentals.monthlyRevenue} />
          <QuarterlyTrendCharts data={fundamentals.incomeQuarters} />
          <FinancialHealthCards balanceSheet={fundamentals.balanceSheet} cashFlow={fundamentals.cashFlow} />
          <DividendTable data={fundamentals.dividends} />

          {(() => {
            const aiContent = aiResults.get(fundamentals.stockId);
            const aiLoading = aiStates.get(fundamentals.stockId)?.loading ?? false;
            const aiError = aiStates.get(fundamentals.stockId)?.error;
            if (aiContent || aiLoading) {
              return (
                <>
                  {aiLoading && <p role="status" className="text-sm text-slate-300">正在生成 {fundamentals.stockId} 的 AI 基本面解讀…</p>}
                  <AnalysisResult content={aiContent || ''} loading={aiLoading} title="AI 基本面解讀報告" />
                </>
              );
            }
            return (
              <div className="border border-dashed border-surface-line rounded-card p-6 flex flex-col items-center gap-3 text-center">
                {aiError && <p role="alert" className="text-sm text-warn">{fundamentals.stockId}：{aiError}</p>}
                <Button variant="ai" onClick={handleGenerateAi} className="inline-flex items-center gap-2">
                  <Bot className="w-4 h-4" /> {aiError ? '重試 AI 基本面解讀' : 'AI 基本面解讀'}
                </Button>
              </div>
            );
          })()}

          <p className="text-xs text-slate-500 text-center pt-2">
            資料來源：FinMind ・ 金額單位：新台幣億元 ・ 本頁為資料呈現與 AI 輔助解讀，非投資建議
          </p>
        </>
      )}
    </div>
  );
};

export default FundamentalsPanel;
