export interface StockDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma5?: number;
  ma10?: number;
  ma20?: number;
  ma60?: number;
  ma5Dir?: 'up' | 'down' | 'flat';
  ma10Dir?: 'up' | 'down' | 'flat';
  ma20Dir?: 'up' | 'down' | 'flat';
  ma60Dir?: 'up' | 'down' | 'flat';
  rsi?: number;
  k?: number;
  d?: number;
  j?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  // Institutional Investors (Real Data from FinMind/TWSE)
  foreignBuySell?: number;
  investmentTrustBuySell?: number;
  dealerBuySell?: number;
}

export interface StockInfo {
  symbol: string;
  name: string; // Name is now required
  currency: string;
  exchangeTimezoneName: string;
}

export interface TechnicalIndicators {
  lastClose: number;
  lastVolume: number;
  ma5: number;
  ma10: number;
  ma20: number;
  ma60: number;
  rsi: number;
  k: number;
  d: number;
  j: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  volumeAvg5: number;
  volumeTrend: 'UP' | 'DOWN' | 'FLAT';
}

export interface AIAnalysisResult {
  decision: 'BUY' | 'SELL' | 'HOLD';
  confidence: string;
  summary: string;
  details: string;
}

export type TimeRange = '1mo' | '3mo' | '6mo' | '1y' | '2y';