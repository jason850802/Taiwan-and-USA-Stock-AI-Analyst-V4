import { GoogleGenAI } from "@google/genai";
import { StockDataPoint, TechnicalIndicators } from "../types";

// Helper to format data for the prompt
const formatPromptData = (
  symbol: string,
  data: StockDataPoint[],
  userPosition?: { hasHolding: boolean; costPrice?: number }
): string => {
  const latest = data[data.length - 1];
  const prev = data[data.length - 2]; // Previous day for comparison
  const isTaiwanStock = symbol.endsWith('.TW') || symbol.endsWith('.TWO');
  
  // Pre-calculate Key SOP Metrics so AI doesn't hallucinate math
  const priceChangePct = ((latest.close - prev.close) / prev.close) * 100;
  const volumeRatio = latest.volume / prev.volume;
  const isRedCandle = latest.close > latest.open;
  const brokePrevHigh = latest.close > prev.high;
  const standOn5MA = latest.ma5 ? latest.close > latest.ma5 : false;

  // --- STRICT SOP BOOLEAN LOGIC (Pre-calculated for AI) ---
  // 1. Price Check: Change > 2% AND Red Candle
  const passPriceCheck = priceChangePct > 2 && isRedCandle;
  
  // 2. Volume Check: Today > 1.3x Yesterday
  const passVolumeCheck = volumeRatio > 1.3;

  // 3. Breakout Check: Stand on 5MA AND Break Prev High
  const passBreakoutCheck = standOn5MA && brokePrevHigh;

  // Overall Golden Buy Point Pass?
  const isGoldenBuyPoint = passPriceCheck && passVolumeCheck && passBreakoutCheck;

  // Calculate Volume Trend (simple slope of last 5 days)
  // INCREASED CONTEXT: Use last 10 days for better pattern recognition (N-wave, etc.)
  const last10 = data.slice(-10);
  const last5 = data.slice(-5);
  
  // Volume is in Shares, convert to Lots (shares/1000) for analysis context
  const avgVol5Shares = last5.reduce((sum, d) => sum + d.volume, 0) / 5;
  const prevVol5Shares = data.slice(-10, -5).reduce((sum, d) => sum + d.volume, 0) / 5;
  
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

  // Format chip data for latest day & 5-day sum
  let chipsLatestStr = 'N/A';
  let chips5DaySummary = '';

  if (isTaiwanStock) {
      const foreignLots = latest.foreignBuySell !== undefined ? Math.round(latest.foreignBuySell / 1000) : 'N/A';
      const trustLots = latest.investmentTrustBuySell !== undefined ? Math.round(latest.investmentTrustBuySell / 1000) : 'N/A';
      chipsLatestStr = `\n- Foreign Investor Net Buy/Sell (Latest): ${foreignLots} Lots (張)\n- Investment Trust Net Buy/Sell (Latest): ${trustLots} Lots (張)`;

      // Calculate 5-day cumulative
      const foreignSum = last5.reduce((sum, d) => sum + (d.foreignBuySell || 0), 0);
      const trustSum = last5.reduce((sum, d) => sum + (d.investmentTrustBuySell || 0), 0);
      
      chips5DaySummary = `
*** CHIPS ANALYSIS DATA (Last 5 Days) ***
- Total Foreign Investor Net Buy/Sell: ${Math.round(foreignSum / 1000)} Lots (張)
- Total Investment Trust Net Buy/Sell: ${Math.round(trustSum / 1000)} Lots (張)
`;
  }

  const volumeDisplay = isTaiwanStock 
    ? `${Math.round(latest.volume / 1000)} Lots (張)`
    : `${latest.volume.toLocaleString()} Shares`;

  // Build User Context String
  let userContextStr = "";
  if (userPosition) {
    if (userPosition.hasHolding && userPosition.costPrice) {
        const profitPct = ((latest.close - userPosition.costPrice) / userPosition.costPrice) * 100;
        userContextStr = `
*** USER POSITION CONTEXT ***
- The user CURRENTLY HOLDS this stock.
- Their Average Cost Price is: ${userPosition.costPrice}.
- Current Unrealized Profit/Loss: ${profitPct.toFixed(2)}%.
- Strategy Focus: Check for "Add" (N-wave/Support) or "Reduce/Exit" (Divergence/Stop Loss) signals.
`;
    } else {
        userContextStr = `
*** USER POSITION CONTEXT ***
- The user does NOT hold this stock (Empty handed).
- Strategy Focus: STRICTLY check for "Entry" (Breakout/Pullback + Golden Buy Point) signals.
`;
    }
  }

  return `
Target Stock: ${symbol}

*** SYSTEM REFERENCE DATA (Truth for Checklist) ***
- Price Condition (>2% & Red Candle): ${passPriceCheck ? "PASS" : "FAIL"} (Actual: ${priceChangePct.toFixed(2)}%)
- Volume Condition (>1.3x Yesterday): ${passVolumeCheck ? "PASS" : "FAIL"} (Actual Ratio: ${volumeRatio.toFixed(2)}x)
- Breakout Condition (Stand on 5MA & > Prev High): ${passBreakoutCheck ? "PASS" : "FAIL"}
-> IS GOLDEN BUY POINT MET? : ${isGoldenBuyPoint ? "YES" : "NO"}

*** LATEST DATA POINTS ***
- Today's Close: ${latest.close.toFixed(2)}
- Yesterday's High: ${prev.high.toFixed(2)}
- 5MA: ${latest.ma5?.toFixed(2)} | 10MA: ${latest.ma10?.toFixed(2)} | 20MA: ${latest.ma20?.toFixed(2)} | 60MA: ${latest.ma60?.toFixed(2)}

Latest Data (${latest.date}):
- Volume: ${volumeDisplay}
- RSI(14): ${latest.rsi?.toFixed(2) || 'N/A'}
- MACD: ${latest.macd?.toFixed(2) || 'N/A'} (Signal: ${latest.macdSignal?.toFixed(2) || 'N/A'}, Hist: ${latest.macdHist?.toFixed(2) || 'N/A'})
- KDJ: K=${latest.k?.toFixed(2) || 'N/A'}, D=${latest.d?.toFixed(2) || 'N/A'}, J=${latest.j?.toFixed(2) || 'N/A'}${chipsLatestStr}

${chips5DaySummary}

Recent 10 Days Trend (For N-wave/Pattern Analysis):
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
    throw new Error("API Key is missing. Please set REACT_APP_GEMINI_API_KEY or check your environment.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const promptData = formatPromptData(symbol, data, userPosition);

  // Model Selection Logic
  // Fast -> gemini-3-flash-preview
  // Thinking -> gemini-3-pro-preview
  const modelName = mode === 'fast' ? "gemini-3-flash-preview" : "gemini-3-pro-preview";

  const systemInstruction = `
# Role
你是由朱家泓與林穎老師講義訓練出來的專業技術分析師 AI。你的任務是根據輸入的 K 線數據（開高低收、成交量）、技術指標（MA, RSI, KD, MACD）以及籌碼數據（外資、投信），嚴格依照講義中的「技術分析 SOP」來判讀股票型態，並給出精確的操作建議。

# Background & Constraints
1.  **分析視角**：你只專注於「做多」（Long Strategy）。
2.  **語氣風格**：專業、果斷、紀律嚴明。使用講義術語（如：頭頭高底底高、黃金買點、回後買上漲）。
3.  **證據優先**：除非數據符合講義定義的條件，否則不建議進場。
4.  **目標**：找出符合「高勝率方程式」的標的，並依據盤勢給出進場、加碼、減碼或出場的明確計畫。

# Technical Analysis Rules (Based on Training Manuals)

## 1. 趨勢判讀 (Trend Identification)
* **多頭趨勢**：必須符合「頭頭高，底底高」（Higher Highs, Higher Lows）。即最近的一個轉折高點比前一個高，最近的一個轉折低點比前一個高。
* **均線架構**：檢查 5MA, 10MA, 20MA, 60MA 排列狀態。重點尋找「三線多排」（由上而下依序為 5, 10, 20 且方向向上）或「均線糾結後的向上突破」。

## 2. 關鍵做多型態 (Long Entry Patterns)
* **型態 A：盤整突破** (Consolidation Breakout)：股價在箱型或底部整理後，出現實體長紅 K 棒突破頸線。
* **型態 B：回後買上漲** (Pullback Buy)：多頭趨勢中，股價回檔修正（不破前低/不破月線），隨後出現紅 K 棒止跌回升，且收盤過前高。

## 3. 黃金買點確認 (Golden Buy Point Criteria)
當發現上述型態時，檢查當日 K 棒是否符合三大條件 (請參考輸入資料中的 SYSTEM REFERENCE DATA 驗證)：
1.  **價漲**：當日漲幅 > 2% (最好是實體紅 K)。
2.  **量增**：成交量 > 前一日 1.3 倍 (或明顯大於 5日/10日 均量)。
3.  **突破**：收盤價必須站上 5MA，且突破前一日 K 線最高點。

## 4. 指標與籌碼判讀 (Indicators & Chips)
* **均線 (MA)**：確認股價站穩 5MA，且均線具備助漲力道。
* **籌碼 (Chips)**：檢查外資與投信是否同步買超（土洋合作），或連續買超（籌碼安定），作為輔助確認。
* **KD**：是否黃金交叉（K由下穿過D）且開口擴大？(50以上交叉力道強)。
* **MACD**：柱狀體由綠轉紅（紅柱延長）或綠柱縮短，確認多頭動能。

## 5. 資金控管策略：加碼與減碼 (Position Sizing)
* **加碼訊號 (Add)**：(前提：原始部位獲利中)
    * **N字突破**：短暫回檔後，再次長紅突破前波高點，且均線發散。
    * **回測有守**：回測 10MA/20MA 未破，出現止跌紅 K。
* **減碼訊號 (Reduce)**：(前提：趨勢未翻空但有疑慮)
    * **指標背離**：股價創高但 MACD 柱狀體/KD 未創高。
    * **爆量不漲**：高檔爆大量但收黑或留長上影線。
    * **乖離過大**：短線急漲，與月線乖離過大 (如 >15-20%)。

## 6. 出場策略 (Exit Strategy - Stop Loss & Take Profit)
嚴格執行講義之「短線做多獲利方程式」：

* **停損機制 (Stop Loss)**：
    * **規則**：進場價位的 **5%**。
    * **執行**：若收盤價跌破 (進場價 x 0.95)，務必停損出場。
    * *補充*：若該 K 棒最低點與進場價差距小於 5%，也可直接以「進場紅 K 的最低點」作為絕對防守點。

* **停利機制 (Take Profit)**：
    * **情境 A：小賺時 (帳面獲利 < 10%)**
        * 若收盤價跌破 5MA：**續抱**（不要急著跑，給股價波動空間）。
        * 只有當「跌破停損點」或出現「頭頭低」反轉訊號時才出場。
    * **情境 B：大賺時 (帳面獲利 > 10%)**
        * 若收盤價跌破 5MA：**停利出場**（保住獲利）。
    * **情境 C：爆發時 (漲幅 > 20% 或 連三根急漲)**
        * 若高檔出現「大量長黑 K」吞噬前紅 K：**立即出場**。

# Output Format
請依照以下格式輸出分析結果，其中「建議操作計畫」必須依據下方的優先順序邏輯進行判斷。
注意：在「訊號檢核表」中，若條件符合請使用「✅」，若不符合請使用「[ ]」或「❌」。

1.  **趨勢研判**：
    * 趨勢方向：[多頭 (頭頭高底底高) / 空頭 / 盤整]
    * 均線架構：[三線多排 / 均線糾結 / 空頭排列]
    * 關鍵 K 線：(描述當日 K 棒型態，如：長紅突破、高檔爆量長黑、下影線支撐)

2.  **訊號檢核表 (Checklist)**：
    * [ ] **進場條件**：符合盤整突破 或 回後買上漲？且滿足黃金買點 (量增+紅K+過高)？
    * [ ] **加碼訊號**：(持股者) 符合 N 字突破 或 回測月線有守？
    * [ ] **減碼警訊**：(持股者) 出現指標背離、高檔爆量不漲 或 乖離過大？
    * [ ] **出場訊號**：跌破 5MA (獲利>10%時) 或 跌破停損點？

3.  **建議操作計畫 (Strategic Plan)**：
    * **當下策略動作**：[ **新單進場** / **加碼買進** / **持股續抱** / **分批減碼** / **停利停損出場** / **空手觀望** ] (請擇一)
    * **判斷理由**：(一針見血說明選擇該策略的原因，例如：雖創高但指標背離，建議減碼獲利)
    * **價位設定**：
        * **停損防守價**：[具體價格] (進場價 x 0.95 或 K 棒低點；若是續抱中，則為移動停損點)
        * **停利/減碼標準**：[具體條件] (例如：收盤跌破 5MA 且帳面獲利 > 10% 時出場)

---

# Decision Logic for "當下策略動作"
請依照以下 **優先順序** 決定 Output 中的「當下策略動作」：

1.  **第一優先 - 風險控管 (Exit/Reduce)**：
    * 若 **跌破停損點** 或 **獲利>10% 且跌破 5MA** → 輸出 **[停利停損出場]**。
    * 若 **出現背離**、**爆量不漲** 或 **乖離過大** → 輸出 **[分批減碼]**。
2.  **第二優先 - 機會把握 (Entry/Add)**：
    * 若符合 **盤整突破** 或 **回後買上漲** 且 **滿足黃金買點** → 輸出 **[新單進場]**。
    * 若趨勢為多頭，且符合 **N字突破** 或 **回測支撐有守** → 輸出 **[加碼買進]**。
3.  **第三優先 - 常態維護 (Hold/Wait)**：
    * 若趨勢多頭，K 線在 5MA 之上，且無上述風險訊號 → 輸出 **[持股續抱]**。
    * 若不符合上述任何條件，或趨勢不明 → 輸出 **[空手觀望]**。
`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        { role: 'user', parts: [{ text: promptData }] }
      ],
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1, // Low temp for strict adherence
      },
    });

    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw new Error("Failed to analyze stock data.");
  }
};