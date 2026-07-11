// entryFilter.ts — 朱家泓「六六大順」做多進場濾網（純程式判定，方案C的客觀層）
// 直接讀用 StockDataPoint[] 內已計算好的 ma/k/d/macdHist/量 等欄位，不重算指標。
import { StockDataPoint } from '../types';
import { VolumeProjection } from './volume';

export type StepStatus = 'pass' | 'warn' | 'fail';
export type Decision = 'GO' | 'WAIT' | 'NO_GO';

// 波段大底搜尋窗（近 N 日內最低點，避免抓到過久遠的歷史低點；與 fetch_stock.py 一致）
const MAJOR_LOW_LOOKBACK = 60;

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
  entryPattern: '回後買上漲' | '盤整突破' | 'K線橫盤突破' | '皆不符';
  preceptHits: PreceptHit[];        // 觸犯的戒律
  decision: Decision;
  confidence: number;               // 0-100
  entryPrice: number;
  stopPrice: number;                // 停損軌一：進場價 × 0.95（-5%）
  maGuardPrice?: number;            // 停損軌二：關鍵均線防守價（收盤跌破即出場）
  guardMaLabel?: string;            // 軌二採用的均線（短線MA5／波段MA10／中長線MA20）
  takeProfitRule: string;
  summary: string;
}

/** 停損軌二的操作級別：短線 MA5／波段 MA10／中長線 MA20（預設） */
export type GuardLevel = 'MA5' | 'MA10' | 'MA20';

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
  volumeProj?: VolumeProjection | null,
  guardLevel: GuardLevel = 'MA20'   // 停損軌二操作級別（短線MA5／波段MA10／中長線MA20）
): EntryFilterResult {
  const n = data.length;
  const last = data[n - 1];
  const prev = data[n - 2];
  const dayTrend = trendOf(data);
  const weekTrend = weeklyData && weeklyData.length > 10 ? trendOf(weeklyData) : undefined;

  const close = last.close;
  const chgPct = last.priceChangePercent ?? (prev ? ((close - prev.close) / prev.close) * 100 : 0);
  // 盤中時改用「預估全日量」計算攻擊量（收盤量比會低估），否則用實際今量；兩軌皆套用同一今量。
  const dayVolRatio = prev && prev.volume ? last.volume / prev.volume : 0;
  const usedIntradayProj = !!(volumeProj && volumeProj.status === 'Intraday' && volumeProj.yesterdayVolume > 0);
  const volRatio = usedIntradayProj
    ? volumeProj!.projectedVolume / volumeProj!.yesterdayVolume
    : dayVolRatio;
  // 攻擊量雙軌擇一（初階CH6）：今量>昨量×1.3 或 今量>基本量(前5日均量,不含今日)×1.2
  const todayVolEff = usedIntradayProj ? volumeProj!.projectedVolume : last.volume;
  const baseVol5 = n >= 6
    ? data.slice(n - 6, n - 1).reduce((s, p) => s + p.volume, 0) / 5
    : 0;
  const volVsBase5 = baseVol5 > 0 ? todayVolEff / baseVol5 : 0;
  const isAttackVol = volRatio >= 1.3 || volVsBase5 >= 1.2;
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

  // 回檔 1/2 法則（初階 CH2）：前波漲幅（前底→前高）與當前回檔比例
  // 弱勢回檔（<1/2、不破月線/前低）→ 多頭續漲；強勢回檔（>1/2 或破月線/前低）→ warn
  let retraceRatio: number | undefined;
  let retraceBrokeLow = false;
  if (lastHigh) {
    const lowsBeforeHigh = lows.filter(s => s.idx < lastHigh.idx);
    const prevLow = lowsBeforeHigh[lowsBeforeHigh.length - 1];   // 前高之前最近的前底
    if (prevLow) {
      const upAmp = lastHigh.price - prevLow.price;
      const pullLow = Math.min(...data.slice(lastHigh.idx).map(p => p.close));
      if (upAmp > 0 && pullLow < lastHigh.price) {
        retraceRatio = (lastHigh.price - pullLow) / upAmp;
        retraceBrokeLow = pullLow < prevLow.price;
      }
    }
  }

  // 高檔量化錨點（進階連三紅第5/6點、淘汰法#5）
  // 波段大底＝近 MAJOR_LOW_LOOKBACK 日內最低點（優先取轉折低，無則取最低收盤），避免抓到過久遠歷史低點
  let riseFromBase: number | undefined;          // 自波段大底以來漲幅%
  {
    const winStart = Math.max(0, n - MAJOR_LOW_LOOKBACK);
    const lowsInWin = lows.filter(s => s.idx >= winStart);
    const basePrice = lowsInWin.length
      ? lowsInWin.reduce((m, s) => (s.price < m.price ? s : m)).price
      : Math.min(...data.slice(winStart).map(d => d.close));
    if (basePrice > 0) riseFromBase = ((close - basePrice) / basePrice) * 100;
  }
  let ma5RunRisePct: number | undefined;         // 沿5均（收盤≥MA5）累計漲幅%（最多回看20根）
  {
    let s = n - 1;
    while (s > 0 && n - 1 - s < 20 && data[s].ma5 !== undefined && data[s].close >= data[s].ma5!) s--;
    const start = s + 1;
    if (start < n - 1 && last.ma5 !== undefined && close >= last.ma5 && data[start].close > 0 && close > data[start].close)
      ma5RunRisePct = ((close - data[start].close) / data[start].close) * 100;
  }

  // 步驟2 位置
  {
    let status: StepStatus = 'warn';
    let verdict = '';
    const details: string[] = [`收盤對MA20乖離：${biasMa20.toFixed(1)}%`, `連續上漲：${upStreak} 根`];
    if (retraceRatio !== undefined)
      details.push(`回檔/前波漲幅：${(retraceRatio * 100).toFixed(0)}%${retraceBrokeLow ? '（已破前低）' : ''}`);
    if (riseFromBase !== undefined) details.push(`自波段大底漲幅：${riseFromBase.toFixed(0)}%`);
    if (ma5RunRisePct !== undefined) details.push(`沿5均累計漲幅：${ma5RunRisePct.toFixed(1)}%`);
    if (dayTrend.trend === '盤整') { status = 'warn'; verdict = '盤整區內，等突破再進（戒律6）'; }
    else if (biasMa20 > 18 || upStreak >= 4) { status = 'warn'; verdict = '乖離過大/連漲，疑似末升段或短線高檔（戒律2、8）'; details.push('追高風險'); }
    else if (riseFromBase !== undefined && riseFromBase >= 100) {
      status = 'warn'; verdict = '自波段大底起漲已達一倍＝高檔（淘汰法#5、末升段），不宜追多';
    }
    else if (ma5RunRisePct !== undefined && ma5RunRisePct > 20) {
      status = 'warn'; verdict = '沿5均累計漲幅逾20%，遇大量長紅/變盤訊號即停利（連三紅警訊）';
    }
    else if (retraceRatio !== undefined && (retraceRatio > 0.5 || retraceBrokeLow) && dayTrend.trend === '多頭') {
      status = 'warn'; verdict = '強勢回檔（回檔超過前波漲幅1/2或破前低），易頭頭低盤整，站回月線再談做多';
    }
    else if (aboveMa20 && biasMa20 >= 0 && biasMa20 <= 12) { status = 'pass'; verdict = '初升/主升段回檔附近，位置理想'; }
    else if (!aboveMa20) { status = 'fail'; verdict = '未站上月線，位置不宜'; }
    else { status = 'warn'; verdict = '位置中性'; }
    steps.push({ id: 2, key: 'position', name: '當下位置', status, verdict, details });
  }

  // 步驟3 K線轉折（關鍵進場K線）
  {
    const checks = [
      { label: '價漲>2%紅K', ok: chgPct > 2 && isRedK },
      { label: '攻擊量(>昨1.3倍或>5日均量1.2倍)', ok: isAttackVol },
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
      details: [`今量/昨量：${volRatio.toFixed(2)}；今量/5日均量：${volVsBase5 > 0 ? volVsBase5.toFixed(2) : 'N/A'}（攻擊量${isAttackVol ? '✓' : '✗'}，>昨1.3倍或>5日均量1.2倍擇一）${usedIntradayProj ? '（盤中依預估量）' : ''}`,
                `今K ${chgPct.toFixed(2)}%`] });
  }

  // 步驟6 指標
  {
    const k = last.k, d = last.d, hist = last.macdHist;
    const kdLongUp = k !== undefined && d !== undefined && k > d;
    // 高檔鈍化（KD 進入 80~100 盤整）＝指標失去參考價值、回歸價量；為強勢股特徵，不單獨扣分
    const kdBlunt = k !== undefined && d !== undefined && k > 80 && d > 80;
    const kdGolden = k !== undefined && d !== undefined && prev?.k !== undefined && prev?.d !== undefined && prev.k <= prev.d && k > d;
    const macdUp = hist !== undefined && (hist > 0 || (prev?.macdHist !== undefined && hist > prev.macdHist));
    const priceVolOk = chgPct > 0 && isAttackVol;   // 價漲＋攻擊量＝價量正常
    let status: StepStatus;
    let verdict: string;
    if (kdBlunt) {
      // 鈍化時 KD 不作多空判定，改依價量
      if (priceVolOk) { status = 'pass'; verdict = '高檔鈍化，回歸價量：價漲量增仍偏多'; }
      else if (chgPct < 0 || (hist !== undefined && !macdUp)) { status = 'warn'; verdict = '高檔鈍化且價量轉弱，留意停利'; }
      else { status = 'warn'; verdict = '高檔鈍化，回歸價量觀察'; }
    } else if (kdLongUp && macdUp) {
      status = 'pass'; verdict = '指標同向偏多';
    } else if (k !== undefined && d !== undefined && k < d && !macdUp) {
      status = 'fail'; verdict = '指標轉弱';
    } else {
      status = 'warn'; verdict = '指標分歧';
    }
    steps.push({ id: 6, key: 'indicator', name: '指標', status, verdict,
      details: [
        `KD：K=${fmt(k)} D=${fmt(d)} ${kdGolden ? '黃金交叉' : kdLongUp ? 'K>D多排' : 'K<D空排'}${kdBlunt ? '（高檔鈍化，回歸價量）' : ''}`,
        `MACD柱：${fmt(hist)} ${macdUp ? '紅柱延長/轉強' : '走弱'}`,
      ] });
  }

  // ---------- 選股SOP 6 必要條件 ----------
  const sop: SopCheck[] = [
    { label: '①趨勢：日線頭頭高底底高', ok: dayTrend.trend === '多頭' },
    { label: '②均線：MA10/MA20多排向上', ok: align3Long && maUp },
    { label: '③位置：收盤站上MA10、MA20', ok: aboveMa20 && (last.ma10 !== undefined && close > last.ma10) },
    { label: '④量：攻擊量(>昨1.3倍或>5日均量1.2倍)', ok: isAttackVol },
    { label: '⑤進場K線：價漲>2%突破5均過昨高', ok: chgPct > 2 && isRedK && overMa5 && overPrevHigh },
    { label: '⑥指標：KD多排向上、MACD柱轉強', ok: steps[5].status === 'pass' },
  ];
  const sopPassN = sop.filter(s => s.ok).length;

  // ---------- K線橫盤突破偵測（進階第六章買點3）----------
  // 往回找「起始K」：其後連續 ≥3 根收盤皆未突破起始K最高點、也未跌破其最低點（K線橫盤），
  // 今日中長紅K（漲>2%）帶攻擊量（雙軌）收盤突破起始K最高點，且 MA20 未下彎。
  let isSidewaysBreakout = false;
  if (n >= 5 && isRedK && chgPct > 2 && isAttackVol && last.ma20Dir !== 'down') {
    const maxLookback = Math.max(0, n - 1 - 12);   // 橫盤最多回看 12 根
    for (let s = n - 5; s >= maxLookback; s--) {
      const boxHigh = data[s].high, boxLow = data[s].low;
      const inner = data.slice(s + 1, n - 1);      // 起始K之後、今日之前
      if (inner.length < 3) continue;
      const allInside = inner.every(p => p.close <= boxHigh && p.close >= boxLow);
      if (allInside && close > boxHigh) { isSidewaysBreakout = true; break; }
    }
  }

  // ---------- 進場口訣（優先序：結構最特定者先判） ----------
  let entryPattern: EntryFilterResult['entryPattern'] = '皆不符';
  const notBreakPrevLow = lastLow ? close > lastLow.price : true;
  if (dayTrend.trend === '多頭' && isSidewaysBreakout)
    entryPattern = 'K線橫盤突破';
  else if (dayTrend.trend === '多頭' && notBreakPrevLow && overMa5 && overPrevHigh && isAttackVol && isRedK)
    entryPattern = '回後買上漲';
  else if (dayTrend.trend !== '空頭' && lastHigh && close > lastHigh.price && isAttackVol && isRedK)
    entryPattern = '盤整突破';

  // ---------- 10大戒律（可量化者）----------
  const preceptHits: PreceptHit[] = [];
  if (!aboveMa20) preceptHits.push({ no: 1, text: '盤低多頭未突破月線勿做多' });
  if (upStreak >= 3) preceptHits.push({ no: 2, text: `上漲第${upStreak}根，勿追高` });
  if (dayTrend.trend === '盤整') preceptHits.push({ no: 6, text: '盤整區內勿做多' });
  // 戒律3：遇週線壓力前勿做多（距現價上方最近週線轉折高 <5%；無週線資料則跳過不誤判）
  if (weekTrend) {
    const wkHighsAbove = weekTrend.swings.filter(s => s.type === 'high' && s.price > close);
    if (wkHighsAbove.length) {
      const nearRes = Math.min(...wkHighsAbove.map(s => s.price));
      const distPct = ((nearRes - close) / close) * 100;
      if (distPct < 5)
        preceptHits.push({ no: 3, text: `距週線壓力 ${nearRes.toFixed(2)} 僅 ${distPct.toFixed(1)}%，遇週線壓力前勿做多` });
    }
  }
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
  // 停損雙軌擇一（擇一為主要防守，收盤跌破即出場）：
  // 軌一：進場價 × 0.95（-5%）；軌二：收盤跌破關鍵均線（依操作級別 MA5/MA10/MA20）
  const stopPrice = +(entryPrice * 0.95).toFixed(2);
  const guardMaVal = guardLevel === 'MA5' ? last.ma5 : guardLevel === 'MA10' ? last.ma10 : last.ma20;
  const maGuardPrice = guardMaVal !== undefined ? +guardMaVal.toFixed(2) : undefined;
  const guardMaLabel = guardLevel === 'MA5' ? '短線MA5' : guardLevel === 'MA10' ? '波段MA10' : '中長線MA20';

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
    entryPrice, stopPrice, maGuardPrice, guardMaLabel,
    takeProfitRule: `停損雙軌擇一：-5%（${stopPrice}）或收盤跌破${guardMaLabel}（${maGuardPrice ?? '—'}）；漲幅>10%收盤跌破5均停利；漲>20%或急漲3天遇大量長黑K當日出；飆股/糾結突破改用智慧K線法（收盤跌破前一日K線最低點出場）`,
    summary,
  };
}
