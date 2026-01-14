import { StockDataPoint, TimeRange, StockInfo } from '../types';
import { calculateSMA, calculateRSI, calculateMACD, calculateKDJ } from '../utils/math';

const CORS_PROXY = 'https://corsproxy.io/?';
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
// FinMind API Source (Proxies TWSE data)
const FINMIND_BASE = 'https://api.finmindtrade.com/api/v4/data';

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        currency: string;
        symbol: string;
        exchangeTimezoneName: string;
        regularMarketPrice: number;
        previousClose: number;
        longName?: string; // Company Full Name
        shortName?: string; // Company Short Name
      };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: number[];
          high: number[];
          low: number[];
          close: number[];
          volume: number[];
        }>;
      };
    }> | null;
    error: any;
  };
}

// Fetch Institutional Data (Foreign/Trust) from FinMind
const fetchInstitutionalData = async (stockId: string, startDate: string) => {
    const cleanId = stockId.replace('.TW', '').replace('.TWO', '');
    const url = `${FINMIND_BASE}?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${cleanId}&start_date=${startDate}`;
    
    try {
        const res = await fetch(url);
        const json = await res.json();
        if (json.msg === 'success' && Array.isArray(json.data)) {
            return json.data;
        }
        return [];
    } catch (e) {
        console.warn("Failed to fetch institutional data from FinMind", e);
        return [];
    }
};

// Fetch Daily Price/Volume Data from FinMind (Source: TWSE)
// This is used to correct Yahoo's often inaccurate volume data for TW stocks.
const fetchFinMindPriceVolume = async (stockId: string, startDate: string) => {
    const cleanId = stockId.replace('.TW', '').replace('.TWO', '');
    const url = `${FINMIND_BASE}?dataset=TaiwanStockPrice&data_id=${cleanId}&start_date=${startDate}`;
    
    try {
        const res = await fetch(url);
        const json = await res.json();
        if (json.msg === 'success' && Array.isArray(json.data)) {
            return json.data;
        }
        return [];
    } catch (e) {
        console.warn("Failed to fetch price/volume data from FinMind", e);
        return [];
    }
}

// Fetch Stock Info (Name) from FinMind for Taiwan Stocks
const fetchFinMindStockInfo = async (stockId: string) => {
    const cleanId = stockId.replace('.TW', '').replace('.TWO', '');
    const url = `${FINMIND_BASE}?dataset=TaiwanStockInfo&data_id=${cleanId}`;
    
    try {
        const res = await fetch(url);
        const json = await res.json();
        if (json.msg === 'success' && Array.isArray(json.data) && json.data.length > 0) {
            // FinMind usually returns data sorted by date, latest first, or just one entry for info
            return json.data[0].stock_name; 
        }
        return null;
    } catch (e) {
        console.warn("Failed to fetch stock info from FinMind", e);
        return null;
    }
};

const fetchRawData = async (symbol: string) => {
  // CRITICAL: Always fetch 5 years of data to ensure MACD/EMA/RSI calculations have enough history to converge.
  const range = '5y';
  const cleanSymbol = symbol.trim().toUpperCase();

  // Heuristic:
  // 1. If it contains numbers (e.g. "2330", "0050"), it's likely a TW stock. Try suffixes.
  // 2. If it's pure letters (e.g. "AAPL", "TSLA"), try as-is first (US Stock).
  const looksLikeTaiwanStock = /[0-9]/.test(cleanSymbol);

  if (looksLikeTaiwanStock) {
      // Logic for TW stocks: Try .TW, then .TWO
      const target = cleanSymbol.replace('.TW', '').replace('.TWO', '');
      try {
          return await queryYahoo(`${target}.TW`, range);
      } catch (e) {
          console.log(`Failed to fetch ${target}.TW, trying .TWO`);
          return await queryYahoo(`${target}.TWO`, range);
      }
  } else {
      // Logic for US/Global stocks: Try direct first
      try {
          return await queryYahoo(cleanSymbol, range);
      } catch (e) {
          // If direct fails, fallback to trying TW suffixes (in case user typed a ticker that happens to be an ETF code with letters?)
          console.log(`Failed to fetch ${cleanSymbol}, trying fallback suffixes`);
          try {
             return await queryYahoo(`${cleanSymbol}.TW`, range);
          } catch {
             return await queryYahoo(`${cleanSymbol}.TWO`, range);
          }
      }
  }
};

const queryYahoo = async (symbol: string, range: string): Promise<YahooChartResponse> => {
    // ADDED: lang=zh-Hant-TW & region=TW to force Traditional Chinese names for Taiwan stocks
    const url = `${CORS_PROXY}${encodeURIComponent(`${YAHOO_BASE}${symbol}?interval=1d&range=${range}&lang=zh-Hant-TW&region=TW`)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch error: ${res.statusText}`);
    const json = await res.json();
    if (json.chart.error) throw new Error(JSON.stringify(json.chart.error));
    if (!json.chart.result || json.chart.result.length === 0) throw new Error('No data found');
    return json as YahooChartResponse;
};

const filterDataByRange = (data: StockDataPoint[], range: TimeRange): StockDataPoint[] => {
    if (data.length === 0) return [];
    
    const now = new Date();
    let startDate = new Date();
    
    switch (range) {
        case '1mo': startDate.setMonth(now.getMonth() - 1); break;
        case '3mo': startDate.setMonth(now.getMonth() - 3); break;
        case '6mo': startDate.setMonth(now.getMonth() - 6); break;
        case '1y': startDate.setFullYear(now.getFullYear() - 1); break;
        case '2y': startDate.setFullYear(now.getFullYear() - 2); break;
        default: startDate.setMonth(now.getMonth() - 6);
    }

    return data.filter(d => new Date(d.date) >= startDate);
};

export const getStockData = async (symbol: string, range: TimeRange = '6mo'): Promise<{info: StockInfo, data: StockDataPoint[]}> => {
  // 1. Fetch LONG history (5y) from Yahoo for Price/Volume (Base)
  const response = await fetchRawData(symbol);
  const result = response.chart.result![0];
  const meta = result.meta;
  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];

  if (!timestamps || !quote || !quote.close) {
      throw new Error("Invalid data structure received from API");
  }

  const closes = quote.close;
  const opens = quote.open;
  const highs = quote.high;
  const lows = quote.low;
  const volumes = quote.volume; 

  // Detect if it is a Taiwan stock based on the returned symbol
  const isTaiwanStock = meta.symbol.endsWith('.TW') || meta.symbol.endsWith('.TWO');

  // 2. Fetch FinMind Data ONLY if it's a Taiwan stock
  const chipMap = new Map<string, { foreign: number, trust: number }>();
  const volumeMap = new Map<string, number>();
  let taiwanStockName: string | null = null;

  if (isTaiwanStock) {
      let fetchStartDate = new Date();
      fetchStartDate.setFullYear(fetchStartDate.getFullYear() - 5); 
      const fetchStartDateStr = fetchStartDate.toISOString().split('T')[0];
      
      const [institutionalData, finMindPriceData, finMindInfoName] = await Promise.all([
          fetchInstitutionalData(meta.symbol, fetchStartDateStr),
          fetchFinMindPriceVolume(meta.symbol, fetchStartDateStr),
          fetchFinMindStockInfo(meta.symbol)
      ]);
      
      if (finMindInfoName) {
          taiwanStockName = finMindInfoName;
      }
      
      institutionalData.forEach((item: any) => {
          const date = item.date; 
          const net = (item.buy || 0) - (item.sell || 0);
          if (!chipMap.has(date)) chipMap.set(date, { foreign: 0, trust: 0 });
          const record = chipMap.get(date)!;
          if (item.name === 'Foreign_Investor') record.foreign += net;
          else if (item.name === 'Investment_Trust') record.trust += net;
      });

      finMindPriceData.forEach((item: any) => {
          volumeMap.set(item.date, item.Trading_Volume); 
      });
  }

  // 3. Process and Merge Data
  const cleanData: any[] = [];
  timestamps.forEach((ts, i) => {
      // Ensure we have valid price data before processing
      if (closes[i] !== null && opens[i] !== null && highs[i] !== null && lows[i] !== null && closes[i] > 0) {
          const dateStr = new Date(ts * 1000).toISOString().split('T')[0];
          
          // VOLUME LOGIC:
          // If TW Stock: Prefer FinMind volume.
          // If US Stock: Always use Yahoo volume.
          let finalVolume = 0;
          if (isTaiwanStock && volumeMap.has(dateStr)) {
              finalVolume = volumeMap.get(dateStr)!;
          } else {
              finalVolume = (volumes && volumes[i]) ? volumes[i] : 0;
          }

          cleanData.push({
              date: dateStr,
              timestamp: ts,
              open: opens[i],
              high: highs[i],
              low: lows[i],
              close: closes[i],
              volume: finalVolume 
          });
      }
  });

  // 4. Calculate Indicators on the FULL merged dataset (5 Years)
  const closeValues = cleanData.map(d => d.close);
  const highValues = cleanData.map(d => d.high);
  const lowValues = cleanData.map(d => d.low);

  const ma5 = calculateSMA(closeValues, 5);
  const ma10 = calculateSMA(closeValues, 10);
  const ma20 = calculateSMA(closeValues, 20);
  const ma60 = calculateSMA(closeValues, 60);
  const rsi = calculateRSI(closeValues, 14);
  const { macdLine, signalLine, histogram } = calculateMACD(closeValues);
  const { K, D, J } = calculateKDJ(highValues, lowValues, closeValues);

  const fullProcessedData: StockDataPoint[] = cleanData.map((d, i) => {
      const getDir = (current: number | undefined, prev: number | undefined) => {
          if (current === undefined || prev === undefined) return 'flat';
          return current > prev ? 'up' : current < prev ? 'down' : 'flat';
      };

      // Only assign chips if we have them (TW stocks)
      const chips = chipMap.get(d.date) || { foreign: 0, trust: 0 };
      
      return {
          ...d,
          ma5: ma5[i] || undefined,
          ma10: ma10[i] || undefined,
          ma20: ma20[i] || undefined,
          ma60: ma60[i] || undefined,
          ma5Dir: i > 0 ? getDir(ma5[i], ma5[i-1]) : 'flat',
          ma10Dir: i > 0 ? getDir(ma10[i], ma10[i-1]) : 'flat',
          ma20Dir: i > 0 ? getDir(ma20[i], ma20[i-1]) : 'flat',
          ma60Dir: i > 0 ? getDir(ma60[i], ma60[i-1]) : 'flat',
          
          rsi: rsi[i] || undefined,
          macd: macdLine[i] || undefined,
          macdSignal: signalLine[i] || undefined,
          macdHist: histogram[i] || undefined,
          k: K[i],
          d: D[i],
          j: J[i],

          // Real Data (FinMind) - will be 0 for US stocks
          foreignBuySell: chips.foreign, 
          investmentTrustBuySell: chips.trust
      };
  });

  // 5. Slice data to match the requested range
  const slicedData = filterDataByRange(fullProcessedData, range);

  // Use FinMind name if available for TW stocks, otherwise Yahoo name
  let displayName = meta.longName || meta.shortName || meta.symbol;
  if (isTaiwanStock && taiwanStockName) {
      displayName = taiwanStockName;
  }

  return {
      info: {
          symbol: meta.symbol,
          name: displayName,
          currency: meta.currency,
          exchangeTimezoneName: meta.exchangeTimezoneName
      },
      data: slicedData
  };
};