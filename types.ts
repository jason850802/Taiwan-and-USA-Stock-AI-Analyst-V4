export interface StockDataPoint {
  date: string; // YYYY-MM-DD or MM-DD HH:mm
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  
  // Adjusted Prices
  openAdj?: number;
  highAdj?: number;
  lowAdj?: number;
  closeAdj?: number;

  ma5?: number;
  ma10?: number;
  ma20?: number;
  ma60?: number;

  // Adjusted Moving Averages
  ma5Adj?: number;
  ma10Adj?: number;
  ma20Adj?: number;
  ma60Adj?: number;

  ma5Dir?: 'up' | 'down' | 'flat';
  ma10Dir?: 'up' | 'down' | 'flat';
  ma20Dir?: 'up' | 'down' | 'flat';
  ma60Dir?: 'up' | 'down' | 'flat';
  
  rsi?: number;
  rsiAdj?: number; // Adjusted RSI

  k?: number;
  d?: number;
  j?: number;
  
  macd?: number;
  macdSignal?: number;
  macdHist?: number;

  // Adjusted MACD
  macdAdj?: number;
  macdSignalAdj?: number;
  macdHistAdj?: number;

  // Institutional Investors (Real Data from FinMind/TWSE)
  foreignBuySell?: number;
  investmentTrustBuySell?: number;
  dealerBuySell?: number;
  // Calculated locally for visual cues
  priceChange?: number;
  priceChangePercent?: number;
}

export interface StockInfo {
  symbol: string;
  name: string;
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

export type TimeInterval = '15m' | '60m' | '1d' | '1wk' | '1mo';

export interface IndicatorSettings {
  showMA5: boolean;
  showMA10: boolean;
  showMA20: boolean;
  showMA60: boolean;
  showRSI: boolean;
  showK: boolean;
  showD: boolean;
  showJ: boolean;
  useAdjusted: boolean; // New Toggle
}