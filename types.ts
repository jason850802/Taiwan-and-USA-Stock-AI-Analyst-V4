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
  chipDataUnavailable?: boolean;
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

// ── 台股基本面（Fundamentals Tab）──────────────────────────
export interface TwQuarterIncome {
  quarter: string;              // 'YYYY-MM-DD' 財報日
  revenueYi: number | null;     // 億元
  grossProfitYi: number | null;
  operatingIncomeYi: number | null;
  pretaxIncomeYi: number | null;
  netIncomeYi: number | null;
  eps: number | null;           // 元
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
}

export interface TwBalanceSheetSummary {
  date: string;
  cashYi: number | null;
  receivablesYi: number | null;
  inventoriesYi: number | null;
  currentAssetsYi: number | null;
  ppeYi: number | null;
  totalAssetsYi: number | null;
  totalLiabilitiesYi: number | null;
  equityYi: number | null;
  debtRatioPct: number | null;
}

export interface TwCashFlowSummary {
  date: string;                 // YTD 累計截止日
  operatingCfYi: number | null;
  investingCfYi: number | null;
  financingCfYi: number | null;
  capexYi: number | null;
  freeCashFlowYi: number | null;
}

export interface TwValuation {
  date: string;
  per: number | null;
  pbr: number | null;
  dividendYieldPct: number | null;
}

export interface TwMonthlyRevenue {
  ym: string;
  revenueYi: number | null;
  yoyPct: number | null;
}

export interface TwDividendRecord {
  period: string | number;
  announceDate: string | null;
  cashDividend: number;
  stockDividend: number;
  exDate: string | null;
}

export interface TwFundamentals {
  stockId: string;
  name: string | null;
  industry: string | null;
  asOf: string;                          // 抓取日
  valuation: TwValuation | null;
  incomeQuarters: TwQuarterIncome[];     // 近 8 季，舊→新
  balanceSheet: TwBalanceSheetSummary | null;
  cashFlow: TwCashFlowSummary | null;
  monthlyRevenue: TwMonthlyRevenue[];    // 近 13 月，舊→新
  dividends: TwDividendRecord[];         // 近 5 期
  warnings: string[];                    // 失敗的 dataset 標籤，供降級 UI
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
