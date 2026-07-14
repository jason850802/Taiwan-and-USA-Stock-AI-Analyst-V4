import { StockDataPoint, TimeInterval, StockInfo } from '../types';
import { calculateSMA, calculateRSI, calculateMACD, calculateKDJ, calculateBollingerBands } from '../utils/math';
import { proxyHeaders } from './_shared/apiClient';
import { fetchFinMindRows } from './finmind';
import { ensureTaiwanDirectory, resolveTaiwanSuffix } from './stockDirectory';
import {
  marketForSymbol,
  isQuoteCacheFresh,
  readQuoteCache,
  writeQuoteCache,
  writeMemoryAlias,
  type QuoteCacheEntry,
} from './quoteCache';

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

const fetchInstitutionalData = async (stockId: string, startDate: string, signal?: AbortSignal) => {
    const cleanId = stockId.replace(/\.TWO?$/i, '');
    try {
        return await fetchFinMindRows('TaiwanStockInstitutionalInvestorsBuySell', { data_id: cleanId, start_date: startDate }, signal);
    } catch (e) {
        console.warn("Failed to fetch institutional data", e);
        return null;
    }
};

const fetchFinMindPriceVolume = async (stockId: string, startDate: string, signal?: AbortSignal) => {
    const cleanId = stockId.replace(/\.TWO?$/i, '');
    try {
        return await fetchFinMindRows('TaiwanStockPrice', { data_id: cleanId, start_date: startDate }, signal);
    } catch (e) {
        console.warn("Failed to fetch price/volume data from FinMind", e);
        return [];
    }
}

const fetchFinMindStockInfo = async (stockId: string, signal?: AbortSignal) => {
    const cleanId = stockId.replace(/\.TWO?$/i, '');
    try {
        const rows = await fetchFinMindRows('TaiwanStockInfo', { data_id: cleanId }, signal);
        if (rows.length > 0) {
            return rows[0].stock_name as string;
        }
    } catch (e) {
        console.warn('Failed to fetch stock info from FinMind (TaiwanStockInfo)', e);
    }
    return null;
};

// Fallback: Fetch OHLC from FinMind when Yahoo fails
const fetchFinMindDailyData = async (stockId: string): Promise<StockDataPoint[]> => {
    const cleanId = stockId.replace(/\.TWO?$/i, '');
    // Fetch last 5 years
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 5);
    const dateStr = startDate.toISOString().split('T')[0];

    const rows = await fetchFinMindRows('TaiwanStockPrice', { data_id: cleanId, start_date: dateStr });
    
    if (rows.length > 0) {
        return rows.map((d: any) => ({
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

const queryYahoo = async (symbol: string, interval: string, range: string, signal?: AbortSignal): Promise<YahooChartResponse> => {
    const qs = new URLSearchParams({ symbol, interval, range }).toString();
    const res = await fetch(`/api/yahoo/chart?${qs}`, {
        headers: { ...proxyHeaders },
        signal,
    });

    if (!res.ok) {
        const parsed = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(parsed.message || `Fetch error (${res.status})`);
    }

    const json = await res.json() as YahooChartResponse;

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

    return json;
};

const fetchRawData = async (symbol: string, interval: string, range: string, signal?: AbortSignal) => {
  const clean = symbol.trim().toUpperCase();
  const performQuery = async (s: string) => queryYahoo(s, interval, range, signal);

  // 1. Check for Explicit Numeric Code (e.g. "2330", "0050", "00631L", "00679B", "00981A")
  // Taiwan ETF codes: digits optionally followed by a single letter (L, R, B, C, U, V, A, D, T, K, M, S...)
  const codeMatch = clean.match(/^(\d{3,6}[A-Z]?)/);

  if (codeMatch) {
      const coreCode = codeMatch[1];

      if (clean.includes('.TW') || clean.includes('.TWO')) {
          return await performQuery(clean);
      }

      // 1.5 名錄 .TW/.TWO 後綴預解析：上櫃股（如 6488）名錄命中即後綴直達，
      // 消滅整輪 .TW 失敗握手（冷抓 12 秒的大宗）。名錄有 memCache＋localStorage，常態 0ms。
      try {
          const dir = await ensureTaiwanDirectory();
          const suffix = resolveTaiwanSuffix(coreCode, dir);
          if (suffix) {
              try {
                  return await performQuery(coreCode + suffix);
              } catch (e: any) {
                  // H-1：使用者主動取消不是「名錄不一致」，直接上拋、不得 fall through 重試
                  if (e?.name === 'AbortError') throw e;
                  // 名錄與 Yahoo 不一致的極罕見情境：fall through 回既有 try-chain，
                  // 行為不劣於今日（planner_rulings #6）
              }
          }
      } catch (e: any) {
          if (e?.name === 'AbortError') throw e; // H-1
          /* 名錄載入失敗即跳過預解析，走既有 try-fallback */
      }

      // Implicit Code "2330" / "00981A" -> Try .TW then .TWO
      try {
          return await performQuery(`${coreCode}.TW`);
      } catch (e: any) {
          if (e?.name === 'AbortError') throw e; // H-1：取消不得觸發 .TWO 重試
          try {
              // Fallback to OTC (TWO)
              return await performQuery(`${coreCode}.TWO`);
          } catch (e2: any) {
             if (e2?.name === 'AbortError') throw e2; // H-1
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
            // 合成棒候選日期：沿用區塊內同一套 getExchangeTime 轉換（台北/紐約時區一致），勿另造轉換。
            const { hour: rawHour, minute: rawMinute, dateStr: rawDateStr } =
                getExchangeTime(synthTs, meta.exchangeTimezoneName, isTaiwanStock);
            // 守衛 4（日期須前進）：只有合成棒日期嚴格晚於序列最後一根真實（非 null）棒日期時才合成。
            // 情境：颱風日 regularMarketTime 停在 7/9（＝最後真實棒 7/9），synth 日期 7/9 不嚴格晚於 7/9 → 不合成 ✓；
            //       正常盤中 regularMarketTime＝今日 > 昨日（最後真實棒）→ 合成，儀表板顯示最新價（原設計保留）✓。
            // 邊界：cleanData 為空（無真實棒可比）→ 維持原合成行為（不因此退化）。
            // 縱深防禦：即使漏網，getStockData 殭屍過濾器仍會兜底剔除平盤棒。
            const synthDateAdvances = !lastClean || rawDateStr > lastClean.rawDateStr;
            if ((!lastClean || lastClean.timestamp !== synthTs) && synthDateAdvances) {
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

// BL-2 投機起跑籌碼三件套的形狀（模組層宣告，供 resolveChipContext 共用）。
type ChipSpec = {
  name: Promise<string | null>;
  inst: Promise<any[] | null>;
  pv: Promise<any[]>;
} | null;

// 步驟 3 產出的籌碼上下文：一次解析、供兩段式（2y/10y）共用同一批籌碼，不重抓。
type ChipContext = {
  taiwanStockName: string | null;
  chipMap: Map<string, { foreign: number; trust: number }>;
  volumeMap: Map<string, number>;
  ohlcMap: Map<string, { open: number; high: number; low: number; close: number }>;
  chipDataUnavailable: boolean;
  chipsApplied: boolean; // ＝原 shouldFetchFinMindChips，步驟4 的 volume 覆寫與 chips 欄位開關
};

// 步驟 3 本體：消費 chipSpec 或當場起跑（含 BL-2 的雙分支與 fallback 沿用語意），await 一次。
const resolveChipContext = async (
    chipSpec: ChipSpec,
    symbolInfo: any,
    isTaiwanStock: boolean,
    usedFallback: boolean,
    interval: TimeInterval,
    signal?: AbortSignal,
): Promise<ChipContext> => {
  // 3. Stock Info & Chips (Always enrich Taiwan stocks with FinMind Chips if possible)
  let taiwanStockName: string | null = null;
  const chipMap = new Map<string, { foreign: number, trust: number }>();
  const volumeMap = new Map<string, number>();
  let chipDataUnavailable = false;
  // FinMind 當日真實 OHLC，供步驟4 取代平盤合成棒（_synthetic）用。
  const ohlcMap = new Map<string, { open: number; high: number; low: number; close: number }>();

  // 台股中文名抓取（條件：isTaiwanStock && !usedFallback，所有 interval）——
  // 三段串行改兩段：不再先 await，改併入下方籌碼/量能的 Promise.all 並行。
  // fetchFinMindStockInfo 內部 try/catch 回 null、永不 reject，Promise.all 安全。
  // 有投機 chipSpec → 直接消費其 name promise（進場已起跑）；
  // 無 → 照舊條件當場起跑（補傳 signal），非台股／fallback → null。
  const namePromise: Promise<string | null> = chipSpec
      ? chipSpec.name
      : ((isTaiwanStock && !usedFallback)
          ? fetchFinMindStockInfo(symbolInfo.symbol, signal)
          : Promise.resolve(null));

  const shouldFetchFinMindChips = isTaiwanStock && interval === '1d';
  if (shouldFetchFinMindChips) {
      let fetchedName: string | null;
      let institutionalData: any[] | null;
      let finMindPriceData: any[];

      if (chipSpec) {
          // 投機起跑結果直接收割（含 usedFallback 路徑：cleanId 相同、必為台股 1d，沿用不重抓）。
          [fetchedName, institutionalData, finMindPriceData] = await Promise.all([
              chipSpec.name,
              chipSpec.inst,
              chipSpec.pv,
          ]);
      } else {
          // 罕見：名錄未命中的裸碼但 Yahoo 解析為台股 → 無投機結果，照舊當場起跑（補傳 signal）。
          let fetchStartDate = new Date();
          fetchStartDate.setFullYear(fetchStartDate.getFullYear() - 5);
          const fetchStartDateStr = fetchStartDate.toISOString().split('T')[0];

          // We need clean ID for FinMind
          const cleanId = symbolInfo.symbol.replace(/\.TWO?$/i, '');

          [fetchedName, institutionalData, finMindPriceData] = await Promise.all([
              namePromise,
              fetchInstitutionalData(cleanId, fetchStartDateStr, signal),
              fetchFinMindPriceVolume(cleanId, fetchStartDateStr, signal),
          ]);
      }
      if (fetchedName) taiwanStockName = fetchedName;

      if (institutionalData === null) {
          chipDataUnavailable = true;
      } else {
          institutionalData.forEach((item: any) => {
              const date = item.date;
              const net = (item.buy || 0) - (item.sell || 0);
              if (!chipMap.has(date)) chipMap.set(date, { foreign: 0, trust: 0 });
              const record = chipMap.get(date)!;
              if (item.name === 'Foreign_Investor') record.foreign += net;
              else if (item.name === 'Investment_Trust') record.trust += net;
          });
      }

      finMindPriceData.forEach((item: any) => {
          volumeMap.set(item.date, item.Trading_Volume);
          // FinMind 欄位：high=max、low=min（比照 fetchFinMindDailyData）。
          ohlcMap.set(item.date, { open: item.open, high: item.max, low: item.min, close: item.close });
      });
  } else {
      // 非籌碼路徑（US／TW 週月線／fallback）：只需等中文名，絕不誤設 chipDataUnavailable
      const fetchedName = await namePromise;
      if (fetchedName) taiwanStockName = fetchedName;
  }

  return { taiwanStockName, chipMap, volumeMap, ohlcMap, chipDataUnavailable, chipsApplied: shouldFetchFinMindChips };
};

// 步驟 4 → 4.5 → 5 ＋ name/info 打包：純同步、無 await。
// info 打包採非 mutate 版（不改 symbolInfo），故雙次呼叫（2y/10y）安全。
const enrichChartData = (
    processedData: any[],
    symbolInfo: any,
    interval: TimeInterval,
    ctx: ChipContext,
): { info: StockInfo; data: StockDataPoint[] } => {
  // 4. Final Enriching
  let finalData = processedData.map(d => {
      // If we have accurate volume from FinMind (even if we used Yahoo for price), overwrite it
      // FinMind volume is usually more reliable for TW stocks
      if (ctx.chipsApplied && ctx.volumeMap.has(d.rawDateStr || d.date)) {
          d.volume = ctx.volumeMap.get(d.rawDateStr || d.date)!;
      }

      // 以 FinMind 當日真實 OHLC 取代平盤合成棒：
      // 僅當這根是步驟前段補的 _synthetic 平盤棒、且 FinMind 該日已有真實 OHLC 時觸發。
      // 美股 / 台股盤中 FinMind 無當日資料 → ohlcMap.has 為 false → 維持平盤補值（不退化）。
      // FinMind fallback 路徑 / 非 1d → 無 _synthetic 標記 → 不觸發。
      if (d._synthetic === true && ctx.ohlcMap.has(d.rawDateStr)) {
          const o = ctx.ohlcMap.get(d.rawDateStr)!;
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

      const chips = ctx.chipDataUnavailable
          ? undefined
          : ctx.chipMap.get(d.rawDateStr || d.date) || { foreign: 0, trust: 0 };
      return {
          ...d,
          foreignBuySell: chips?.foreign,
          investmentTrustBuySell: chips?.trust
      };
  });

  // 4.5 日線「殭屍棒」過濾器（主修·台美股通用）
  // 放置理由：必須在第4步 FinMind 覆寫之後執行，確保 FinMind 有真實 OHLC/量的日期已被覆寫成真值、
  // 不會被誤殺；颱風臨時休市日 FinMind 無資料列（乾淨）→ 該棒維持 volume=0＋平盤 → 命中剔除。
  // 此過濾器同時捕捉兩種假棒：App 用 regularMarketPrice 合成的 _synthetic 平盤棒（步驟4 已 delete 標記），
  // 以及 Yahoo 直接回傳、通過 processYahooResult null 守衛的「非 null」平盤棒（第二根因）。
  // 已知可接受邊界（使用者已確認接受）：極冷門股「真實零成交日」（參考價＝前收）也會被剔除——
  // 無成交即無資訊，對指標更正確；漲跌停鎖死零成交棒（價≠前收，close!==prevKept.close）不受影響、保留。
  // 僅 1d 執行；週線/月線/盤中（1wk/1mo/60m/15m）維持原序列不處理。
  if (interval === '1d') {
      const filteredData: any[] = [];
      let prevKept: any = null; // 追蹤「上一根被保留的棒」，以正確處理連續多根殭屍棒（如連兩天休市）
      for (const bar of finalData) {
          // 序列第一根無 prevKept → 永遠保留，絕不剔除。
          // 以原始欄位（open/high/low/close/volume）比較，勿用 Adj 欄位。
          const isZombie = prevKept !== null
              && bar.volume === 0
              && bar.open === bar.high
              && bar.high === bar.low
              && bar.low === bar.close
              && bar.close === prevKept.close;
          if (isZombie) continue; // 殭屍棒剔除，且不更新 prevKept（連續休市棒皆與最後真實棒比對）
          filteredData.push(bar);
          prevKept = bar;
      }
      finalData = filteredData;
  }

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
          ma5: ma5[i] ?? undefined,
          ma10: ma10[i] ?? undefined,
          ma20: ma20[i] ?? undefined,
          ma60: ma60[i] ?? undefined,
          ma5Dir: i > 0 ? getDir(ma5[i], ma5[i-1]) : 'flat',
          ma10Dir: i > 0 ? getDir(ma10[i], ma10[i-1]) : 'flat',
          ma20Dir: i > 0 ? getDir(ma20[i], ma20[i-1]) : 'flat',
          ma60Dir: i > 0 ? getDir(ma60[i], ma60[i-1]) : 'flat',
          rsi: rsi[i] ?? undefined,
          macd: macdLine[i] ?? undefined,
          macdSignal: signalLine[i] ?? undefined,
          macdHist: histogram[i] ?? undefined,
          k: K[i],
          d: D[i],
          j: J[i],
          ma5Adj: ma5Adj[i] ?? undefined,
          ma10Adj: ma10Adj[i] ?? undefined,
          ma20Adj: ma20Adj[i] ?? undefined,
          ma60Adj: ma60Adj[i] ?? undefined,
          rsiAdj: rsiAdj[i] ?? undefined,
          macdAdj: macdDataAdj.macdLine[i] ?? undefined,
          macdSignalAdj: macdDataAdj.signalLine[i] ?? undefined,
          macdHistAdj: macdDataAdj.histogram[i] ?? undefined,
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

  // info 打包：非 mutate 版（不改入參 symbolInfo），雙次呼叫（2y/10y）輸出逐位元等價。
  const info = { ...symbolInfo };
  if (ctx.taiwanStockName) info.name = ctx.taiwanStockName;

  return {
      info: {
          ...info,
          chipDataUnavailable: ctx.chipDataUnavailable,
      },
      data: fullProcessedData
  };
};

// 原 getStockData 函式體整段搬移（內容零改動，除：fetchRawData 透傳 signal、
// 步驟 3 台股中文名併入 Promise.all 並行）。快取整合在下方 getStockData 外殼。
const fetchStockDataUncached = async (
    symbol: string,
    interval: TimeInterval = '1d',
    signal?: AbortSignal,
    onPartial?: (r: { info: StockInfo; data: StockDataPoint[] }) => void,
): Promise<{info: StockInfo, data: StockDataPoint[]}> => {

  let mainInterval = interval as string;
  let mainRange = '5y';
  
  if (interval === '1wk') mainRange = '5y';
  else if (interval === '1mo') mainRange = '15y'; // BL-3 收斂——max 對 2330/AAPL 拉 380-550 根月棒，絕大多數在預設視窗外
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

  // BL-2 投機起跑：台股 1d 且 symbol 已帶後綴（名錄已解析）時，籌碼三件套與 chart 同刻起跑，
  // 不再被 chart 網路往返＋前端處理間隙串行扣住。條件不符（美股／週月線／裸代碼）→ null，
  // 步驟 3 照舊當場起跑，零行為差。內部三支函式皆 try/catch 吞錯回 null/[]，永不 reject。
  // （ChipSpec 型別已提升為模組層，供 resolveChipContext 共用。）
  let chipSpec: ChipSpec = null;
  if (interval === '1d' && /\.TWO?$/i.test(symbol)) {
      const specStart = new Date();
      specStart.setFullYear(specStart.getFullYear() - 5);
      const specStartStr = specStart.toISOString().split('T')[0];
      const specCleanId = symbol.replace(/\.TWO?$/i, '');
      chipSpec = {
          name: fetchFinMindStockInfo(specCleanId, signal),
          inst: fetchInstitutionalData(specCleanId, specStartStr, signal),
          pv: fetchFinMindPriceVolume(specCleanId, specStartStr, signal),
      };
  }

  // 兩段式旗標：2y partial 已上屏後，10y 補全失敗絕不回退 FinMind fallback（見下方 catch）。
  let partialFired = false;

  // 1. Try Fetching Data (Primary: Yahoo, Fallback: FinMind)
  try {
      // 兩段式（僅 1d 冷抓且呼叫端要 partial 時啟動）：t0 同發 2y+10y，
      // 2y 先到即完整上屏（含籌碼副圖與指標），10y 到貨後用「同一批籌碼 ctx」重 enrich 無感交換。
      if (interval === '1d' && onPartial) {
          const p2y = fetchRawData(symbol, mainInterval, '2y', signal);
          const p10y = fetchRawData(symbol, mainInterval, mainRange, signal); // mainRange='10y'
          const t2y = p2y.then(r => ({ which: '2y' as const, res: r }), () => null); // 2y 失敗靜默等 10y
          const t10y = p10y.then(r => ({ which: '10y' as const, res: r }));          // 10y 失敗走 catch
          const first = await Promise.race([t10y, t2y]);

          if (first && first.which === '2y') {
              // 2y 先到：解析 meta → 籌碼解析一次 → 完整 enrich → 發射 partial → 等 10y 用同一 ctx 重 enrich。
              const meta2y = first.res.chart.result![0].meta;
              isTaiwanStock = meta2y.symbol.endsWith('.TW') || meta2y.symbol.endsWith('.TWO');
              symbolInfo = {
                  symbol: meta2y.symbol,
                  name: meta2y.longName || meta2y.shortName || meta2y.symbol,
                  currency: meta2y.currency,
                  exchangeTimezoneName: meta2y.exchangeTimezoneName
              };
              const processedData2y = processYahooResult(first.res, mainInterval);
              const ctx = await resolveChipContext(chipSpec, symbolInfo, isTaiwanStock, usedFallback, interval, signal);
              if (!signal?.aborted) {
                  onPartial(enrichChartData(processedData2y, symbolInfo, interval, ctx));
                  partialFired = true;
              }
              const fullRes = await p10y;
              const processedData10y = processYahooResult(fullRes, mainInterval);
              return enrichChartData(processedData10y, symbolInfo, interval, ctx); // 同一批 chipMap，不重抓
          }

          // 2y 失敗靜默（first===null）→ 等 p10y；10y 先到（CDN 熱）→ 用其結果。兩者收斂到單段尾流程。
          const fullRes = (first && first.which === '10y') ? first.res : await p10y;
          const resultMeta = fullRes.chart.result![0].meta;
          isTaiwanStock = resultMeta.symbol.endsWith('.TW') || resultMeta.symbol.endsWith('.TWO');
          processedData = processYahooResult(fullRes, mainInterval);
          symbolInfo = {
              symbol: resultMeta.symbol,
              name: resultMeta.longName || resultMeta.shortName || resultMeta.symbol,
              currency: resultMeta.currency,
              exchangeTimezoneName: resultMeta.exchangeTimezoneName
          };
      } else {
          // 單段（原路徑不動）：非 1d／無 onPartial／forceRefresh／背景刷新皆走此。
          const mainResponse = await fetchRawData(symbol, mainInterval, mainRange, signal);
          const resultMeta = mainResponse.chart.result![0].meta;
          isTaiwanStock = resultMeta.symbol.endsWith('.TW') || resultMeta.symbol.endsWith('.TWO');

          processedData = processYahooResult(mainResponse, mainInterval);
          symbolInfo = {
              symbol: resultMeta.symbol,
              name: resultMeta.longName || resultMeta.shortName || resultMeta.symbol,
              currency: resultMeta.currency,
              exchangeTimezoneName: resultMeta.exchangeTimezoneName
          };
      }
  } catch (err: any) {
      // H-1：使用者主動取消（AbortError）直接上拋——不得觸發不可中止的 FinMind fallback
      // （fetchFinMindDailyData/fetchFinMindStockInfo 不吃 signal，429 限流是常態，白打放大風險）
      if (err?.name === 'AbortError') throw err;
      // partial 已上屏：10y 補全失敗絕不進 FinMind fallback（保留 2y 視圖、不寫快取，由外殼 console.warn）
      if (partialFired) {
          const e = new Error(`10y completion failed: ${err.message}`) as any;
          e.partialDelivered = true;
          throw e;
      }
      // If Yahoo fails, and it looks like a Taiwan Stock Request for Daily Data, try FinMind
      const cleanSymbol = symbol.toUpperCase().replace(/\.TWO?$/i, '');
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

  // 3. 籌碼上下文解析（步驟 3 抽出）：一次解析、await 一次。
  const ctx = await resolveChipContext(chipSpec, symbolInfo, isTaiwanStock, usedFallback, interval, signal);

  // 4 → 4.5 → 5 ＋ name/info 打包（步驟 4/4.5/5 抽出）：純同步。
  return enrichChartData(processedData, symbolInfo, interval, ctx);
};

// ── 行情快取外殼（B-1，quick-260712-vno）──
// 快取語意：快取的是 getStockData 管線終點的最終資料——殭屍棒過濾（4.5）、
// close-null 補值（_synthetic/FinMind OHLC 取代）、FinMind 量能覆寫全部已在管線內完成，
// 命中路徑與新抓路徑逐位元同源，後處理不可能被跳過或重複執行。
// TTL 政策見 .planning/optimization/PLAN.md 已拍板決策 3（盤中 10 分／收盤後沿用到下一交易日開盤）。

type StockDataResult = { info: StockInfo; data: StockDataPoint[] };

export interface GetStockDataOpts {
  forceRefresh?: boolean;                       // 更新報價按鈕：略過快取真重抓
  signal?: AbortSignal;                         // 只 plumb 到 queryYahoo（planner_rulings #4）
  onRevalidated?: (r: StockDataResult) => void; // SWR 背景刷新到貨回呼
}

// SWR 背景刷新去重：同 key 已在刷新則不重複發
const inflightRevalidate = new Map<string, Promise<StockDataResult | null>>();

// 淺拷貝防禦：防呼叫端意外 mutate 陣列污染快取（資料點物件共享，消費端本就視為 immutable）
const cloneResult = (r: StockDataResult): StockDataResult => ({ info: { ...r.info }, data: r.data.slice() });

const writeQuoteCacheResult = (key: string, interval: string, result: StockDataResult): void => {
    const entry: QuoteCacheEntry = {
        cachedAt: Date.now(),
        // planner_rulings #3：籌碼不可用可能是暫時性 429，只享 10 分鐘短 TTL、不享收盤後沿用
        shortTtlOnly: result.info.chipDataUnavailable === true,
        result,
    };
    writeQuoteCache(key, entry);
    // canonical 解析失敗但 Yahoo try-chain 成功的殘餘情境：以最終 symbol 建 memory 別名
    const resultKey = `${result.info.symbol}|${interval}`;
    if (resultKey !== key) writeMemoryAlias(resultKey, entry);
};

const revalidateInBackground = (key: string, canon: string, interval: TimeInterval, onRevalidated?: (r: StockDataResult) => void): void => {
    if (inflightRevalidate.has(key)) return; // 去重
    // 不傳呼叫端 signal——刷新 promise 可能被多消費端共享，中止會誤傷（planner_rulings #4）
    const p = fetchStockDataUncached(canon, interval)
        .then((result) => {
            writeQuoteCacheResult(key, interval, result);
            onRevalidated?.(cloneResult(result));
            return result;
        })
        .catch((err) => {
            // 刷新失敗吞掉、保留舊快取不清除
            console.warn(`Background quote revalidation failed for ${key}:`, err);
            return null;
        })
        .finally(() => { inflightRevalidate.delete(key); });
    inflightRevalidate.set(key, p);
};

export const getStockData = async (
  symbol: string,
  interval: TimeInterval = '1d',
  opts?: GetStockDataOpts,
): Promise<StockDataResult> => {
  // 正規化＋canonical key：裸台股碼先經名錄預解析成 .TW/.TWO 完整代碼，
  // 讓 `2330` 與 `2330.TW` 命中同一份快取
  const clean = symbol.trim().toUpperCase();
  let canon = clean;
  if (/^\d{3,6}[A-Z]?$/.test(clean)) {
      try {
          const dir = await ensureTaiwanDirectory();
          const suffix = resolveTaiwanSuffix(clean, dir);
          if (suffix) canon = clean + suffix;
      } catch { /* 名錄失敗即以原字串為 key */ }
  }
  const key = `${canon}|${interval}`;

  if (!opts?.forceRefresh) {
      const entry = readQuoteCache(key);
      if (entry) {
          const cached = entry.result as StockDataResult;
          if (isQuoteCacheFresh(entry.cachedAt, Date.now(), marketForSymbol(canon), entry.shortTtlOnly)) {
              // fresh：0 網路請求即回傳
              return cloneResult(cached);
          }
          // stale → SWR：立即回傳舊資料，背景刷新到貨後經 onRevalidated 更新
          revalidateInBackground(key, canon, interval, opts?.onRevalidated);
          return cloneResult(cached);
      }
  }

  // 統一 inflight 檢查（forceRefresh 與「partial 上屏後切走再切回的 miss」共享同一補全，
  // 防重複兩段式／重複網路請求）：同 key 已有補全在跑 → 直接 await 共用。
  {
      const inflight = inflightRevalidate.get(key);
      if (inflight) {
          const shared = await inflight;
          if (shared) return cloneResult(shared);
      }
  }

  // miss 且 1d 冷抓（非 forceRefresh）：兩段式協調——2y partial 先 resolve、10y 補全走 onRevalidated。
  if (!opts?.forceRefresh && interval === '1d') {
      return await new Promise<StockDataResult>((resolve, reject) => {
          let settled = false;
          const completion = fetchStockDataUncached(canon, interval, opts?.signal, (partial) => {
              // partial 上屏：立即 resolve，但不寫快取（快取只寫 full）
              if (!settled && !opts?.signal?.aborted) { settled = true; resolve(cloneResult(partial)); }
          })
              .then((full) => {
                  if (opts?.signal?.aborted) {
                      if (!settled) { settled = true; reject(new DOMException('Aborted', 'AbortError')); }
                      return null; // abort：不寫快取、不發 onRevalidated
                  }
                  writeQuoteCacheResult(key, interval, full);
                  if (!settled) { settled = true; resolve(cloneResult(full)); }        // 10y 先到：一次到位
                  else { opts?.onRevalidated?.(cloneResult(full)); }                   // partial 已上屏：走既有回呼換 full
                  return full;
              })
              .catch((err) => {
                  if (!settled) { settled = true; reject(err); return null; }          // 無 partial：錯誤照舊上拋
                  if (err?.name !== 'AbortError') console.warn(`Full-range completion failed for ${key}:`, err); // 停留 2y 視圖，無錯誤 UI
                  return null;
              })
              .finally(() => { inflightRevalidate.delete(key); });
          inflightRevalidate.set(key, completion); // forceRefresh／切回的 miss 共享補全
      });
  }

  // 其餘 interval 與 forceRefresh：維持現行單段（不傳 onPartial）
  const result = await fetchStockDataUncached(canon, interval, opts?.signal);

  // 寫快取前守衛（planner_rulings #4）：abort 打在 FinMind 階段會被內部 try/catch 吞成
  // 降級結果（chipDataUnavailable:true）照常完成——不攔截會把降級結果毒進快取。
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  writeQuoteCacheResult(key, interval, result);
  return result;
};
