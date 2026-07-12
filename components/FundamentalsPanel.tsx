import React, { useEffect, useState } from 'react';
import { TwFundamentals } from '../types';
import { getTwFundamentals } from '../services/finmind';
import Banner from './ui/Banner';
import Card from './ui/Card';
import Skeleton from './ui/Skeleton';
import StockSearch from './StockSearch';
import ValuationHeader from './fundamentals/ValuationHeader';
import MonthlyRevenueChart from './fundamentals/MonthlyRevenueChart';
import QuarterlyTrendCharts from './fundamentals/QuarterlyTrendCharts';

interface FundamentalsPanelProps {
  initialSymbol: string; // 純代碼（呼叫端已 strip .TW/.TWO），面板掛載後自管內部搜尋狀態
}

const stripTwCode = (raw: string): string => raw.trim().toUpperCase().replace(/\.TWO?$/i, '');
const isTwCode = (code: string): boolean => /^\d{3,6}[A-Z]?$/.test(code);

const FundamentalsPanel: React.FC<FundamentalsPanelProps> = ({ initialSymbol }) => {
  const [queryText, setQueryText] = useState(initialSymbol);
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [fundamentals, setFundamentals] = useState<TwFundamentals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonTwWarning, setNonTwWarning] = useState(false);

  const fetchFundamentals = async (code: string, force = false) => {
    setLoading(true);
    setError(null);
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
        </>
      )}
    </div>
  );
};

export default FundamentalsPanel;
