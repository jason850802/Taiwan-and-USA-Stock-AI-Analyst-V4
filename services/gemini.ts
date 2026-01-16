import { GoogleGenAI } from "@google/genai";
import { StockDataPoint } from "../types";

// Helper to format data for the prompt
const formatPromptData = (
  symbol: string,
  data: StockDataPoint[],
  userPosition?: { hasHolding: boolean; costPrice?: number }
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

  return `
Target Stock: ${symbol}

*** SYSTEM REFERENCE DATA ***
- Price Condition (>2% & Red Candle): ${passPriceCheck ? "PASS" : "FAIL"} (Actual: ${priceChangePct.toFixed(2)}%)
- Volume Ratio: ${volumeRatio.toFixed(2)}x
- Stand on 5MA & > Prev High: ${passBreakoutCheck ? "PASS" : "FAIL"}
-> IS GOLDEN BUY POINT MET? : ${isGoldenBuyPoint ? "YES" : "NO"}

*** LATEST DATA POINTS ***
- Today's Close: ${latest.close.toFixed(2)}
- 5MA: ${latest.ma5?.toFixed(2)} | 10MA: ${latest.ma10?.toFixed(2)} | 20MA: ${latest.ma20?.toFixed(2)} | 60MA: ${latest.ma60?.toFixed(2)}

Indicators:
- RSI(14): ${latest.rsi?.toFixed(2) || 'N/A'}
- MACD: DIF=${latest.macd?.toFixed(2) || 'N/A'}, DEA=${latest.macdSignal?.toFixed(2) || 'N/A'}, Hist=${latest.macdHist?.toFixed(2) || 'N/A'}
- KDJ: K=${latest.k?.toFixed(2) || 'N/A'}, D=${latest.d?.toFixed(2) || 'N/A'}, J=${latest.j?.toFixed(2) || 'N/A'}${chipsLatestStr}

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
    mode: 'fast' | 'thinking' = 'fast'
) => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const promptData = formatPromptData(symbol, data, userPosition);
  const modelName = mode === 'fast' ? "gemini-3-flash-preview" : "gemini-3-pro-preview";

  const systemInstruction = `
# Role
你是由朱家泓與林穎老師講義訓練出來的專業技術分析師 AI。你的任務是根據輸入的 K 線數據、技術指標以及籌碼數據，嚴格依照「技術分析 SOP」來判讀股票型態，並給出精確的操作建議。

# Background & Constraints
1.  **分析視角**：專注於「做多」邏輯。
2.  **專業語法**：使用專業術語（如：頭頭高底底高、黃金買點、交叉、背離、土洋合作）。
3.  **目標**：找出符合「高勝率方程式」的標的。

# Output Format
請依照以下格式輸出分析結果，保持結構清晰，標題嚴禁包含英文：

1.  **趨勢研判**：
    * **趨勢方向**：[多頭 / 空頭 / 盤整] (判斷基準：頭頭高底底高)
    * **均線結構**：[描述 5, 10, 20, 60 MA 的排列與方向]
    * **關鍵 K 線**：[描述當日 K 棒型態及其意義]
    * **KDJ 分析**：[摘要解析]
    * **MACD 分析**：[摘要解析]
    * **外資與投信**：[解析籌碼安定度與法人態度]

2.  **訊號檢核表**：
    * 若符合條件，請將 [ ] 改為 ✅ 表示打勾；不符合則保持 [ ]。
    * [ ] **進場條件**：是否符合突破型態與黃金買點？
    * [ ] **加碼訊號**：
    * [ ] **減碼警訊**：
    * [ ] **出場訊號**：
    * **注意(重要)**：
        - 若使用者為「空手 (NO POSITION)」，則對於『加碼訊號』、『減碼警訊』、『出場訊號』這三項僅需保留標題與檢核框，不可加文字說明。
        - 若使用者為「持有中 (HOLDING)」，請務必根據其『平均成本價』，結合朱家泓老師的指標(如跌破5MA、爆量長黑等)給出具體加減碼或出場建議。

3.  **建議操作計畫**：
    * **當下策略動作**：[ 新單進場 / 加碼買進 / 持股續抱 / 分批減碼 / 停利停損出場 / 空手觀望 ]
    * **判斷理由**：簡述原因。
    * **價位設定**：
        * **停損防守價**：[具體價格]
        * **停利/減碼標準**：[具體條件。輸出時請確保『停利』與『減碼』字樣分別使用標籤標示或加粗以便識別顏色]
`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts: [{ text: promptData }] }],
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
      },
    });
    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw new Error("Failed to analyze stock data.");
  }
};