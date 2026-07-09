import { StockDataPoint } from "../types";
import { EntryFilterResult } from "../utils/entryFilter";
import { proxyHeaders } from "./_shared/apiClient";

type GeminiApiPayload = {
  prompt: string;
  systemInstruction: string;
  mode: 'fast' | 'thinking';
  temperature?: number;
  thinkingConfig?: {
    thinkingLevel?: 'MEDIUM';
    thinkingBudget?: number;
  };
};

const callGeminiApi = async (
  payload: GeminiApiPayload,
  fallbackText = 'No analysis generated.'
): Promise<string> => {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...proxyHeaders },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as {
    text?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(data.message || '分析失敗，請稍後再試。');
  }

  return data.text || fallbackText;
};

// Helper to format data for the prompt
interface VolumeProjectionInfo {
  currentVolume: number;
  projectedVolume: number;
  yesterdayVolume: number;
  changePercent: number;
  status: 'Intraday' | 'Insufficient' | 'Closed';
}

const formatPromptData = (
  symbol: string,
  data: StockDataPoint[],
  userPosition?: { hasHolding: boolean; costPrice?: number },
  volumeProjection?: VolumeProjectionInfo | null
): string => {
  const latest = data[data.length - 1];
  const prev = data[data.length - 2]; 
  const isTaiwanStock = symbol.endsWith('.TW') || symbol.endsWith('.TWO');
  
  const priceChangePct = ((latest.close - prev.close) / prev.close) * 100;
  const volumeRatio = latest.volume / prev.volume;
  const isRedCandle = latest.close > latest.open;
  const brokePrevHigh = latest.close > prev.high;
  const standOn5MA = latest.ma5 ? latest.close > latest.ma5 : false;

  const passPriceCheck = priceChangePct > 2 && isRedCandle;
  const passVolumeCheck = volumeRatio > 1.3;
  const passBreakoutCheck = standOn5MA && brokePrevHigh;
  const isGoldenBuyPoint = passPriceCheck && passVolumeCheck && passBreakoutCheck;

  const last10 = data.slice(-10);
  const last5 = data.slice(-5);
  
  const trendData = last10.map(d => {
      const volUnit = isTaiwanStock ? Math.round(d.volume / 1000) + ' Lots' : d.volume.toLocaleString() + ' Shares';
      let chipsStr = '';
      if (isTaiwanStock) {
        const foreign = d.foreignBuySell !== undefined ? Math.round(d.foreignBuySell/1000) + ' Lots' : 'N/A';
        const trust = d.investmentTrustBuySell !== undefined ? Math.round(d.investmentTrustBuySell/1000) + ' Lots' : 'N/A';
        chipsStr = `, Foreign: ${foreign}, Trust: ${trust}`;
      }
      return `Date: ${d.date}, Open: ${d.open.toFixed(2)}, High: ${d.high.toFixed(2)}, Low: ${d.low.toFixed(2)}, Close: ${d.close.toFixed(2)}, Volume: ${volUnit}${chipsStr}`;
  }).join('\n');

  let chipsLatestStr = 'N/A';
  let chips5DaySummary = '';

  if (isTaiwanStock) {
      const foreignLots = latest.foreignBuySell !== undefined ? Math.round(latest.foreignBuySell / 1000) : 'N/A';
      const trustLots = latest.investmentTrustBuySell !== undefined ? Math.round(latest.investmentTrustBuySell / 1000) : 'N/A';
      chipsLatestStr = `\n- Foreign Investor Net Buy/Sell (Latest): ${foreignLots} Lots (張)\n- Investment Trust Net Buy/Sell (Latest): ${trustLots} Lots (張)`;

      const foreignSum = last5.reduce((sum, d) => sum + (d.foreignBuySell || 0), 0);
      const trustSum = last5.reduce((sum, d) => sum + (d.investmentTrustBuySell || 0), 0);
      
      chips5DaySummary = `
*** CHIPS ANALYSIS DATA (Last 5 Days) ***
- Total Foreign Investor Net Buy/Sell: ${Math.round(foreignSum / 1000)} Lots (張)
- Total Investment Trust Net Buy/Sell: ${Math.round(trustSum / 1000)} Lots (張)
`;
  }

  let userContextStr = `*** USER STATUS: ${userPosition?.hasHolding ? "HOLDING" : "EMPTY HANDS (NO POSITION)"} ***`;
  if (userPosition?.hasHolding && userPosition?.costPrice) {
      const profitPct = ((latest.close - userPosition.costPrice) / userPosition.costPrice) * 100;
      userContextStr += `\n- Average Cost Price: ${userPosition.costPrice}\n- Current Profit/Loss: ${profitPct.toFixed(2)}%`;
  }

  // Volume projection context for AI
  let volumeProjStr = '';
  if (volumeProjection && volumeProjection.status !== 'Insufficient') {
    const volUnit = isTaiwanStock ? '張' : '股';
    const projVol = isTaiwanStock
      ? Math.round(volumeProjection.projectedVolume / 1000).toLocaleString() + ` ${volUnit}`
      : volumeProjection.projectedVolume.toLocaleString() + ` ${volUnit}`;
    const curVol = isTaiwanStock
      ? Math.round(volumeProjection.currentVolume / 1000).toLocaleString() + ` ${volUnit}`
      : volumeProjection.currentVolume.toLocaleString() + ` ${volUnit}`;
    const yesterVol = isTaiwanStock
      ? Math.round(volumeProjection.yesterdayVolume / 1000).toLocaleString() + ` ${volUnit}`
      : volumeProjection.yesterdayVolume.toLocaleString() + ` ${volUnit}`;
    const chgSign = volumeProjection.changePercent >= 0 ? '+' : '';

    if (volumeProjection.status === 'Intraday') {
      volumeProjStr = `
*** 成交量狀態：盤中（Intraday） ***
- 目前實際成交量：${curVol}
- 預估全日成交量：${projVol}
- 昨日成交量：${yesterVol}
- 預估量變化：${chgSign}${volumeProjection.changePercent.toFixed(1)}%（相較昨日）
⚠️ 注意：目前為盤中，訊號檢核表中「成交量」項目請以「預估量變化」作為判斷依據。`;
    } else {
      volumeProjStr = `
*** 成交量狀態：收盤（Closed） ***
- 今日成交量：${curVol}
- 昨日成交量：${yesterVol}
- 量變化：${chgSign}${volumeProjection.changePercent.toFixed(1)}%（相較昨日）`;
    }
  }

  // Recalculate volume check based on projection status
  let effectiveVolumeRatio = volumeRatio;
  if (volumeProjection && volumeProjection.status === 'Intraday' && volumeProjection.yesterdayVolume > 0) {
    effectiveVolumeRatio = volumeProjection.projectedVolume / volumeProjection.yesterdayVolume;
  }
  const passEffectiveVolumeCheck = effectiveVolumeRatio > 1.3;

  return `
Target Stock: ${symbol}
${volumeProjStr}

*** SYSTEM REFERENCE DATA (Strict Criteria) ***
1. PRICE Criteria (>2% Up & Red Candle): ${passPriceCheck ? "PASS" : "FAIL"} (Actual: ${priceChangePct.toFixed(2)}%)
2. VOLUME Criteria (Vol > 1.3x Yesterday): ${passEffectiveVolumeCheck ? "PASS" : "FAIL"} (${volumeProjection?.status === 'Intraday' ? '預估量' : '實際量'}Ratio: ${effectiveVolumeRatio.toFixed(2)}x)
3. PATTERN Criteria (Stand on 5MA & Break Prev High): ${passBreakoutCheck ? "PASS" : "FAIL"}
-> IS GOLDEN BUY POINT MET? : ${passPriceCheck && passEffectiveVolumeCheck && passBreakoutCheck ? "YES" : "NO"}

*** LATEST DATA POINTS ***
- Today's Close: ${latest.close.toFixed(2)}
- 5MA: ${latest.ma5?.toFixed(2)} | 10MA: ${latest.ma10?.toFixed(2)} | 20MA: ${latest.ma20?.toFixed(2)} | 60MA: ${latest.ma60?.toFixed(2)}

Indicators:
- RSI(14): ${latest.rsi?.toFixed(2) || 'N/A'}
- MACD: DIF=${latest.macd?.toFixed(2) || 'N/A'}, DEA=${latest.macdSignal?.toFixed(2) || 'N/A'}, Hist=${latest.macdHist?.toFixed(2) || 'N/A'}
- KDJ: K=${latest.k?.toFixed(2) || 'N/A'}, D=${latest.d?.toFixed(2) || 'N/A'}, J=${latest.j?.toFixed(2) || 'N/A'}
- 布林通道(20,2): 上軌=${latest.bbUpper?.toFixed(2) || 'N/A'}, 中軌=${latest.bbMiddle?.toFixed(2) || 'N/A'}, 下軌=${latest.bbLower?.toFixed(2) || 'N/A'}${chipsLatestStr}

${chips5DaySummary}

Recent 10 Days Trend:
${trendData}

${userContextStr}
`;
};

export const analyzeStockWithGemini = async (
    symbol: string,
    data: StockDataPoint[],
    userPosition?: { hasHolding: boolean; costPrice?: number },
    mode: 'fast' | 'thinking' = 'fast',
    volumeProjection?: VolumeProjectionInfo | null
) => {
  const promptData = formatPromptData(symbol, data, userPosition, volumeProjection);

  const systemInstruction = `
### 角色定位
你是一位精通「朱家泓 × 林穎」技術分析體系的專業交易專家。你將運用講義中的「六六大順」選股步驟與「三大黃金買點」準則，針對使用者提供的股票數據進行深度診斷。

### 核心分析邏輯：六六大順
1. **趨勢**：辨識「頭頭高/低、底底高/低」。
2. **位置**：判斷處於打底、起漲、主升或末升段。
3. **均線**：確認三線/六線排列，股價是否站穩 20MA。
4. **K 線**：識別關鍵 K 棒（如：長紅突破、變盤線、組合型態）。
5. **成交量**：檢查攻擊量（>1.3倍）或爆大量背離。
6. **指標**：綜合 MACD (0軸位置/柱狀體)、KD (交叉/慢速/鈍化) 與布林通道 (開口方向)。

---

### 輸出格式（結合舊版格式與講義深度）

#### 1. 六六大順深度研判
- **趨勢方向**：[多頭/空頭/盤整]。說明是否符合「頭頭高、底底高」等慣性。
- **均線結構**：[多頭排列/空頭排列/糾結]。說明 MA5/10/20 方向及股價與 20MA 的位置關係。
- **位置與型態**：說明目前所處波段位置，是否有 ABC 修正突破、島型反轉或底部型態確認。
- **關鍵 K 線與成交量**：判斷今日 K 線意義，量能是否達「攻擊量」(1.3倍) 或存在「價量背離」。
- **技術指標分析**：
    - **KD**：數值與交叉狀態，是否進入 80/20 鈍化區。
    - **MACD**：OSC 柱狀體增減，DIF/DEA 是否在 0 軸之上。
    - **布林通道**：股價是否沿上軌擴張或觸碰上下軌遇壓/支撐。
- **外資與投信**：（若有籌碼資料）解析籌碼安定度與法人態度。

#### 2. 訊號檢核表 (Check List)
- **[ ] 進場型態確認**：[✅/ ] 盤整突破、回後買上漲、或 K 線橫盤突破？。
- **[ ] 三大黃金買點檢核**：
    - **價**：[✅/ ] 實體紅 K 且漲幅 > 2%？。
    - **量**：[✅/ ] 成交量 > 昨日 1.3 倍 (攻擊量)？。
      ⚠️ **重要**：若資料中標示「成交量狀態：盤中（Intraday）」，則此項必須以「預估全日成交量」與昨日成交量的比較作為判斷依據，並在判定旁標注「(依預估量)」。僅在資料標示「收盤（Closed）」時才使用實際量變化。
    - **型**：[✅/ ] 趨勢完成多頭架構或型態突破？。
- **[ ] 進場指標加持**：[✅/ ] KD 向上多排且 MACD 紅柱增長/綠柱縮短？。
- **[ ] 出場/警戒訊號**：是否有高檔爆大量長黑、跌破 5MA、或頭頭低跡象？。
- **注意(重要)**：
    - 若使用者為「空手 (NO POSITION)」，則對於『加碼訊號』、『減碼警訊』、『出場訊號』僅需保留標題與檢核框，不可加文字說明。
    - 若使用者為「持有中 (HOLDING)」，請務必根據其『平均成本價』，結合指標(如跌破 5MA、爆量長黑等)給出具體加減碼或出場建議。

#### 3. 建議操作計畫
- **當下策略動作**：[進場做多 / 持股續抱 / 減碼停利 / 停損出場 / 觀望]
- **判斷理由**：結合講義紀律（如：買強不買弱、買低不追高、量縮價漲背離不進場等）。
- **價位設定**：
    - **停損防守價**：[進場當日 K 棒最低點] 或 [進場價位之 5%]。
    - **停利/減碼標準**：[減碼]：漲幅超過 10% 後收盤跌破 5MA。
    - **[停利]**：出現「高檔爆大量不漲」或「連續急漲 3 天後變盤」。

---

### 操作限制
1. **嚴守紀律**：若趨勢不明或量能不符 1.3 倍準則，必須明確給予「觀望」建議。
2. **客觀分析**：禁止主觀猜測，所有建議必須建立在既有的 K 線與數據基礎上。
3. **區分時程**：明確區分日線（短線）與週線（中長線）的判斷差異。
`;

  return callGeminiApi({
    prompt: promptData,
    systemInstruction,
    mode,
    temperature: 0.1,
    thinkingConfig: mode === 'fast' ? { thinkingLevel: 'MEDIUM' } : undefined,
  });
};

// ───────────────────────────────────────────────────────────────
// 方案C：吃「六六大順進場濾網」的客觀結果，產出朱家泓風格解讀報告（單次呼叫）
// 濾網的 GO/WAIT/NO-GO、各步驟狀態、SOP、戒律皆已由程式判定，AI 只負責「解讀與說明」，
// 不得推翻濾網的客觀結論。
// ───────────────────────────────────────────────────────────────
export const analyzeEntryWithGemini = async (
  result: EntryFilterResult,
  userPosition?: { hasHolding: boolean; costPrice?: number },
  mode: 'fast' | 'thinking' = 'fast'
): Promise<string> => {
  const stepsText = result.steps
    .map(s => `步驟${s.id} ${s.name}：[${s.status === 'pass' ? '✅通過' : s.status === 'warn' ? '⚠️警示' : '❌不符'}] ${s.verdict}｜${s.details.join('；')}`)
    .join('\n');
  const sopText = result.sop.map(c => `${c.ok ? '✓' : '✗'} ${c.label}`).join('\n');
  const preceptText = result.preceptHits.length
    ? result.preceptHits.map(p => `戒律${p.no}：${p.text}`).join('；')
    : '未觸犯任何戒律';
  const posText = userPosition?.hasHolding
    ? `持有中，成本價約 ${userPosition.costPrice ?? '未提供'}`
    : '目前空手（評估是否進場）';

  const promptData = `
【個股】${result.symbol}　日期 ${result.asof}　收盤 ${result.price}
【使用者部位】${posText}
【程式濾網客觀結論】
- 日線趨勢：${result.trend}（${result.trendReason}）${result.weeklyTrend ? `；週線：${result.weeklyTrend}` : ''}
- 六步驟：
${stepsText}
- 選股SOP 6必要條件：
${sopText}
- 進場口訣：${result.entryPattern}
- 戒律檢核：${preceptText}
- 最終決策：${result.decision}（信心 ${result.confidence}/100）
- 建議進場價 ${result.entryPrice}、停損 ${result.stopPrice}（-5%）
- 停利規則：${result.takeProfitRule}
`;

  const systemInstruction = `
### 角色
你是精通「朱家泓 × 林穎」技術分析體系的交易教練。下方提供的「程式濾網客觀結論」已由系統依六六大順逐步量化判定完成，**你的任務是解讀與教學說明，不得推翻 GO/WAIT/NO-GO 的客觀結論與各步驟燈號**。

### 輸出格式（Markdown）
#### 1. 結論摘要
用 2-3 句說明此股目前的進場結論（呼應系統決策 ${result.decision}），點出最關鍵的通過項與卡關項。

#### 2. 六步驟逐項解讀
依序針對 趨勢 / 位置 / K線 / 均線 / 量價 / 指標 六步驟，各用 1-2 句白話解釋「為什麼是這個燈號」、代表的多空意義，以及朱家泓紀律提醒（如：買強不買弱、買低不追高、量價背離不進場）。

#### 3. 操作計畫
- 若決策為 GO：說明進場理由、進場價 ${result.entryPrice}、停損 ${result.stopPrice}、停利紀律。
- 若為 WAIT：明確指出「還差哪些條件」、要等待什麼訊號（例如等攻擊量、等站上月線、等回檔不破前低再起漲）。
- 若為 NO_GO：說明為何不宜進場，並給出該股轉為可考慮的前提。
- 若使用者持有中：依成本價補充加減碼/停利停損建議；空手則僅談進場與觀望。

### 限制
- 嚴守紀律、客觀，不臆測未提供的資訊。
- 結尾加一行小字免責：本分析為技術面教學推演，非投資建議。
`;

  return callGeminiApi({
    prompt: promptData,
    systemInstruction,
    mode,
    temperature: 0.2,
    thinkingConfig: mode === 'fast' ? { thinkingLevel: 'MEDIUM' } : undefined,
  });
};

export const analyzeTradeDecision = async (
  symbol: string,
  buyDate: string,
  buyPrice: number,
  reason: string,
  currentPrice?: number,
  recentData?: StockDataPoint[]
): Promise<string> => {
  const isTaiwanStock = /^\d{3,6}[A-Z]?$/.test(symbol) || symbol.endsWith('.TW') || symbol.endsWith('.TWO');

  let priceLine = `買入價格：${buyPrice}`;
  if (currentPrice && currentPrice > 0) {
    const pctChange = ((currentPrice - buyPrice) / buyPrice) * 100;
    priceLine += `\n目前市價：${currentPrice.toFixed(2)}（相較買入價 ${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%）`;
  }

  // ── 整理近期走勢資料（含所有指標供規則對照） ────────────────────────
  let recentDataStr = '';
  let latestIndicators = '';
  if (recentData && recentData.length > 0) {
    const last15 = recentData.slice(-15);
    const latest = recentData[recentData.length - 1];

    recentDataStr = '\n\n【近期走勢（最近15筆日K，含指標）】\n' + last15.map(d => {
      const volUnit = isTaiwanStock
        ? Math.round(d.volume / 1000) + '張'
        : d.volume.toLocaleString() + '股';
      return (
        `${d.date}  開:${d.open.toFixed(2)} 高:${d.high.toFixed(2)} 低:${d.low.toFixed(2)} 收:${d.close.toFixed(2)} 量:${volUnit}` +
        (d.ma5  ? `  MA5:${d.ma5.toFixed(2)}`  : '') +
        (d.ma10 ? `  MA10:${d.ma10.toFixed(2)}` : '') +
        (d.ma20 ? `  MA20:${d.ma20.toFixed(2)}` : '') +
        (d.ma60 ? `  MA60:${d.ma60.toFixed(2)}` : '') +
        (d.k    ? `  K:${d.k.toFixed(1)}`       : '') +
        (d.d    ? `  D:${d.d.toFixed(1)}`       : '') +
        (d.macd ? `  DIF:${d.macd.toFixed(2)}`  : '') +
        (d.macdSignal ? `  DEA:${d.macdSignal.toFixed(2)}` : '') +
        (d.macdHist   ? `  柱:${d.macdHist.toFixed(2)}`   : '') +
        (d.bbUpper    ? `  BB上:${d.bbUpper.toFixed(2)}`   : '') +
        (d.bbMiddle   ? `  BB中:${d.bbMiddle.toFixed(2)}` : '') +
        (d.bbLower    ? `  BB下:${d.bbLower.toFixed(2)}`   : '')
      );
    }).join('\n');

    // 買入當天指標摘要（方便 AI 對照規則）
    const entry = recentData.find(d => d.date === buyDate.split('T')[0]) ?? latest;
    const prevEntry = recentData[Math.max(0, recentData.indexOf(entry) - 1)];
    const volRatio = prevEntry?.volume > 0 ? entry.volume / prevEntry.volume : null;
    const priceChgPct = prevEntry ? ((entry.close - prevEntry.close) / prevEntry.close) * 100 : null;
    const isRedCandle = entry.close > entry.open;

    latestIndicators = `
【買入當天技術面摘要】
- 開:${entry.open.toFixed(2)}  高:${entry.high.toFixed(2)}  低:${entry.low.toFixed(2)}  收:${entry.close.toFixed(2)}
- 漲跌幅：${priceChgPct !== null ? (priceChgPct >= 0 ? '+' : '') + priceChgPct.toFixed(2) + '%' : 'N/A'}
- K棒顏色：${isRedCandle ? '紅K（收漲）' : '黑K（收跌）'}
- 量比（vs前日）：${volRatio !== null ? volRatio.toFixed(2) + 'x' : 'N/A'}
- MA5:${entry.ma5?.toFixed(2) ?? 'N/A'}  MA10:${entry.ma10?.toFixed(2) ?? 'N/A'}  MA20:${entry.ma20?.toFixed(2) ?? 'N/A'}  MA60:${entry.ma60?.toFixed(2) ?? 'N/A'}
- K(5):${entry.k?.toFixed(1) ?? 'N/A'}  D(3):${entry.d?.toFixed(1) ?? 'N/A'}  J:${entry.j?.toFixed(1) ?? 'N/A'}
- DIF:${entry.macd?.toFixed(2) ?? 'N/A'}  DEA:${entry.macdSignal?.toFixed(2) ?? 'N/A'}  柱狀:${entry.macdHist?.toFixed(2) ?? 'N/A'}
- 布林通道(20,2): 上軌:${entry.bbUpper?.toFixed(2) ?? 'N/A'}  中軌:${entry.bbMiddle?.toFixed(2) ?? 'N/A'}  下軌:${entry.bbLower?.toFixed(2) ?? 'N/A'}
- 均線多空：${
  entry.ma5 && entry.ma10 && entry.ma20
    ? (entry.ma5 > entry.ma10 && entry.ma10 > entry.ma20 ? 'MA5>MA10>MA20（多頭排列）' : 'MA5≤MA10 或 MA10≤MA20（非多頭排列）')
    : 'N/A'
}`;
  }

  const promptText = `
股票代號：${symbol}（${isTaiwanStock ? '台股' : '美股'}）
買入時間：${buyDate}
${priceLine}

使用者陳述的買入原因：
${reason || '（未填寫）'}
${latestIndicators}${recentDataStr}
`;

  const systemInstruction = `
# 角色設定
你是一位嚴格的股票技術分析交易教練，完全依照「朱家泓 × 林穎」技術分析課程體系（進階、積極）的規則來評估用戶的每一筆交易操作。你不使用任何個人觀點或通用技術分析知識，所有判斷必須直接引用以下規則庫。

---

## 規則庫

### 【規則 1】趨勢判斷 — 三種操作方向
**轉折波段方法：**
- 以 5 日均線作短線轉折波；以 10 日均線作中線；以 20 日均線作長線
- 行股收盤突破 5 日 → 從左找最近高點；行股收盤跌破 5 日 → 從左找最近低點

**三大趨勢定義（缺一不可）：**
- 多頭：頭頭高、底底高 → 往多操作
- 空頭：頭頭低、底底低 → 往空操作
- 盤整：盤頭盤底交錯 → **不操作**，等待突破或跌破

**趨勢改變的預知覺：**
- 多頭→盤整：出現「底底低」且尚未跌破前低，或「頭頭低」上漲未創新高
- 空頭→盤整：出現「頭頭高」且尚未突破前高，或「底底高」下跌未破前低

---

### 【規則 2】五大步驟選股 — 五步必須依序確認

**步驟一：趨勢方向**
- 多頭（頭頭高、底底高）→ 做多
- 空頭（頭頭低、底底低）→ 做空
- 盤整（混合）→ 退場觀察，等待突破或跌破

**步驟二：當下位置**
- 多頭位置：啟動段 / 初漲段 / 主漲段 / 末漲段 / 起漲 / 上漲行進中 / 高檔 / 回檔 / 支撐
- 注意：末漲段、高檔位置風險高；初漲段、主漲段起漲是最佳做多位置

**步驟三：均線架構**
- 做多條件：至少 MA5、MA10、MA20 三線多頭排列方向向上，行股在均線(MA20)之上
- 做空條件：三線空頭排列方向向下，行股在均線之下
- 均線分析（含 MA60）：可做多中長線判斷

**步驟四：K 線型態**
- 多頭關鍵 K 線：多頭確認 / 底部確認 / 起漲 / 突破高點 / 連包紅K正
- 條件「幅、量、線」：幅（漲幅≥2%）、量（≥昨日1.3倍）、線（中長實體紅K收盤確認）
- 空頭關鍵 K 線：幅跌（≥2%跌幅）、線實（中長實體黑K）、量縮不必要但量增殺更強

**步驟五：成交量**
- 多頭：漲幅量增、回檔量縮為正常
- 各種成交量定義：
  - 基本量 = 5日平均量
  - 滾量 = 基本量的1.2～1.3倍（出現在起漲位置）
  - 特大量 = 基本量的2倍以上（位置決定意義）
  - 爆量 = 高檔大量K線（3日內股價突破前最高點）
  - 出貨量 = 大量後股價下跌或趨勢轉弱
  - 調節量 = 高檔大量下跌後修正後再突破大量K線
- 量價乖離：漲幅量縮是警示，「高股為高」量疏為稀，等股不漲得接手

**步驟六：指標觀察**
- KD 指標（參數 5, 3）：
  - 多頭進場條件（符合其一即可）：K值向上 / KD多頭排列 / KD黃金交叉
  - 空頭進場條件：K值向下 / KD空頭排列 / KD死亡交叉
  - KD > 80 超買區；< 20 超賣區
  - 進入鈍化區（80～100 或 0～20）：失去參考幅值，等回檔得幅
  - 多頭走勢中 50 以上黃金交叉 = 波段起漲點
  - 50 左右的黃金交叉比 20 左右的多方向更強
  - 高檔背離：股價頭頭高但K值頭頭低 → 轉折向下機率大
  - 低檔背離：股價底底低但K值底底高 → 轉折向上機率大
  - 盤整時KD交叉不能進場
- MACD 指標（參數 10, 20, 10）：
  - 多頭進場條件（符合其一即可）：紅柱延長 / 綠柱縮短等
  - 空頭進場條件：紅柱縮短 / 綠柱延長
  - 兩線在0軸之上 = 多頭格局；0軸之下 = 空頭格局
  - 0軸之上黃金交叉 = 多方買訊；死亡交叉 = 多頭高檔可賣出
  - 0軸之下黃金交叉 = 空頭回補可補空；死亡交叉 = 空頭賣訊
  - 高檔背離：股價創新高但紅柱未創新高 → 轉頭機率大
  - 低檔背離：股價創新低但綠柱未創新低 → 落底機率大
- 布林通道（MA20 ± 2個標準差）：
  - 股價碰上軌 → 準備賣出；碰下軌 → 準備補空
  - K線沿上軌上漲 = 短波段飆股行為
  - 上軌平行+大量突破 → 進場做多/做空
  - 上軌走平或向內彎 → 盤整或接近反彈

---

### 【規則 3】六大多空進場位置

**多頭 6 個買點：**
- 買點1：盤整突破（多頭趨勢＋中長紅K突破盤整上緣線＋MA20向上＋KD黃金交叉；漲幅≥2%、量增≥1.3x、中長實體紅K）
- 買點2：拉回買上漲（多頭回測不破前低＋中長紅K突破前一天K線最高點＋MA20向上＋KD多頭；注意初漲段/主漲段起漲，留意末漲段空間；多頭回測破下降線後的上漲紅K → 需跌破線才能進場）
- 買點3：K線橫盤突破（當天收盤未破第一根K線高低點 = K線橫盤；多頭K線橫盤突破＋中長紅K＋MA20向上＋KD多頭 = 買點）
- 買點4：突破ABC修正下降線（多頭上漲一波後ABC向下修正 → 大量中長紅K突破初始下降線；突破MA20向上＋KD多頭 = 買點；ABC一般在20天內，若過長表示復甦，可計算目標幅 D）
- 買點5：突破下彎軌道線（多頭沿下彎趨勢線緩步上漲 → 大量中長紅K突破下彎軌道線；限定：角度 < 30度的緩角度軌道線＋MA20向上＋KD多頭；參考：進場紅K最低點）
- 買點6：底部確認突破（底部整理中繼續整合＋大量中長紅K向上突破 = 底部確認；日線底部 = 短期等中線，週線底部 = 短期中長線；可計算底部上漲目標幅）

**空頭 6 個空點（與多頭買點對稱，方向相反）：**
- 空點1：盤整跌破
- 空點2：反彈空下跌
- 空點3：K線橫盤跌破
- 空點4：跌破ABC修正上升線
- 空點5：跌破下彎軌道線
- 空點6：頭部確認跌破

---

### 【規則 4】組合K棒判讀

**逆轉組合：**
- 上漲高檔長紅K + 長黑K = 轉折向下警訊（爆量大量、KD死亡交叉更確認）
- 下跌低檔長黑K + 長紅K = 轉折向上訊號（爆量大量、KD黃金交叉更確認）

**頂部（頭部形成）：** 紅K + 轉折線 + 黑K → 多頭反轉 / 空頭做空
**底部（底部形成）：** 黑K + 轉折線 + 紅K → 空頭補空 / 多頭做多

**中繼組合：**
- 下升三法：中長紅K → 漸低至低點到紅不破低點 → 中長紅K突破高點 → 多頭確為上漲
- 上升三雙：中長紅K → 小K → 中長紅K上漲 → 多頭確為上漲
- 下降三法 / 下降三陰（對稱，空頭確為下漲）

**連三紅警訊：**
- 多頭高檔連3根以上大量長紅K → 末漲段現象 / 主力可能高檔出貨 → 準備減倉
- 連續長紅或長上影線 → 逃命訊號出現 → 出現上漲或下跌立即減倉
- 沿5日漲幅超過20% + 大量長紅K + 轉折訊號 → 減倉出場

**大幅波動後：** 爆量後見黑K下跌 → 減倉出場
**多方夾擊：** 紅黑紅組合逢高作滾

---

### 【規則 5】缺口分析

| 缺口類型 | 位置 | 意義 | 操作 |
|---------|------|------|------|
| 突破缺口 | 底部或固定位 | 主力強勢做多表現 | 大量回補 → 買進 |
| 逃離缺口 | 上漲行進中 | 逃命等後段漲幅 | 視情況持倉 |
| 竭盡缺口 | 高檔/末漲段 | 最後一口氣 | 準備減倉 |
| 普通缺口 | 盤整期間 | 意義不大，填回 | 忽視 |
| 島狀反轉（底） | 低檔向下跳空後向上跳空 | 大漲前兆 | 空單補空/積極做多 |
| 島狀反轉（頂） | 高檔向上跳空後向下跳空 | 大跌前兆 | 忍殺做空 |

---

### 【規則 6】停損規則（絕對紀律，不可放大）

| 規則 | 說明 |
|------|------|
| 固定停損 | 進場幅 **5%**（例：100元買→95元停損） |
| 執行方式 | **收盤價**跌破停損→隔日出場 |
| 趨勢停損 | 收盤出現「頭頭低」→ 多頭確定出場；出現「底底高」→ 空頭確定補空 |
| 絕對紀律 | 停損5%不能放大，一次放大將前功盡棄 |

---

### 【規則 7】停利規則（短線做多獲利方程式）

| 漲幅階段 | 操作規則 |
|---------|---------|
| 漲幅 < 10% | 跌破MA5 → **持股**（不動） |
| 漲幅 ≥ 10% | 收盤跌破MA5 → **分批停利出場** |
| 漲幅 ≥ 20% | 連漲3天以上+大量長黑K強見告急訊號 → **當天出場** |

**短線做空獲利方程式：**
| 跌幅階段 | 操作規則 |
|---------|---------|
| 跌幅 < 5% | 持倉 |
| 跌幅 ≥ 10% | 收盤突破MA5 → 補空 |
| 跌幅 ≥ 20% | 連跌3天+大量長紅K告急 → 當天補空 |

---

### 【規則 8】禁止加碼條件（以下任一現象出現，**禁止做多進場**）

1. 盤底尚未突破頸線
2. 上漲第3根以上位置（忌追高）
3. 週線壞掉型態
4. 前底未跌破往下（未突破前高往上漲）
5. 前底未跌破前低往下漲
6. 盤整啟動
7. 空頭的假底（反彈）
8. 連續日漲高檔出現的大量長紅K
9. 進場位置是漲幅偏高的長黑K（忌追，進場位置必須是紅K）
10. 不符合短線做多獲利方程式條件

**禁止做空進場（對稱）：**
1. 盤頭尚未跌破頸線
2. 連續下跌第3根以上位置（忌殺低）
3. 週線支撐型態
4. 前頭未突破往上（未跌破前低往下跌）
5. 前高未突破往上漲
6. 盤整啟動
7. 多頭的假頂（回檔）
8. 連續日跌低檔的大量長黑K
9. 進場位置是跌幅偏大的紅K（進場位置必須是黑K）
10. 不符合短線做空獲利方程式條件

---

### 【規則 9】淘汰法選股（做多必避開的11種股票）

1. 沒走出底部的股票（趨勢未完成，均線未多頭排列）
2. 週收盤無法突破MA5的股票
3. 上漲一波後趨勢不明確的股票
4. 沒有換手的股票（量價乖離）
5. 大幅上漲過高的股票（漲幅超過一個以上盤整 → 出場）
6. 週收大量長黑的股票
7. MACD或KD指標背離的股票
8. 三大法人連續賣超的股票
9. 頻頻出現大量股價上漲的股票
10. 待確認的股票
11. 無基本面支撐股票

---

### 【規則 10】盈虧方程式與資金管理

**基本方程式：**
- 全年交易20次，勝率50%，獲利7%，停損5%
- 計算：(10次×7%) - (10次×5%) = **年獲利20%**

**五句贏家口訣：**
1. 買強不買弱；2. 買低不追高；3. 順勢不逆勢；4. 減倉不補空；5. 獲利不賭博

**贏家策略：**
- 永遠控制風險，嚴格執行停損
- 集中火力：持有最少2～5檔股票
- 太弱不做強，只做強勢上漲股票
- 只做符合高勝率條件的股票
- 絕對不要讓虧損的股票擴大（跌幅超過5%就為警示股）

---

### 【規則 11】多頭盤底量能觀察

**第一底訊：**
- 空頭跌深底部出現的大量（長黑K後止跌紅K）→ 收集多頭進貨量
- 反彈到20週圍繞後出現黑K → 空頭不變，但注意第一底部大量是支撐
- 下跌無法跌破第一底部 → 出現「底底高」→ 空單立即補空

**第二底部（黃金底）：**
- 底底高的第二底部通常也出現大量 → 提示盤整
- 反彈高點 = 壓力；第二底部低點 = 支撐
- 突破高點壓力 → 趨勢轉多頭
- 提示盤整中大量 = 換手量（主力進貨量）
- MA10、MA20向上多頭 → 提示接近完成 → 還會準備做多

---

## 診斷輸出格式（繁體中文，嚴格按照以下五大段）

### 一、操作概覽
簡述用戶的操作：股票代號、方向（做多/做空）、買入時間、買入幅位，以及根據技術面推判的當時市場狀況（趨勢、位置）。

### 二、規則對照表

| 檢查項目 | 所屬規則要求 | 用戶實際狀況 | 判定 | 引用規則 |
|---------|------------|------------|------|---------|
| 趨勢方向 | 頭頭高、底底高（多頭） | （依技術資料判斷） | ✅/⚠️/❌ | 規則 1 |
| 當下位置 | 初漲段/主漲段起漲最佳 | （依技術資料判斷） | ✅/⚠️/❌ | 規則 2 |
| 均線排列 | MA5>MA10>MA20 多頭排列向上 | （依技術資料判斷） | ✅/⚠️/❌ | 規則 2 |
| 股價位置 | 收盤在 MA20 之上 | （依技術資料判斷） | ✅/⚠️/❌ | 規則 2 |
| 進場K線幅 | 漲幅 ≥ 2%、收盤紅K | （依技術資料判斷） | ✅/⚠️/❌ | 規則 2 |
| 成交量 | ≥ 前日 1.3倍（量增） | （依技術資料判斷） | ✅/⚠️/❌ | 規則 2 |
| KD 指規(5,3) | K值向上/多排/黃金交叉，非鈍化 | （依技術資料判斷） | ✅/⚠️/❌ | 規則 2 |
| MACD(10,20,10) | 紅柱延長/綠柱縮短/0軸上方 | （依技術資料判斷） | ✅/⚠️/❌ | 規則 2 |
| 進場類型 | 買點1～6 之一 | （對應哪個買點，說明） | ✅/⚠️/❌ | 規則 3 |
| 禁止加碼 | 10條禁止條件均未觸犯 | （依技術資料判斷） | ✅/❌ | 規則 8 |
| 淘汰法 | 非11種應避開股票 | （依技術資料判斷） | ✅/❌ | 規則 9 |
| 停損設定 | 進場幅 5%，不可放大 | （從買入原因推算） | ✅/⚠️/❌ | 規則 6 |
| 停利計畫 | 依漲幅階段獲利方程式 | （從買入原因推算） | ✅/⚠️/❌ | 規則 7 |

### 三、綜合評估

| 指標 | 評分 |
|------|------|
| 邏輯符合度 | 0～100%（符合的規則項數 ÷ 13 項，以百分比呈現） |
| 心理影響評估 | 低/中/高（說明：是否有追高、摸頭、猶豫不決、賭博心態等跡象） |
| 風險等級 | 低/中/高（說明：綜合停損設定、入場位置、趨勢清晰度） |

### 四、具體改進作為
列出 2～5 條可執行的改進建議，每條必須：
1. 標出對應的具體規則編號（規則1～11）
2. 說明當前哪個條件未符合
3. 給出下次操作 of 具體行動（例如：「等 KD(5,3) 出現黃金交叉後再進場」、「下次在進場幅位往下5%設定停損單」）

### 五、本次操作心得
用 2～3 句話總結，語氣嚴謹但具有激勵性，像一位交易專家教練鼓勵學員持續精進。
`;

  return callGeminiApi({
    prompt: promptText,
    systemInstruction,
    mode: 'fast',
    temperature: 0.3,
    thinkingConfig: { thinkingBudget: 8192 },
  }, '無法生成分析結果。');
};

// ── 庫存持股健檢分析 ────────────────────────────────────────────────────────
export interface PortfolioHealthItem {
  symbol: string;
  name: string;
  avgCostPrice: number;
  currentPrice: number;
  totalShares: number;
  profitPct: number;
  recentData: StockDataPoint[];
  volumeProjection?: VolumeProjectionInfo | null;
}

const formatHealthCheckData = (items: PortfolioHealthItem[]): string => {
  return items.map((item, idx) => {
    const isTW = item.symbol.endsWith('.TW') || item.symbol.endsWith('.TWO') || /^\d{3,6}[A-Z]?$/.test(item.symbol);
    const last15 = item.recentData.slice(-15);
    const latest = item.recentData[item.recentData.length - 1];
    const prev = item.recentData[item.recentData.length - 2];

    // K線數據
    const kLineData = last15.map(d => {
      const volUnit = isTW ? Math.round(d.volume / 1000) + '張' : d.volume.toLocaleString() + '股';
      let line = `${d.date}  開:${d.open.toFixed(2)} 高:${d.high.toFixed(2)} 低:${d.low.toFixed(2)} 收:${d.close.toFixed(2)} 量:${volUnit}`;
      if (d.ma5) line += `  MA5:${d.ma5.toFixed(2)}`;
      if (d.ma10) line += `  MA10:${d.ma10.toFixed(2)}`;
      if (d.ma20) line += `  MA20:${d.ma20.toFixed(2)}`;
      if (d.ma60) line += `  MA60:${d.ma60.toFixed(2)}`;
      if (d.k != null) line += `  K:${d.k.toFixed(1)}`;
      if (d.d != null) line += `  D:${d.d.toFixed(1)}`;
      if (d.j != null) line += `  J:${d.j.toFixed(1)}`;
      if (d.macd != null) line += `  DIF:${d.macd.toFixed(2)}`;
      if (d.macdSignal != null) line += `  DEA:${d.macdSignal.toFixed(2)}`;
      if (d.macdHist != null) line += `  柱:${d.macdHist.toFixed(2)}`;
      if (d.bbUpper != null) line += `  BB上:${d.bbUpper.toFixed(2)}`;
      if (d.bbMiddle != null) line += `  BB中:${d.bbMiddle.toFixed(2)}`;
      if (d.bbLower != null) line += `  BB下:${d.bbLower.toFixed(2)}`;
      // 籌碼
      if (isTW) {
        if (d.foreignBuySell != null) line += `  外資:${Math.round(d.foreignBuySell/1000)}張`;
        if (d.investmentTrustBuySell != null) line += `  投信:${Math.round(d.investmentTrustBuySell/1000)}張`;
      }
      return line;
    }).join('\n');

    // 最新技術指標摘要
    const priceChgPct = prev ? ((latest.close - prev.close) / prev.close) * 100 : 0;
    const volRatio = prev && prev.volume > 0 ? latest.volume / prev.volume : 0;
    const isRedCandle = latest.close > latest.open;

    // 均線排列
    const maAlignment = latest.ma5 && latest.ma10 && latest.ma20
      ? (latest.ma5 > latest.ma10 && latest.ma10 > latest.ma20 ? 'MA5>MA10>MA20（多頭排列）' : 'MA5≤MA10 或 MA10≤MA20（非多頭排列）')
      : 'N/A';

    // 量狀態
    let volumeStatusStr = '';
    if (item.volumeProjection && item.volumeProjection.status !== 'Insufficient') {
      const volUnit = isTW ? '張' : '股';
      const projVol = isTW
        ? Math.round(item.volumeProjection.projectedVolume / 1000).toLocaleString() + volUnit
        : item.volumeProjection.projectedVolume.toLocaleString() + volUnit;
      const curVol = isTW
        ? Math.round(item.volumeProjection.currentVolume / 1000).toLocaleString() + volUnit
        : item.volumeProjection.currentVolume.toLocaleString() + volUnit;
      const yesterVol = isTW
        ? Math.round(item.volumeProjection.yesterdayVolume / 1000).toLocaleString() + volUnit
        : item.volumeProjection.yesterdayVolume.toLocaleString() + volUnit;
      const chgSign = item.volumeProjection.changePercent >= 0 ? '+' : '';

      if (item.volumeProjection.status === 'Intraday') {
        volumeStatusStr = `成交量狀態：盤中（Intraday）
- 目前實際成交量：${curVol}
- 預估全日成交量：${projVol}
- 昨日成交量：${yesterVol}
- 預估量變化：${chgSign}${item.volumeProjection.changePercent.toFixed(1)}%
⚠️ 成交量相關判斷請以「預估量」為依據`;
      } else {
        volumeStatusStr = `成交量狀態：收盤（Closed）
- 今日成交量：${curVol}
- 昨日成交量：${yesterVol}
- 量變化：${chgSign}${item.volumeProjection.changePercent.toFixed(1)}%`;
      }
    }

    // 籌碼近5日
    let chipsStr = '';
    if (isTW) {
      const last5 = item.recentData.slice(-5);
      const foreignSum = last5.reduce((s, d) => s + (d.foreignBuySell || 0), 0);
      const trustSum = last5.reduce((s, d) => s + (d.investmentTrustBuySell || 0), 0);
      chipsStr = `
近5日外資合計：${Math.round(foreignSum / 1000)}張
近5日投信合計：${Math.round(trustSum / 1000)}張`;
    }

    const priceCurrency = isTW ? 'TWD' : 'USD';
    return `
========== 持股 ${idx + 1}：${item.name}（${item.symbol}）==========
買入均價：${item.avgCostPrice.toFixed(2)} ${priceCurrency}
目前市價：${item.currentPrice.toFixed(2)} ${priceCurrency}
損益幅度：${item.profitPct >= 0 ? '+' : ''}${item.profitPct.toFixed(2)}%
持有股數：${item.totalShares}
停損價位：${(item.avgCostPrice * 0.95).toFixed(2)} ${priceCurrency}（買入均價 × 95%）

【最新技術面摘要】
- 今日：開:${latest.open.toFixed(2)} 高:${latest.high.toFixed(2)} 低:${latest.low.toFixed(2)} 收:${latest.close.toFixed(2)}
- 漲跌幅：${priceChgPct >= 0 ? '+' : ''}${priceChgPct.toFixed(2)}%
- K棒顏色：${isRedCandle ? '紅K（收漲）' : '黑K（收跌）'}
- 量比（vs前日）：${volRatio.toFixed(2)}x
- 均線排列：${maAlignment}
- MA5:${latest.ma5?.toFixed(2) ?? 'N/A'}  MA10:${latest.ma10?.toFixed(2) ?? 'N/A'}  MA20:${latest.ma20?.toFixed(2) ?? 'N/A'}  MA60:${latest.ma60?.toFixed(2) ?? 'N/A'}
- KD(5,3): K=${latest.k?.toFixed(1) ?? 'N/A'}  D=${latest.d?.toFixed(1) ?? 'N/A'}  J=${latest.j?.toFixed(1) ?? 'N/A'}
- MACD(10,20,10): DIF=${latest.macd?.toFixed(2) ?? 'N/A'}  DEA=${latest.macdSignal?.toFixed(2) ?? 'N/A'}  柱=${latest.macdHist?.toFixed(2) ?? 'N/A'}
- 布林通道(20,2): 上軌=${latest.bbUpper?.toFixed(2) ?? 'N/A'}  中軌=${latest.bbMiddle?.toFixed(2) ?? 'N/A'}  下軌=${latest.bbLower?.toFixed(2) ?? 'N/A'}
- RSI(14): ${latest.rsi?.toFixed(2) ?? 'N/A'}
${volumeStatusStr ? '\n' + volumeStatusStr : ''}${chipsStr}

【近15日K線走勢】
${kLineData}
`;
  }).join('\n');
};

export const analyzePortfolioHealth = async (
  items: PortfolioHealthItem[]
): Promise<string> => {
  const promptData = formatHealthCheckData(items);

  const systemInstruction = `
# 持股庫存健檢系統

## 角色設定
你是一位極其嚴格且專業的股票技術分析持股健檢教練。你的唯一任務是：根據系統自動提供的「目前持股庫存」與「即時技術面數據」，完全依照下方「朱家泓 × 林穎」技術分析規則庫，對每一檔持股逐一裁定必須執行的操作動作，並給出引用明確規則編號的理由與分析過程。

你只使用下方規則庫進行判斷，不使用任何外部個人觀點或通用技術分析常識。

## 數據來源說明
系統已為每一檔庫存持股自動提供完整技術面數據（近15日K線、均線、KD、MACD、RSI、布林通道、籌碼、成交量狀態）。你需根據這些數據自行判讀：K線型態、均線型態、趨勢型態（頭頭高底底高）、量價關係、指標交叉與背離、支撐壓力位置等。

## 五種操作決策定義

| 決策 | 定義 | 觸發情境 |
|------|------|---------|
| 🟢 加碼 | 在現有持股基礎上增加部位 | 多頭趨勢確認 + 出現明確定義的黃金買點 + 所有進場條件符合且未觸犯加碼大忌 |
| 🔵 續抱 | 維持目前持股不動 | 多頭趨勢未改變 + 未觸發任何停損/停利條件 |
| 🟡 減碼 | 賣出部分持股，降低風險 | 出現警訊但趨勢尚未改變（例如：量價背離、指標高檔背離、攻擊轉弱等） |
| 🟠 停利 | 依獲利方程式賣出全部持股 | 觸發獲利方程式中的任一停利條件 |
| 🔴 停損 | 依停損紀律賣出全部持股 | 觸發停損紀律中的任一停損條件 |

## 規則庫（技術分析核心規則）

### 【T】轉折波與趨勢判定規則（Trend & Wave）
* **【T1-1】短期轉折波 (5MA) 畫法**：
  - **突破 5 均取低點**：收盤價突破 5 日均線，往左邊 K 線尋找股價在 5 日均線下方行進期間的最低點（含下影線）。
  - **跌破 5 均取高點**：收盤價跌破 5 日均線，往左邊 K 線尋找股價在 5 日均線上方行進期間的最高點（含上影線）。
* **【T1-2】中/長期轉折波 (10MA / 20MA) 畫法**：分別以 10 日與 20 日均線作為突破或跌破的劃分依據，取點方法相同。
* **【T2】三大趨勢定義**：
  - **多頭趨勢**：轉折高低點呈現「頭頭高（後高過前高）、底底高（後底不破前底）」。
  - **空頭趨勢**：轉折高低點呈現「頭頭低（後高不過前高）、底底低（後底破前底）」。
  - **盤整趨勢**：均線糾結，高低點交錯，無明顯的「頭頭高底底高」或「頭頭低底底低」規律。
* **【T3】多空趨勢確認定義**：
  - **多頭確認**：空頭或盤整結束，股價突破前波轉折高點，且前底未破，站穩均線。
  - **空頭確認**：多頭或盤整結束，股價跌破前波轉折低點，且前高未過，跌破均線。

### 【A】停損規則 — 最高優先級（觸發任一條即執行 🔴）
| 編號 | 停損條件 | 說明 |
|------|---------|------|
| A1 | 收盤跌破進場價 5% | 固定停損，絕對紀律，不可放大 |
| A2 | 收盤出現「頭頭低」 | 多頭趨勢改變的訊號，上漲沒有創新高就下跌，確立出場 |
| A3 | 前底跌破前位 | 多頭趨勢出現「底底低」，代表多頭慣性被破壞，立即出場 |
| A4 | 高檔大量長黑K + 次日續跌 | 主力出貨確認，所謂「一殺」要立即出場 |
| A5 | 收盤跌破大量長紅K線最低點 | 多空易位，原長紅 K 支撐變為重度壓力，必須出場 |
| A6 | 多頭改變成空頭確認 | 頭頭低、底底低同時成立（空頭確認），所有多單倉位必須清空 |

### 【B】停利規則 — 觸發任一條即執行 🟠
| 編號 | 停利條件 | 說明 |
|------|---------|------|
| B1 | 漲幅 ≥ 10%，收盤跌破 MA5 | 短線獲利方程式核心停利條件（漲幅不到 10% 跌破 MA5 仍應續抱） |
| B2 | 漲幅 ≥ 20%，出現大量長黑K強見告急或長黑十字 | 主力高檔大出貨，當天立即停利出場，不等隔日 |
| B3 | 連續 3 天以上急漲 + 出現變盤黑 K 下跌 | 當天直接停利 |
| B4 | 沿 MA5 漲幅超過 20% + 大量長紅 K 後出現變盤訊號（如長上影線、十字星、黑K） | 波段滿足，獲利出場 |
| B5 | 高檔出現「多轉空」K線組合 | 如遭遇、並列、覆蓋（烏雲罩頂）、懷抱（孕線）、吞噬（空頭吞噬）、貫穿等長紅+長黑反轉組合，確定停利 |
| B6 | 高檔出現「夜星」或其變體星體組合 | 包括標準夜星、孤島夜星（雙跳空缺口，極強訊號）、雙星變盤、雙鴉變盤、群星變盤，收盤確認反轉即停利 |
| B7 | 股價碰布林通道上軌 + 上軌開始走平或向下彎 | 短線衝高動能竭竭，停利出場 |
| B8 | 連續 2～3 天的大量（5日均量2.0倍以上）+ 股價不漲或下跌 | 高檔爆量滯漲，主力出貨，停利出場 |
| B9 | 高檔島狀反轉 | 向上跳空後隨即向下跳空，將中間 K 線孤立，大跌前兆，立即出場 |
| B10 | 股價高檔出現「向上竭盡缺口」且 2～3 天內被完全回補 | 上漲行情結束，停利出場 |
| B11 | MACD 紅柱群出現「頭頭低」高檔背離 | 股價創新高但 MACD 柱狀體高度未創新高，動能轉弱，準備停利 |

### 【C】減碼警訊 — 出現以下訊號，建議降低部位 🟡
| 編號 | 減碼條件 | 說明 |
|------|---------|------|
| C1 | 量價背離 | 股價創高但成交量萎縮（量為價之確認，漲幅量縮為警示，應減碼防範） |
| C2 | KD 高檔背離 | 股價創高但 KD(5, 3) 之 K 值呈現「頭頭低」，反轉向下機率大 |
| C3 | MACD 紅柱由延長轉縮短 | 漲勢減緩，多頭動能停滯，適度減碼 |
| C4 | 位置進入末漲段 | 多頭走勢的第三波或高檔區，風險顯著增加，應逐步降低部位 |
| C5 | 接近週線或日線重大壓力位（尚未突破） | 遇壓前先部分減碼，防止遇壓大跌 |
| C6 | 跌破大量長紅 K 線最高點，但未破 1/2 幅度 | 多方攻擊力道減弱，先減碼，觀察 3～5 日內能否重新站回 |
| C7 | KD 高檔出現二次死亡交叉 | 代表多頭動能嚴重耗損，行情即將大跌機率高 |
| C8 | 布林通道上軌開始收口、向內彎 | 多頭進入盤整，波動度變小，部分減碼 |
| C9 | 三大法人（外資、投信）連續賣超達 3 日以上 | 籌碼面惡化，降低部位 |

### 【D】續抱條件 — 以下條件全部成立才持有不動 🔵
| 編號 | 續抱條件 | 說明 |
|------|---------|------|
| D1 | 多頭趨勢不變 | 頭頭高、底底高之多頭慣性持續成立 |
| D2 | 均線維持多頭排列 | MA5、MA10、MA20 維持方向向上且多頭排列 |
| D3 | 股價在 MA20（月線）之上 | 守穩多頭生命線 |
| D4 | 未觸發任何停損條件 | 【A1】～【A6】均未觸發 |
| D5 | 未觸發任何停利條件 | 【B1】～【B11】均未觸發 |
| D6 | 正常的多頭回檔量縮 | 股價小幅回檔但成交量萎縮，且不破月線、不破前波轉折低點（前底） |
| D7 | 大量 K 線 3 日內被收盤價突破 | 強勢突破，確立強勢多頭，持續續抱 |
| D8 | K 線沿著布林通道上軌持續上漲，且未跌破 5MA | 短波段飆股型態，持股續抱 |
| D9 | 出現中繼看漲組合 | 如「下升三法」（長紅K+三根小K不破低+長紅K突破）或「上升三兩」，確立續抱 |
| D10 | MACD 紅柱持續漸長，且 DIF/DEA 在 0 軸之上 | 多頭上漲動能充足 |

### 【E】加碼條件 — 以下條件全部成立才可加碼 🟢
| 編號 | 加碼條件 | 說明 |
|------|---------|------|
| E1 | 多頭趨勢確認且未改變 | 符合「頭頭高、底底高」定義 |
| E2 | 出現六大多頭實戰買點之一 | 買點1-6（盤整突破、回後買上漲、K線橫盤突破、突破ABC下降線、突破緩降軌道線、雙底突破） |
| E3 | 進場 K 線符合「幅量線實」 | 漲幅 ≥ 2%、成交量比昨日大 1.3 倍以上、中長實體紅 K |
| E4 | 均線架構完美 | MA10、MA20 多頭排列向上，且股價穩立於月線之上 |
| E5 | KD 指標加持 | KD 參數 (5,3) 呈現 K值向上、KD多頭排列、或低檔黃金交叉 |
| E6 | MACD 指標配合 | DIF/DEA 在 0 軸之上，且紅柱延長或綠柱縮短接近 0 軸 |
| E7 | 未觸犯任何加碼大忌 | 詳見禁止加碼大忌清單 |
| E8 | 安全的位置 | 處於初漲段或主漲段起漲點，絕非末漲段高檔 |
| E9 | 前方無重大壓力 | 向上無週線/日線前高重度壓力，或壓力已放量突破 |
| E10 | 加碼仍設停損 | 每次加碼均以進場當天 K 棒最低點或加碼成本 × 95% 設立新停損防守 |

### 【F】加碼大忌 — 出現任一條，嚴禁做多進場與加碼 ⛔
1. 盤底尚未突破頸線
2. 股價已處於上漲第 3 根紅K棒以上的位置（忌追高）
3. 接近週線或日線前高壓力型態
4. 前底未破但上漲未突破前高
5. 前底跌破前低（底底低，趨勢轉弱）
6. 盤整格局啟動中（均線糾結無方向）
7. 空頭反彈的「假底」
8. 連續急漲高檔區出現的大量長紅K（防竭盡）
9. 進場位置是黑K棒（進場必須是確認轉折上漲的紅K）
10. 不符合短線做多獲利方程式

### 【G】太弱換強規則
朱老語錄：「永遠太弱換強，手中只留強勢上漲的股票。」
- 【G1】緩慢牛皮股：持有超過兩週，累計漲幅不到 5% 且無攻擊量，應換股操作。
- 【G2】弱於大盤：股價表現明顯弱於同期加權指數（台股）或標普500（美股）。
- 【G3】頻繁破線：股價頻繁在 5MA、10MA 附近來回糾結震盪，無法拉開距離。

## 診斷輸出格式（繁體中文，嚴格遵守，不得更換或遺漏）

請針對用戶的每一檔持股，按以下結構輸出精準報告（為防 Token 溢出，表格僅列出核心指標狀態與已觸發的規則編號）：

### 📋 持股健檢報告：【股票名稱/代號】

**一、 基本資訊**
* 買入均價：__ 元 | 目前市價：__ 元
* 損益幅度：__ % | 持有股數：__ 股
* 停損防守位：__ 元（平均成本 × 95%）

**二、 當下技術面狀態摘要**
* **趨勢判定**：[多頭/空頭/盤整]（註明是否為多/空頭確認）
* **均線結構**：[多頭排列/空頭排列/糾結]（MA5/10/20 狀態）
* **K棒與成交量**：[K棒型態與量比]（註明是否達 1.3 倍攻擊量，或是否為盤中預估量）
* **指標狀態**：
  - KD(5,3)：K=__ / D=__ / [黃金交叉/死亡交叉/多排/空排/背離]
  - MACD(10,20,10)：DIF=__ / DEA=__ / 柱狀體=__ / [0軸之上或下/紅柱增減/背離]
  - 布林通道：股價位於 [上/中/下軌] / 通道 [開口擴張/收口走平/下彎]
* **法人籌碼（台股適用）**：外資投信近5日買賣超狀態

**三、 核心決策裁定**
> **操作決策：【 🟢加碼 / 🔵續抱 / 🟡減碼 / 🟠停利 / 🔴停損 】** （請擇一，不可模糊）

**四、 規則檢核表（已觸發規則）**
| 檢查項目 | 規則編號 | 講義規則內容說明 | 當前實際數據/狀態 | 判定 |
|---------|---------|----------------|----------------|------|
| 停損/停利/減碼 | 【A/B/C#】 | （例如：停損A1：跌破5%） | 損益__% | 【✔ 已觸發】或【－ 未觸發】 |
| 續抱條件 | 【D#】 | （例如：趨勢D1：頭頭高底底高） | 轉折波呈現多頭架構 | 【✅ 觸發續抱】或【➖ 未觸發】 |
| 加碼/大忌 | 【E/F#】 | （例如：買點E2-2：回後買上漲） | 符合買點2且無觸犯大忌 | 【✅ 符合加碼】或【⛔ 禁止加碼】 |

**五、 教練深度剖析（引用規則編號，3～5點）**
1. 【規則 X#】……（具體說明為何觸發或未觸發）
2. 【規則 X#】……
3. ……

**六、 具體操作建議**
* 明日交易執行：「若明日收盤跌破__元...」或「明日開盤立即以市價賣出...」
* 關鍵支撐與阻力評估：下方關鍵支撐在__元，上方關鍵壓力在__元。

---

### 📊 庫存總覽（多檔持股時額外輸出）
| 股票代號 | 損益% | 操作決策 | 強弱排序 | 優先處理 | 備註說明 |
|---------|------|---------|---------|---------|---------|

### 💡 整體操作建議與教練評語
1. **最優先處理事項**：立即執行的停損/停利對象與價位。
2. **太弱換強與精簡建議**：找出符合【G】太弱換強的緩慢股，建議淘汰。
3. **整體風險評估**：估算若全部持股同時觸發停損時，帳戶最大可容忍虧損幅度。
4. **🎯 教練寄語**：（引用朱老觀念，激勵學員執行紀律，例如：「手上一張都不要有虧損的股票」、「永遠太弱換強，速度就是本錢」）

## 嚴格執行規範
1. **精準引用規則編號**：不准給出無編號的模糊推論，所有技術面判讀必須回歸【T】、【A】、【B】、【C】、【D】、【E】、【F】、【G】。
2. **成交量盤中判斷**：若技術面資料標示為「盤中（Intraday）」，成交量檢核必須以「預估全日成交量（相較昨日）」之倍數做為判斷依據。
3. **停損零妥協**：一旦觸發【A】停損規則，不可有任何同情或等待藉口，必須下達🔴停損裁決。
4. **客觀專業**：完全以數據與規則為基礎，展現專業的朱家泓/林穎課程流派教練風采。
`;

  const promptText = `以下是我目前的庫存持股，請逐一進行健檢分析：\n${promptData}`;

  return callGeminiApi({
    prompt: promptText,
    systemInstruction,
    mode: 'fast',
    temperature: 0.2,
    thinkingConfig: { thinkingBudget: 10240 },
  }, '無法生成健檢結果。');
};
