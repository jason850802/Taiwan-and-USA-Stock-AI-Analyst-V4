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
  // ── 歷史損益（Phase 10）────────────────────────────────
  buyDate?: string;                 // 'YYYY-MM-DD'（本地日期）。undefined＝舊資料/未填→回推排除該批
}

// ── 庫存歷史損益：已實現帳本（Phase 10）─────────────────────
export interface RealizedTrade {
  id: string;              // `${Date.now().toString(36)}-${隨機4碼}`（同日多筆不撞）
  lotId: string;           // 來源批次 id（批次刪除後帳仍留存，僅供追溯）
  symbol: string;
  market: 'TW' | 'US';
  sellDate: string;        // 'YYYY-MM-DD' 使用者輸入（可回填歷史日期）
  sharesSold: number;
  sellPrice: number;       // 成交單價（市場幣別：TW=TWD、US=USD）
  grossProceeds: number;   // sellPrice × sharesSold（US 入帳 round2）
  sellFee: number;         // TW: max(1,floor(v×0.001425))；US: calcUsFee 後 round2
  sellTax: number;         // TW: floor(v×taxRate)；US: 0
  costBasis: number;       // 等比成本基礎（市場幣別；乘先除後）
  realizedPnl: number;     // grossProceeds − sellFee − sellTax − costBasis
  divCarried: number;      // 隨賣出移轉到已實現側的現金股利（等比；市場幣別）
  currency: 'TWD' | 'USD'; // 冗餘＝market 幣別，防未來改市場判定規則時帳本失義
  usdTwdRateUsed?: number; // 僅美股 TWD 計價批次賣出時記錄（審計用）
  createdAt: number;
}

// ── 券商對帳單匯入（Phase 11）───────────────────────────────
export type TxnKind = 'buy' | 'sell' | 'dividend';
export type BrokerId = 'sinopac' | 'cathay';

/** 券商無關的中間格式：解析器產出、重播引擎消費（換券商只需新增解析器） */
export interface ParsedTxn {
  broker: BrokerId;
  market: 'TW' | 'US';
  date: string;        // 'YYYY-MM-DD'
  symbol: string;      // '2327' / 'NVDA'（台股不含 .TW 後綴，與既有庫存一致）
  name: string;
  kind: TxnKind;
  shares: number;      // 可為小數（美股碎股）
  price: number;       // 市場幣別單價
  gross: number;       // 成交金額／價金（市場幣別）
  fee: number;         // 帳單實付手續費（不重算，D-06）
  tax: number;         // 帳單實付交易稅（美股恆 0；除息時為代扣稅）
  netTwd?: number;     // 應收/付台幣（美股除息寫入 cashDividends 用）
  dedupeKey: string;   // 台股＝委託單號；美股＝複合鍵（D-11）
  orderRef?: string;   // 台股委託單號（跨 lot 拆帳回溯）
  rawLine: string;     // 原始列摘要（預覽顯示用，不落 localStorage）
}

/** 找不到買進紀錄的賣出（期初部位缺口，D-02：列出讓使用者補成本，不猜數字） */
export interface ImportGap {
  txnIndex: number;
  symbol: string;
  name: string;
  market: 'TW' | 'US';
  sellDate: string;
  sharesMissing: number;
  sellPrice: number;
  costPerShare?: number;   // 使用者填入；未填則該筆賣出略過
  buyDate?: string;        // 預設賣出日前一日（D-13），可改
}

export interface ImportPlan {
  broker: BrokerId;
  txns: ParsedTxn[];                                   // 已去重、已依日期排序
  skippedDuplicates: number;
  unsupported: { rawLine: string; reason: string }[];
  gaps: ImportGap[];
  preview: { buys: number; sells: number; dividends: number };
  dateRange: { from: string; to: string } | null;
}

// ── 庫存歷史損益：每日快照（Phase 10）───────────────────────
// 存「可加成的分解量」不存算好的損益——含息/不含息在渲染期組合（CONTEXT D-05）。
export interface DailyPnlSnapshot {
  date: string;            // 該市場交易日（＝最後一根有效 close 的交易所當地日期）
  market: 'TW' | 'US';
  source: 'live' | 'backfill';
  marketValue: number;     // Σ lot(close × shares)；TW=TWD、US=USD
  totalCost: number;       // Σ 持有批次成本（含買費）；US 為 USD（TWD 計價批次以當時匯率換算）
  estSellCosts: number;    // Σ per-lot 預估賣出費稅（per-lot floor，對齊 StatCards）
  cashDividends: number;   // 快照時點持有批次現金股利累計（US 已換 USD）
  usdTwdRate?: number;     // 有做任何 TWD→USD 換算時必填（審計用）
  symbolCount: number;     // 當日檔數（組成變動偵測／除錯）
  capturedAt: number;      // 寫入時刻 Date.now()
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
