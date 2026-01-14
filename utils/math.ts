import { StockDataPoint } from '../types';

export const calculateSMA = (data: number[], period: number): (number | null)[] => {
  if (data.length < period) return new Array(data.length).fill(null);
  const sma = new Array(data.length).fill(null);
  
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  sma[period - 1] = sum / period;
  
  for (let i = period; i < data.length; i++) {
    sum += data[i] - data[i - period];
    sma[i] = sum / period;
  }
  return sma;
};

export const calculateEMA = (data: number[], period: number): (number | null)[] => {
  if (data.length < period) return new Array(data.length).fill(null);
  
  const k = 2 / (period + 1);
  const ema = new Array(data.length).fill(null);
  
  // Standard EMA initialization: Start with SMA of the first 'period' data points
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  let currentEma = sum / period;
  ema[period - 1] = currentEma;

  // Calculate subsequent EMAs
  for (let i = period; i < data.length; i++) {
    currentEma = (data[i] * k) + (currentEma * (1 - k));
    ema[i] = currentEma;
  }
  return ema;
};

export const calculateRSI = (closePrices: number[], period: number = 14): (number | null)[] => {
  const rsiArray = new Array(closePrices.length).fill(null);
  if (closePrices.length < period + 1) return rsiArray;

  let gains = 0;
  let losses = 0;

  // Initial Average Gain/Loss (Simple Average)
  for (let i = 1; i <= period; i++) {
    const diff = closePrices[i] - closePrices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  rsiArray[period] = 100 - (100 / (1 + avgGain / avgLoss));

  // Wilder's Smoothing for subsequent values
  for (let i = period + 1; i < closePrices.length; i++) {
    const diff = closePrices[i] - closePrices[i - 1];
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    if (avgLoss === 0) {
        rsiArray[i] = 100;
    } else {
        const rs = avgGain / avgLoss;
        rsiArray[i] = 100 - (100 / (1 + rs));
    }
  }
  return rsiArray;
};

export const calculateMACD = (closePrices: number[], fast: number = 12, slow: number = 26, signal: number = 9) => {
  const emaFast = calculateEMA(closePrices, fast);
  const emaSlow = calculateEMA(closePrices, slow);
  
  // DIF = Fast EMA - Slow EMA
  const macdLine: (number | null)[] = closePrices.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return (f !== null && s !== null) ? f - s : null;
  });

  // To calculate the Signal Line (EMA of MACD/DIF), we need to extract the valid MACD values first.
  // The MACD line starts having valid values at index `slow - 1`.
  // We compute EMA on this valid slice to avoid zero-padding issues that skew the early signal line.
  const validStartIndex = macdLine.findIndex(v => v !== null);
  
  let signalLine: (number | null)[] = new Array(closePrices.length).fill(null);
  let histogram: (number | null)[] = new Array(closePrices.length).fill(null);

  if (validStartIndex !== -1) {
      const validMacdValues = macdLine.slice(validStartIndex) as number[];
      const signalLineValid = calculateEMA(validMacdValues, signal);
      
      // Map valid signal values back to the original timeline
      for(let i=0; i<signalLineValid.length; i++) {
          if (signalLineValid[i] !== null) {
              signalLine[validStartIndex + i] = signalLineValid[i];
          }
      }
      
      // Histogram = MACD (DIF) - Signal (DEA)
      histogram = macdLine.map((v, i) => {
          const s = signalLine[i];
          return (v !== null && s !== null) ? v - s : null;
      });
  }

  return { macdLine, signalLine, histogram };
};

export const calculateKDJ = (highs: number[], lows: number[], closes: number[], period: number = 9) => {
  // Standard KDJ (9, 3, 3) initialization
  const K = new Array(closes.length).fill(50);
  const D = new Array(closes.length).fill(50);
  const J = new Array(closes.length).fill(50);

  // KDJ calculation
  for (let i = period - 1; i < closes.length; i++) {
    const windowLows = lows.slice(i - period + 1, i + 1);
    const windowHighs = highs.slice(i - period + 1, i + 1);
    const minLow = Math.min(...windowLows);
    const maxHigh = Math.max(...windowHighs);
    
    let rsv = 50;
    if (maxHigh !== minLow) {
        rsv = ((closes[i] - minLow) / (maxHigh - minLow)) * 100;
    }

    const prevK = i > 0 ? K[i-1] : 50;
    const prevD = i > 0 ? D[i-1] : 50;
    
    // Smoothness params: 1/3 new + 2/3 old (Standard Slow Stochastic)
    K[i] = (2/3) * prevK + (1/3) * rsv;
    D[i] = (2/3) * prevD + (1/3) * K[i];
    J[i] = 3 * K[i] - 2 * D[i];
  }
  
  return { K, D, J };
};