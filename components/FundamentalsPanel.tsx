import React, { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { TwFundamentals } from '../types';
import { getTwFundamentals } from '../services/finmind';
import { analyzeFundamentals } from '../services/gemini';
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
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [fundamentals, setFundamentals] = useState<TwFundamentals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonTwWarning, setNonTwWarning] = useState(false);

  // AI 解讀結果以 stockId 為 key 快取：切股票不污染、切回免重生成。
  const [aiResults, setAiResults] = useState<Map<string, string>>(new Map());
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const fetchFundamentals = async (code: string, force = false) => {
    setLoading(true);
    setError(null);
    setAiError(null);
    try {
      const data = await getTwFundamentals(code, { force });
      setFundamentals(data);
      setActiveSymbol(code);
    } catch (err: any) {
      setError(err.message || '基本面資料載入失敗，請稍後再試。');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAi = async () => {
    if (!fundamentals) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const report = await analyzeFundamentals(fundamentals);
      setAiResults(prev => new Map(prev).set(fundamentals.stockId, report));
    } catch (err: any) {
      setAiError(err.message || 'AI 解讀失敗，請稍後再試。');
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    fetchFundamentals(initialSymbol);
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
          onRetry={() => fetchFundamentals(activeSymbol || initialSymbol, true)}
        >
          {error}
        </Banner>
      )}

      {!error && fundamentals && fundamentals.warnings.length > 0 && (
        <Banner
          variant="info"
          onDismiss={() => setFundamentals({ ...fundamentals, warnings: [] })}
          onRetry={() => fetchFundamentals(activeSymbol || initialSymbol, true)}
        >
          部分資料暫時無法取得：{fundamentals.warnings.map(w => WARNING_LABELS[w] || w).join('、')}
        </Banner>
      )}

      {loading && !fundamentals && (
        <Card>
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
            if (aiContent || aiLoading) {
              return <AnalysisResult content={aiContent || ''} loading={aiLoading} title="AI 基本面解讀報告" />;
            }
            return (
              <div className="border border-dashed border-surface-line rounded-card p-6 flex flex-col items-center gap-3 text-center">
                {aiError && <p className="text-sm text-warn">{aiError}</p>}
                <Button variant="ai" onClick={handleGenerateAi} className="inline-flex items-center gap-2">
                  <Bot className="w-4 h-4" /> {aiError ? '重試 AI 基本面解讀' : 'AI 基本面解讀'}
                </Button>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
};

export default FundamentalsPanel;
