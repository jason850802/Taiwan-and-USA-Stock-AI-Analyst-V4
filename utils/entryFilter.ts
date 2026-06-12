// entryFilter.ts — 朱家泓「六六大順」做多進場濾網（純程式判定，方案C的客觀層）
// 直接讀用 StockDataPoint[] 內已計算好的 ma/k/d/macdHist/量 等欄位，不重算指標。
import { StockDataPoint } from '../types';
import { VolumeProjection } from './volume';

export type StepStatus = 'pass' | 'warn' | 'fail';
export type Decision = 'GO' | 'WAIT' | 'NO_GO';

export interface FilterStep {
  id: number;
  key: string;
  name: string;       // 中文步驟名
  status: StepStatus; // ✅ / ⚠️ / ❌
  verdict: string;    // 一句結論
  details: string[];  // 逐項依據
}

export interface SopCheck { label: string; ok: boolean; note?: string; }
export interface PreceptHit { no: number; text: string; }

export interface EntryFilterResult {
  symbol: string;
  asof: string;
  price: number;
  trend: '多頭' | '空頭' | '盤整' | '資料不足';
  trendReason: string;
  weeklyTrend?: string;
  steps: FilterStep[];
  sop: SopCheck[];
  entryPattern: '回後買上漲' | '盤整突破' | '皆不符';
  preceptHits: PreceptHit[];        // 觸犯的戒律
  decision: Decision;
  confidence: number;               // 0-100
  entryPrice: number;
  stopPrice: number;                // 進場價 × 0.95
  takeProfitRule: string;
  summary: string;
}

interface Swing { type: 'high' | 'low'; idx: number; price: number; date: string; }

// ---------- 轉折波偵測（fractal，前後各 k 根）----------
function detectSwings(closes: number[], dates: string[], k = 2): Swing[] {
  const pts: Swing[] = [];
  for (let i = k; i < closes.length - k; i++) {
    const win = closes.slice(i - k, i + k + 1);
    if (closes[i] === Math.max(...win) && closes[i] > closes[i - 1])
      pts.push({ type: 'high', idx: i, price: closes[i], date: dates[i] });
    else if (closes[i] === Math.min(...win) && closes[i] < closes[i - 1])
      pts.push({ type: 'low', idx: i, price: closes[i], date: dates[i] });
  }
  const cleaned: Swing[] = [];
  for (const p of pts) {
    const last = cleaned[cleaned.length - 1];
    if (last && last.type === p.type) {
      if ((p.type === 'high' && p.price >= last.price) || (p.type === 'low' && p.price <= last.price))
        cleaned[cleaned.length - 1] = p;
    } else cleaned.push(p);
  }
  return cleaned;
}

function classifyTrend(sw: Swing[]): { trend: EntryFilterResult['trend']; reason: string } {
  const highs = sw.filter(s => s.type === 'high');
  const lows = sw.filter(s => s.type === 'low');
  if (highs.length < 2 || lows.length < 2) return { trend: '資料不足', reason: '轉折點不足以判定' };
  const hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
  const bh = lows[lows.length - 1].price > lows[lows.length - 2].price;
  const hl = highs[highs.length - 1].price < highs[highs.length - 2].price;
  const bl = lows[lows.length - 1].price < lows[lows.length - 2].price;
  if (hh && bh) return { trend: '多頭', reason: '頭頭高 + 底底高' };
  if (hl && bl) return { trend: '空頭', reason: '頭頭低 + 底底低' };
  return { trend: '盤整', reason: '高低點未同向（非多非空）' };
}

function trendOf(data: StockDataPoint[]): { trend: EntryFilterResult['trend']; reason: string; swings: Swing[] } {
  const closes = data.map(d => d.close);
  const dates = data.map(d => d.date);
  const sw = detectSwings(closes, dates);
  return { ...classifyTrend(sw), swings: sw };
}

const fmt = (n?: number) => (n === undefined || n === null || isNaN(n) ? '—' : n.toFixed(2));

// ---------- 主函式 ----------
export function runEntryFilter(
  symbol: string,
  data: StockDataPoint[],
  weeklyData?: StockDataPoint[],
  volumeProj?: VolumeProjection | null
): EntryFilterResult {
  const n = data.length;
  const last = data[n - 1];
  const prev = data[n - 2];
  const dayTrend = trendOf(data);
  const weekTrend = weeklyData && weeklyData.length > 10 ? trendOf(weeklyData) : undefined;

  const close = last.close;
  const chgPct = last.priceChangePercent ?? (prev ? ((close - prev.close) / prev.close) * 100 : 0);
  // 盤中時改用「預估全日量／昨量」計算攻擊量倍數（收盤量比會低估），否則用收盤量比。
  const dayVolRatio = prev && prev.volume ? last.volume / prev.volume : 0;
  const usedIntradayProj = !!(volumeProj && volumeProj.status === 'Intraday' && volumeProj.yesterdayVolume > 0);
  const volRatio = usedIntradayProj
    ? volumeProj!.projectedVolume / volumeProj!.yesterdayVolume
    : dayVolRatio;
  const isAttackVol = volRatio >= 1.3;
  const aboveMa20 = last.ma20 !== undefined && close > last.ma20;
  const align3Long = last.ma5 !== undefined && last.ma10 !== undefined && last.ma20 !== undefined
    && last.ma5 > last.ma10 && last.ma10 > last.ma20;
  const align3Short = last.ma5 !== undefined && last.ma10 !== undefined && last.ma20 !== undefined
    && last.ma5 < last.ma10 && last.ma10 < last.ma20;
  const maUp = last.ma5Dir === 'up' && last.ma10Dir !== 'down' && last.ma20Dir !== 'down';
  const isRedK = close > last.open;
  const overPrevHigh = prev ? close > prev.high : false;
  const overMa5 = last.ma5 !== undefined && close > last.ma5;

  // 連續上漲根數
  let upStreak = 0;
  for (let i = n - 1; i > 0; i--) { if (data[i].close > data[i - 1].close) upStreak++; else break; }

  // 乖離率（對 MA20）
  const biasMa20 = last.ma20 ? ((close - last.ma20) / last.ma20) * 100 : 0;

  // 最近轉折低/高
  const lows = dayTrend.swings.filter(s => s.type === 'low');
  const highs = dayTrend.swings.filter(s => s.type === 'high');
  const lastLow = lows[lows.length - 1];
  const lastHigh = highs[highs.length - 1];

  const steps: FilterStep[] = [];

  // 步驟1 趨勢
  {
    let status: StepStatus = dayTrend.trend === '多頭' ? 'pass' : (dayTrend.trend === '盤整' ? 'warn' : 'fail');
    const details = [
      `日線：${dayTrend.trend}（${dayTrend.reason}）`,
      weekTrend ? `週線：${weekTrend.trend}` : '週線：未取得',
    ];
    if (dayTrend.trend === '多頭' && weekTrend && weekTrend.trend === '空頭') {
      status = 'warn';
      details.push('⚠️ 日多週空＝空頭反彈，違反做多戒律7');
    }
    steps.push({ id: 1, key: 'trend', name: '趨勢研判', status,
      verdict: dayTrend.trend === '多頭' ? '多頭順勢可做多' : `${dayTrend.trend}：非做多前提`, details });
  }

  // 步驟2 位置
  {
    let status: StepStatus = 'warn';
    let verdict = '';
    const details: string[] = [`收盤對MA20乖離：${biasMa20.toFixed(1)}%`, `連續上漲：${upStreak} 根`];
    if (dayTrend.trend === '盤整') { status = 'warn'; verdict = '盤整區內，等突破再進（戒律6）'; }
    else if (biasMa20 > 18 || upStreak >= 4) { status = 'warn'; verdict = '乖離過大/連漲，疑似末升段或短線高檔（戒律2、8）'; details.push('追高風險'); }
    else if (aboveMa20 && biasMa20 >= 0 && biasMa20 <= 12) { status = 'pass'; verdict = '初升/主升段回檔附近，位置理想'; }
    else if (!aboveMa20) { status = 'fail'; verdict = '未站上月線，位置不宜'; }
    else { status = 'warn'; verdict = '位置中性'; }
    steps.push({ id: 2, key: 'position', name: '當下位置', status, verdict, details });
  }

  // 步驟3 K線轉折（關鍵進場K線）
  {
    const checks = [
      { label: '價漲>2%紅K', ok: chgPct > 2 && isRedK },
      { label: '量增>昨1.3倍', ok: isAttackVol },
      { label: '收盤過5均', ok: overMa5 },
      { label: '收盤過前一日高', ok: overPrevHigh },
    ];
    const passN = checks.filter(c => c.ok).length;
    // 價漲黑K（戒律9）：上漲日但收黑
    const upBlackK = chgPct > 0 && close < last.open;
    let status: StepStatus = passN >= 3 ? 'pass' : passN >= 2 ? 'warn' : 'fail';
    if (upBlackK) status = 'warn';
    steps.push({ id: 3, key: 'kline', name: 'K線轉折', status,
      verdict: passN >= 3 ? '出現多頭關鍵進場K線' : '關鍵進場訊號不足',
      details: [...checks.map(c => `${c.ok ? '✓' : '✗'} ${c.label}`), upBlackK ? '⚠️ 價漲黑K（戒律9）' : `今K漲跌 ${chgPct.toFixed(2)}%`] });
  }

  // 步驟4 均線架構
  {
    let status: StepStatus;
    let verdict: string;
    if (!aboveMa20) { status = 'fail'; verdict = '未站上月線MA20（戒律1）'; }
    else if (align3Long && maUp) { status = 'pass'; verdict = '3線多排且方向向上、站上月線'; }
    else if (align3Short) { status = 'fail'; verdict = '空頭排列'; }
    else { status = 'warn'; verdict = '均線糾結/排列不完整'; }
    steps.push({ id: 4, key: 'ma', name: '均線架構', status, verdict,
      details: [
        `MA5/10/20/60：${fmt(last.ma5)}/${fmt(last.ma10)}/${fmt(last.ma20)}/${fmt(last.ma60)}`,
        `排列：${align3Long ? '3線多排' : align3Short ? '3線空排' : '糾結'}；方向 MA5 ${last.ma5Dir ?? '—'}`,
        `股價 vs 月線：${aboveMa20 ? '站上' : '在下'}`,
      ] });
  }

  // 步驟5 量價
  {
    const priceUp = chgPct > 0;
    const divergence = priceUp && volRatio < 0.8;           // 價漲量縮（簡化背離）
    const highVolNoGain = volRatio > 2 && Math.abs(chgPct) < 0.5; // 爆量不漲
    let status: StepStatus;
    let verdict: string;
    if (isAttackVol && priceUp) { status = 'pass'; verdict = '攻擊量配合上漲'; }
    else if (highVolNoGain || (biasMa20 > 15 && volRatio > 2)) { status = 'warn'; verdict = '高檔爆量不漲，疑似調節/出貨量'; }
    else if (divergence) { status = 'warn'; verdict = '價漲量縮，量價背離'; }
    else { status = 'warn'; verdict = '量能不足以確認攻擊'; }
    steps.push({ id: 5, key: 'volume', name: '量價關係', status, verdict,
      details: [`今量/昨量：${volRatio.toFixed(2)}（攻擊量${isAttackVol ? '✓' : '✗'}）${usedIntradayProj ? '（盤中依預估量）' : ''}`,
                `量5MA參考；今K ${chgPct.toFixed(2)}%`] });
  }

  // 步驟6 指標
  {
    const k = last.k, d = last.d, hist = last.macdHist;
    const kdLongUp = k !== undefined && d !== undefined && k > d;
    const kdBlunt = k !== undefined && d !== undefined && k > 80 && d > 80;
    const kdGolden = k !== undefined && d !== undefined && prev?.k !== undefined && prev?.d !== undefined && prev.k <= prev.d && k > d;
    const macdUp = hist !== undefined && (hist > 0 || (prev?.macdHist !== undefined && hist > prev.macdHist));
    let status: StepStatus;
    if (kdLongUp && !kdBlunt && macdUp) status = 'pass';
    else if (kdBlunt || (k !== undefined && d !== undefined && k < d && !macdUp)) status = 'fail';
    else status = 'warn';
    steps.push({ id: 6, key: 'indicator', name: '指標', status,
      verdict: status === 'pass' ? '指標同向偏多' : status === 'fail' ? '指標轉空/高檔鈍化' : '指標分歧',
      details: [
        `KD：K=${fmt(k)} D=${fmt(d)} ${kdGolden ? '黃金交叉' : kdLongUp ? 'K>D多排' : 'K<D空排'}${kdBlunt ? '（高檔鈍化）' : ''}`,
        `MACD柱：${fmt(hist)} ${macdUp ? '紅柱延長/轉強' : '走弱'}`,
      ] });
  }

  // ---------- 選股SOP 6 必要條件 ----------
  const sop: SopCheck[] = [
    { label: '①趨勢：日線頭頭高底底高', ok: dayTrend.trend === '多頭' },
    { label: '②均線：MA10/MA20多排向上', ok: align3Long && maUp },
    { label: '③位置：收盤站上MA10、MA20', ok: aboveMa20 && (last.ma10 !== undefined && close > last.ma10) },
    { label: '④量：發動K線有攻擊量(>1.3)', ok: isAttackVol },
    { label: '⑤進場K線：價漲>2%突破5均過昨高', ok: chgPct > 2 && isRedK && overMa5 && overPrevHigh },
    { label: '⑥指標：KD多排向上、MACD柱轉強', ok: steps[5].status === 'pass' },
  ];
  const sopPassN = sop.filter(s => s.ok).length;

  // ---------- 進場口訣 ----------
  let entryPattern: EntryFilterResult['entryPattern'] = '皆不符';
  const notBreakPrevLow = lastLow ? close > lastLow.price : true;
  if (dayTrend.trend === '多頭' && notBreakPrevLow && overMa5 && overPrevHigh && isAttackVol && isRedK)
    entryPattern = '回後買上漲';
  else if (dayTrend.trend !== '空頭' && lastHigh && close > lastHigh.price && isAttackVol && isRedK)
    entryPattern = '盤整突破';

  // ---------- 10大戒律（可量化者）----------
  const preceptHits: PreceptHit[] = [];
  if (!aboveMa20) preceptHits.push({ no: 1, text: '盤低多頭未突破月線勿做多' });
  if (upStreak >= 3) preceptHits.push({ no: 2, text: `上漲第${upStreak}根，勿追高` });
  if (dayTrend.trend === '盤整') preceptHits.push({ no: 6, text: '盤整區內勿做多' });
  if (weekTrend && weekTrend.trend === '空頭' && dayTrend.trend === '多頭')
    preceptHits.push({ no: 7, text: '空頭(週線)的反彈勿做多' });
  if (chgPct > 0 && close < last.open) preceptHits.push({ no: 9, text: '進場位置出現價漲黑K勿做多' });

  // ---------- 決策 ----------
  let decision: Decision;
  if (dayTrend.trend !== '多頭' || !aboveMa20) decision = 'NO_GO';
  else if (sopPassN === 6 && preceptHits.length === 0 && entryPattern !== '皆不符') decision = 'GO';
  else decision = 'WAIT';

  // 信心：SOP 通過數為主，戒律與口訣調整
  let confidence = Math.round((sopPassN / 6) * 80);
  if (entryPattern !== '皆不符') confidence += 10;
  confidence -= preceptHits.length * 8;
  if (decision === 'NO_GO') confidence = Math.min(confidence, 30);
  confidence = Math.max(0, Math.min(100, confidence));

  const entryPrice = close;
  const stopPrice = +(entryPrice * 0.95).toFixed(2);

  const summary =
    decision === 'GO'
      ? `符合做多進場：${entryPattern}，SOP 6項全過、無觸犯戒律。`
      : decision === 'WAIT'
      ? `條件尚未到位（SOP ${sopPassN}/6${preceptHits.length ? `、觸犯戒律${preceptHits.map(p => p.no).join('/')}` : ''}），建議等待。`
      : `不符合做多前提（${dayTrend.trend !== '多頭' ? '非多頭' : '未站上月線'}），不進場。`;

  return {
    symbol, asof: last.date, price: close,
    trend: dayTrend.trend, trendReason: dayTrend.reason,
    weeklyTrend: weekTrend?.trend,
    steps, sop, entryPattern, preceptHits, decision, confidence,
    entryPrice, stopPrice,
    takeProfitRule: '停損 −5%；漲幅>10%收盤跌破5均停利；漲>20%或急漲3天遇大量長黑K當日出',
    summary,
  };
}
