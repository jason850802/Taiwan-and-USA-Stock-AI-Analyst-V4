import { StockDataPoint, TimeInterval, StockInfo } from '../types';
import { calculateSMA, calculateRSI, calculateMACD, calculateKDJ } from '../utils/math';

const CORS_PROXY = 'https://corsproxy.io/?';
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
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
        longName?: string;
        shortName?: string;
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
        adjclose?: Array<{
          adjclose: number[];
        }>;
      };
    }> | null;
    error: any;
  };
}

// --- Helper Functions ---

// Format date based on Exchange Timezone
const formatExchangeDate = (timestamp: number, timezone: string, interval: string) => {
    const date = new Date(timestamp * 1000);
    const isIntraday = interval === '15m' || interval === '60m';
    
    try {
        const options: Intl.DateTimeFormatOptions = {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: isIntraday ? '2-digit' : undefined,
            minute: isIntraday ? '2-digit' : undefined,
            hour12: false
        };
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(date);
        
        const p: any = {};
        parts.forEach(({type, value}) => p[type] = value);
        
        if (isIntraday) {
            // Ensure 2 digits for consistency
            const h = p.hour ? p.hour.padStart(2, '0') : '00';
            const m = p.minute ? p.minute.padStart(2, '0') : '00';
            return `${p.month}-${p.day} ${h}:${m}`;
        } else {
            return `${p.year}-${p.month}-${p.day}`;
        }
    } catch (e) {
        const d = new Date(timestamp * 1000);
        const iso = d.toISOString();
        return isIntraday ? iso.slice(5, 16).replace('T', ' ') : iso.slice(0, 10);
    }
};

// Retrieve specific time parts in Exchange Timezone
const getExchangeTime = (timestamp: number, timezone: string, isTaiwan: boolean): { hour: number, minute: number, dateStr: string } => {
    try {
        const effectiveTimezone = isTaiwan ? 'Asia/Taipei' : timezone;
        
        const date = new Date(timestamp * 1000);
        const options: Intl.DateTimeFormatOptions = {
            timeZone: effectiveTimezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        };
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(date);
        
        let h = 0, m = 0;
        const p: any = {};
        parts.forEach(({type, value}) => p[type] = value);

        if (p.hour) h = parseInt(p.hour, 10);
        if (p.minute) m = parseInt(p.minute, 10);
        
        if (h === 24) h = 0;
        
        const dateStr = `${p.year}-${p.month}-${p.day}`;

        return { hour: h, minute: m, dateStr };
    } catch (e) {
        const d = new Date(timestamp * 1000);
        const dateStr = d.toISOString().split('T')[0];
        return { hour: d.getHours(), minute: d.getMinutes(), dateStr };
    }
};

// Calculate the Start Date of the period (Week: Mon, Month: 1st)
const getPeriodStartDate = (timestamp: number, interval: string, timezone: string): string => {
    const date = new Date(timestamp * 1000);
    
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour12: false
    }).formatToParts(date);
    
    const p: any = {};
    parts.forEach(({type, value}) => p[type] = value);
    
    let d = new Date(Date.UTC(parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day)));
    
    if (interval === '1mo') {
        d.setUTCDate(1);
    } else if (interval === '1wk') {
        const day = d.getUTCDay(); 
        const diff = day === 0 ? -6 : 1 - day;
        d.setUTCDate(d.getUTCDate() + diff);
    }
    
    return d.toISOString().split('T')[0];
};

const fetchInstitutionalData = async (stockId: string, startDate: string) => {
    const cleanId = stockId.replace('.TW', '').replace('.TWO', '');
    const url = `${FINMIND_BASE}?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${cleanId}&start_date=${startDate}`;
    try {
        const res = await fetch(url);
        const json = await res.json();
        return (json.msg === 'success' && Array.isArray(json.data)) ? json.data : [];
    } catch (e) {
        console.warn("Failed to fetch institutional data", e);
        return [];
    }
};

const fetchFinMindPriceVolume = async (stockId: string, startDate: string) => {
    const cleanId = stockId.replace('.TW', '').replace('.TWO', '');
    const url = `${FINMIND_BASE}?dataset=TaiwanStockPrice&data_id=${cleanId}&start_date=${startDate}`;
    try {
        const res = await fetch(url);
        const json = await res.json();
        return (json.msg === 'success' && Array.isArray(json.data)) ? json.data : [];
    } catch (e) {
        console.warn("Failed to fetch price/volume data from FinMind", e);
        return [];
    }
}

const fetchFinMindStockInfo = async (stockId: string) => {
    const cleanId = stockId.replace('.TW', '').replace('.TWO', '');
    const url = `${FINMIND_BASE}?dataset=TaiwanStockInfo&data_id=${cleanId}`;
    try {
        const res = await fetch(url);
        const json = await res.json();
        return (json.msg === 'success' && Array.isArray(json.data) && json.data.length > 0) ? json.data[0].stock_name : null;
    } catch (e) {
        console.warn("Failed to fetch stock info from FinMind", e);
        return null;
    }
};

const queryYahoo = async (symbol: string, interval: string, range: string): Promise<YahooChartResponse> => {
    const url = `${CORS_PROXY}${encodeURIComponent(`${YAHOO_BASE}${symbol}?interval=${interval}&range=${range}&includeAdjustedClose=true&includePrePost=false&lang=zh-Hant-TW&region=TW`)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch error: ${res.statusText}`);
    const json = await res.json();
    if (json.chart.error) throw new Error(JSON.stringify(json.chart.error));
    if (!json.chart.result || json.chart.result.length === 0) throw new Error('No data found');
    return json as YahooChartResponse;
};

const fetchRawData = async (symbol: string, interval: string, range: string) => {
  const cleanSymbol = symbol.trim().toUpperCase();
  const looksLikeTaiwanStock = /[0-9]/.test(cleanSymbol);

  const performQuery = async (s: string) => queryYahoo(s, interval, range);

  if (looksLikeTaiwanStock) {
      const target = cleanSymbol.replace('.TW', '').replace('.TWO', '');
      try {
          const res = await performQuery(`${target}.TW`);
          return res;
      } catch (e) {
          console.log(`Failed to fetch ${target}.TW, trying .TWO`);
          return await performQuery(`${target}.TWO`);
      }
  } else {
      try {
          return await performQuery(cleanSymbol);
      } catch (e) {
          try {
             return await performQuery(`${cleanSymbol}.TW`);
          } catch {
             return await performQuery(`${cleanSymbol}.TWO`);
          }
      }
  }
};

// Helper to process Yahoo JSON result into an array of objects
const processYahooResult = (response: YahooChartResponse, interval: string): any[] => {
    const result = response.chart.result![0];
    const meta = result.meta;
    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];
    const adjCloseRaw = result.indicators.adjclose?.[0]?.adjclose;

    if (!timestamps || !quote || !quote.close) return [];

    const closes = quote.close;
    const opens = quote.open;
    const highs = quote.high;
    const lows = quote.low;
    const volumes = quote.volume;

    const cleanData: any[] = [];
    const isTaiwanStock = meta.symbol.endsWith('.TW') || meta.symbol.endsWith('.TWO');

    timestamps.forEach((ts, i) => {
        if (closes[i] !== null && opens[i] !== null && highs[i] !== null && lows[i] !== null) {
            
            const { hour: rawHour, minute: rawMinute, dateStr: rawDateStr } = getExchangeTime(ts, meta.exchangeTimezoneName, isTaiwanStock);
            const dateStr = formatExchangeDate(ts, meta.exchangeTimezoneName, interval === '1wk' ? '1d' : interval);
            const rawC = closes[i];
            const adjC = (adjCloseRaw && adjCloseRaw[i]) ? adjCloseRaw[i] : rawC;
            const ratio = (rawC !== 0) ? adjC / rawC : 1;

            cleanData.push({
                date: dateStr,
                timestamp: ts, 
                rawHour: rawHour,     
                rawMinute: rawMinute, 
                rawDateStr: rawDateStr, // YYYY-MM-DD
                open: opens[i],
                high: highs[i],
                low: lows[i],
                close: rawC,
                volume: (volumes && volumes[i]) ? volumes[i] : 0,
                openAdj: opens[i] * ratio,
                highAdj: highs[i] * ratio,
                lowAdj: lows[i] * ratio,
                closeAdj: adjC,
                exchangeTimezone: meta.exchangeTimezoneName, 
            });
        }
    });

    return cleanData;
};

export const getStockData = async (symbol: string, interval: TimeInterval = '1d'): Promise<{info: StockInfo, data: StockDataPoint[]}> => {
  
  let mainInterval = interval as string;
  let mainRange = '5y';
  
  if (interval === '1wk') mainRange = '5y';
  else if (interval === '1mo') mainRange = 'max';
  else if (interval === '1d') mainRange = '10y';
  else if (interval === '60m') {
      mainInterval = '60m';
      mainRange = '1y'; 
  } else if (interval === '15m') {
      mainInterval = '15m';
      mainRange = '60d';
  }

  // 1. Fetch Main Data
  const mainResponse = await fetchRawData(symbol, mainInterval, mainRange);
  const resultMeta = mainResponse.chart.result![0].meta;
  const isTaiwanStock = resultMeta.symbol.endsWith('.TW') || resultMeta.symbol.endsWith('.TWO');
  
  // Initial Processing
  let processedData = processYahooResult(mainResponse, mainInterval);

  // 1.5 Special Logic for Weekly/Monthly (Deduplication)
  if (interval === '1wk' || interval === '1mo') {
      const periodMap = new Map<string, any>();
      const timezone = resultMeta.exchangeTimezoneName || 'Asia/Taipei';

      processedData.forEach(item => {
          const dateStr = getPeriodStartDate(item.timestamp, interval, timezone);
          
          if (!periodMap.has(dateStr)) {
              periodMap.set(dateStr, { ...item, date: dateStr });
          } else {
              const existing = periodMap.get(dateStr);
              // Merge logic for weekly fragments
              const ratio = item.close !== 0 ? (item.closeAdj / item.close) : 1;
              const isSeparateFragment = Math.abs(item.open - existing.open) > 0.0001;
              
              const merged = {
                  ...item, 
                  date: dateStr, 
                  open: existing.open, 
                  high: Math.max(existing.high, item.high),
                  low: Math.min(existing.low, item.low),
                  close: item.close, 
                  volume: isSeparateFragment ? (existing.volume + item.volume) : item.volume,
                  openAdj: existing.open * ratio, 
                  highAdj: Math.max(existing.high, item.high) * ratio,
                  lowAdj: Math.min(existing.low, item.low) * ratio,
                  closeAdj: item.closeAdj 
              };
              periodMap.set(dateStr, merged);
          }
      });
      processedData = Array.from(periodMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  // 2a. 60m Logic for Taiwan Stocks
  if (interval === '60m' && isTaiwanStock) {
      try {
          const uniqueMap = new Map<string, any>(); // Map for "First-Win" deduplication
          
          processedData.forEach(d => {
              let shiftedTs = d.timestamp;

              // Logic 1: 09:00 - 12:00 -> +60 mins
              if (d.rawHour >= 9 && d.rawHour <= 12) {
                  shiftedTs = d.timestamp + 3600;
              } 
              // Logic 2: 13:00 -> 13:30 (Force specific time)
              else if (d.rawHour === 13) {
                  // To strictly set it to 13:30 for the current day, we find 13:00 timestamp and add 30 mins (1800s)
                  // Assuming d.timestamp is the start of the 13:00 candle.
                  // Note: Yahoo sometimes sends 13:25 or 13:30 data points.
                  // We treat ANY 13:xx data as the "Close" candle and map it to 13:30.
                  const dateObj = new Date(d.timestamp * 1000);
                  dateObj.setMinutes(30);
                  dateObj.setSeconds(0);
                  shiftedTs = dateObj.getTime() / 1000;
              } else {
                  return; // Skip pre-market/after-hours
              }

              const formattedDate = formatExchangeDate(shiftedTs, d.exchangeTimezone, '60m');
              
              // First-Win Logic: If we already have a candle for this slot (e.g., 13:30), 
              // keep the first one. We assume the first one is the "13:00" start candle shifted.
              // Later we will fix the Close price using Daily data.
              if (!uniqueMap.has(formattedDate)) {
                  uniqueMap.set(formattedDate, {
                      ...d,
                      timestamp: shiftedTs,
                      date: formattedDate
                  });
              }
          });

          processedData = Array.from(uniqueMap.values()).sort((a, b) => a.timestamp - b.timestamp);

      } catch (e) {
          console.warn("Error in 60m shift logic", e);
      }
  }

  // 2b. 15m Logic for Taiwan Stocks
  if (interval === '15m' && isTaiwanStock) {
      try {
          const uniqueMap = new Map<string, any>();

          processedData.forEach(d => {
             // Basic shift: Candle at 09:00 represents 09:00-09:15, so display 09:15
             let shiftedTs = d.timestamp + (15 * 60);

             // Special handling for the last candle (13:15 -> 13:30)
             // If raw is 13:00 -> 13:15
             // If raw is 13:15 -> 13:30
             // If raw is 13:30 -> 13:30 (Edge case, but handle it)
             
             if (d.rawHour === 13) {
                 if (d.rawMinute >= 30) {
                     // Already past close, map to 13:30
                     const dateObj = new Date(d.timestamp * 1000);
                     dateObj.setMinutes(30);
                     dateObj.setSeconds(0);
                     shiftedTs = dateObj.getTime() / 1000;
                 }
             }

             // Time Filter: Only allow up to 13:30
             // Get the shifted time HHMM
             const tTime = getExchangeTime(shiftedTs, d.exchangeTimezone, true);
             const tVal = tTime.hour * 100 + tTime.minute;
             
             // Allow 09:15 to 13:30
             if (tVal < 915 || tVal > 1330) return;

             const formattedDate = formatExchangeDate(shiftedTs, d.exchangeTimezone, '15m');

             // First-Win Deduplication
             if (!uniqueMap.has(formattedDate)) {
                 uniqueMap.set(formattedDate, {
                     ...d,
                     timestamp: shiftedTs,
                     date: formattedDate
                 });
             }
          });

          processedData = Array.from(uniqueMap.values()).sort((a, b) => a.timestamp - b.timestamp);

      } catch (e) {
          console.warn("Error in 15m shift logic", e);
      }
  }

  // 2c. Daily Close Correction (Universal for Intraday 60m/15m)
  if ((interval === '60m' || interval === '15m') && isTaiwanStock) {
      try {
          // Fetch Daily Data for comparison
          const dailyRes = await fetchRawData(symbol, '1d', '1y');
          const dailyData = processYahooResult(dailyRes, '1d');
          const dailyCloseMap = new Map<string, number>();
          // Map: YYYY-MM-DD -> Close Price
          dailyData.forEach(d => dailyCloseMap.set(d.rawDateStr, d.close));
          
          processedData.forEach(candle => {
              const t = getExchangeTime(candle.timestamp, candle.exchangeTimezone, true);
              
              // Identify the LAST candle of the day: 13:30
              if (t.hour === 13 && t.minute === 30) {
                  const correctClose = dailyCloseMap.get(candle.rawDateStr);
                  
                  if (correctClose !== undefined && correctClose !== 0) {
                       // Rule: Modify Close. 
                       // Modify High/Low ONLY if Close is outside current range.
                       // Maintain real High/Low fluctuation otherwise.
                       
                       const oldClose = candle.close;
                       const oldHigh = candle.high;
                       const oldLow = candle.low;

                       // 1. Force Close
                       candle.close = correctClose;

                       // 2. Adjust High/Low if needed
                       if (candle.close > candle.high) candle.high = candle.close;
                       if (candle.close < candle.low) candle.low = candle.close;

                       // 3. Recalculate Adjusted Close based on ratio
                       if (oldClose !== 0) {
                           const ratio = candle.closeAdj / oldClose; 
                           // Note: Using old ratio is approximate. 
                           // Better to re-derive from daily adj close if possible, 
                           // but intraday adjClose is usually just Close. 
                           // Let's assume Intraday AdjClose = Close for simplicity unless ratio exists.
                           candle.closeAdj = candle.close * ratio;
                           
                           // Also adjust highAdj/lowAdj if high/low changed
                           if (candle.high !== oldHigh) candle.highAdj = candle.high * ratio;
                           if (candle.low !== oldLow) candle.lowAdj = candle.low * ratio;
                       }
                  }
              }
          });
      } catch (e) {
          console.warn("Daily Close Correction failed", e);
      }
  }

  // 3. Stock Info & Chips
  let taiwanStockName: string | null = null;
  const chipMap = new Map<string, { foreign: number, trust: number }>();
  const volumeMap = new Map<string, number>();

  if (isTaiwanStock) {
      const fetchedName = await fetchFinMindStockInfo(resultMeta.symbol);
      if (fetchedName) taiwanStockName = fetchedName;
  }

  const shouldFetchFinMindChips = isTaiwanStock && interval === '1d';
  if (shouldFetchFinMindChips) {
      let fetchStartDate = new Date();
      fetchStartDate.setFullYear(fetchStartDate.getFullYear() - 5); 
      const fetchStartDateStr = fetchStartDate.toISOString().split('T')[0];
      
      const [institutionalData, finMindPriceData] = await Promise.all([
          fetchInstitutionalData(resultMeta.symbol, fetchStartDateStr),
          fetchFinMindPriceVolume(resultMeta.symbol, fetchStartDateStr),
      ]);
      
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

  // 4. Final Enriching
  const finalData = processedData.map(d => {
      if (shouldFetchFinMindChips && volumeMap.has(d.date)) {
          d.volume = volumeMap.get(d.date)!;
      }
      const chips = chipMap.get(d.date) || { foreign: 0, trust: 0 };
      return {
          ...d,
          foreignBuySell: chips.foreign,
          investmentTrustBuySell: chips.trust
      };
  });

  // 5. Calculate Indicators
  const rawCloses = finalData.map(d => d.close);
  const rawHighs = finalData.map(d => d.high);
  const rawLows = finalData.map(d => d.low);
  const adjCloses = finalData.map(d => d.closeAdj);
  
  // Set A: RAW
  const ma5 = calculateSMA(rawCloses, 5);
  const ma10 = calculateSMA(rawCloses, 10);
  const ma20 = calculateSMA(rawCloses, 20);
  const ma60 = calculateSMA(rawCloses, 60);
  const rsi = calculateRSI(rawCloses, 14);
  const { macdLine, signalLine, histogram } = calculateMACD(rawCloses);
  const { K, D, J } = calculateKDJ(rawHighs, rawLows, rawCloses);

  // Set B: ADJUSTED
  const ma5Adj = calculateSMA(adjCloses, 5);
  const ma10Adj = calculateSMA(adjCloses, 10);
  const ma20Adj = calculateSMA(adjCloses, 20);
  const ma60Adj = calculateSMA(adjCloses, 60);
  const rsiAdj = calculateRSI(adjCloses, 14);
  const macdDataAdj = calculateMACD(adjCloses);
  
  const fullProcessedData: StockDataPoint[] = finalData.map((d: any, i: number) => {
      const getDir = (current: number | undefined, prev: number | undefined) => {
          if (current === undefined || prev === undefined) return 'flat';
          return current > prev ? 'up' : current < prev ? 'down' : 'flat';
      };
      
      const prevClose = i > 0 ? finalData[i-1].close : d.open;
      const priceChange = d.close - prevClose;
      const priceChangePercent = (priceChange / prevClose) * 100;

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
          ma5Adj: ma5Adj[i] || undefined,
          ma10Adj: ma10Adj[i] || undefined,
          ma20Adj: ma20Adj[i] || undefined,
          ma60Adj: ma60Adj[i] || undefined,
          rsiAdj: rsiAdj[i] || undefined,
          macdAdj: macdDataAdj.macdLine[i] || undefined,
          macdSignalAdj: macdDataAdj.signalLine[i] || undefined,
          macdHistAdj: macdDataAdj.histogram[i] || undefined,
          priceChange,
          priceChangePercent
      };
  });

  let displayName = resultMeta.longName || resultMeta.shortName || resultMeta.symbol;
  if (isTaiwanStock && taiwanStockName) {
      displayName = taiwanStockName;
  }

  return {
      info: {
          symbol: resultMeta.symbol,
          name: displayName,
          currency: resultMeta.currency,
          exchangeTimezoneName: resultMeta.exchangeTimezoneName
      },
      data: fullProcessedData
  };
};