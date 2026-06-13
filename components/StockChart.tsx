import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Cell,
  ReferenceLine,
  // recharts 3.x public hooks — used by CursorPriceLine (in-chart, no internal imports)
  useActiveTooltipDataPoints,
  useYAxisScale,
  usePlotArea
} from 'recharts';
import { StockDataPoint, IndicatorSettings, MALineConfig } from '../types';
import { calculateSMA } from '../utils/math';
import { ZoomIn, ZoomOut } from 'lucide-react';

interface StockChartProps {
  data: StockDataPoint[];
  settings: IndicatorSettings;
  isTaiwanStock: boolean;
  onToggleSetting?: (key: keyof IndicatorSettings) => void;
}

// ----------------------------------------------------------------------
// 1. Custom Shapes & Tooltips
// ----------------------------------------------------------------------

// Custom crosshair cursor — vertical line centered on the active bar
const CrosshairCursor = (props: any) => {
  const { points, width, height, top, left } = props;
  if (!points || points.length === 0) return null;
  const x = points[0].x;
  return (
    <line x1={x} y1={top} x2={x} y2={top + height} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} />
  );
};

const CandleStickShape = (props: any) => {
  const { x, y, width, height, payload } = props;
  const { open, close, high, low } = payload;

  // Guard
  if (!open || !close || width <= 0 || height <= 0) return null;

  const isUp   = close > open;
  const isDown = close < open;
  const color  = isUp ? '#ef4444' : isDown ? '#10b981' : '#94a3b8';
  const centerX = x + width / 2;

  // candleBody is now [low, high], so:
  //   y           = pixel position of high  (top)
  //   y + height  = pixel position of low   (bottom)
  const ratio = (high !== low) ? height / (high - low) : 0;

  // Pixel positions of open / close
  const yOpen  = y + (high - open)  * ratio;
  const yClose = y + (high - close) * ratio;

  const yBodyTop    = Math.min(yOpen, yClose);
  const yBodyBottom = Math.max(yOpen, yClose);
  const bodyHeight  = yBodyBottom - yBodyTop;

  // Doji: open ≈ close → draw a cross (十字線)
  if (bodyHeight < 1) {
    const yMid = (yBodyTop + yBodyBottom) / 2;
    return (
      <g>
        {/* 上下引線 */}
        <line x1={centerX} y1={y}          x2={centerX} y2={y + height} stroke={color} strokeWidth={1} />
        {/* 橫線（實體） */}
        <line x1={x} y1={yMid} x2={x + width} y2={yMid} stroke={color} strokeWidth={1.5} />
      </g>
    );
  }

  return (
    <g>
      {/* 上引線 */}
      <line x1={centerX} y1={y}          x2={centerX} y2={yBodyTop}    stroke={color} strokeWidth={1} />
      {/* 下引線 */}
      <line x1={centerX} y1={yBodyBottom} x2={centerX} y2={y + height} stroke={color} strokeWidth={1} />
      {/* 實體 */}
      <rect x={x} y={yBodyTop} width={width} height={bodyHeight} fill={color} stroke="none" />
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
            <span className="text-slate-500">開</span><span className={colorClass}>{data.open.toFixed(2)}</span>
            <span className="text-slate-500">高</span><span className={colorClass}>{data.high.toFixed(2)}</span>
            <span className="text-slate-500">低</span><span className={colorClass}>{data.low.toFixed(2)}</span>
            <span className="text-slate-500">收</span><span className={colorClass}>{data.close.toFixed(2)}</span>

            <span className="text-slate-500">漲跌</span><span className={changeColor}>{changeTxt}</span>
            <span className="text-slate-500">漲跌%</span><span className={changeColor}>{percentTxt}</span>

            <span className="text-slate-500 col-span-2 border-t border-slate-800 my-1"></span>
            <span className="text-slate-500">量</span><span className="text-slate-200">{volDisplay}</span>

            {data.bbUpper != null && (
              <>
                <span className="text-slate-500 col-span-2 border-t border-slate-800 my-1"></span>
                <span className="text-purple-400">BB上</span><span className="text-slate-200">{data.bbUpper.toFixed(2)}</span>
                <span className="text-purple-400">BB中</span><span className="text-slate-200">{data.bbMiddle?.toFixed(2)}</span>
                <span className="text-purple-400">BB下</span><span className="text-slate-200">{data.bbLower?.toFixed(2)}</span>
              </>
            )}
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
                        <span className="text-yellow-400 font-bold">K (5)</span>
                        <span className="text-slate-200">{data.k?.toFixed(2)}</span>
                        </>
                    )}
                    
                    {settings.showD && (
                        <>
                        <span className="text-pink-400 font-bold">D (3)</span>
                        <span className="text-slate-200">{data.d?.toFixed(2)}</span>
                        </>
                    )}
                    
                    {settings.showJ && (
                        <>
                        <span className="text-purple-400 font-bold">J (3)</span>
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

const MALegend = ({ currentData, settings }: { currentData: any, settings: IndicatorSettings }) => {
    if (!currentData) return null;

    return (
        <div className="flex flex-wrap gap-2 items-center">
            {settings.maLines.filter(l => l.enabled).map((line) => {
                const key = `ma_${line.period}`;
                const dirKey = `ma_${line.period}_dir`;
                const value = currentData[key] as number | undefined;
                const dir = currentData[dirKey] as string | undefined;
                if (value === undefined) return null;
                const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '';
                const dirColor = dir === 'up' ? 'text-red-400' : dir === 'down' ? 'text-emerald-400' : 'text-slate-500';
                return (
                    <div key={key} className="flex items-center gap-1.5 text-xs font-mono bg-slate-900/50 px-2 py-1 rounded border border-slate-800">
                        <span style={{ color: line.color }} className="font-bold">MA{line.period}</span>
                        <span className="text-slate-200">{value.toFixed(2)}</span>
                        <span className={`${dirColor} text-[10px]`}>{arrow}</span>
                    </div>
                );
            })}
        </div>
    );
};

// ----------------------------------------------------------------------
// 2b. In-chart cursor price line (hooks-based, replaces old ReferenceLine+Label)
// ----------------------------------------------------------------------

// 維護備註：此元件依賴 recharts 3.x 公開 hooks
// （useActiveTooltipDataPoints / useYAxisScale / usePlotArea），
// 已在安裝的 recharts 3.8.0 (node_modules/recharts/types/hooks.d.ts) 確認存在。
// 只用公開 export，不從 recharts/es6/... 內部路徑匯入。
// 它被當作 <ComposedChart> 的子元素渲染，因而能讀取圖表 context。
// 升級 recharts 時請確認這三個 hook 仍然存在。
const CursorPriceLine = () => {
  const activePoints = useActiveTooltipDataPoints<any>(); // 目前 hover 的資料點（無 hover 時 undefined）
  const yScale = useYAxisScale('right'); // 價格軸 yAxisId="right"
  const plotArea = usePlotArea();

  // 任一 hook 在無 active cursor / context 未就緒時回傳 undefined → 不渲染
  if (!activePoints || activePoints.length === 0 || !yScale || !plotArea) return null;

  const close = activePoints[0]?.close;
  if (close == null) return null;

  const y = yScale(close);
  if (y == null) return null;

  const xStart = plotArea.x;
  const xEnd = plotArea.x + plotArea.width;

  // 與舊的 ReferenceLine+Label 視覺一致：虛線 #94a3b8、標籤 #e2e8f0 fontSize 11
  return (
    <g>
      <line
        x1={xStart}
        y1={y}
        x2={xEnd}
        y2={y}
        stroke="#94a3b8"
        strokeDasharray="3 3"
        opacity={0.8}
      />
      <text x={xEnd + 4} y={y} dy={4} fill="#e2e8f0" fontSize={11} textAnchor="start">
        {close.toFixed(2)}
      </text>
    </g>
  );
};

// ----------------------------------------------------------------------
// 3. Main Chart Component
// ----------------------------------------------------------------------

type PanelView = 'foreign' | 'trust' | 'macd' | 'kdj' | 'rsi';

// 模組層級常數 —— 避免在 parent render 中重建物件字面值而破壞 React.memo
const CHART_MARGIN = { top: 5, right: 0, left: 0, bottom: 5 };
const SYNC_ID = 'stockDashboard';
const Y_AXIS_WIDTH = 60;
const COMMON_Y_AXIS_PROPS = {
  orientation: 'right' as const,
  width: Y_AXIS_WIDTH,
  tick: { fontSize: 11, fill: '#94a3b8' },
  tickLine: false,
  axisLine: false,
  mirror: false,
  tickMargin: 5,
};

// ----------------------------------------------------------------------
// 3a. Memoized main price chart body
// ----------------------------------------------------------------------

interface MainPriceChartProps {
  displayData: any[];
  settings: IndicatorSettings;
  isTaiwanStock: boolean;
  volumeCells: React.ReactNode;
  onMouseMove: (state: any) => void;
  onMouseLeave: () => void;
}

const MainPriceChart: React.FC<MainPriceChartProps> = React.memo(({
  displayData,
  settings,
  isTaiwanStock,
  volumeCells,
  onMouseMove,
  onMouseLeave,
}) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={displayData}
        syncId={SYNC_ID}
        margin={CHART_MARGIN}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        barCategoryGap="20%"
        barGap="-100%"
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
        <XAxis
          dataKey="date"
          stroke="#94a3b8"
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          minTickGap={40}
          tickLine={false}
          axisLine={{ stroke: '#475569' }}
        />
        <YAxis
          {...COMMON_Y_AXIS_PROPS}
          yAxisId="right"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(val) => val.toFixed(0)}
          textAnchor="start"
        />
        {/* Hidden volume axis — domain inflated so bars occupy bottom ~20% */}
        <YAxis yAxisId="volume" orientation="left" hide domain={[0, (dataMax: number) => dataMax * 5]} />
        <Tooltip content={<MainTooltip isTaiwanStock={isTaiwanStock} />} cursor={<CrosshairCursor />} />

        {/* Volume overlay — behind candlesticks, same position via barGap=-100% */}
        <Bar yAxisId="volume" dataKey="volume" isAnimationActive={false}>
          {volumeCells}
        </Bar>

        {settings.maLines.filter(l => l.enabled).map((line) => (
          <Line key={`ma-${line.period}`} yAxisId="right" type="monotone" dataKey={`ma_${line.period}`} stroke={line.color} strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />
        ))}

        {/* Bollinger Bands */}
        {settings.showBB && (
          <>
            <Area yAxisId="right" type="monotone" dataKey="bbBand" stroke="none" fill="#8b5cf6" fillOpacity={0.06} isAnimationActive={false} dot={false} activeDot={false} />
            <Line yAxisId="right" type="monotone" dataKey="bbUpper" stroke="#8b5cf6" strokeWidth={1} strokeDasharray="4 2" dot={false} activeDot={false} isAnimationActive={false} />
            <Line yAxisId="right" type="monotone" dataKey="bbLower" stroke="#8b5cf6" strokeWidth={1} strokeDasharray="4 2" dot={false} activeDot={false} isAnimationActive={false} />
          </>
        )}

        <Bar yAxisId="right" dataKey="candleBody" shape={<CandleStickShape />} name="Price" isAnimationActive={false} />

        {/* Hooks-based close-price tracking line (follows cursor via recharts store, not parent state) */}
        <CursorPriceLine />
      </ComposedChart>
    </ResponsiveContainer>
  );
});

// ----------------------------------------------------------------------
// 3b. Memoized sub-panel chart body
// ----------------------------------------------------------------------

interface SubPanelChartProps {
  view: PanelView;
  displayData: any[];
  settings: IndicatorSettings;
  isTaiwanStock: boolean;
  macdHistCells: React.ReactNode;
  foreignCells: React.ReactNode;
  trustCells: React.ReactNode;
  onMouseMove: (state: any) => void;
  onMouseLeave: () => void;
}

const SubPanelChart: React.FC<SubPanelChartProps> = React.memo(({
  view,
  displayData,
  settings,
  macdHistCells,
  foreignCells,
  trustCells,
  onMouseMove,
  onMouseLeave,
}) => {
  const sharedChartProps = {
    data: displayData,
    syncId: SYNC_ID,
    margin: CHART_MARGIN,
    onMouseMove,
    onMouseLeave,
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      {view === 'foreign' ? (
        <BarChart {...sharedChartProps} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis {...COMMON_Y_AXIS_PROPS} stroke="#94a3b8" tickFormatter={(val) => (val / 1000).toFixed(0)} />
          <Tooltip cursor={<CrosshairCursor />} content={<ChipTooltip title="Foreign" />} />
          <ReferenceLine y={0} stroke="#475569" />
          <Bar dataKey="foreignBuySell" isAnimationActive={false}>
            {foreignCells}
          </Bar>
        </BarChart>
      ) : view === 'trust' ? (
        <BarChart {...sharedChartProps} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis {...COMMON_Y_AXIS_PROPS} stroke="#94a3b8" tickFormatter={(val) => (val / 1000).toFixed(0)} />
          <Tooltip cursor={<CrosshairCursor />} content={<ChipTooltip title="Trust" />} />
          <ReferenceLine y={0} stroke="#475569" />
          <Bar dataKey="investmentTrustBuySell" isAnimationActive={false}>
            {trustCells}
          </Bar>
        </BarChart>
      ) : view === 'macd' ? (
        <ComposedChart {...sharedChartProps} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis {...COMMON_Y_AXIS_PROPS} stroke="#94a3b8" />
          <Tooltip content={<MACDTooltip />} />
          <ReferenceLine y={0} stroke="#475569" />
          <Bar dataKey="macdHist" isAnimationActive={false}>
            {macdHistCells}
          </Bar>
          <Line type="monotone" dataKey="macd" stroke="#fb923c" dot={false} strokeWidth={1.5} name="DIF" isAnimationActive={false} />
          <Line type="monotone" dataKey="macdSignal" stroke="#22d3ee" dot={false} strokeWidth={1.5} name="DEA" isAnimationActive={false} />
        </ComposedChart>
      ) : view === 'kdj' ? (
        <ComposedChart {...sharedChartProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis {...COMMON_Y_AXIS_PROPS} domain={[0, 100]} stroke="#94a3b8" />
          <Tooltip content={<IndicatorTooltip settings={settings} />} />
          <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="3 3" opacity={0.4} />
          <ReferenceLine y={20} stroke="#10b981" strokeDasharray="3 3" opacity={0.4} />
          {settings.showK && <Line type="monotone" dataKey="k" stroke="#facc15" dot={false} strokeWidth={1.5} name="K" isAnimationActive={false} />}
          {settings.showD && <Line type="monotone" dataKey="d" stroke="#f472b6" dot={false} strokeWidth={1.5} name="D" isAnimationActive={false} />}
          {settings.showJ && <Line type="monotone" dataKey="j" stroke="#c084fc" dot={false} strokeWidth={1.5} name="J" isAnimationActive={false} />}
        </ComposedChart>
      ) : (
        <ComposedChart {...sharedChartProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis {...COMMON_Y_AXIS_PROPS} domain={[0, 100]} stroke="#94a3b8" />
          <Tooltip content={<IndicatorTooltip settings={settings} />} />
          <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" opacity={0.4} />
          <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" opacity={0.4} />
          <Line type="monotone" dataKey="rsi" stroke="#38bdf8" dot={false} strokeWidth={2} name="RSI" isAnimationActive={false} />
        </ComposedChart>
      )}
    </ResponsiveContainer>
  );
});

const StockChart: React.FC<StockChartProps> = ({ data, settings, isTaiwanStock, onToggleSetting }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [panel1View, setPanel1View] = useState<PanelView>('foreign');
  const [panel2View, setPanel2View] = useState<PanelView>('trust');

  const [barsToShow, setBarsToShow] = useState(100);

  useEffect(() => {
     setBarsToShow(Math.min(100, data.length));
  }, [data.length]);

  const handleZoom = useCallback((direction: 'in' | 'out') => {
      setBarsToShow(prev => {
          const step = Math.ceil(prev * 0.2);
          if (direction === 'in') return Math.max(20, prev - step);
          else return Math.min(data.length, prev + step);
      });
  }, [data.length]);

  // Keyboard shortcuts: +/- for zoom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); handleZoom('in'); }
      else if (e.key === '-') { e.preventDefault(); handleZoom('out'); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleZoom]);

  const hasChipData = useMemo(() => {
      if (!data || data.length === 0) return false;
      return data.some(d => (d.foreignBuySell !== undefined && d.foreignBuySell !== 0) || (d.investmentTrustBuySell !== undefined && d.investmentTrustBuySell !== 0));
  }, [data]);

  // Pre-compute MAs on full dataset (only recalc when data/settings change, NOT on zoom)
  const maResultsCache = useMemo(() => {
    const useAdj = settings.useAdjusted;
    const allCloses = data.map(d => useAdj && d.closeAdj ? d.closeAdj : d.close);
    const results: Record<number, (number | null)[]> = {};
    for (const line of settings.maLines) {
      results[line.period] = calculateSMA(allCloses, line.period);
    }
    return results;
  }, [data, settings.useAdjusted, settings.maLines]);

  // Transform Data based on Settings (Adj vs Raw) — zoom only re-slices, no SMA recalc
  const displayData = useMemo(() => {
    const useAdj = settings.useAdjusted;
    const startIndex = Math.max(0, data.length - barsToShow);
    const sliced = data.slice(startIndex, data.length);

    return sliced.map((d, i) => {
        const originalIndex = startIndex + i;

        const openVal = useAdj && d.openAdj ? d.openAdj : d.open;
        const closeVal = useAdj && d.closeAdj ? d.closeAdj : d.close;
        const highVal = useAdj && d.highAdj ? d.highAdj : d.high;
        const lowVal = useAdj && d.lowAdj ? d.lowAdj : d.low;

        let priceChange = 0;
        let priceChangePercent = 0;
        if (originalIndex > 0) {
            const prevD = data[originalIndex - 1];
            const prevClose = useAdj && prevD.closeAdj ? prevD.closeAdj : prevD.close;
            priceChange = closeVal - prevClose;
            priceChangePercent = (priceChange / prevClose) * 100;
        }

        // Build dynamic MA fields: ma_5, ma_10, ma_5_dir, etc.
        const maFields: Record<string, any> = {};
        for (const line of settings.maLines) {
          const val = maResultsCache[line.period]?.[originalIndex];
          maFields[`ma_${line.period}`] = val ?? undefined;
          if (originalIndex > 0) {
            const prev = maResultsCache[line.period]?.[originalIndex - 1];
            maFields[`ma_${line.period}_dir`] = (val != null && prev != null)
              ? (val > prev ? 'up' : val < prev ? 'down' : 'flat')
              : 'flat';
          } else {
            maFields[`ma_${line.period}_dir`] = 'flat';
          }
        }

        return {
            ...d,
            open: openVal,
            close: closeVal,
            high: highVal,
            low: lowVal,
            candleBody: [lowVal, highVal],
            ...maFields,
            rsi: useAdj ? d.rsiAdj : d.rsi,
            macd: useAdj ? d.macdAdj : d.macd,
            macdSignal: useAdj ? d.macdSignalAdj : d.macdSignal,
            macdHist: useAdj ? d.macdHistAdj : d.macdHist,
            bbUpper: useAdj ? d.bbUpperAdj : d.bbUpper,
            bbMiddle: useAdj ? d.bbMiddleAdj : d.bbMiddle,
            bbLower: useAdj ? d.bbLowerAdj : d.bbLower,
            bbBand: (useAdj ? d.bbLowerAdj : d.bbLower) != null && (useAdj ? d.bbUpperAdj : d.bbUpper) != null
              ? [(useAdj ? d.bbLowerAdj : d.bbLower), (useAdj ? d.bbUpperAdj : d.bbUpper)]
              : undefined,
            priceChange,
            priceChangePercent
        };
    });
  }, [data, barsToShow, settings.useAdjusted, maResultsCache]);

  const activeData = activeIndex !== null && displayData[activeIndex] ? displayData[activeIndex] : displayData[displayData.length - 1];

  // Throttle mouse move to reduce re-renders (~60fps max)
  const rafRef = useRef<number | null>(null);
  const pendingIndex = useRef<number | null>(null);

  const handleMouseMove = useCallback((state: any) => {
      const newIndex = state?.activeTooltipIndex ?? null;
      if (newIndex === pendingIndex.current) return; // skip if same
      pendingIndex.current = newIndex;
      if (rafRef.current) return; // already scheduled
      rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setActiveIndex(pendingIndex.current);
      });
  }, []);

  const handleMouseLeave = useCallback(() => {
      setActiveIndex(null);
  }, []);

  // Pre-compute Cell arrays to avoid recreating on every render
  const volumeCells = useMemo(() => displayData.map((entry, index) => (
    <Cell key={`vol-${index}`} fill={entry.close >= entry.open ? '#ef4444' : '#10b981'} fillOpacity={0.15} />
  )), [displayData]);

  const macdHistCells = useMemo(() => displayData.map((entry, index) => (
    <Cell key={`hist-${index}`} fill={(entry.macdHist || 0) >= 0 ? '#ef4444' : '#10b981'} />
  )), [displayData]);

  const foreignCells = useMemo(() => displayData.map((entry, index) => (
    <Cell key={`fii-${index}`} fill={(entry.foreignBuySell || 0) > 0 ? '#ef4444' : '#10b981'} />
  )), [displayData]);

  const trustCells = useMemo(() => displayData.map((entry, index) => (
    <Cell key={`it-${index}`} fill={(entry.investmentTrustBuySell || 0) > 0 ? '#ef4444' : '#10b981'} />
  )), [displayData]);

  if (!data || data.length === 0) return <div className="text-gray-400">No data available for chart</div>;

  return (
    <div className="flex flex-col gap-4 w-full relative group">
      
      {/* 1. Price Chart Section */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg relative outline-none">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-2 pr-20">
            <div className="flex items-center gap-2">
                <h3 className="text-slate-200 font-semibold text-lg">K線圖</h3>
                <span className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded uppercase tracking-wider">
                    {settings.useAdjusted ? 'Adj (還原)' : 'Raw (原始)'}
                </span>
            </div>
            <MALegend currentData={activeData} settings={settings} />
        </div>

        <div className="absolute top-4 right-4 flex gap-1 z-10">
            <button onClick={() => handleZoom('out')} className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-l border border-slate-600 transition-colors" title="縮小 (-)">
                <ZoomOut size={16} />
            </button>
            <button onClick={() => handleZoom('in')} className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-r border border-slate-600 transition-colors" title="放大 (+)">
                <ZoomIn size={16} />
            </button>
        </div>
        
        <div className="h-[450px] w-full">
          <MainPriceChart
            displayData={displayData}
            settings={settings}
            isTaiwanStock={isTaiwanStock}
            volumeCells={volumeCells}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        </div>
      </div>

       {/* 2. Sub-panels: two full-width windows with toggle buttons */}
       {[
         { view: panel1View, setView: setPanel1View, id: 1 },
         { view: panel2View, setView: setPanel2View, id: 2 },
       ].map(({ view, setView, id }) => {
         const viewOptions: { key: PanelView; label: string; show: boolean }[] = [
           { key: 'foreign', label: '外資', show: hasChipData },
           { key: 'trust', label: '投信', show: hasChipData },
           { key: 'macd', label: 'MACD', show: settings.showMACD !== false },
           { key: 'kdj', label: 'KDJ', show: settings.showK || settings.showD || settings.showJ },
           { key: 'rsi', label: 'RSI', show: settings.showRSI },
         ];

         const titleMap: Record<PanelView, string> = {
           foreign: '外資買賣超 (Foreign Net Buy/Sell)',
           trust: '投信買賣超 (Trust Net Buy/Sell)',
           macd: 'MACD (10, 20, 10)',
           kdj: 'KDJ (5, 3, 3)',
           rsi: 'RSI (14)',
         };

         return (
           <div key={`panel-${id}`} className="bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-lg outline-none">
             <div className="flex items-center justify-between mb-2">
               <h3 className="text-slate-200 font-medium text-sm">{titleMap[view]}</h3>
               <div className="flex gap-1">
                 {viewOptions.filter(o => o.show).map(o => (
                   <button
                     key={o.key}
                     onClick={() => setView(o.key)}
                     className={`px-2.5 py-1 text-xs rounded transition-colors ${
                       view === o.key
                         ? 'bg-blue-600 text-white'
                         : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
                     }`}
                   >
                     {o.label}
                   </button>
                 ))}
               </div>
             </div>
             <div className="h-[180px] w-full">
               <SubPanelChart
                 view={view}
                 displayData={displayData}
                 settings={settings}
                 isTaiwanStock={isTaiwanStock}
                 macdHistCells={macdHistCells}
                 foreignCells={foreignCells}
                 trustCells={trustCells}
                 onMouseMove={handleMouseMove}
                 onMouseLeave={handleMouseLeave}
               />
             </div>
           </div>
         );
       })}
    </div>
  );
};

export default StockChart;