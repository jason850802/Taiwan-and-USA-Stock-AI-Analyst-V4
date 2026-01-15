import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Cell,
  ReferenceLine,
  Label
} from 'recharts';
import { StockDataPoint, IndicatorSettings } from '../types';
import { ZoomIn, ZoomOut } from 'lucide-react';

interface StockChartProps {
  data: StockDataPoint[];
  settings: IndicatorSettings;
  isTaiwanStock: boolean;
}

// ----------------------------------------------------------------------
// 1. Custom Shapes & Tooltips
// ----------------------------------------------------------------------

const CandleStickShape = (props: any) => {
  const { x, y, width, height, payload } = props;
  const { open, close, high, low } = payload;
  
  // Guard against null/zero width
  if (!open || !close) return null;

  const isUp = close > open;
  const isDown = close < open;
  const color = isUp ? '#ef4444' : isDown ? '#10b981' : '#94a3b8';

  const bodyMin = Math.min(open, close);
  const bodyMax = Math.max(open, close);
  const diff = bodyMax - bodyMin;
  
  let ratio = 0;
  if (diff > 0) {
      ratio = height / diff;
  } else if (height > 0 && (high-low) > 0) {
      // Fallback for doji/flat body but with high/low
      ratio = height / (high - low);
  }
  
  const yHigh = y - (high - bodyMax) * ratio;
  const yLow = (y + height) + (bodyMin - low) * ratio;
  const centerX = x + width / 2;

  return (
    <g>
      <line x1={centerX} y1={yHigh} x2={centerX} y2={yLow} stroke={color} strokeWidth={1} />
      <rect x={x} y={y} width={width} height={Math.max(1, height)} fill={color} stroke="none" />
    </g>
  );
};

// Main Tooltip for Price/Volume
const MainTooltip = ({ active, payload, label, isTaiwanStock }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isUp = data.close > data.open;
    const colorClass = isUp ? "text-red-400" : data.close < data.open ? "text-emerald-400" : "text-slate-400";
    
    // Display Volume in Lots for Taiwan Stocks
    const volDisplay = isTaiwanStock 
        ? `${Math.round(data.volume / 1000).toLocaleString()} 張`
        : `${(data.volume).toLocaleString()}`; 

    const priceChange = data.priceChange;
    const priceChangePercent = data.priceChangePercent;
    
    const isChangeUp = priceChange > 0;
    const isChangeDown = priceChange < 0;
    const changeColor = isChangeUp ? "text-red-400" : isChangeDown ? "text-emerald-400" : "text-slate-400";
    const arrow = isChangeUp ? "↑" : isChangeDown ? "↓" : "";
    const changeTxt = priceChange !== undefined ? `${arrow}${Math.abs(priceChange).toFixed(2)}` : '-';
    const percentTxt = priceChangePercent !== undefined ? `${arrow}${Math.abs(priceChangePercent).toFixed(2)}%` : '-';

    return (
      <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs backdrop-blur-md bg-opacity-90 z-50 min-w-[150px]">
        <p className="text-slate-400 mb-2 font-medium border-b border-slate-700 pb-1">{data.date}</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span className="text-slate-500">Open</span><span className={colorClass}>{data.open.toFixed(2)}</span>
            <span className="text-slate-500">High</span><span className={colorClass}>{data.high.toFixed(2)}</span>
            <span className="text-slate-500">Low</span><span className={colorClass}>{data.low.toFixed(2)}</span>
            <span className="text-slate-500">Close</span><span className={colorClass}>{data.close.toFixed(2)}</span>
            
            <span className="text-slate-500">Chg</span><span className={changeColor}>{changeTxt}</span>
            <span className="text-slate-500">Chg%</span><span className={changeColor}>{percentTxt}</span>

            <span className="text-slate-500 col-span-2 border-t border-slate-800 my-1"></span>
            <span className="text-slate-500">Volume</span><span className="text-slate-200">{volDisplay}</span>
        </div>
      </div>
    );
  }
  return null;
};

const ChipTooltip = ({ active, payload, title }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        let val = 0;
        if (title === "Foreign") val = data.foreignBuySell;
        if (title === "Trust") val = data.investmentTrustBuySell;

        const lots = Math.round(val / 1000);
        const colorClass = lots > 0 ? "text-red-400" : lots < 0 ? "text-emerald-400" : "text-slate-400";

        return (
            <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs backdrop-blur-md bg-opacity-90 z-50">
                <p className="text-slate-400 mb-1 font-medium border-b border-slate-700 pb-1">{data.date}</p>
                <div className="flex justify-between gap-4">
                    <span className="text-slate-300 font-bold">{title}</span>
                    <span className={colorClass}>{lots > 0 ? '+' : ''}{lots.toLocaleString()} 張</span>
                </div>
            </div>
        );
    }
    return null;
}

const IndicatorTooltip = ({ active, payload, settings }: { active?: boolean, payload?: any[], settings: IndicatorSettings }) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs backdrop-blur-md bg-opacity-90 z-50">
                <p className="text-slate-400 mb-2 font-medium border-b border-slate-700 pb-1">{data.date}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {settings.showRSI && (
                        <>
                            <span className="text-blue-400 font-bold">RSI (14)</span>
                            <span className="text-slate-200">{data.rsi?.toFixed(2)}</span>
                        </>
                    )}
                    
                    {(settings.showK || settings.showD || settings.showJ) && (
                         <div className="col-span-2 border-t border-slate-800 my-1"></div>
                    )}

                    {settings.showK && (
                        <>
                        <span className="text-yellow-400 font-bold">K (9)</span>
                        <span className="text-slate-200">{data.k?.toFixed(2)}</span>
                        </>
                    )}
                    
                    {settings.showD && (
                        <>
                        <span className="text-pink-400 font-bold">D (9)</span>
                        <span className="text-slate-200">{data.d?.toFixed(2)}</span>
                        </>
                    )}
                    
                    {settings.showJ && (
                        <>
                        <span className="text-purple-400 font-bold">J (9)</span>
                        <span className="text-slate-200">{data.j?.toFixed(2)}</span>
                        </>
                    )}
                </div>
            </div>
        );
    }
    return null;
}

const MACDTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs backdrop-blur-md bg-opacity-90 z-50">
                <p className="text-slate-400 mb-2 font-medium border-b border-slate-700 pb-1">{data.date}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <span className="text-orange-400 font-bold">DIF</span>
                    <span className="text-slate-200">{data.macd?.toFixed(2)}</span>
                    
                    <span className="text-cyan-400 font-bold">DEA</span>
                    <span className="text-slate-200">{data.macdSignal?.toFixed(2)}</span>
                    
                    <span className="text-slate-300 font-bold">Hist</span>
                    <span className={data.macdHist >= 0 ? 'text-red-400' : 'text-emerald-400'}>{data.macdHist?.toFixed(2)}</span>
                </div>
            </div>
        );
    }
    return null;
}

// ----------------------------------------------------------------------
// 2. Info Overlay Component
// ----------------------------------------------------------------------

const MALegend = ({ currentData, settings }: { currentData: StockDataPoint, settings: IndicatorSettings }) => {
    if (!currentData) return null;

    const renderItem = (label: string, value: number | undefined, dir: string | undefined, color: string) => {
        if (value === undefined) return null;
        const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : ''; 
        const dirColor = dir === 'up' ? 'text-red-400' : dir === 'down' ? 'text-emerald-400' : 'text-slate-500';
        
        return (
            <div className="flex items-center gap-1.5 text-xs font-mono bg-slate-900/50 px-2 py-1 rounded border border-slate-800">
                <span style={{ color: color }} className="font-bold">{label}</span>
                <span className="text-slate-200">{value.toFixed(2)}</span>
                <span className={`${dirColor} text-[10px]`}>{arrow}</span>
            </div>
        );
    };

    return (
        <div className="flex flex-wrap gap-2 items-center">
            {settings.showMA5 && renderItem("MA5", currentData.ma5, currentData.ma5Dir, "#fbbf24")}
            {settings.showMA10 && renderItem("MA10", currentData.ma10, currentData.ma10Dir, "#38bdf8")}
            {settings.showMA20 && renderItem("MA20", currentData.ma20, currentData.ma20Dir, "#a78bfa")}
            {settings.showMA60 && renderItem("MA60", currentData.ma60, currentData.ma60Dir, "#34d399")}
        </div>
    );
};

// ----------------------------------------------------------------------
// 3. Main Chart Component
// ----------------------------------------------------------------------

const StockChart: React.FC<StockChartProps> = ({ data, settings, isTaiwanStock }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  
  // Controls how many bars to show initially to avoid clutter
  // Default to 100 or less
  const [barsToShow, setBarsToShow] = useState(100);
  
  useEffect(() => {
     setBarsToShow(Math.min(100, data.length));
  }, [data.length]);

  const handleZoom = (direction: 'in' | 'out') => {
      setBarsToShow(prev => {
          const step = Math.ceil(prev * 0.2); 
          if (direction === 'in') return Math.max(20, prev - step);
          else return Math.min(data.length, prev + step); 
      });
  };

  const hasChipData = useMemo(() => {
      if (!data || data.length === 0) return false;
      return data.some(d => (d.foreignBuySell !== undefined && d.foreignBuySell !== 0) || (d.investmentTrustBuySell !== undefined && d.investmentTrustBuySell !== 0));
  }, [data]);

  // Transform Data based on Settings (Adj vs Raw)
  // This ensures the Chart sees the correct "close", "open", "ma5" keys
  const displayData = useMemo(() => {
    const startIndex = Math.max(0, data.length - barsToShow);
    const sliced = data.slice(startIndex, data.length);

    return sliced.map((d, i) => {
        // Switch between Raw and Adj
        const useAdj = settings.useAdjusted;
        
        const openVal = useAdj && d.openAdj ? d.openAdj : d.open;
        const closeVal = useAdj && d.closeAdj ? d.closeAdj : d.close;
        const highVal = useAdj && d.highAdj ? d.highAdj : d.high;
        const lowVal = useAdj && d.lowAdj ? d.lowAdj : d.low;

        // Min/Max for candle body
        let minBody = Math.min(openVal, closeVal);
        let maxBody = Math.max(openVal, closeVal);
        if (minBody === maxBody) maxBody += 0.000001;

        let priceChange = 0;
        let priceChangePercent = 0;
        
        // Calculate change based on the visible data stream (approximation for display)
        const originalIndex = startIndex + i;
        if (originalIndex > 0) {
            const prevD = data[originalIndex - 1];
            const prevClose = useAdj && prevD.closeAdj ? prevD.closeAdj : prevD.close;
            priceChange = closeVal - prevClose;
            priceChangePercent = (priceChange / prevClose) * 100;
        }

        return { 
            ...d,
            // Override basic keys for Recharts
            open: openVal,
            close: closeVal,
            high: highVal,
            low: lowVal,
            candleBody: [minBody, maxBody],
            
            // Map MAs
            ma5: useAdj ? d.ma5Adj : d.ma5,
            ma10: useAdj ? d.ma10Adj : d.ma10,
            ma20: useAdj ? d.ma20Adj : d.ma20,
            ma60: useAdj ? d.ma60Adj : d.ma60,
            
            // Map Indicators
            rsi: useAdj ? d.rsiAdj : d.rsi,
            macd: useAdj ? d.macdAdj : d.macd,
            macdSignal: useAdj ? d.macdSignalAdj : d.macdSignal,
            macdHist: useAdj ? d.macdHistAdj : d.macdHist,
            
            priceChange,
            priceChangePercent
        };
    });
  }, [data, barsToShow, settings.useAdjusted]);

  const activeData = activeIndex !== null && displayData[activeIndex] ? displayData[activeIndex] : displayData[displayData.length - 1];
  const cursorData = activeIndex !== null && displayData[activeIndex] ? displayData[activeIndex] : null;

  const handleMouseMove = useCallback((state: any) => {
      if (state && state.activeTooltipIndex !== undefined) {
          setActiveIndex(state.activeTooltipIndex);
      } else {
          setActiveIndex(null);
      }
  }, []);

  const handleMouseLeave = useCallback(() => {
      setActiveIndex(null);
  }, []);

  const sharedChartProps = {
    data: displayData,
    syncId: "stockDashboard",
    margin: { top: 5, right: 0, left: 0, bottom: 5 },
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
  };

  const Y_AXIS_WIDTH = 60;
  const commonYAxisProps = {
    orientation: "right" as const,
    width: Y_AXIS_WIDTH,
    tick: { fontSize: 11, fill: '#94a3b8' },
    tickLine: false,
    axisLine: false,
    mirror: false,
    tickMargin: 5,
  };

  if (!data || data.length === 0) return <div className="text-gray-400">No data available for chart</div>;

  return (
    <div className="flex flex-col gap-4 w-full relative group">
      
      {/* 1. Price Chart Section */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg relative outline-none">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-2 pr-20">
            <div className="flex items-center gap-2">
                <h3 className="text-slate-200 font-semibold text-lg">Price Action</h3>
                <span className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded uppercase tracking-wider">
                    {settings.useAdjusted ? 'Adj (還原)' : 'Raw (原始)'}
                </span>
            </div>
            <MALegend currentData={activeData} settings={settings} />
        </div>

        <div className="absolute top-4 right-4 flex gap-1 z-10">
            <button onClick={() => handleZoom('out')} className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-l border border-slate-600 transition-colors" title="Zoom Out (-)">
                <ZoomOut size={16} />
            </button>
            <button onClick={() => handleZoom('in')} className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-r border border-slate-600 transition-colors" title="Zoom In (+)">
                <ZoomIn size={16} />
            </button>
        </div>
        
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart {...sharedChartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis 
                dataKey="date" 
                stroke="#94a3b8" 
                tick={{fill: '#94a3b8', fontSize: 11}} 
                minTickGap={40} 
                tickLine={false} 
                axisLine={{stroke: '#475569'}} 
              />
              <YAxis 
                {...commonYAxisProps}
                yAxisId="right"
                domain={['dataMin', 'dataMax']} 
                tickFormatter={(val) => val.toFixed(0)} 
                textAnchor="start" 
              />
              <Tooltip content={<MainTooltip isTaiwanStock={isTaiwanStock} />} cursor={{ stroke: '#475569', strokeDasharray: '4 4' }} />

              {settings.showMA5 && <Line yAxisId="right" type="monotone" dataKey="ma5" stroke="#fbbf24" strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />}
              {settings.showMA10 && <Line yAxisId="right" type="monotone" dataKey="ma10" stroke="#38bdf8" strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />}
              {settings.showMA20 && <Line yAxisId="right" type="monotone" dataKey="ma20" stroke="#a78bfa" strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />}
              {settings.showMA60 && <Line yAxisId="right" type="monotone" dataKey="ma60" stroke="#34d399" strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />}
              
              <Bar yAxisId="right" dataKey="candleBody" shape={<CandleStickShape />} name="Price" isAnimationActive={false} maxBarSize={15} />

              {cursorData && (
                <ReferenceLine 
                    yAxisId="right" 
                    y={cursorData.close} 
                    stroke="#94a3b8" 
                    strokeDasharray="3 3" 
                    opacity={0.8}
                >
                    <Label 
                        value={cursorData.close.toFixed(2)} 
                        position="right" 
                        fill="#e2e8f0" 
                        fontSize={11}
                        className="bg-slate-800"
                        offset={5}
                    />
                </ReferenceLine>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

       {/* 2. Volume Chart */}
       <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg h-[250px] outline-none">
           <h3 className="text-slate-200 mb-2 font-medium text-sm">{isTaiwanStock ? "成交張數 (Lots)" : "Volume"}</h3>
           <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart {...sharedChartProps}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis 
                    {...commonYAxisProps}
                    stroke="#94a3b8" 
                    tickFormatter={(val) => isTaiwanStock ? (val/1000).toFixed(0) : (val/1000000).toFixed(1) + 'M'} 
                />
                <Tooltip cursor={{fill: '#334155', opacity: 0.4}} content={<MainTooltip isTaiwanStock={isTaiwanStock} />} />
                <Bar dataKey="volume" isAnimationActive={false}>
                    {displayData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.close >= entry.open ? '#ef4444' : '#10b981'} opacity={0.6} />
                    ))}
                </Bar>
                </BarChart>
            </ResponsiveContainer>
           </div>
       </div>

       {/* 3. Chip Analysis (Synchronized Zoom) */}
       {hasChipData && (
        <>
            <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-lg h-[180px] outline-none">
                    <h3 className="text-slate-200 mb-1 font-medium text-xs flex items-center justify-between">
                        <span>外資買賣超 (Foreign Net Buy/Sell)</span>
                    </h3>
                    <div className="h-[140px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart {...sharedChartProps}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                            <XAxis dataKey="date" hide />
                            <YAxis 
                                {...commonYAxisProps}
                                stroke="#94a3b8" 
                                tickFormatter={(val) => (val/1000).toFixed(0)} 
                            />
                            <Tooltip cursor={{fill: '#334155', opacity: 0.4}} content={<ChipTooltip title="Foreign" />} />
                            <ReferenceLine y={0} stroke="#475569" />
                            <Bar dataKey="foreignBuySell" isAnimationActive={false}>
                                {displayData.map((entry, index) => (
                                    <Cell key={`fii-${index}`} fill={(entry.foreignBuySell || 0) > 0 ? '#ef4444' : '#10b981'} />
                                ))}
                            </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
            </div>
            
            <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-lg h-[180px] outline-none">
                    <h3 className="text-slate-200 mb-1 font-medium text-xs flex items-center justify-between">
                        <span>投信買賣超 (Trust Net Buy/Sell)</span>
                    </h3>
                    <div className="h-[140px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart {...sharedChartProps}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                            <XAxis dataKey="date" hide />
                            <YAxis 
                                {...commonYAxisProps}
                                stroke="#94a3b8" 
                                tickFormatter={(val) => (val/1000).toFixed(0)} 
                            />
                            <Tooltip cursor={{fill: '#334155', opacity: 0.4}} content={<ChipTooltip title="Trust" />} />
                            <ReferenceLine y={0} stroke="#475569" />
                            <Bar dataKey="investmentTrustBuySell" isAnimationActive={false}>
                                {displayData.map((entry, index) => (
                                    <Cell key={`it-${index}`} fill={(entry.investmentTrustBuySell || 0) > 0 ? '#ef4444' : '#10b981'} />
                                ))}
                            </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
            </div>
        </>
       )}

       {/* 4. Technical Indicators Row */}
       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg h-[250px] outline-none">
                <h3 className="text-slate-200 mb-2 font-medium text-sm">MACD (12, 26, 9)</h3>
                <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart {...sharedChartProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis dataKey="date" hide />
                        <YAxis {...commonYAxisProps} stroke="#94a3b8" />
                        <Tooltip content={<MACDTooltip />} />
                        <ReferenceLine y={0} stroke="#475569" />
                        
                        <Bar dataKey="macdHist" isAnimationActive={false}>
                            {displayData.map((entry, index) => (
                                <Cell key={`hist-${index}`} fill={(entry.macdHist || 0) >= 0 ? '#ef4444' : '#10b981'} />
                            ))}
                        </Bar>
                        
                        <Line type="monotone" dataKey="macd" stroke="#fb923c" dot={false} strokeWidth={1.5} name="DIF" isAnimationActive={false} />
                        <Line type="monotone" dataKey="macdSignal" stroke="#22d3ee" dot={false} strokeWidth={1.5} name="DEA" isAnimationActive={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg h-[250px] outline-none">
                <h3 className="text-slate-200 mb-2 font-medium text-sm">RSI & KDJ</h3>
                <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart {...sharedChartProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis dataKey="date" hide />
                        <YAxis {...commonYAxisProps} domain={[0, 100]} stroke="#94a3b8" />
                        <Tooltip content={<IndicatorTooltip settings={settings} />} />
                        {settings.showRSI && <Line type="monotone" dataKey="rsi" stroke="#38bdf8" dot={false} strokeWidth={2} name="RSI" isAnimationActive={false} />}
                        {settings.showK && <Line type="monotone" dataKey="k" stroke="#facc15" dot={false} strokeWidth={1} name="K" isAnimationActive={false} />}
                        {settings.showD && <Line type="monotone" dataKey="d" stroke="#f472b6" dot={false} strokeWidth={1} name="D" isAnimationActive={false} />}
                        {settings.showJ && <Line type="monotone" dataKey="j" stroke="#c084fc" dot={false} strokeWidth={1} name="J" isAnimationActive={false} />}
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>
       </div>
    </div>
  );
};

export default StockChart;