export interface StockDataPoint {
  date: string; // YYYY-MM-DD or MM-DD HH:mm
  timestamp?: number; // Unix timestamp in seconds
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

  // Bollinger Bands (20, 2)
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  bbUpperAdj?: number;
  bbMiddleAdj?: number;
  bbLowerAdj?: number;

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

export interface PortfolioItem {
  id: string;
  symbol: string;
  avgCostPrice: number;       // 成本均價（購入幣別）
  totalShares: number;        // 總股數
  totalCost: number;          // 總成本 TWD（台股 / 美股以TWD購入時使用；美股USD購入時為0）
  brokerDiscount: number;     // 券商折扣（台股專用，e.g. 2.8 = 2.8折）
  buyFee?: number;             // 實付買入手續費（購入幣別）
  cashDividends: number;      // 已領現金股利
  stockDividends: number;     // 已領股票股利（股）
  // ── 美股專用 ───────────────────────────────────────────
  purchaseCurrency?: 'TWD' | 'USD'; // 購入幣別（undefined = TWD 向下相容）
  totalCostUSD?: number;            // 總成本 USD（美股以USD購入時，固定值）
  isUsEtf?: boolean;                // true = 美股ETF（$3固定費）；false = 個股（0.008%）
}

export interface MALineConfig {
  period: number;
  enabled: boolean;
  color: string;
}

export interface IndicatorSettings {
  maLines: MALineConfig[];
  showRSI: boolean;
  showK: boolean;
  showD: boolean;
  showJ: boolean;
  showMACD: boolean;
  showBB: boolean;
  useAdjusted: boolean;
}
