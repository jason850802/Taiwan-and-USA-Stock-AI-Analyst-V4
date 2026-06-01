import { StockDataPoint, TimeInterval, StockInfo } from '../types';
import { calculateSMA, calculateRSI, calculateMACD, calculateKDJ, calculateBollingerBands } from '../utils/math';

// PROXY ROTATION STRATEGY
// 1. CorsProxy: Fast, usually reliable.
// 2. AllOrigins: Good fallback, reliable uptime.
const PROXIES = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url='
];

// Switch to query2 as it is often more stable/updated
const YAHOO_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart/';
const FINMIND_BASE = 'https://api.finmindtrade.com/api/v4/data';

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        currency: string;
        symbol: string;
        exchangeTimezoneName: string;
        regularMarketPrice: number;
        regularMarketTime?: number; // Yahoo 回傳的最新報價/當日收盤 Unix 秒時間戳
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

const getPeriodEndDate = (timestamp: number, interval: string, timezone: string): string => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour12: false
    });
    
    const parts = formatter.formatToParts(date);
    const p: any = {};
    parts.forEach(({type, value}) => p[type] = value);
    
    let d = new Date(parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day));
    
    if (interval === '1wk') {
        const day = d.getDay();
        const diff = 5 - day; 
        d.setDate(d.getDate() + diff);
    } else if (interval === '1mo') {
        d = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    }
    
    const targetY = d.getFullYear();
    const targetM = String(d.getMonth() + 1).padStart(2, '0');
    const targetD = String(d.getDate()).padStart(2, '0');
    const targetDateStr = `${targetY}-${targetM}-${targetD}`;
    
    const nowFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour12: false
    });
    const nowParts = nowFormatter.formatToParts(now);
    const np: any = {};
    nowParts.forEach(({type, value}) => np[type] = value);
    const todayStr = `${np.year}-${np.month}-${np.day}`;
    
    return targetDateStr > todayStr ? todayStr : targetDateStr;
};

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

const fetchInstitutionalData = async (stockId: string, startDate: string, isOTC = false) => {
    const cleanId = stockId.replace('.TW', '').replace('.TWO', '');
    const dataset = isOTC ? 'TaiwanOTCStockInstitutionalInvestorsBuySell' : 'TaiwanStockInstitutionalInvestorsBuySell';
    const url = `${FINMIND_BASE}?dataset=${dataset}&data_id=${cleanId}&start_date=${startDate}`;
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
    // Try listed (上市) first, then OTC (上櫃) if not found
    for (const dataset of ['TaiwanStockInfo', 'TaiwanOTCStockInfo']) {
        const url = `${FINMIND_BASE}?dataset=${dataset}&data_id=${cleanId}`;
        try {
            const res = await fetch(url);
            const json = await res.json();
            if (json.msg === 'success' && Array.isArray(json.data) && json.data.length > 0) {
                return json.data[0].stock_name as string;
            }
        } catch (e) {
            console.warn(`Failed to fetch stock info from FinMind (${dataset})`, e);
        }
    }
    return null;
};

// Fallback: Fetch OHLC from FinMind when Yahoo fails
const fetchFinMindDailyData = async (stockId: string): Promise<StockDataPoint[]> => {
    const cleanId = stockId.replace('.TW', '').replace('.TWO', '');
    // Fetch last 5 years
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 5);
    const dateStr = startDate.toISOString().split('T')[0];
    
    const url = `${FINMIND_BASE}?dataset=TaiwanStockPrice&data_id=${cleanId}&start_date=${dateStr}`;
    
    const res = await fetch(url);
    const json = await res.json();
    
    if (json.msg === 'success' && Array.isArray(json.data) && json.data.length > 0) {
        return json.data.map((d: any) => ({
            date: d.date,
            timestamp: new Date(d.date).getTime() / 1000,
            open: d.open,
            high: d.max,
            low: d.min,
            close: d.close,
            volume: d.Trading_Volume,
            // FinMind doesn't give Adj Close easily, use Close
            openAdj: d.open,
            highAdj: d.max,
            lowAdj: d.min,
            closeAdj: d.close, 
            exchangeTimezone: 'Asia/Taipei',
            rawDateStr: d.date
        }));
    }
    throw new Error('FinMind data not found');
};

const queryYahoo = async (symbol: string, interval: string, range: string): Promise<YahooChartResponse> => {
    // Add random param to prevent Proxy Caching
    const targetUrl = `${YAHOO_BASE}${symbol}?interval=${interval}&range=${range}&includeAdjustedClose=true&includePrePost=false&lang=zh-Hant-TW&region=TW&_rand=${new Date().getTime()}`;
    
    let lastError: any;
    
    // Try each proxy in order
    for (const proxy of PROXIES) {
        try {
            const isAllOrigins = proxy.includes('allorigins');
            const cacheBuster = isAllOrigins ? `&_t=${Date.now()}` : '';
            
            const url = `${proxy}${encodeURIComponent(targetUrl)}${cacheBuster}`;
            
            const res = await fetch(url);
            
            if (!res.ok) {
                // If 429 (Too Many Requests), definitely try next proxy
                if (res.status === 429) {
                    console.warn(`Proxy ${proxy} hit rate limit (429). Switching...`);
                    continue; 
                }
                throw new Error(`Fetch error (${res.status}): ${res.statusText}`);
            }
            
            // Check Content-Type to ensure it's JSON
            const contentType = res.headers.get('content-type');
            if (contentType && !contentType.includes('application/json')) {
                // Try to consume text so we don't leak
                try { await res.text(); } catch {}
                throw new Error(`Invalid response (not JSON) from ${proxy}`);
            }

            const json = await res.json();
            
            // Handle Proxy-wrapped errors or Yahoo-specific errors
            if (json.chart && json.chart.error) {
                const code = json.chart.error.code;
                if (code === 'Not Found') {
                    throw new Error(`Symbol ${symbol} not found.`);
                }
                throw new Error(JSON.stringify(json.chart.error)); 
            }
            
            if (!json.chart || !json.chart.result || json.chart.result.length === 0) {
                 throw new Error('No data found in response');
            }

            return json as YahooChartResponse;

        } catch (e: any) {
            console.warn(`Proxy ${proxy} failed for ${symbol}:`, e.message);
            lastError = e;
            
            // Don't retry if it's definitely a "Symbol Not Found" error
            if (e.message && e.message.includes('not found')) {
                break;
            }
        }
    }
    
    throw lastError || new Error('All Yahoo proxies failed.');
};

const fetchRawData = async (symbol: string, interval: string, range: string) => {
  const clean = symbol.trim().toUpperCase();
  const performQuery = async (s: string) => queryYahoo(s, interval, range);

  // 1. Check for Explicit Numeric Code (e.g. "2330", "0050", "00631L", "00679B", "00981A")
  // Taiwan ETF codes: digits optionally followed by a single letter (L, R, B, C, U, V, A, D, T, K, M, S...)
  const codeMatch = clean.match(/^(\d{3,6}[A-Z]?)/);

  if (codeMatch) {
      const coreCode = codeMatch[1];

      if (clean.includes('.TW') || clean.includes('.TWO')) {
          return await performQuery(clean);
      }

      // Implicit Code "2330" / "00981A" -> Try .TW then .TWO
      try {
          return await performQuery(`${coreCode}.TW`);
      } catch (e: any) {
          try {
              // Fallback to OTC (TWO)
              return await performQuery(`${coreCode}.TWO`);
          } catch (e2) {
             throw new Error(`找不到台股代號: ${coreCode}`);
          }
      }
  }

  // 2. US Stocks or others
  try {
      return await performQuery(clean);
  } catch (e) {
      throw e;
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

    // --- 最新一根 null-close 合成補值（僅 1d）---
    // 盤後 Yahoo 有時尚未把當日收盤填入歷史 quote 陣列（最後一根 close=null），
    // 但 meta.regularMarketPrice 已是當日最新報價。此時用 regularMarketPrice 合成補上
    // 序列最後一根，讓 dashboard 顯示最新交易日而非退回前一個完整交易日。
    // 只處理「序列最後一根」；中間零星 null 維持既有丟棄行為。
    if (interval === '1d' && timestamps.length > 0) {
        const lastIdx = timestamps.length - 1;
        const rmp = meta.regularMarketPrice;

        // 守衛 1：最後一根本來就有效（已進 cleanData）→ 不補值
        // 守衛 2：regularMarketPrice 不可用 → 不補值（退回既有行為）
        if (closes[lastIdx] === null && Number.isFinite(rmp) && rmp > 0) {
            // 決定合成 K 棒時間戳：優先用 meta.regularMarketTime，否則退回 timestamps[lastIdx]
            const synthTs = (Number.isFinite(meta.regularMarketTime) && (meta.regularMarketTime as number) > 0)
                ? (meta.regularMarketTime as number)
                : timestamps[lastIdx];

            // 守衛 3（防重複）：若 cleanData 尾端已有同時間戳則不重複 push
            const lastClean = cleanData.length > 0 ? cleanData[cleanData.length - 1] : null;
            if (!lastClean || lastClean.timestamp !== synthTs) {
                const { hour: rawHour, minute: rawMinute, dateStr: rawDateStr } =
                    getExchangeTime(synthTs, meta.exchangeTimezoneName, isTaiwanStock);
                const dateStr = formatExchangeDate(synthTs, meta.exchangeTimezoneName, interval);

                cleanData.push({
                    date: dateStr,
                    timestamp: synthTs,
                    rawHour: rawHour,
                    rawMinute: rawMinute,
                    rawDateStr: rawDateStr, // YYYY-MM-DD
                    open: rmp,
                    high: rmp,
                    low: rmp,
                    close: rmp,
                    // volume=0 僅為避免量能污染（攻擊量等判斷）；TW 1d 若 FinMind 該日
                    // 已有真實 Trading_Volume，既有 override 會自動以真實量取代（預期且更正確）。
                    volume: 0,
                    // 盤中無調整資訊，ratio=1，故 Adj 全等於 rmp
                    openAdj: rmp,
                    highAdj: rmp,
                    lowAdj: rmp,
                    closeAdj: rmp,
                    exchangeTimezone: meta.exchangeTimezoneName,
                    // 內部標記：這根是用 regularMarketPrice 平盤補的，
                    // 待 getStockData 步驟4 以 FinMind 真實 OHLC 取代。
                    // 收尾（步驟4 map）必 delete，絕不外洩進 StockDataPoint。
                    _synthetic: true,
                });
            }
        }
    }

    return cleanData;
};

export const getLatestPrice = async (symbol: string): Promise<{ price: number; name: string }> => {
  const response = await fetchRawData(symbol, '1d', '5d');
  const result = response.chart.result![0];
  const meta = result.meta;
  const closes = result.indicators.quote[0].close;
  const validCloses = (closes as (number | null)[]).filter((c) => c !== null) as number[];
  const latestPrice = validCloses.length > 0 ? validCloses[validCloses.length - 1] : meta.regularMarketPrice;

  // For TW stocks, fetch Chinese name from FinMind
  const isTW = meta.symbol.endsWith('.TW') || meta.symbol.endsWith('.TWO');
  let name = meta.longName || meta.shortName || meta.symbol;
  if (isTW) {
    const chineseName = await fetchFinMindStockInfo(meta.symbol);
    if (chineseName) name = chineseName;
  }

  return { price: latestPrice, name };
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

  let processedData: any[] = [];
  let symbolInfo: any = {};
  let isTaiwanStock = false;
  let usedFallback = false;

  // 1. Try Fetching Data (Primary: Yahoo, Fallback: FinMind)
  try {
      // Attempt Yahoo First
      const mainResponse = await fetchRawData(symbol, mainInterval, mainRange);
      const resultMeta = mainResponse.chart.result![0].meta;
      isTaiwanStock = resultMeta.symbol.endsWith('.TW') || resultMeta.symbol.endsWith('.TWO');

      processedData = processYahooResult(mainResponse, mainInterval);
      symbolInfo = {
          symbol: resultMeta.symbol,
          name: resultMeta.longName || resultMeta.shortName || resultMeta.symbol,
          currency: resultMeta.currency,
          exchangeTimezoneName: resultMeta.exchangeTimezoneName
      };
  } catch (err: any) {
      // If Yahoo fails, and it looks like a Taiwan Stock Request for Daily Data, try FinMind
      const cleanSymbol = symbol.toUpperCase().replace('.TW', '').replace('.TWO', '');
      const isPotentialTaiwanStock = /^\d{3,6}[A-Z]?$/.test(cleanSymbol);

      if (isPotentialTaiwanStock && interval === '1d') {
          console.log(`Yahoo failed (${err.message}). Attempting FinMind fallback for ${cleanSymbol}...`);
          try {
              processedData = await fetchFinMindDailyData(cleanSymbol);
              const name = await fetchFinMindStockInfo(cleanSymbol);
              isTaiwanStock = true;
              usedFallback = true;
              symbolInfo = {
                  symbol: `${cleanSymbol}.TW`,
                  name: name || cleanSymbol,
                  currency: 'TWD',
                  exchangeTimezoneName: 'Asia/Taipei'
              };
          } catch (finErr) {
              // If FinMind also fails, revert to original error
              throw new Error(`Data Fetch Failed: ${err.message}`);
          }
      } else {
          throw err;
      }
  }

  // 1.5 Special Logic for Weekly/Monthly (Deduplication & Merge)
  if (interval === '1wk' || interval === '1mo') {
      const periodMap = new Map<string, any>();
      const timezone = symbolInfo.exchangeTimezoneName || 'Asia/Taipei';

      processedData.forEach(item => {
          // Use Start Date as Key for aggregation
          const keyDateStr = getPeriodStartDate(item.timestamp, interval, timezone);
          
          if (!periodMap.has(keyDateStr)) {
              periodMap.set(keyDateStr, { ...item, date: keyDateStr });
          } else {
              const existing = periodMap.get(keyDateStr);
              // Merge logic
              const ratio = item.close !== 0 ? (item.closeAdj / item.close) : 1;
              const isSeparateFragment = Math.abs(item.open - existing.open) > 0.0001;
              
              const merged = {
                  ...item, 
                  date: keyDateStr, 
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
              periodMap.set(keyDateStr, merged);
          }
      });
      processedData = Array.from(periodMap.values()).sort((a, b) => a.timestamp - b.timestamp);

      // DATE CORRECTION: Update display date to "Last Trading Day" (Friday or End of Month)
      processedData.forEach(d => {
          d.date = getPeriodEndDate(d.timestamp, interval, timezone);
      });
  }

  // 2a. Intraday Logic (Only relevant if data came from Yahoo, as FinMind fallback is Daily only)
  if ((interval === '60m' || interval === '15m') && isTaiwanStock && !usedFallback) {
      try {
          const uniqueMap = new Map<string, any>(); 
          
          processedData.forEach(d => {
              let shiftedTs = d.timestamp;
              if (interval === '60m') {
                if (d.rawHour >= 9 && d.rawHour <= 12) shiftedTs = d.timestamp + 3600;
                else if (d.rawHour === 13) {
                    const dateObj = new Date(d.timestamp * 1000);
                    dateObj.setMinutes(30);
                    dateObj.setSeconds(0);
                    shiftedTs = dateObj.getTime() / 1000;
                }
              } else if (interval === '15m') {
                 shiftedTs = d.timestamp + (15 * 60);
                 if (d.rawHour === 13 && d.rawMinute >= 30) {
                     const dateObj = new Date(d.timestamp * 1000);
                     dateObj.setMinutes(30);
                     dateObj.setSeconds(0);
                     shiftedTs = dateObj.getTime() / 1000;
                 }
                 const tTime = getExchangeTime(shiftedTs, d.exchangeTimezone, true);
                 const tVal = tTime.hour * 100 + tTime.minute;
                 if (tVal < 915 || tVal > 1330) return;
              }

              const formattedDate = formatExchangeDate(shiftedTs, d.exchangeTimezone, interval);
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
          console.warn("Error in intraday shift logic", e);
      }
  }

  // 3. Stock Info & Chips (Always enrich Taiwan stocks with FinMind Chips if possible)
  let taiwanStockName: string | null = null;
  const chipMap = new Map<string, { foreign: number, trust: number }>();
  const volumeMap = new Map<string, number>();
  // FinMind 當日真實 OHLC，供步驟4 取代平盤合成棒（_synthetic）用。
  const ohlcMap = new Map<string, { open: number; high: number; low: number; close: number }>();

  if (isTaiwanStock && !usedFallback) {
      // Always try to fetch FinMind name to ensure Traditional Chinese for TW stocks
      const fetchedName = await fetchFinMindStockInfo(symbolInfo.symbol);
      if (fetchedName) taiwanStockName = fetchedName;
  }

  const shouldFetchFinMindChips = isTaiwanStock && interval === '1d';
  if (shouldFetchFinMindChips) {
      let fetchStartDate = new Date();
      fetchStartDate.setFullYear(fetchStartDate.getFullYear() - 5); 
      const fetchStartDateStr = fetchStartDate.toISOString().split('T')[0];
      
      // We need clean ID for FinMind
      const cleanId = symbolInfo.symbol.replace('.TW', '').replace('.TWO', '');
      const isOTC = symbolInfo.symbol.endsWith('.TWO');

      const [institutionalData, finMindPriceData] = await Promise.all([
          fetchInstitutionalData(cleanId, fetchStartDateStr, isOTC),
          fetchFinMindPriceVolume(cleanId, fetchStartDateStr),
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
          // FinMind 欄位：high=max、low=min（比照 fetchFinMindDailyData）。
          ohlcMap.set(item.date, { open: item.open, high: item.max, low: item.min, close: item.close });
      });
  }

  // 4. Final Enriching
  const finalData = processedData.map(d => {
      // If we have accurate volume from FinMind (even if we used Yahoo for price), overwrite it
      // FinMind volume is usually more reliable for TW stocks
      if (shouldFetchFinMindChips && volumeMap.has(d.rawDateStr || d.date)) {
          d.volume = volumeMap.get(d.rawDateStr || d.date)!;
      }

      // 以 FinMind 當日真實 OHLC 取代平盤合成棒：
      // 僅當這根是步驟前段補的 _synthetic 平盤棒、且 FinMind 該日已有真實 OHLC 時觸發。
      // 美股 / 台股盤中 FinMind 無當日資料 → ohlcMap.has 為 false → 維持平盤補值（不退化）。
      // FinMind fallback 路徑 / 非 1d → 無 _synthetic 標記 → 不觸發。
      if (d._synthetic === true && ohlcMap.has(d.rawDateStr)) {
          const o = ohlcMap.get(d.rawDateStr)!;
          d.open = o.open;
          d.high = o.high;
          d.low = o.low;
          d.close = o.close;
          // FinMind 無還原值、ratio=1，Adj 全等於原值（比照 fetchFinMindDailyData）。
          d.openAdj = o.open;
          d.highAdj = o.high;
          d.lowAdj = o.low;
          d.closeAdj = o.close;
          // volume 已由上面既有 volumeMap 機制處理，勿在此重複。
      }

      // 收尾：移除內部標記，絕不外洩進對外 StockDataPoint（fullProcessedData 以 ...d 展開）。
      delete d._synthetic;

      const chips = chipMap.get(d.rawDateStr || d.date) || { foreign: 0, trust: 0 };
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
  const bbRaw = calculateBollingerBands(rawCloses, 20, 2);

  // Set B: ADJUSTED
  const ma5Adj = calculateSMA(adjCloses, 5);
  const ma10Adj = calculateSMA(adjCloses, 10);
  const ma20Adj = calculateSMA(adjCloses, 20);
  const ma60Adj = calculateSMA(adjCloses, 60);
  const rsiAdj = calculateRSI(adjCloses, 14);
  const macdDataAdj = calculateMACD(adjCloses);
  const bbAdj = calculateBollingerBands(adjCloses, 20, 2);

  const fullProcessedData: StockDataPoint[] = finalData.map((d: any, i: number) => {
      const getDir = (current: number | undefined, prev: number | undefined) => {
          if (current === undefined || prev === undefined) return 'flat';
          return current > prev ? 'up' : current < prev ? 'down' : 'flat';
      };
      
      const prevClose = i > 0 ? finalData[i-1].close : d.open;
      const priceChange = d.close - prevClose;
      const priceChangePercent = prevClose !== 0 ? (priceChange / prevClose) * 100 : 0;

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
          bbUpper: bbRaw.upper[i] ?? undefined,
          bbMiddle: bbRaw.middle[i] ?? undefined,
          bbLower: bbRaw.lower[i] ?? undefined,
          bbUpperAdj: bbAdj.upper[i] ?? undefined,
          bbMiddleAdj: bbAdj.middle[i] ?? undefined,
          bbLowerAdj: bbAdj.lower[i] ?? undefined,
          priceChange,
          priceChangePercent
      };
  });

  if (taiwanStockName) {
      symbolInfo.name = taiwanStockName;
  }

  return {
      info: symbolInfo,
      data: fullProcessedData
  };
};